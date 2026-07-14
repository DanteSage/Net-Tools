const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

let mainWindow;
let captureProcess = null;
let packetBuffer = [];
let packetId = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile('src/index.html');
}

// 获取 WinDivert netdump 路径
function getNetdumpPath() {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, 'lib', 'netdump.exe');
  }
  return path.join(process.resourcesPath, 'lib', 'netdump.exe');
}

// 获取 lib 目录路径
function getLibPath() {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, 'lib');
  }
  return path.join(process.resourcesPath, 'lib');
}


// 格式化 IPv6 地址
function formatIPv6(bytes) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) {
    parts.push(bytes.readUInt16BE(i).toString(16));
  }
  // 简化 IPv6 地址（压缩连续的 0）
  let str = parts.join(':');
  str = str.replace(/\b0+/g, ''); // 移除前导 0
  str = str.replace(/:{2,}/, '::'); // 压缩连续的 :
  return str || '::';
}

// 解析 HTTP 内容
function parseHttpContent(payload) {
  try {
    const text = payload.toString('utf8');
    const lines = text.split('\r\n');
    if (lines.length === 0) return null;

    const firstLine = lines[0];
    const httpLayer = {
      name: 'Hypertext Transfer Protocol',
      short: 'HTTP',
      fields: []
    };

    // 检测 HTTP 请求
    const reqMatch = firstLine.match(/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+(.+?)\s+HTTP\/(\d\.\d)/);
    if (reqMatch) {
      httpLayer.fields.push({ name: '方法', value: reqMatch[1] });
      httpLayer.fields.push({ name: 'URI', value: reqMatch[2] });
      httpLayer.fields.push({ name: '版本', value: `HTTP/${reqMatch[3]}` });
      httpLayer.isRequest = true;
      httpLayer.method = reqMatch[1];
      httpLayer.uri = reqMatch[2];
    }

    // 检测 HTTP 响应
    const respMatch = firstLine.match(/^HTTP\/(\d\.\d)\s+(\d+)\s+(.*)/);
    if (respMatch) {
      httpLayer.fields.push({ name: '版本', value: `HTTP/${respMatch[1]}` });
      httpLayer.fields.push({ name: '状态码', value: respMatch[2] });
      httpLayer.fields.push({ name: '状态', value: respMatch[3] });
      httpLayer.isResponse = true;
      httpLayer.statusCode = parseInt(respMatch[2]);
    }

    if (!reqMatch && !respMatch) return null;

    // 解析头部
    for (let i = 1; i < lines.length && lines[i]; i++) {
      const colonIdx = lines[i].indexOf(':');
      if (colonIdx > 0) {
        const name = lines[i].substring(0, colonIdx).trim();
        const value = lines[i].substring(colonIdx + 1).trim();
        if (name.toLowerCase() === 'host') {
          httpLayer.fields.push({ name: 'Host', value });
          httpLayer.host = value;
        } else if (name.toLowerCase() === 'content-type') {
          httpLayer.fields.push({ name: 'Content-Type', value });
        } else if (name.toLowerCase() === 'content-length') {
          httpLayer.fields.push({ name: 'Content-Length', value });
        } else if (name.toLowerCase() === 'user-agent') {
          httpLayer.fields.push({ name: 'User-Agent', value: value.substring(0, 50) + (value.length > 50 ? '...' : '') });
        }
      }
    }

    return httpLayer;
  } catch (e) {
    return null;
  }
}

// TCP 标志解析
function parseTcpFlags(flags) {
  const flagNames = [];
  if (flags & 0x01) flagNames.push('FIN');
  if (flags & 0x02) flagNames.push('SYN');
  if (flags & 0x04) flagNames.push('RST');
  if (flags & 0x08) flagNames.push('PSH');
  if (flags & 0x10) flagNames.push('ACK');
  if (flags & 0x20) flagNames.push('URG');
  if (flags & 0x40) flagNames.push('ECE');
  if (flags & 0x80) flagNames.push('CWR');
  return flagNames;
}

// 解析十六进制数据为详细的数据包信息
function parseHexPacket(hexData, timestamp) {
  try {
    const bytes = Buffer.from(hexData.replace(/\s+/g, ''), 'hex');
    if (bytes.length < 20) return null;

    const packet = {
      id: ++packetId,
      timestamp: timestamp || new Date().toISOString(),
      rawHex: hexData,
      rawBytes: bytes,
      length: bytes.length,
      layers: []
    };

    // 解析 IP 头部
    const ipVersion = (bytes[0] >> 4) & 0x0F;
    let ipHeaderLen, ipProtocol, srcIp, dstIp, ipTotalLen;

    if (ipVersion === 6) {
      // IPv6
      if (bytes.length < 40) return null;
      ipHeaderLen = 40;
      const trafficClass = ((bytes[0] & 0x0F) << 4) | ((bytes[1] >> 4) & 0x0F);
      const flowLabel = ((bytes[1] & 0x0F) << 16) | bytes.readUInt16BE(2);
      const payloadLength = bytes.readUInt16BE(4);
      ipProtocol = bytes[6]; // Next Header
      const hopLimit = bytes[7];
      ipTotalLen = 40 + payloadLength;

      // 解析 IPv6 地址
      srcIp = formatIPv6(bytes.slice(8, 24));
      dstIp = formatIPv6(bytes.slice(24, 40));

      packet.srcIp = srcIp;
      packet.dstIp = dstIp;
      packet.ipVersion = 6;

      const ipLayer = {
        name: 'Internet Protocol Version 6',
        short: 'IPv6',
        fields: [
          { name: '版本', value: 6 },
          { name: '流量类别', value: `0x${trafficClass.toString(16).padStart(2, '0')}` },
          { name: '流标签', value: `0x${flowLabel.toString(16).padStart(5, '0')}` },
          { name: '负载长度', value: `${payloadLength} bytes` },
          { name: '下一个头', value: getProtocolName(ipProtocol) },
          { name: '跳限制', value: hopLimit },
          { name: '源地址', value: srcIp },
          { name: '目标地址', value: dstIp }
        ]
      };
      packet.layers.push(ipLayer);

    } else if (ipVersion === 4) {
      // IPv4
      ipHeaderLen = (bytes[0] & 0x0F) * 4;
      ipTotalLen = bytes.readUInt16BE(2);
      const ipId = bytes.readUInt16BE(4);
      const ipFlagsOffset = bytes.readUInt16BE(6);
      const ipFlags = (ipFlagsOffset >> 13) & 0x07;
      const ipOffset = ipFlagsOffset & 0x1FFF;
      const ipTTL = bytes[8];
      ipProtocol = bytes[9];
      const ipChecksum = bytes.readUInt16BE(10);
      srcIp = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
      dstIp = `${bytes[16]}.${bytes[17]}.${bytes[18]}.${bytes[19]}`;

      packet.srcIp = srcIp;
      packet.dstIp = dstIp;
      packet.ipVersion = 4;

      const ipLayer = {
      name: 'Internet Protocol Version 4',
      short: 'IPv4',
      fields: [
        { name: '版本', value: ipVersion },
        { name: '头部长度', value: `${ipHeaderLen} bytes` },
        { name: '服务类型 (DSCP)', value: `0x${bytes[1].toString(16).padStart(2, '0')}` },
        { name: '总长度', value: `${ipTotalLen} bytes` },
        { name: '标识', value: `0x${ipId.toString(16).padStart(4, '0')} (${ipId})` },
        { name: '标志', value: `0x${ipFlags.toString(16)} (${ipFlags & 0x02 ? 'DF ' : ''}${ipFlags & 0x01 ? 'MF' : ''})`.trim() },
        { name: '片偏移', value: ipOffset },
        { name: '生存时间 (TTL)', value: ipTTL },
        { name: '协议', value: getProtocolName(ipProtocol) },
        { name: '头部校验和', value: `0x${ipChecksum.toString(16).padStart(4, '0')}` },
        { name: '源地址', value: srcIp },
        { name: '目标地址', value: dstIp }
      ]
      };
      packet.layers.push(ipLayer);
    } else {
      return null; // 不支持的 IP 版本
    }

    // 根据协议解析传输层
    let srcPort = 0, dstPort = 0;
    let info = '';

    if (ipProtocol === 6 && bytes.length >= ipHeaderLen + 20) {
      // TCP
      packet.protocol = 'TCP';
      const tcpOffset = ipHeaderLen;
      srcPort = bytes.readUInt16BE(tcpOffset);
      dstPort = bytes.readUInt16BE(tcpOffset + 2);
      const seqNum = bytes.readUInt32BE(tcpOffset + 4);
      const ackNum = bytes.readUInt32BE(tcpOffset + 8);
      const dataOffset = ((bytes[tcpOffset + 12] >> 4) & 0x0F) * 4;
      const tcpFlags = bytes[tcpOffset + 13];
      const windowSize = bytes.readUInt16BE(tcpOffset + 14);
      const tcpChecksum = bytes.readUInt16BE(tcpOffset + 16);
      const urgentPtr = bytes.readUInt16BE(tcpOffset + 18);

      const flagNames = parseTcpFlags(tcpFlags);
      info = `${srcPort} → ${dstPort} [${flagNames.join(', ')}] Seq=${seqNum} Ack=${ackNum} Win=${windowSize}`;

      const tcpFields = [
        { name: '源端口', value: `${srcPort} (${getPortName(srcPort)})` },
        { name: '目标端口', value: `${dstPort} (${getPortName(dstPort)})` },
        { name: '序列号', value: seqNum },
        { name: '确认号', value: ackNum },
        { name: '头部长度', value: `${dataOffset} bytes` },
        { name: '标志', value: `0x${tcpFlags.toString(16).padStart(2, '0')} (${flagNames.join(', ')})` },
        { name: '窗口大小', value: windowSize },
        { name: '校验和', value: `0x${tcpChecksum.toString(16).padStart(4, '0')}` },
        { name: '紧急指针', value: urgentPtr }
      ];
      
      // 解析 TCP 选项
      if (dataOffset > 20) {
        const options = parseTcpOptions(bytes, tcpOffset + 20, dataOffset - 20);
        if (options.length > 0) {
          tcpFields.push({ name: 'TCP 选项', value: options.map(o => o.name).join(', ') });
          options.forEach(opt => {
            if (opt.detail) tcpFields.push({ name: `  ${opt.name}`, value: opt.detail });
          });
        }
      }
      
      const tcpLayer = {
        name: 'Transmission Control Protocol',
        short: 'TCP',
        fields: tcpFields
      };
      packet.layers.push(tcpLayer);

      // 应用层数据
      const payloadOffset = ipHeaderLen + dataOffset;
      if (bytes.length > payloadOffset) {
        const payload = bytes.slice(payloadOffset);
        packet.payload = payload;
        packet.payloadLen = payload.length;
        
        // 尝试识别应用层协议
        if (dstPort === 80 || srcPort === 80) {
          packet.appProtocol = 'HTTP';
          // 解析 HTTP 内容
          const httpLayer = parseHttpContent(payload);
          if (httpLayer) {
            packet.layers.push(httpLayer);
            if (httpLayer.isRequest) {
              info = `HTTP ${httpLayer.method} ${httpLayer.uri}`;
            } else if (httpLayer.isResponse) {
              info = `HTTP ${httpLayer.statusCode} ${httpLayer.fields.find(f => f.name === '状态')?.value || ''}`;
            }
          }
        } else if (dstPort === 443 || srcPort === 443) {
          packet.appProtocol = 'HTTPS/TLS';
          // 解析 TLS 记录
          const tlsLayer = parseTlsRecord(payload);
          if (tlsLayer) packet.layers.push(tlsLayer);
        } else if (dstPort === 22 || srcPort === 22) {
          packet.appProtocol = 'SSH';
        } else if (dstPort === 21 || srcPort === 21) {
          packet.appProtocol = 'FTP';
        } else if (dstPort === 25 || srcPort === 25) {
          packet.appProtocol = 'SMTP';
        } else if (dstPort === 110 || srcPort === 110) {
          packet.appProtocol = 'POP3';
        } else if (dstPort === 143 || srcPort === 143) {
          packet.appProtocol = 'IMAP';
        } else if (dstPort === 3306 || srcPort === 3306) {
          packet.appProtocol = 'MySQL';
        } else if (dstPort === 5432 || srcPort === 5432) {
          packet.appProtocol = 'PostgreSQL';
        } else if (dstPort === 6379 || srcPort === 6379) {
          packet.appProtocol = 'Redis';
        } else if (dstPort === 27017 || srcPort === 27017) {
          packet.appProtocol = 'MongoDB';
        } else if (dstPort === 3389 || srcPort === 3389) {
          packet.appProtocol = 'RDP';
        } else if (dstPort === 8080 || srcPort === 8080 || dstPort === 8443 || srcPort === 8443) {
          packet.appProtocol = 'HTTP-ALT';
          const httpLayer = parseHttpContent(payload);
          if (httpLayer) packet.layers.push(httpLayer);
        }
      }

    } else if (ipProtocol === 17 && bytes.length >= ipHeaderLen + 8) {
      // UDP
      packet.protocol = 'UDP';
      const udpOffset = ipHeaderLen;
      srcPort = bytes.readUInt16BE(udpOffset);
      dstPort = bytes.readUInt16BE(udpOffset + 2);
      const udpLength = bytes.readUInt16BE(udpOffset + 4);
      const udpChecksum = bytes.readUInt16BE(udpOffset + 6);

      info = `${srcPort} → ${dstPort} Len=${udpLength - 8}`;

      const udpLayer = {
        name: 'User Datagram Protocol',
        short: 'UDP',
        fields: [
          { name: '源端口', value: `${srcPort} (${getPortName(srcPort)})` },
          { name: '目标端口', value: `${dstPort} (${getPortName(dstPort)})` },
          { name: '长度', value: `${udpLength} bytes` },
          { name: '数据长度', value: `${udpLength - 8} bytes` },
          { name: '校验和', value: `0x${udpChecksum.toString(16).padStart(4, '0')}` }
        ]
      };
      packet.layers.push(udpLayer);

      // DNS 解析
      if (srcPort === 53 || dstPort === 53) {
        packet.appProtocol = 'DNS';
        const dnsOffset = udpOffset + 8;
        if (bytes.length > dnsOffset + 12) {
          const dnsId = bytes.readUInt16BE(dnsOffset);
          const dnsFlags = bytes.readUInt16BE(dnsOffset + 2);
          const qdCount = bytes.readUInt16BE(dnsOffset + 4);
          const anCount = bytes.readUInt16BE(dnsOffset + 6);
          const nsCount = bytes.readUInt16BE(dnsOffset + 8);
          const arCount = bytes.readUInt16BE(dnsOffset + 10);
          const isResponse = (dnsFlags & 0x8000) !== 0;
          const opcode = (dnsFlags >> 11) & 0x0F;
          const rcode = dnsFlags & 0x0F;
          
          // 解析查询名称
          let queryName = '';
          try {
            queryName = parseDnsName(bytes, dnsOffset + 12);
          } catch (e) {}
          
          const dnsFields = [
            { name: '事务 ID', value: `0x${dnsId.toString(16).padStart(4, '0')}` },
            { name: '类型', value: isResponse ? '响应' : '查询' },
            { name: '操作码', value: getDnsOpcode(opcode) },
            { name: '标志', value: getDnsFlags(dnsFlags) },
          ];
          
          if (isResponse) {
            dnsFields.push({ name: '响应码', value: getDnsRcode(rcode) });
          }
          
          dnsFields.push(
            { name: '问题数', value: qdCount },
            { name: '回答数', value: anCount },
            { name: '授权数', value: nsCount },
            { name: '附加数', value: arCount }
          );
          
          if (queryName) {
            dnsFields.push({ name: '查询名称', value: queryName });
          }
          
          const dnsLayer = {
            name: 'Domain Name System',
            short: 'DNS',
            fields: dnsFields
          };
          packet.layers.push(dnsLayer);
          info = `DNS ${isResponse ? 'Response' : 'Query'} ${queryName || `0x${dnsId.toString(16)}`}`;
        }
      }
      
      // DHCP 解析
      if ((srcPort === 67 || srcPort === 68) && (dstPort === 67 || dstPort === 68)) {
        packet.appProtocol = 'DHCP';
      }
      
      // NTP 解析
      if (srcPort === 123 || dstPort === 123) {
        packet.appProtocol = 'NTP';
      }

      const payloadOffset = udpOffset + 8;
      if (bytes.length > payloadOffset) {
        packet.payload = bytes.slice(payloadOffset);
        packet.payloadLen = packet.payload.length;
      }

    } else if (ipProtocol === 1) {
      // ICMP
      packet.protocol = 'ICMP';
      const icmpOffset = ipHeaderLen;
      const icmpType = bytes[icmpOffset];
      const icmpCode = bytes[icmpOffset + 1];
      const icmpChecksum = bytes.readUInt16BE(icmpOffset + 2);

      const icmpTypes = {
        0: 'Echo Reply',
        3: 'Destination Unreachable',
        4: 'Source Quench',
        5: 'Redirect',
        8: 'Echo Request',
        9: 'Router Advertisement',
        10: 'Router Solicitation',
        11: 'Time Exceeded',
        12: 'Parameter Problem',
        13: 'Timestamp Request',
        14: 'Timestamp Reply'
      };
      
      const icmpFields = [
        { name: '类型', value: `${icmpType} (${icmpTypes[icmpType] || 'Unknown'})` },
        { name: '代码', value: `${icmpCode} (${getIcmpCodeDesc(icmpType, icmpCode)})` },
        { name: '校验和', value: `0x${icmpChecksum.toString(16).padStart(4, '0')}` }
      ];
      
      // Echo Request/Reply 的额外字段
      if (icmpType === 0 || icmpType === 8) {
        if (bytes.length >= icmpOffset + 8) {
          const identifier = bytes.readUInt16BE(icmpOffset + 4);
          const sequence = bytes.readUInt16BE(icmpOffset + 6);
          icmpFields.push({ name: '标识符', value: identifier });
          icmpFields.push({ name: '序列号', value: sequence });
          info = `${icmpTypes[icmpType]} id=${identifier} seq=${sequence}`;
        }
      } else {
        info = `${icmpTypes[icmpType] || `Type ${icmpType}`} Code=${icmpCode}`;
      }

      const icmpLayer = {
        name: 'Internet Control Message Protocol',
        short: 'ICMP',
        fields: icmpFields
      };
      packet.layers.push(icmpLayer);

    } else {
      packet.protocol = getProtocolName(ipProtocol);
      info = `Protocol: ${packet.protocol}`;
    }

    packet.srcPort = srcPort;
    packet.dstPort = dstPort;
    packet.info = info || `${srcIp} → ${dstIp}`;

    return packet;
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

// 协议名称映射
function getProtocolName(num) {
  const protocols = {
    1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6',
    47: 'GRE', 50: 'ESP', 51: 'AH', 58: 'ICMPv6', 89: 'OSPF',
    132: 'SCTP', 136: 'UDPLite'
  };
  return protocols[num] || `Protocol ${num}`;
}

// 端口名称映射
function getPortName(port) {
  const ports = {
    20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
    53: 'DNS', 67: 'DHCP-S', 68: 'DHCP-C', 80: 'HTTP', 110: 'POP3',
    123: 'NTP', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 993: 'IMAPS',
    995: 'POP3S', 1433: 'MSSQL', 1521: 'Oracle', 3306: 'MySQL',
    3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis',
    8080: 'HTTP-ALT', 8443: 'HTTPS-ALT', 27017: 'MongoDB'
  };
  return ports[port] || '';
}

// TCP 选项解析
function parseTcpOptions(bytes, offset, length) {
  const options = [];
  let pos = offset;
  const end = offset + length;
  
  while (pos < end) {
    const kind = bytes[pos];
    if (kind === 0) break; // End of Options
    if (kind === 1) { pos++; continue; } // NOP
    
    const len = bytes[pos + 1] || 2;
    
    switch (kind) {
      case 2: // MSS
        if (len >= 4) {
          const mss = bytes.readUInt16BE(pos + 2);
          options.push({ name: 'MSS', detail: `${mss} bytes` });
        }
        break;
      case 3: // Window Scale
        if (len >= 3) {
          const scale = bytes[pos + 2];
          options.push({ name: 'Window Scale', detail: `${scale} (乘数 ${1 << scale})` });
        }
        break;
      case 4: // SACK Permitted
        options.push({ name: 'SACK Permitted', detail: '' });
        break;
      case 5: // SACK
        options.push({ name: 'SACK', detail: `${(len - 2) / 8} 块` });
        break;
      case 8: // Timestamp
        if (len >= 10) {
          const tsVal = bytes.readUInt32BE(pos + 2);
          const tsEcr = bytes.readUInt32BE(pos + 6);
          options.push({ name: 'Timestamp', detail: `TSval=${tsVal}, TSecr=${tsEcr}` });
        }
        break;
    }
    pos += len;
  }
  return options;
}

// DNS 名称解析
function parseDnsName(bytes, offset) {
  let name = '';
  let pos = offset;
  let jumped = false;
  let maxJumps = 10;
  
  while (maxJumps-- > 0) {
    const len = bytes[pos];
    if (len === 0) break;
    
    // 压缩指针
    if ((len & 0xC0) === 0xC0) {
      const pointer = ((len & 0x3F) << 8) | bytes[pos + 1];
      if (!jumped) pos += 2;
      pos = pointer;
      jumped = true;
      continue;
    }
    
    if (name) name += '.';
    name += bytes.slice(pos + 1, pos + 1 + len).toString('ascii');
    pos += len + 1;
  }
  return name;
}

// DNS 操作码
function getDnsOpcode(opcode) {
  const opcodes = { 0: '标准查询', 1: '反向查询', 2: '服务器状态', 4: '通知', 5: '更新' };
  return opcodes[opcode] || `未知(${opcode})`;
}

// DNS 标志
function getDnsFlags(flags) {
  const parts = [];
  if (flags & 0x0400) parts.push('AA');
  if (flags & 0x0200) parts.push('TC');
  if (flags & 0x0100) parts.push('RD');
  if (flags & 0x0080) parts.push('RA');
  return parts.join(', ') || '无';
}

// DNS 响应码
function getDnsRcode(rcode) {
  const rcodes = { 0: '无错误', 1: '格式错误', 2: '服务器失败', 3: '名称不存在', 4: '不支持', 5: '拒绝' };
  return rcodes[rcode] || `错误(${rcode})`;
}

// ICMP 代码描述
function getIcmpCodeDesc(type, code) {
  if (type === 3) {
    const codes = {
      0: '网络不可达', 1: '主机不可达', 2: '协议不可达', 3: '端口不可达',
      4: '需要分片但设置了DF', 5: '源路由失败', 13: '管理禁止'
    };
    return codes[code] || '';
  }
  if (type === 11) {
    return code === 0 ? 'TTL超时' : '分片重组超时';
  }
  return '';
}

// TLS 记录解析
function parseTlsRecord(payload) {
  if (!payload || payload.length < 5) return null;
  
  const contentType = payload[0];
  const version = payload.readUInt16BE(1);
  const length = payload.readUInt16BE(3);
  
  const contentTypes = { 20: 'ChangeCipherSpec', 21: 'Alert', 22: 'Handshake', 23: 'Application Data' };
  const versions = { 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' };
  
  if (!contentTypes[contentType]) return null;
  
  const fields = [
    { name: '内容类型', value: contentTypes[contentType] || `未知(${contentType})` },
    { name: '版本', value: versions[version] || `0x${version.toString(16)}` },
    { name: '长度', value: `${length} bytes` }
  ];
  
  // Handshake 类型详情
  if (contentType === 22 && payload.length > 5) {
    const hsType = payload[5];
    const hsTypes = { 1: 'ClientHello', 2: 'ServerHello', 11: 'Certificate', 12: 'ServerKeyExchange', 14: 'ServerHelloDone', 16: 'ClientKeyExchange' };
    fields.push({ name: '握手类型', value: hsTypes[hsType] || `未知(${hsType})` });
  }
  
  return {
    name: 'Transport Layer Security',
    short: 'TLS',
    fields
  };
}

// 解析 netdump 输出的数据包
function parseNetdumpOutput(data) {
  const packets = [];
  const lines = data.split('\n');
  let currentHex = '';
  let timestamp = new Date().toISOString();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 检测是否是十六进制数据行
    if (/^[0-9a-fA-F\s]+$/.test(trimmed) && trimmed.length > 10) {
      currentHex += trimmed + ' ';
    } else {
      // 如果有累积的十六进制数据，解析它
      if (currentHex.length > 20) {
        const packet = parseHexPacket(currentHex, timestamp);
        if (packet) packets.push(packet);
      }
      currentHex = '';
      timestamp = new Date().toISOString();

      // 尝试从行中提取十六进制数据
      const hexMatch = trimmed.match(/([0-9a-fA-F]{2}[\s]*){20,}/);
      if (hexMatch) {
        currentHex = hexMatch[0];
      }
    }
  }

  // 处理最后的数据
  if (currentHex.length > 20) {
    const packet = parseHexPacket(currentHex, timestamp);
    if (packet) packets.push(packet);
  }

  return packets;
}

// 简单解析（备用）
function parseSimplePacket(line) {
  try {
    const timestamp = new Date().toISOString();
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return null;

    let srcIp = '', dstIp = '', srcPort = '', dstPort = '', protocol = 'UNKNOWN', length = 0;
    
    const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+):?(\d+)?\s*->\s*(\d+\.\d+\.\d+\.\d+):?(\d+)?/);
    if (ipMatch) {
      srcIp = ipMatch[1] || '';
      srcPort = ipMatch[2] || '';
      dstIp = ipMatch[3] || '';
      dstPort = ipMatch[4] || '';
    }

    if (line.includes('TCP')) protocol = 'TCP';
    else if (line.includes('UDP')) protocol = 'UDP';
    else if (line.includes('ICMP')) protocol = 'ICMP';

    const lenMatch = line.match(/len[=:]?\s*(\d+)/i);
    if (lenMatch) length = parseInt(lenMatch[1]);

    return {
      id: ++packetId,
      timestamp,
      srcIp, srcPort, dstIp, dstPort,
      protocol,
      length,
      info: line.substring(0, 200),
      raw: line,
      layers: []
    };
  } catch (e) {
    return null;
  }
}

// 开始抓包（直接启动 netdump.exe，需要管理员权限运行应用）
ipcMain.handle('start-capture', async (event, filter) => {
  try {
    // 清空缓存
    packetBuffer = [];
    packetId = 0;

    // 如果已经在抓包，先停止
    if (captureProcess) {
      captureProcess.kill();
      captureProcess = null;
    }

    const netdumpPath = getNetdumpPath();
    const libPath = getLibPath();

    // 检查 netdump.exe 是否存在
    if (!fs.existsSync(netdumpPath)) {
      return { success: false, error: `找不到 netdump.exe: ${netdumpPath}` };
    }

    // 启动 netdump 进程
    const windivertFilter = filter || 'true';
    console.log('启动抓包，过滤器:', windivertFilter);

    captureProcess = spawn(netdumpPath, [windivertFilter], {
      cwd: libPath,
      windowsHide: true
    });

    let hexBuffer = '';

    captureProcess.stdout.on('data', (data) => {
      const text = data.toString();
      hexBuffer += text;

      // 解析输出中的数据包
      const packets = parseNetdumpOutput(hexBuffer);
      packets.forEach(packet => {
        packetBuffer.push(packet);
        packetId = Math.max(packetId, packet.id || 0);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('packet-received', packet);
        }
      });

      // 保留最后一行（可能不完整）
      const lastNewline = hexBuffer.lastIndexOf('\n');
      if (lastNewline > 0 && packets.length > 0) {
        hexBuffer = hexBuffer.substring(lastNewline + 1);
      }
    });

    captureProcess.stderr.on('data', (data) => {
      console.error('Capture stderr:', data.toString());
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-error', data.toString());
      }
    });

    captureProcess.on('close', (code) => {
      console.log('抓包进程退出，代码:', code);
      captureProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-stopped');
      }
    });

    captureProcess.on('error', (err) => {
      console.error('抓包进程错误:', err);
      captureProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-error', err.message);
      }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 停止抓包
ipcMain.handle('stop-capture', async () => {
  try {
    if (captureProcess) {
      captureProcess.kill();
      captureProcess = null;
      console.log('抓包已停止');
      return { success: true };
    }
    return { success: false, error: '没有正在运行的抓包进程' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 清除数据
ipcMain.handle('clear-packets', async () => {
  packetBuffer = [];
  return { success: true };
});

// 导出数据
ipcMain.handle('export-packets', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出抓包数据',
    defaultPath: `capture_${Date.now()}.pcap`,
    filters: [
      { name: 'PCAP (Wireshark)', extensions: ['pcap', 'pcapng'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      if (result.filePath.endsWith('.pcap') || result.filePath.endsWith('.pcapng')) {
        const pcapData = createPcapFile(packetBuffer);
        fs.writeFileSync(result.filePath, pcapData);
      } else if (result.filePath.endsWith('.csv')) {
        const csv = ['时间,源IP,源端口,目标IP,目标端口,协议,长度,信息']
          .concat(packetBuffer.map(p => 
            `${p.timestamp},${p.srcIp},${p.srcPort},${p.dstIp},${p.dstPort},${p.protocol},${p.length},"${(p.info || '').replace(/"/g, '""')}"`
          ))
          .join('\n');
        fs.writeFileSync(result.filePath, '\ufeff' + csv, 'utf8');
      } else {
        fs.writeFileSync(result.filePath, JSON.stringify(packetBuffer, null, 2));
      }
      return { success: true, path: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: '取消保存' };
});

// 导入 PCAP 文件
ipcMain.handle('import-packets', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入抓包文件',
    filters: [
      { name: 'PCAP 文件', extensions: ['pcap', 'pcapng', 'cap'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const filePath = result.filePaths[0];
      const data = fs.readFileSync(filePath);
      const packets = parsePcapFile(data);
      
      // 清空当前数据并加载新数据
      packetBuffer = packets;
      
      return { success: true, packets: packets, count: packets.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: '取消导入' };
});

// 解析 PCAP/PCAPNG 文件
function parsePcapFile(buffer) {
  if (buffer.length < 8) return [];
  
  const magic = buffer.readUInt32LE(0);
  
  // 检查是否为 PCAPNG 格式 (Section Header Block)
  if (magic === 0x0A0D0D0A) {
    return parsePcapngFile(buffer);
  }
  
  // 传统 PCAP 格式
  return parsePcapLegacy(buffer);
}

// 解析传统 PCAP 格式
function parsePcapLegacy(buffer) {
  const packets = [];
  let offset = 0;
  
  if (buffer.length < 24) return packets;
  
  const magic = buffer.readUInt32LE(0);
  let isLittleEndian = true;
  let isNanosec = false;
  
  if (magic === 0xa1b2c3d4) {
    isLittleEndian = true;
  } else if (magic === 0xd4c3b2a1) {
    isLittleEndian = false;
  } else if (magic === 0xa1b23c4d) {
    isLittleEndian = true;
    isNanosec = true;
  } else if (magic === 0x4d3cb2a1) {
    isLittleEndian = false;
    isNanosec = true;
  } else {
    throw new Error('无效的 PCAP 文件格式');
  }
  
  const readUInt32 = isLittleEndian 
    ? (buf, off) => buf.readUInt32LE(off)
    : (buf, off) => buf.readUInt32BE(off);
  
  const linkType = readUInt32(buffer, 20);
  offset = 24;
  
  let packetId = 0;
  
  while (offset + 16 <= buffer.length) {
    const tsSec = readUInt32(buffer, offset);
    const tsUsec = readUInt32(buffer, offset + 4);
    const capturedLen = readUInt32(buffer, offset + 8);
    offset += 16;
    
    if (offset + capturedLen > buffer.length) break;
    
    let rawBytes = buffer.slice(offset, offset + capturedLen);
    offset += capturedLen;
    
    const ipData = extractIpData(rawBytes, linkType);
    const timestamp = new Date(tsSec * 1000 + (isNanosec ? tsUsec / 1000000 : tsUsec / 1000));
    const packet = parseIpPacketFromBuffer(ipData, ++packetId, timestamp);
    packet.rawBytes = Array.from(rawBytes);
    packets.push(packet);
  }
  
  return packets;
}

// 解析 PCAPNG 格式
function parsePcapngFile(buffer) {
  const packets = [];
  let offset = 0;
  let packetId = 0;
  let interfaces = []; // 存储接口信息
  let isLittleEndian = true;
  
  while (offset + 8 <= buffer.length) {
    const blockType = buffer.readUInt32LE(offset);
    const blockLen = buffer.readUInt32LE(offset + 4);
    
    if (blockLen < 12 || offset + blockLen > buffer.length) break;
    
    // 检查字节序 - 通过 SHB 的 Byte-Order Magic
    if (blockType === 0x0A0D0D0A && blockLen >= 16) {
      const byteOrderMagic = buffer.readUInt32LE(offset + 8);
      isLittleEndian = (byteOrderMagic === 0x1A2B3C4D);
    }
    
    const readUInt32 = isLittleEndian
      ? (off) => buffer.readUInt32LE(off)
      : (off) => buffer.readUInt32BE(off);
    const readUInt16 = isLittleEndian
      ? (off) => buffer.readUInt16LE(off)
      : (off) => buffer.readUInt16BE(off);
    
    switch (blockType) {
      case 0x0A0D0D0A: // Section Header Block
        interfaces = [];
        break;
        
      case 0x00000001: // Interface Description Block
        if (blockLen >= 20) {
          const linkType = readUInt16(offset + 8);
          interfaces.push({ linkType });
        }
        break;
        
      case 0x00000006: // Enhanced Packet Block
        if (blockLen >= 32) {
          const interfaceId = readUInt32(offset + 8);
          const tsHigh = readUInt32(offset + 12);
          const tsLow = readUInt32(offset + 16);
          const capturedLen = readUInt32(offset + 20);
          const originalLen = readUInt32(offset + 24);
          
          const dataOffset = offset + 28;
          if (dataOffset + capturedLen <= buffer.length) {
            const rawBytes = buffer.slice(dataOffset, dataOffset + capturedLen);
            const linkType = interfaces[interfaceId]?.linkType || 1;
            const ipData = extractIpData(rawBytes, linkType);
            
            // 时间戳 (微秒)
            const tsMicros = (BigInt(tsHigh) << 32n) | BigInt(tsLow);
            const timestamp = new Date(Number(tsMicros / 1000n));
            
            const packet = parseIpPacketFromBuffer(ipData, ++packetId, timestamp);
            packet.rawBytes = Array.from(rawBytes);
            packets.push(packet);
          }
        }
        break;
        
      case 0x00000003: // Simple Packet Block
        if (blockLen >= 16) {
          const originalLen = readUInt32(offset + 8);
          const capturedLen = blockLen - 16;
          const dataOffset = offset + 12;
          
          if (dataOffset + capturedLen <= buffer.length) {
            const rawBytes = buffer.slice(dataOffset, dataOffset + capturedLen);
            const linkType = interfaces[0]?.linkType || 1;
            const ipData = extractIpData(rawBytes, linkType);
            
            const packet = parseIpPacketFromBuffer(ipData, ++packetId, new Date());
            packet.rawBytes = Array.from(rawBytes);
            packets.push(packet);
          }
        }
        break;
    }
    
    offset += blockLen;
  }
  
  return packets;
}

// 从原始数据中提取 IP 数据
function extractIpData(rawBytes, linkType) {
  // linkType 1 = Ethernet, 101 = Raw IP
  if (linkType === 1 && rawBytes.length > 14) {
    const etherType = rawBytes.readUInt16BE(12);
    if (etherType === 0x0800 || etherType === 0x86DD) {
      return rawBytes.slice(14);
    }
  }
  return rawBytes;
}

// 从 Buffer 解析 IP 包
function parseIpPacketFromBuffer(buffer, id, timestamp) {
  const packet = {
    id: id,
    timestamp: timestamp.toISOString().replace('T', ' ').substring(0, 23),
    srcIp: '',
    dstIp: '',
    srcPort: null,
    dstPort: null,
    protocol: 'IP',
    length: buffer.length,
    info: '',
    layers: [],
    rawBytes: Array.from(buffer)
  };
  
  if (buffer.length < 20) return packet;
  
  const version = (buffer[0] >> 4) & 0x0f;
  
  if (version === 4) {
    // IPv4
    const ihl = (buffer[0] & 0x0f) * 4;
    const totalLen = buffer.readUInt16BE(2);
    const protocol = buffer[9];
    packet.srcIp = `${buffer[12]}.${buffer[13]}.${buffer[14]}.${buffer[15]}`;
    packet.dstIp = `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`;
    packet.length = totalLen;
    
    // 解析传输层
    const transportData = buffer.slice(ihl);
    if (protocol === 6 && transportData.length >= 20) {
      // TCP
      packet.srcPort = transportData.readUInt16BE(0);
      packet.dstPort = transportData.readUInt16BE(2);
      const flags = transportData[13];
      const flagStr = [];
      if (flags & 0x02) flagStr.push('SYN');
      if (flags & 0x10) flagStr.push('ACK');
      if (flags & 0x01) flagStr.push('FIN');
      if (flags & 0x04) flagStr.push('RST');
      if (flags & 0x08) flagStr.push('PSH');
      packet.protocol = 'TCP';
      packet.info = `${packet.srcPort} → ${packet.dstPort} [${flagStr.join(',')}]`;
    } else if (protocol === 17 && transportData.length >= 8) {
      // UDP
      packet.srcPort = transportData.readUInt16BE(0);
      packet.dstPort = transportData.readUInt16BE(2);
      packet.protocol = 'UDP';
      packet.info = `${packet.srcPort} → ${packet.dstPort} Len=${transportData.readUInt16BE(4) - 8}`;
    } else if (protocol === 1) {
      packet.protocol = 'ICMP';
      if (transportData.length >= 2) {
        const type = transportData[0];
        const code = transportData[1];
        packet.info = `Type=${type} Code=${code}`;
      }
    } else {
      packet.info = `Protocol=${protocol}`;
    }
  } else if (version === 6) {
    // IPv6
    packet.protocol = 'IPv6';
    if (buffer.length >= 40) {
      packet.srcIp = formatIPv6(buffer.slice(8, 24));
      packet.dstIp = formatIPv6(buffer.slice(24, 40));
      packet.length = buffer.readUInt16BE(4) + 40;
    }
  }
  
  return packet;
}

function formatIPv6(bytes) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) {
    parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }
  return parts.join(':');
}

// 创建 PCAP 文件
function createPcapFile(packets) {
  // PCAP 文件头 (24 bytes)
  const globalHeader = Buffer.alloc(24);
  globalHeader.writeUInt32LE(0xa1b2c3d4, 0);  // Magic number
  globalHeader.writeUInt16LE(2, 4);            // Major version
  globalHeader.writeUInt16LE(4, 6);            // Minor version
  globalHeader.writeInt32LE(0, 8);             // Timezone
  globalHeader.writeUInt32LE(0, 12);           // Sigfigs
  globalHeader.writeUInt32LE(65535, 16);       // Snaplen
  globalHeader.writeUInt32LE(101, 20);         // Network: 101 = LINKTYPE_RAW (raw IP)

  const packetBuffers = [globalHeader];

  for (const packet of packets) {
    if (!packet.rawBytes || packet.rawBytes.length === 0) continue;
    
    const rawBytes = Buffer.from(packet.rawBytes);
    const timestamp = new Date(packet.timestamp);
    const tsSec = Math.floor(timestamp.getTime() / 1000);
    const tsUsec = (timestamp.getTime() % 1000) * 1000;

    // 数据包头 (16 bytes)
    const packetHeader = Buffer.alloc(16);
    packetHeader.writeUInt32LE(tsSec, 0);          // Timestamp seconds
    packetHeader.writeUInt32LE(tsUsec, 4);         // Timestamp microseconds
    packetHeader.writeUInt32LE(rawBytes.length, 8); // Captured length
    packetHeader.writeUInt32LE(rawBytes.length, 12);// Original length

    packetBuffers.push(packetHeader);
    packetBuffers.push(rawBytes);
  }

  return Buffer.concat(packetBuffers);
}

// 获取统计数据
ipcMain.handle('get-statistics', async () => {
  const stats = {
    total: packetBuffer.length,
    protocols: {},
    topSources: {},
    topDestinations: {},
    bytesOverTime: [],
    packetsOverTime: []
  };

  const timeSlots = {};
  
  for (const packet of packetBuffer) {
    // 协议统计
    const proto = packet.protocol || 'Unknown';
    stats.protocols[proto] = (stats.protocols[proto] || 0) + 1;

    // IP 统计
    if (packet.srcIp) {
      stats.topSources[packet.srcIp] = (stats.topSources[packet.srcIp] || 0) + 1;
    }
    if (packet.dstIp) {
      stats.topDestinations[packet.dstIp] = (stats.topDestinations[packet.dstIp] || 0) + 1;
    }

    // 时间统计 (按秒)
    if (packet.timestamp) {
      const sec = packet.timestamp.substring(0, 19);
      if (!timeSlots[sec]) {
        timeSlots[sec] = { packets: 0, bytes: 0 };
      }
      timeSlots[sec].packets++;
      timeSlots[sec].bytes += packet.length || 0;
    }
  }

  // 转换时间序列
  const sortedTimes = Object.keys(timeSlots).sort();
  stats.packetsOverTime = sortedTimes.map(t => ({ time: t, count: timeSlots[t].packets }));
  stats.bytesOverTime = sortedTimes.map(t => ({ time: t, bytes: timeSlots[t].bytes }));

  // 只保留 Top 10
  stats.topSources = Object.entries(stats.topSources)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
  stats.topDestinations = Object.entries(stats.topDestinations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});

  return stats;
});

// 窗口控制
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle('window-close', () => mainWindow.close());

// 检查管理员权限
ipcMain.handle('check-admin', async () => {
  try {
    const { execSync } = require('child_process');
    execSync('net session', { windowsHide: true });
    return true;
  } catch {
    return false;
  }
});

// 检查服务状态（简化版，检查是否有抓包进程在运行）
ipcMain.handle('check-service', async () => {
  return {
    running: captureProcess !== null,
    connected: captureProcess !== null,
    servicePath: getNetdumpPath()
  };
});

// 启动服务（直接返回成功，因为不再需要独立服务）
ipcMain.handle('start-service', async () => {
  return { success: true, message: '已使用管理员模式' };
});

// 获取网卡列表
ipcMain.handle('get-interfaces', async () => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const interfaces = [];
    
    // 使用 os.networkInterfaces() 获取网卡信息
    const nets = os.networkInterfaces();
    
    for (const [name, addrs] of Object.entries(nets)) {
      if (!addrs) continue;
      
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          // 尝试获取接口索引
          let ifIndex = 0;
          try {
            // 使用 PowerShell 获取接口索引
            const cmd = `powershell -Command "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -Property Name, ifIndex | ConvertTo-Json"`;
            const result = execSync(cmd, { windowsHide: true, encoding: 'utf8' });
            const adapters = JSON.parse(result);
            const adapterList = Array.isArray(adapters) ? adapters : [adapters];
            
            for (const adapter of adapterList) {
              if (adapter && adapter.Name && name.includes(adapter.Name)) {
                ifIndex = adapter.ifIndex;
                break;
              }
            }
          } catch (e) {
            // 忽略错误，使用默认值
          }
          
          interfaces.push({
            name: name,
            address: addr.address,
            mac: addr.mac,
            ifIndex: ifIndex
          });
        }
      }
    }
    
    // 添加 "所有网卡" 选项
    interfaces.unshift({
      name: '所有网卡',
      address: '',
      mac: '',
      ifIndex: 0
    });
    
    return interfaces;
  } catch (error) {
    console.error('Get interfaces error:', error);
    return [{ name: '所有网卡', address: '', mac: '', ifIndex: 0 }];
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // 停止抓包进程
  if (captureProcess) {
    captureProcess.kill();
    captureProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  // 确保退出前停止抓包
  if (captureProcess) {
    captureProcess.kill();
    captureProcess = null;
  }
});
