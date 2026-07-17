/**
 * Tshark 网络分析器工具模块
 * @module tshark-analyzer
 */
const path = require('path');
const { spawn, execFile } = require('child_process');
const { ipcMain, dialog, BrowserWindow, app, safeStorage } = require('electron');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { createToolWindow: defaultCreateToolWindow } = require('../utils/toolWindow');
const {
    validateCustomTsharkPath,
    checkTsharkVersion,
    findTshark,
    getTsharkInterfaces
} = require('../utils/tshark-executable');

// ==================== 常量定义 ====================

const TSHARK_FIELDS = [
    '-e', 'frame.time_epoch',
    '-e', 'frame.len',
    '-e', 'eth.src',
    '-e', 'eth.dst',
    '-e', 'ip.src',
    '-e', 'ip.dst',
    '-e', 'ip.ttl',
    '-e', 'ipv6.src',
    '-e', 'ipv6.dst',
    '-e', 'tcp.srcport',
    '-e', 'tcp.dstport',
    '-e', 'tcp.flags.reset',
    '-e', 'tcp.flags.syn',
    '-e', 'tcp.flags.fin',
    '-e', 'tcp.flags.push',
    '-e', 'tcp.flags.ack',
    '-e', 'tcp.flags.urg',
    '-e', 'tcp.seq',
    '-e', 'tcp.ack',
    '-e', 'tcp.len',
    '-e', 'tcp.window_size_value',
    '-e', 'ip.proto',
    '-e', 'ip.flags.df',
    '-e', 'ip.id',
    '-e', 'frame.time',
    '-e', 'tcp.analysis.retransmission',
    '-e', 'tcp.analysis.fast_retransmission',
    '-e', 'tcp.analysis.out_of_order',
    '-e', 'tcp.analysis.duplicate_ack',
    '-e', 'tcp.analysis.ack_rtt',
    '-e', 'tcp.analysis.zero_window',
    '-e', 'tcp.analysis.window_full',
    '-e', 'udp.srcport',
    '-e', 'udp.dstport',
    '-e', 'dns.qry.name',
    '-e', 'dns.qry.type',
    '-e', 'dns.flags.rcode',
    '-e', 'dns.a',
    '-e', 'icmp.type',
    '-e', 'icmp.code',
    '-e', 'icmp.seq',
    '-e', 'icmp.ident',
    '-e', 'icmpv6.type',
    '-e', 'icmpv6.code',
    '-e', 'arp.opcode',
    '-e', 'arp.src.proto_ipv4',
    '-e', 'arp.dst.proto_ipv4',
    '-e', 'arp.src.hw_mac',
    '-e', 'http.request.method',
    '-e', 'http.request.uri',
    '-e', 'http.response.code',
    '-e', 'http.time',
    '-e', 'tls.handshake.type',
    '-e', 'tls.alert_message',
    '-e', 'bootp.option.dhcp',
    '-e', 'isakmp.exchangetype',
    '-e', 'isakmp.notify.msgtype',
    '-e', 'esp.spi',
    '-e', 'sip.Status-Code',
    '-e', 'sip.Method',
    '-e', 'rtp.ssrc',
    '-e', 'rtp.seq',
    '-e', 'rtp.timestamp',
    '-e', '_ws.col.Protocol',
    '-e', '_ws.col.Info'
];

const CLEARTEXT_PORTS = new Set(['21', '23', '25', '110', '143', '69']);
const TSHARK_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_IMPORT_STDERR_LENGTH = 8192;

const AI_SYSTEM_PROMPT = `你是一位资深网络运维专家（CCIE级别），擅长通过流量分析精准定位网络故障。

【诊断阈值参考标准】
TCP连接质量:
  - 重传率: <1%=正常, 1-3%=轻微拥塞(medium), 3-8%=严重拥塞(high), >8%=极度异常(critical)
  - 平均RTT: <50ms=优秀, 50-150ms=良好, 150-300ms=较差(medium), >300ms=严重延迟(high)
  - RST占总包比: <0.5%=正常, >2%=异常(high), 大量RST可能是防火墙/端口不可达/服务故障
  - 乱序包占比: <0.5%=正常, >2%=链路质量差(medium), >5%=严重(high)
  - 连接完成率(FIN/SYN): >85%=正常, 70-85%=偏低(medium), <70%=严重(high)
  - TCP零窗口次数: 0=正常, >5=接收方缓冲区满/内存压力(medium), >20=严重(high)
  - TCP窗口满次数: 0=正常, >10=发送方受接收窗口限制(medium), 持续出现=瓶颈(high)
网络性能:
  - 带宽利用率: 结合流量大小和持续时间综合判断
  - 大包(>1400B)占比: 正常数据传输应有合理比例，占比极低说明分片或小包泛滥
  - 小包(<100B)占比: >70%说明控制包过多，可能存在大量应答或心跳包
  - 纯ACK包占比: >50%可能存在延迟ACK或连接空闲过多
DNS健康:
  - DNS失败占DNS总数: <3%=正常, 3-10%=偏高(medium), >10%=严重(high)
  - 持续失败同一域名: 可能是内网DNS故障或域名被封锁
应用层:
  - HTTP错误率: <5%=正常, 5-15%=偏高(medium), >15%=严重(high)
  - TLS Alert出现即为异常，可能是证书问题、版本不兼容或中间人攻击
TCP连接故障:
  - SYN无回应(无SYN-ACK且无RST)占SYN比: >20%=可能防火墙/安全组阻断(high), >50%=严重(critical)
  - 大量纯SYN包(SYN无ACK)占比>10%且来源IP>20个: 疑似SYN洪水攻击(critical)
  - 四次挥手不完整(SYN-ACK远多于FIN): >20%比例=半开连接泄漏(medium), >50%=资源耗尽风险(high)
MTU/分片:
  - ICMP type=3 code=4(需分片但DF置位)出现: MTU黑洞，大包无法通过中间节点(high)
  - DF置位大包>10个且有ICMP差错: 建议调整路径MTU或MSS(medium)
明文传输风险:
  - 检测到Telnet/FTP/POP3等明文协议: 安全风险(medium)，建议迁移加密协议
VoIP质量:
  - SIP 4xx错误: 信令拒绝，可能权限/配置问题(medium)
  - SIP 5xx错误: 服务器故障(high)
  - RTP流存在但包数极少(每路<50包): 媒体流中断，可能NAT穿越失败或防火墙(high)
HTTP性能:
  - HTTP平均响应时间: <500ms=正常, 500ms-2s=偏慢(medium), >2s=严重(high), >5s=极慢(critical)
  - HTTP错误率: <5%=正常, 5-15%=偏高(medium), >15%=严重(high)
TLS安全:
  - TLS Alert出现即为异常: certificate_unknown/certificate_expired=证书问题(high), handshake_failure=握手失败(high), decrypt_error=解密失败可能中间人(critical)
DNS错误分类:
  - NXDOMAIN大量出现: 域名配置错误或DNS劫持
  - SERVFAIL: 上游DNS递归故障或DNS服务器问题(high)
  - REFUSED: DNS服务器拒绝查询，权限问题
  - 全部超时(Discover无Offer): DNS服务器不可达(critical)
ARP异常:
  - ARP应答率 <80%: 目标主机可能不在线或防火墙拦截ARP
  - ARP应答率 =0%: 目标IP不存在或主机宕机(high)
DHCP故障:
  - Discover有但Offer=0: DHCP服务器不可达/VLAN未透传(critical)
  - NAK出现: 客户端IP与服务器网段不符，租约被拒绝(high)
  - Decline出现: IP地址冲突，客户端主动放弃(medium)
广播风暴/环路:
  - IP ID重复次数>50且广播包>20个: 网络环路，同一帧被反复转发(critical)，需检查STP/交换机配置
  - IP ID重复占比>5%: 疑似局部环路(high)
  - 广播包占比>30%且PPS>500: 广播风暴，可能是STP故障或环路(critical)
  - 广播包占比>15%: 广播异常，可能存在配置错误(high)
ARP欺骗:
  - 同一IP对应2+个不同MAC地址: 疑似ARP欺骗/中间人攻击(critical)，需检查网关IP的MAC映射
VPN/IKE故障:
  - IKE发送无回应: VPN对端不可达或UDP 500/4500被防火墙拦截(high)
  - IKE有错误通知(NOTIFY): 预共享密钥不匹配、加密套件不支持、证书验证失败(high)
  - 有IKE交互但无ESP包: IKE协商完成但数据通道未建立(medium)
  - ESP包有但返回路径无: 单向路由或NAT问题(high)
安全威胁特征:
  - 唯一目标IP过多(>50且流量小): 可能横向扫描/端口扫描(high)
  - 大量RST+小包: 可能端口扫描
  - ICMP不可达过多: 路由黑洞或防火墙屏蔽
  - 单IP流量占比>80%: 可能DDoS或蠕虫传播

【评分规则】100分起扣: critical问题-25分, high-12分, medium-5分, low-2分, 最低0分

必须严格以JSON格式返回（禁止添加任何代码块标记或额外文字）：
{
  "overall_status": "normal|warning|critical",
  "health_score": 85,
  "summary": "一句话结论（20字以内，必须明确说明网络是否正常）",
  "conclusion": "详细诊断结论（150字以内，说明：1.网络整体状况 2.主要问题及根因 3.对业务的影响程度）",
  "dimensions": {
    "connectivity": {"score": 90, "status": "normal|warning|critical"},
    "performance": {"score": 75, "status": "normal|warning|critical"},
    "application": {"score": 85, "status": "normal|warning|critical"},
    "dns": {"score": 95, "status": "normal|warning|critical"},
    "security": {"score": 80, "status": "normal|warning|critical"}
  },
  "issues": [
    {
      "title": "问题标题（15字以内）",
      "description": "详细描述问题现象、根本原因和可能影响",
      "severity": "critical|high|medium|low",
      "evidence": "引用具体数字作为证据",
      "metric_value": "实际测量值（如：重传率3.2%）",
      "threshold": "正常阈值（如：<1%）"
    }
  ],
  "recommendations": [
    {
      "priority": "high|medium|low",
      "title": "建议标题",
      "action": "具体可执行的操作步骤（分步骤说明）",
      "expected_effect": "预期改善效果"
    }
  ]
}
如果数据包少于20个或抓包不足3秒，summary必须注明"样本不足，结论仅供参考"。`;

// ==================== 模块状态 ====================

let analyzerWindow = null;
let packetCounter = 0;
let cachedTsharkPath = null;
let tmpPcapPath = null;

// ==================== 进程清理工具 ====================

/**
 * 强制终止抓包进程（Windows 需杀整个进程树）
 * @private
 */
function _killProcess(proc, dependencies = {}) {
    if (!proc) return;
    const platform = dependencies.platform || process.platform;
    const runExecFile = dependencies.execFile || execFile;
    if (platform === 'win32' && proc.pid) {
        try {
            runExecFile(
                'taskkill.exe',
                ['/F', '/T', '/PID', String(proc.pid)],
                { windowsHide: true, shell: false, timeout: 5000 },
                (error) => {
                    if (!error) return;
                    try { proc.kill(); } catch (_) {}
                }
            );
            return;
        } catch (_) {
            // Fall through to direct termination when taskkill cannot start.
        }
    }
    try { proc.kill(); } catch (_) {}
}

function createTsharkImportTask(options = {}) {
    const spawnProcess = typeof options.spawnProcess === 'function' ? options.spawnProcess : spawn;
    const killProcess = typeof options.killProcess === 'function' ? options.killProcess : _killProcess;
    const setTimeoutFn = typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout;
    const clearTimeoutFn = typeof options.clearTimeoutFn === 'function' ? options.clearTimeoutFn : clearTimeout;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.max(1, Math.floor(options.timeoutMs))
        : TSHARK_IMPORT_TIMEOUT_MS;
    const onPackets = typeof options.onPackets === 'function' ? options.onPackets : () => {};
    const owner = options.owner || null;
    const filePath = String(options.filePath || '');

    let proc = null;
    let timer = null;
    let settled = false;
    let buffer = '';
    let batch = [];
    let stderrTail = '';
    let totalPkts = 0;
    let resolveTask;

    const promise = new Promise(resolve => {
        resolveTask = resolve;
    });

    const onOwnerDestroyed = () => {
        finish({ success: false, error: '分析窗口已关闭', cancelled: true }, true);
    };

    const removeOwnerListener = () => {
        if (!owner) return;
        try {
            if (typeof owner.removeListener === 'function') {
                owner.removeListener('destroyed', onOwnerDestroyed);
            } else if (typeof owner.off === 'function') {
                owner.off('destroyed', onOwnerDestroyed);
            }
        } catch (_) {}
    };

    function finish(result, terminateProcess = false) {
        if (settled) return false;
        settled = true;
        if (timer !== null) {
            try { clearTimeoutFn(timer); } catch (_) {}
            timer = null;
        }
        removeOwnerListener();
        buffer = '';
        batch = [];
        if (terminateProcess && proc) {
            try { killProcess(proc); } catch (_) {}
        }
        resolveTask(result);
        return true;
    }

    const flushBatch = () => {
        if (settled || batch.length === 0) return !settled;
        const packets = batch;
        batch = [];
        try {
            onPackets(packets);
            return true;
        } catch (error) {
            finish({ success: false, error: `推送解析结果失败: ${error.message}` }, true);
            return false;
        }
    };

    const parseLine = (line) => {
        const text = line.trim();
        if (!text || text.startsWith('{"index"')) return;
        const packet = _parseEkPacket(text);
        if (!packet) return;
        batch.push(packet);
        totalPkts += 1;
    };

    const task = {
        promise,
        stop(reason = '导入已停止') {
            return finish({ success: false, error: reason, cancelled: true }, true);
        },
        isSettled() {
            return settled;
        },
        get process() {
            return proc;
        }
    };

    if (owner && typeof owner.once === 'function') {
        try {
            owner.once('destroyed', onOwnerDestroyed);
        } catch (error) {
            finish({ success: false, error: `无法监听分析窗口状态: ${error.message}` });
            return task;
        }
    }
    if (owner && typeof owner.isDestroyed === 'function' && owner.isDestroyed()) {
        finish({ success: false, error: '分析窗口已关闭', cancelled: true });
        return task;
    }
    if (settled) return task;

    try {
        proc = spawnProcess(options.tsharkPath, options.args || [], { windowsHide: true });
    } catch (error) {
        finish({ success: false, error: error.message });
        return task;
    }

    proc.stdout?.on('data', (data) => {
        if (settled) return;
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) parseLine(line);
        if (batch.length >= 200) flushBatch();
    });
    proc.stdout?.once('error', (error) => {
        finish({ success: false, error: `Tshark 输出流错误: ${error.message}` }, true);
    });

    proc.stderr?.on('data', (data) => {
        if (settled) return;
        stderrTail = (stderrTail + data.toString()).slice(-MAX_IMPORT_STDERR_LENGTH);
    });
    proc.stderr?.once('error', (error) => {
        finish({ success: false, error: `Tshark 错误流异常: ${error.message}` }, true);
    });

    proc.once('error', (error) => {
        finish({ success: false, error: error.message }, true);
    });

    proc.once('close', (code, signal) => {
        if (settled) return;
        if (buffer.trim()) parseLine(buffer);
        if (!flushBatch()) return;
        if (code === 0 && !signal) {
            finish({
                success: true,
                fileName: path.basename(filePath),
                packetCount: totalPkts
            });
            return;
        }
        const detail = stderrTail.trim();
        const suffix = detail ? `: ${detail}` : '';
        finish({
            success: false,
            error: `Tshark 解析异常退出（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）${suffix}`
        });
    });

    try {
        timer = setTimeoutFn(() => {
            finish({
                success: false,
                error: 'Tshark 文件解析超时，进程已终止',
                timedOut: true
            }, true);
        }, timeoutMs);
        timer?.unref?.();
    } catch (error) {
        finish({ success: false, error: `无法启动导入超时计时器: ${error.message}` }, true);
    }

    return task;
}

function createTsharkImportController(options = {}) {
    let activeTask = null;

    return {
        start(params) {
            if (activeTask && !activeTask.isSettled()) {
                return Promise.resolve({ success: false, error: '已有 Tshark 文件导入任务正在运行' });
            }
            const task = createTsharkImportTask({
                ...params,
                spawnProcess: options.spawnProcess,
                killProcess: options.killProcess,
                setTimeoutFn: options.setTimeoutFn,
                clearTimeoutFn: options.clearTimeoutFn,
                timeoutMs: options.timeoutMs
            });
            activeTask = task;
            return task.promise.finally(() => {
                if (activeTask === task) activeTask = null;
            });
        },
        stop(reason) {
            if (!activeTask || activeTask.isSettled()) return false;
            return activeTask.stop(reason);
        },
        isRunning() {
            return Boolean(activeTask && !activeTask.isSettled());
        }
    };
}

function createProcessSpawnWaiter(proc) {
    let finishWait;
    const promise = new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return false;
            settled = true;
            proc.removeListener('spawn', onSpawn);
            proc.removeListener('error', onError);
            proc.removeListener('close', onClose);
            resolve(result);
            return true;
        };
        finishWait = finish;
        const onSpawn = () => finish({ success: true });
        const onError = (error) => finish({ success: false, error: error.message });
        const onClose = (code, signal) => finish({
            success: false,
            error: `Tshark 启动前已退出（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）`
        });

        proc.once('spawn', onSpawn);
        proc.once('error', onError);
        proc.once('close', onClose);
    });
    return {
        promise,
        cancel(reason) {
            if (finishWait({ success: false, cancelled: true, error: reason || 'Tshark 启动已取消' })) {
                try { proc.once('error', () => {}); } catch (_) {}
            }
        }
    };
}

// ==================== 私有函数 ====================

/**
 * 解析 tshark -T ek 单行输出为数据包对象
 * @private
 */
function _parseEkPacket(line) {
    try {
        const data = JSON.parse(line);
        if (data.index) return null;
        const layers = data._source?.layers || data.layers;
        if (!layers) return null;

        const getVal = (key) => {
            // tshark -T ek 输出中字段名的 '.' 均被替换为 '_'
            const k = key.replace(/\./g, '_');
            const v = layers[k] ?? layers[key];
            if (Array.isArray(v)) return v[0] || '';
            return v || '';
        };

        const ethSrc  = getVal('eth.src');
        const ethDst  = getVal('eth.dst');
        const srcIp = getVal('ip.src') || getVal('ipv6.src');
        const dstIp = getVal('ip.dst') || getVal('ipv6.dst');
        const srcPort = getVal('tcp.srcport') || getVal('udp.srcport');
        const dstPort = getVal('tcp.dstport') || getVal('udp.dstport');
        // 优先用 tshark 列字段，再用已采集字段兜底
        const _wsProto = getVal('_ws.col.Protocol');
        const _rawIpProto = getVal('ip.proto');
        const IP_PROTO_NAMES = {
            '1':'ICMP','2':'IGMP','4':'IPv4','6':'TCP','8':'EGP','9':'IGP',
            '17':'UDP','41':'IPv6','43':'IPv6-Route','44':'IPv6-Frag',
            '47':'GRE','50':'ESP','51':'AH','58':'ICMPv6',
            '59':'IPv6-NoNxt','60':'IPv6-Opts','88':'EIGRP','89':'OSPF',
            '103':'PIM','112':'VRRP','115':'L2TP','132':'SCTP','136':'UDPLite'
        };
        let protocol = _wsProto;
        if (!protocol) {
            if (getVal('arp.opcode'))                                        protocol = 'ARP';
            else if (getVal('icmpv6.type'))                                  protocol = 'ICMPv6';
            else if (getVal('icmp.type'))                                    protocol = 'ICMP';
            else if (getVal('http.request.method') || getVal('http.response.code')) protocol = 'HTTP';
            else if (getVal('tls.handshake.type'))                           protocol = 'TLS';
            else if (getVal('dns.qry.name'))                                 protocol = 'DNS';
            else if (srcPort === '53' || dstPort === '53')                   protocol = 'DNS';
            else if (srcPort || dstPort)       protocol = getVal('tcp.srcport') ? 'TCP' : 'UDP';
            else if (_rawIpProto && IP_PROTO_NAMES[_rawIpProto])             protocol = IP_PROTO_NAMES[_rawIpProto];
            else                                                             protocol = 'Other';
        }
        // 不同 tshark 版本大小写可能不同，逐一尝试
        const rawInfo = getVal('_ws.col.Info') || getVal('_ws.col.info')
            || layers['_ws_col_Info']?.[0] || layers['_ws_col_info']?.[0] || '';
        const info = String(rawInfo).substring(0, 150);
        const length = parseInt(getVal('frame.len') || 0);
        const timestamp = parseFloat(getVal('frame.time_epoch') || 0) || Date.now() / 1000;
        const isRetrans = getVal('tcp.analysis.retransmission') === '1' || getVal('tcp.analysis.fast_retransmission') === '1';
        const isRst = getVal('tcp.flags.reset') === '1';
        const isSyn = getVal('tcp.flags.syn') === '1';
        const isFin = getVal('tcp.flags.fin') === '1';
        const isPsh = getVal('tcp.flags.push') === '1';
        const isAck = getVal('tcp.flags.ack') === '1';
        const isUrg = getVal('tcp.flags.urg') === '1';
        const isOutOfOrder = getVal('tcp.analysis.out_of_order') === '1';
        const isDupAck = getVal('tcp.analysis.duplicate_ack') === '1';
        const isZeroWindow = getVal('tcp.analysis.zero_window') === '1';
        const isWindowFull = getVal('tcp.analysis.window_full') === '1';
        const absTime = getVal('frame.time') || null;
        const rttRaw = parseFloat(getVal('tcp.analysis.ack_rtt') || 0);
        const ttl = parseInt(getVal('ip.ttl') || 0);
        const winSize = parseInt(getVal('tcp.window_size_value') || 0);
        const tcpSeq  = getVal('tcp.seq');
        const tcpAck  = getVal('tcp.ack');
        const tcpLen  = getVal('tcp.len');
        const ipProto = getVal('ip.proto');
        const ipId    = getVal('ip.id');
        const ipDf    = getVal('ip.flags.df') === '1';
        // DNS
        const dnsName   = getVal('dns.qry.name');
        const dnsRcode  = getVal('dns.flags.rcode');
        const dnsQtype  = getVal('dns.qry.type');
        const dnsA      = getVal('dns.a');
        // ICMP v4
        const icmpType  = getVal('icmp.type');
        const icmpCode  = getVal('icmp.code');
        const icmpSeq   = getVal('icmp.seq');
        const icmpIdent = getVal('icmp.ident');
        // ICMPv6
        const icmpv6Type = getVal('icmpv6.type');
        const icmpv6Code = getVal('icmpv6.code');
        // ARP
        const arpOp      = getVal('arp.opcode');
        const arpSrcIp   = getVal('arp.src.proto_ipv4');
        const arpDstIp   = getVal('arp.dst.proto_ipv4');
        const arpSrcMac  = getVal('arp.src.hw_mac');
        // HTTP
        const httpMethod = getVal('http.request.method');
        const httpUri    = getVal('http.request.uri');
        const httpCode   = getVal('http.response.code');
        const httpTime   = parseFloat(getVal('http.time') || 0) || null;
        // TLS
        const tlsHsType   = getVal('tls.handshake.type');
        const tlsAlertMsg = getVal('tls.alert_message') || null;
        // DHCP (bootp)
        const dhcpType = getVal('bootp.option.dhcp') || null;
        // IKE/ISAKMP (VPN) - 通过 info 字段判断是否为响应包
        const ikeExType  = getVal('isakmp.exchangetype') || null;
        const ikeIsResp  = ikeExType !== null && (info.toLowerCase().includes('response') || info.toLowerCase().includes('resp'));
        const ikeNotify  = getVal('isakmp.notify.msgtype') || null;
        const espSpi     = getVal('esp.spi') || null;
        // SIP/RTP (VoIP)
        const sipStatus  = getVal('sip.Status-Code') || null;
        const sipMethod  = getVal('sip.Method') || null;
        const rtpSsrc    = getVal('rtp.ssrc') || null;
        const rtpSeq     = getVal('rtp.seq') || null;
        const rtpTs      = getVal('rtp.timestamp') || null;
        // MTU/分片：ICMP type=3 code=4（需要分片但DF置位）
        const isIcmpNeedFrag = (icmpType === '3' && icmpCode === '4');
        // DF置位的大包（>1400B）可能引发 MTU 黑洞
        const isDfBigPkt = ipDf && (parseInt(getVal('frame.len') || 0) > 1400);
        // 明文传输：Telnet/FTP/SMTP/POP3 端口
        const isClearText = CLEARTEXT_PORTS.has(String(dstPort)) || CLEARTEXT_PORTS.has(String(srcPort));
        // 纯 SYN（无ACK）：连接发起包
        const isSynOnly  = isSyn && !isAck;
        // 广播/多播判断
        const isBroadcast = ethDst === 'ff:ff:ff:ff:ff:ff'
            || dstIp === '255.255.255.255'
            || (dstIp && dstIp.endsWith('.255'));
        const isMulticast = (ethDst && ethDst.startsWith('01:')) && !isBroadcast;

        return {
            id: ++packetCounter,
            timestamp,
            length,
            srcIp,
            dstIp,
            srcPort: String(srcPort),
            dstPort: String(dstPort),
            protocol,
            info,
            ttl,
            winSize,
            rtt: rttRaw > 0 ? rttRaw : null,
            ethSrc: ethSrc || null,
            ethDst: ethDst || null,
            tcpSeq: tcpSeq || null,
            tcpAck: tcpAck || null,
            tcpLen: tcpLen || null,
            ipProto: ipProto || null,
            ipId: ipId || null,
            ipDf,
            dns: dnsName ? { name: dnsName, qtype: dnsQtype || null, rcode: dnsRcode || null, a: dnsA || null } : null,
            icmp: icmpType !== '' && icmpType ? { type: icmpType, code: icmpCode || null, seq: icmpSeq || null, ident: icmpIdent || null } : null,
            icmpv6: icmpv6Type !== '' && icmpv6Type ? { type: icmpv6Type, code: icmpv6Code || null } : null,
            arp: arpOp ? { opcode: arpOp, srcIp: arpSrcIp || null, dstIp: arpDstIp || null, srcMac: arpSrcMac || null } : null,
            http: (httpMethod || httpCode) ? { method: httpMethod || null, uri: httpUri || null, code: httpCode || null, time: httpTime } : null,
            tls: (tlsHsType || tlsAlertMsg) ? { handshakeType: tlsHsType || null, alertMsg: tlsAlertMsg } : null,
            dhcpType: dhcpType || null,
            ike: ikeExType ? { exchangeType: ikeExType, isResponse: ikeIsResp, notifyMsg: ikeNotify } : null,
            esp: espSpi ? { spi: espSpi } : null,
            sip: (sipStatus || sipMethod) ? { status: sipStatus, method: sipMethod } : null,
            rtp: rtpSsrc ? { ssrc: rtpSsrc, seq: rtpSeq, timestamp: rtpTs } : null,
            isIcmpNeedFrag,
            isDfBigPkt,
            isClearText,
            isBroadcast,
            isMulticast,
            // 兼容旧访问方式
            dnsName: dnsName || null,
            dnsRcode: dnsRcode || null,
            icmpType: icmpType !== '' ? icmpType : (icmpv6Type !== '' ? icmpv6Type : null),
            icmpCode: icmpCode !== '' ? icmpCode : (icmpv6Code !== '' ? icmpv6Code : null),
            absTime: absTime || null,
            flags: {
                retransmission: isRetrans,
                reset: isRst,
                syn: isSyn,
                synOnly: isSynOnly,
                synAck: isSyn && isAck,
                fin: isFin,
                push: isPsh,
                ack: isAck,
                zeroWindow: isZeroWindow,
                windowFull: isWindowFull,
                urg: isUrg,
                outOfOrder: isOutOfOrder,
                duplicateAck: isDupAck
            }
        };
    } catch {
        return null;
    }
}

/**
 * 调用云端 AI API 进行诊断
 * @private
 */
function _callAiApi(config, userPrompt) {
    return new Promise((resolve, reject) => {
        const { apiUrl, apiKey, model } = config;
        let endpointUrl = (apiUrl || 'https://api.openai.com/v1/chat/completions').trim();
        // 若用户只填了 base URL（不包含端点路径），自动补全
        try {
            const _u = new URL(endpointUrl);
            if (!_u.pathname.includes('chat/completions')) {
                if (_u.pathname === '/' || _u.pathname === '') {
                    endpointUrl = endpointUrl.replace(/\/$/, '') + '/v1/chat/completions';
                } else {
                    endpointUrl = endpointUrl.replace(/\/$/, '') + '/chat/completions';
                }
            }
        } catch {}

        const isMiMoTokenPlan = (apiKey || '').startsWith('tp-');

        const body = JSON.stringify({
            model: model || 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: AI_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt + '\n\n⚠️ 重要：只输出纯 JSON，不要包含任何解释文字、Markdown 代码块或额外字符。直接以 { 开头，以 } 结尾。' }
            ],
            temperature: 0.2,
            max_tokens: 3500,
            stream: true
        });

        let parsedUrl;
        try {
            parsedUrl = new URL(endpointUrl);
        } catch {
            return reject(new Error(`无效的 API 地址: ${endpointUrl}`));
        }

        const authHeaders = isMiMoTokenPlan
            ? { 'api-key': apiKey || '' }
            : { 'Authorization': `Bearer ${apiKey || ''}` };

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + (parsedUrl.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 300000,
            rejectUnauthorized: true
        };

        const transport = parsedUrl.protocol === 'https:' ? https : http;
        const req = transport.request(options, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                let errData = '';
                res.on('data', c => { errData += c; });
                res.on('end', () => {
                    try {
                        const ej = JSON.parse(errData);
                        reject(new Error(ej.error?.message || `API 请求失败 (HTTP ${res.statusCode})`));
                    } catch {
                        reject(new Error(`API 请求失败 (HTTP ${res.statusCode}): ${errData.substring(0, 150)}`));
                    }
                });
                return;
            }

            // 流式 SSE 解析：收集 content 和 reasoning_content
            let contentParts = [];
            let buffer = '';

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === '[DONE]') continue;
                    try {
                        const delta = JSON.parse(payload);
                        const d = delta.choices?.[0]?.delta;
                        if (d && d.content) contentParts.push(d.content);
                    } catch {}
                }
            });

            res.on('end', () => {
                // 处理 buffer 中残留的最后一行
                if (buffer.trim()) {
                    const trimmed = buffer.trim();
                    if (trimmed.startsWith('data:')) {
                        const payload = trimmed.slice(5).trim();
                        if (payload !== '[DONE]') {
                            try {
                                const delta = JSON.parse(payload);
                                const d = delta.choices?.[0]?.delta;
                                if (d && d.content) contentParts.push(d.content);
                            } catch {}
                        }
                    }
                }

                const content = contentParts.join('');
                if (!content.trim()) {
                    console.error('[AI Stream] 未收到有效 content，可能全部消耗在推理阶段');
                    return resolve({ _raw: '', summary: 'AI 推理完成但未生成内容，请重试或换用非推理模型', issues: [], recommendations: [], health_score: 0 });
                }

                const _preview = content.substring(0, 200).replace(/[^\x00-\x7F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
                console.log('[AI Raw] len=' + content.length + ' | ' + _preview);

                const cleanJson = (s) => s
                    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/g, '')
                    .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
                    .replace(/，/g, ',').replace(/：/g, ':')
                    .replace(/,(\s*[}\]])/g, '$1')
                    .trim();

                let parsed = null;
                const cleaned = cleanJson(content);
                try { parsed = JSON.parse(cleaned); } catch (_) {}
                if (!parsed) {
                    const m = cleaned.match(/\{[\s\S]*\}/);
                    if (m) { try { parsed = JSON.parse(cleanJson(m[0])); } catch (_) {} }
                }
                if (!parsed) {
                    const segments = cleaned.split(/\{/).slice(1);
                    for (let i = segments.length - 1; i >= 0; i--) {
                        try {
                            const candidate = cleanJson('{' + segments.slice(0, i + 1).join('{'));
                            const p = JSON.parse(candidate);
                            if (p && p.health_score !== undefined) { parsed = p; break; }
                        } catch (_) {}
                    }
                }

                if (parsed && typeof parsed === 'object') {
                    resolve(parsed);
                } else {
                    console.error('[AI Parse Failed]', content.substring(0, 500));
                    resolve({ _raw: content, summary: '解析失败，请重试', issues: [], recommendations: [], health_score: 0 });
                }
            });
        });

        console.log('[AI Request] stream=true', options.method, `${parsedUrl.protocol}//${options.hostname}:${options.port}${options.path}`, 'model=' + (model || 'gpt-3.5-turbo'));
        req.on('error', (err) => reject(new Error(`API 请求错误: ${err.message}\n地址: ${endpointUrl}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时 (300s)，API: ${endpointUrl}`)); });
        req.write(body);
        req.end();
    });
}

/**
 * 构建用于 AI 诊断的 Markdown 格式数据摘要
 * @private
 */
function _buildDiagnosticPrompt(stats, packetCount) {
    const {
        totalBytes, protocols, srcIps, dstIps, retrans, rsts, duration,
        outOfOrders, duplicateAcks, synCount, rttSum, rttCount,
        dnsErrors, icmpUnreachable, avgTtl,
        httpErrors, tlsAlerts, finCount, dstPorts, failedDnsNames,
        zeroWindows, windowFull, largePkts, smallPkts, ackOnlyPkts,
        synAckCount, dnsByRcode, arpRequests, arpReplies, arpIpMacMap,
        tlsAlertTypes, httpTimeSum, httpTimeCount, dhcpStats,
        broadcastPkts, multicastPkts, duplicateIpIds, ikeSent, ikeRecv, ikeErrors, espPkts,
        synOnlyCount, icmpNeedFrag, dfBigPkts, clearTextPkts,
        sipErrors, sipMethods, rtpPkts, rtpSsrcCount,
        anomaly, anomalousFlows, timeBuckets, firstTs,
        rtpStreamStats
    } = stats;

    const bytesStr = totalBytes > 1024 * 1024
        ? `${(totalBytes / 1024 / 1024).toFixed(2)} MB`
        : `${(totalBytes / 1024).toFixed(2)} KB`;

    const protoLines = Object.entries(protocols || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([p, c]) => `  - ${p}: ${c}个 (${packetCount > 0 ? (c / packetCount * 100).toFixed(1) : 0}%)`).join('\n');

    const srcLines = Object.entries(srcIps || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([ip, c]) => `  - ${ip}: ${c}个包`).join('\n');

    const dstLines = Object.entries(dstIps || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([ip, c]) => `  - ${ip}: ${c}个包`).join('\n');

    const portNames = { '80':'HTTP','443':'HTTPS','22':'SSH','21':'FTP','53':'DNS',
        '3306':'MySQL','5432':'PostgreSQL','6379':'Redis','8080':'HTTP-ALT','3389':'RDP','25':'SMTP','110':'POP3','143':'IMAP' };
    const dstPortLines = Object.entries(dstPorts || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([p, c]) => `  - ${portNames[p] ? portNames[p]+'('+p+')' : p}: ${c}个包`).join('\n');

    const retransRate = packetCount > 0 ? (retrans / packetCount * 100).toFixed(2) : 0;
    const avgRtt = rttCount > 0 ? (rttSum / rttCount * 1000).toFixed(2) : null;
    const avgPktSize = packetCount > 0 ? (totalBytes / packetCount).toFixed(0) : 0;
    const rstRate = packetCount > 0 ? (rsts / packetCount * 100).toFixed(2) : 0;
    const oooRate = packetCount > 0 ? (outOfOrders / packetCount * 100).toFixed(2) : 0;
    const connSuccessRate = synCount > 0
        ? `${Math.min(100, ((finCount || 0) / synCount * 100)).toFixed(1)}% (SYN:${synCount} FIN:${finCount||0} RST:${rsts||0})`
        : '无TCP连接数据';
    const connSuccessPct = synCount > 0 ? Math.min(100, ((finCount || 0) / synCount * 100)).toFixed(1) : null;
    const dnsTotalEst = (dnsErrors || 0) + Object.entries(protocols || {})
        .filter(([p]) => p.toUpperCase() === 'DNS').reduce((s, [,c]) => s + c, 0);
    const dnsFailRate = dnsTotalEst > 0 ? (dnsErrors / dnsTotalEst * 100).toFixed(1) : 0;
    const failedDnsStr = (failedDnsNames || []).length > 0
        ? (failedDnsNames).join(', ')
        : '无';
    const bwKbps = duration > 0 ? ((totalBytes * 8) / duration / 1000).toFixed(1) : 'N/A';
    const synNoReply = Math.max(0, (synCount || 0) - (synAckCount || 0) - (rsts || 0));
    const avgHttpTime = httpTimeCount > 0 ? (httpTimeSum / httpTimeCount * 1000).toFixed(0) : null;
    const tlsAlertStr = Object.entries(tlsAlertTypes || {}).map(([k,v]) => `${k}:${v}次`).join(', ') || '无';
    const dnsByRcodeStr = `NXDOMAIN:${(dnsByRcode||{}).nxdomain||0} SERVFAIL:${(dnsByRcode||{}).servfail||0} REFUSED:${(dnsByRcode||{}).refused||0} 其他:${(dnsByRcode||{}).other||0}`;
    const arpReplyRate = (arpRequests || 0) > 0 ? ((arpReplies || 0) / arpRequests * 100).toFixed(1) : 'N/A';
    const dhcp = dhcpStats || {};
    const hasDhcpIssue = (dhcp.discover || 0) > 0 && (dhcp.offer || 0) === 0;
    // 广播风暴检测
    const broadcastRate = packetCount > 0 ? ((broadcastPkts || 0) / packetCount * 100).toFixed(1) : 0;
    const multicastRate = packetCount > 0 ? ((multicastPkts || 0) / packetCount * 100).toFixed(1) : 0;
    const pps = duration > 0 ? (packetCount / duration).toFixed(1) : 0;
    const isBcastStorm = (broadcastPkts || 0) / packetCount > 0.3 && pps > 500;
    const dupIpIdRate = packetCount > 0 ? ((duplicateIpIds || 0) / packetCount * 100).toFixed(1) : 0;
    const isLoop = (duplicateIpIds || 0) > 50 && (broadcastPkts || 0) > 20;
    // ARP 欺骗检测：IP 对应 2+ 个 MAC
    const arpSpoofed = Object.entries(arpIpMacMap || {})
        .filter(([, macs]) => (Array.isArray(macs) ? macs.length : 0) >= 2)
        .map(([ip, macs]) => `${ip}(${(Array.isArray(macs) ? macs : []).join('/')})`);
    // VPN
    const ikeNoReply = (ikeSent || 0) > 0 && (ikeRecv || 0) === 0;
    const vpnActive  = (espPkts || 0) > 0;
    // SYN洪水：大量纯SYN包（SYN无ACK）且来源IP分散
    const synFloodRate = synOnlyCount > 0 && packetCount > 0 ? ((synOnlyCount || 0) / packetCount * 100).toFixed(1) : 0;
    const uniqueSrcCount = Object.keys(srcIps || {}).length;
    const isSynFlood = (synOnlyCount || 0) > 100 && uniqueSrcCount > 20 && (finCount || 0) < (synOnlyCount || 0) * 0.1;
    // 四次挥手异常：有FIN但未完成挥手（finCount远小于synAckCount）
    const incompleteFin = (finCount || 0) > 0 && (synAckCount || 0) > 0
        ? Math.max(0, (synAckCount || 0) - (finCount || 0))
        : 0;
    // MTU/分片
    const mtuIssue = (icmpNeedFrag || 0) > 0 || (dfBigPkts || 0) > 10;
    // 明文传输
    const clearTextRate = packetCount > 0 ? ((clearTextPkts || 0) / packetCount * 100).toFixed(1) : 0;
    // VoIP
    const rtpStreamCount = rtpSsrcCount || 0;
    const sipMethodStr = Object.entries(sipMethods || {}).map(([m,c]) => `${m}:${c}`).join(', ') || '无';
    const hasVoIP = rtpPkts > 0 || Object.keys(sipMethods || {}).length > 0;
    const rtpStreamsStr = (rtpStreamStats || []).length > 0
        ? '\n' + rtpStreamStats.map(rs => {
            const lossWarn  = parseFloat(rs.lossRate)  > 5  ? ' ⚠️高丢包'  : '';
            const jitterWarn = parseFloat(rs.jitterMs) > 30 ? ' ⚠️高抖动'  : '';
            return `  - SSRC ${rs.ssrc}: ${rs.pkts}包, 丢包率${rs.lossRate}%, 抖动${rs.jitterMs}ms${lossWarn}${jitterWarn}`;
        }).join('\n')
        : '';
    const largePktRate = packetCount > 0 ? ((largePkts || 0) / packetCount * 100).toFixed(1) : 0;
    const smallPktRate = packetCount > 0 ? ((smallPkts || 0) / packetCount * 100).toFixed(1) : 0;
    const ackOnlyRate  = packetCount > 0 ? ((ackOnlyPkts || 0) / packetCount * 100).toFixed(1) : 0;
    const uniqueSrcIps = Object.keys(srcIps || {}).length;
    const uniqueDstIps = Object.keys(dstIps || {}).length;
    // 主要业务场景推断
    const protoObj = protocols || {};
    const hasHTTP  = (protoObj['HTTP'] || 0) + (protoObj['HTTP/XML'] || 0) > 0;
    const hasHTTPS = (protoObj['TLS'] || 0) + (protoObj['SSL'] || 0) > 0;
    const hasSSH   = Object.keys(dstPorts || {}).includes('22');
    const hasMysql = Object.keys(dstPorts || {}).includes('3306');
    const busScenes = [hasHTTP && 'Web-HTTP', hasHTTPS && 'Web-HTTPS/TLS', hasSSH && 'SSH远程管理', hasMysql && '数据库MySQL'].filter(Boolean).join(', ') || '未明确识别';

    return `## 网络抓包数据分析摘要

### 基本信息
- 数据包总数：${packetCount}
- 抓包时长：${(duration || 0).toFixed(1)} 秒
- 总数据量：${bytesStr}，估算带宽：${bwKbps} Kbps
- 平均包大小：${avgPktSize} 字节，平均速率：${duration > 0 ? (packetCount / duration).toFixed(1) : 0} 包/秒
- 唯一源IP数：${uniqueSrcIps}，唯一目标IP数：${uniqueDstIps}
- 推测业务场景：${busScenes}

### 包大小分布
- 大包(>1400B)：${largePkts || 0} 个（${largePktRate}%）
- 小包(<100B)：${smallPkts || 0} 个（${smallPktRate}%）
- 纯ACK包：${ackOnlyPkts || 0} 个（${ackOnlyRate}%）

### TCP 质量指标（已计算比率，直接对照阈值判断）
- TCP 重传次数：${retrans || 0}，重传率：${retransRate}%（阈值 <1% 正常）
- TCP RST 次数：${rsts || 0}，RST占比：${rstRate}%（阈值 <0.5% 正常）
- TCP 乱序包：${outOfOrders || 0}，乱序率：${oooRate}%（阈值 <0.5% 正常）
- TCP 重复 ACK：${duplicateAcks || 0}
- TCP 平均 RTT：${avgRtt !== null ? avgRtt + ' ms' : '无数据'}（阈值 <150ms 正常）
- TCP 连接完成率：${connSuccessRate}${connSuccessPct ? '（阈值 >85% 正常）' : ''}
- TCP SYN 无回应（无SYN-ACK且无RST）：${synNoReply} 个（可能被防火墙/安全组阻断）
- TCP SYN-ACK 数量：${synAckCount || 0}（正常应接近 SYN 数）
- TCP 纯SYN（无ACK）包：${synOnlyCount || 0} 个（占总包${synFloodRate}%）${isSynFlood ? ' ⚠️ 纯SYN比例高+来源IP分散，疑似SYN洪水攻击' : ''}
- TCP 四次挥手不完整（SYN-ACK已建立但无对应FIN）：${incompleteFin} 条连接（半开连接泄漏）
- TCP 零窗口次数：${zeroWindows || 0}（接收方缓冲区满，>5为异常）
- TCP 窗口满次数：${windowFull || 0}（发送方受限，>10为异常）
- 平均 IP TTL：${avgTtl ? avgTtl.toFixed(0) : '无数据'}

### DNS 健康
- DNS 解析失败次数：${dnsErrors || 0}，失败率估算：${dnsFailRate}%（阈值 <3% 正常）
- DNS 错误类型分布：${dnsByRcodeStr}
  （NXDOMAIN=域名不存在, SERVFAIL=服务器故障/上游递归失败, REFUSED=服务器拒绝）
- DNS 失败域名列表：${failedDnsStr}

### 应用层异常
- ICMP/ICMPv6 不可达次数：${icmpUnreachable || 0}
- HTTP 4xx/5xx 错误次数：${httpErrors || 0}
- HTTP 平均响应时间：${avgHttpTime !== null ? avgHttpTime + ' ms（阈值 <500ms 正常，>2000ms 严重）' : '无HTTP响应数据'}
- TLS Alert 次数：${tlsAlerts || 0}，类型分布：${tlsAlertStr}

### ARP/DHCP 异常
- ARP 请求：${arpRequests || 0} 次，ARP 响应：${arpReplies || 0} 次，应答率：${arpReplyRate}%
  （应答率 <80% 可能目标主机不在线；=0% 目标 IP 不存在或主机宕机）
- ARP 欺骗自动检测（同一 IP 对应 ≥2 个不同 MAC）：${arpSpoofed.length > 0 ? '⚠️ 检测到可疑IP: ' + arpSpoofed.join(', ') : '未发现异常'}
- DHCP Discover：${dhcp.discover||0}，Offer：${dhcp.offer||0}，NAK：${dhcp.nak||0}，Decline：${dhcp.decline||0}
  ${hasDhcpIssue ? '⚠️ 发现 DHCP Discover 但无 Offer，可能 DHCP 服务器不可达或 VLAN 未透传' : ''}

### 广播/多播流量（广播风暴/环路检测）
- 广播包：${broadcastPkts || 0} 个（${broadcastRate}%），多播包：${multicastPkts || 0} 个（${multicastRate}%）
- 当前 PPS（包/秒）：${pps}
- IP ID 重复出现次数：${duplicateIpIds || 0}（占${dupIpIdRate}%，正常应为0）
  ${isLoop ? '⚠️ IP ID重复次数>50且伴随大量广播包，高度疑似网络环路（同一数据包反复转发）' : ''}
  ${isBcastStorm ? '⚠️ 广播比例>30%且PPS>500，疑似广播风暴或STP故障' : ''}

### VPN/IKE 状态
- IKE 发送：${ikeSent || 0} 个，IKE 响应：${ikeRecv || 0} 个，IKE 错误通知：${ikeErrors || 0} 个
- ESP 加密包：${espPkts || 0} 个
  ${ikeNoReply ? '⚠️ IKE 发送但无回应，VPN 对端可能不可达或被防火墙拦截（UDP 500/4500未放行）' : ''}
  ${!ikeNoReply && (ikeSent||0)>0 && ikeErrors>0 ? '⚠️ IKE 协商出现错误通知，可能预共享密钥错误或提议不匹配' : ''}
  ${vpnActive ? 'ESP 隧道已建立（有加密流量）' : ''}

### MTU/分片问题
- ICMP"需要分片但DF置位"(type=3 code=4)次数：${icmpNeedFrag || 0}${(icmpNeedFrag||0)>0 ? ' ⚠️ 存在MTU黑洞，大包被中间设备丢弃' : ''}
- DF置位大包(>1400B)：${dfBigPkts || 0} 个${mtuIssue ? '（MTU可能不匹配，建议调整MSS或MTU）' : ''}

### 安全/明文传输风险
- 明文协议包（Telnet/FTP/SMTP/POP3/IMAP/TFTP）：${clearTextPkts || 0} 个（占${clearTextRate}%）
  ${(clearTextPkts||0)>0 ? '⚠️ 检测到明文传输，账号密码可能被嗅探，建议迁移到SSH/FTPS/STARTTLS' : '无明文传输风险'}

### VoIP 质量（SIP/RTP）
${hasVoIP ? `- SIP 方法分布：${sipMethodStr}
- SIP 4xx/5xx 错误：${sipErrors || 0} 个${sipErrors > 0 ? '（存在SIP信令错误，可能无法建立通话）' : ''}
- RTP 包数量：${rtpPkts || 0} 个，RTP 媒体流数：${rtpStreamCount} 路
  ${rtpStreamCount > 0 && rtpPkts < rtpStreamCount * 50 ? '⚠️ RTP包数极少，媒体流可能中断' : ''}
- RTP 逐流统计（丢包率阈值 <1%正常 >5%高，抖动阈值 <30ms正常 >50ms严重）：${rtpStreamsStr || '  (RTP流数据不足)'}` : '- 未检测到SIP/RTP流量（无VoIP业务）'}

### 目标端口分布 (Top 8)
${dstPortLines || '  (无数据)'}

### 协议分布 (Top 10)
${protoLines || '  (无数据)'}

### 来源 IP Top 5
${srcLines || '  (无数据)'}

### 目标 IP Top 5
${dstLines || '  (无数据)'}
${_buildAnomalySection(anomaly, anomalousFlows, timeBuckets, firstTs, retrans, rsts, dnsErrors, tlsAlerts, httpErrors)}
---
【分析要求】请结合上方「异常包样本」章节中的具体数字和模式，对以下5个维度逐一分析，给出"网络是否正常"的明确结论：
1. 连接质量(connectivity)：重传率、RTT、RST率、零窗口/窗口满、连接成功率
2. 性能表现(performance)：乱序包、重复ACK、TTL、吞吐量/带宽、包大小分布
3. 应用层(application)：HTTP错误、TLS Alert、业务场景（根据推测的业务类型说明影响）
4. DNS健康(dns)：解析失败率、失败域名模式（是否有规律）
5. 安全状况(security)：唯一IP数异常、SYN/FIN比率、端口扫描特征、ICMP不可达
每个维度给出0-100分。issues只列有据可查的问题，每个issue必须引用具体数字和时序作为evidence。`;

}

/**
 * 构建异常包样本章节（供 AI 做溯源分析）
 * @private
 */
function _buildAnomalySection(anomaly, anomalousFlows, timeBuckets, firstTs, retrans, rsts, dnsErrors, tlsAlerts, httpErrors) {
    if (!anomaly) return '';
    const rt = (ts) => firstTs > 0 && ts ? `T+${(ts - firstTs).toFixed(2)}s` : '';
    let out = '';

    // 时序分布
    const buckets = timeBuckets || [];
    if (buckets.length > 0) {
        out += '\n### 异常时序分布（每5秒一档）\n';
        out += buckets.map(b => `  ${b.label}: 重传${b.retrans}次 RST${b.rst}次 DNS失败${b.dnsFail}次`).join('\n');
        const peak = [...buckets].sort((a, b) => (b.retrans + b.rst) - (a.retrans + a.rst))[0];
        if (peak && peak.retrans + peak.rst >= 3)
            out += `\n  ⚠️ 异常集中于 ${peak.label}，可能是突发性拥塞或链路短暂中断`;
    }

    // RST 样本
    const rstSamples = anomaly.rst || [];
    if (rstSamples.length > 0) {
        const dstGrp = {};
        for (const r of rstSamples) { const k = `${r.dst}:${r.dp||'?'}`; dstGrp[k] = (dstGrp[k] || 0) + 1; }
        const topDst = Object.entries(dstGrp).sort((a, b) => b[1] - a[1])[0];
        out += `\n\n### RST 包样本（共 ${rsts||0} 次，展示前 ${rstSamples.length} 条）\n`;
        out += rstSamples.map(r => `  ${rt(r.t)} ${r.src}:${r.sp||'?'} → ${r.dst}:${r.dp||'?'}`).join('\n');
        if (topDst && topDst[1] > 1)
            out += `\n  → 提示: ${topDst[1]} 次 RST 均指向 ${topDst[0]}，该目标可能拒绝连接或被防火墙阻断`;
    }

    // 重传样本
    const retransSamples = anomaly.retrans || [];
    if (retransSamples.length > 0) {
        out += `\n\n### 重传包样本（共 ${retrans||0} 次，展示前 ${retransSamples.length} 条）\n`;
        out += retransSamples.map(r => `  ${rt(r.t)} ${r.src} → ${r.dst}:${r.dp||'?'} (该流第 ${r.n} 次重传)`).join('\n');
        const maxFlow = (anomalousFlows || []).find(f => f.retransCount >= 3);
        if (maxFlow)
            out += `\n  → 提示: 流 ${maxFlow.key} 累计重传 ${maxFlow.retransCount} 次，持续重传说明该路径存在稳定性丢包`;
    }

    // DNS 失败样本
    const dnsSamples = anomaly.dnsFail || [];
    if (dnsSamples.length > 0) {
        out += `\n\n### DNS 解析失败样本（共 ${dnsErrors||0} 次，展示前 ${dnsSamples.length} 条）\n`;
        out += dnsSamples.map(d => `  ${rt(d.t)} query: ${d.q} → ${d.rc}`).join('\n');
        const sfx = {};
        for (const d of dnsSamples) { const k = d.q.split('.').slice(-2).join('.'); sfx[k] = (sfx[k] || 0) + 1; }
        const topSfx = Object.entries(sfx).sort((a, b) => b[1] - a[1])[0];
        if (topSfx && topSfx[1] >= 2)
            out += `\n  → 提示: ${topSfx[1]} 次失败均属 .${topSfx[0]}，可能是内网域名 DNS 未配置或 split-horizon 失效`;
    }

    // TLS Alert 样本
    const tlsSamples = anomaly.tlsAlert || [];
    if (tlsSamples.length > 0) {
        out += `\n\n### TLS Alert 样本（共 ${tlsAlerts||0} 次，展示前 ${tlsSamples.length} 条）\n`;
        out += tlsSamples.map(a => `  ${rt(a.t)} ${a.src} → ${a.dst}  Alert: ${a.alert}`).join('\n');
    }

    // HTTP 错误样本
    const httpSamples = anomaly.httpError || [];
    if (httpSamples.length > 0) {
        out += `\n\n### HTTP 错误样本（共 ${httpErrors||0} 次，展示前 ${httpSamples.length} 条）\n`;
        out += httpSamples.map(h => `  ${rt(h.t)} HTTP ${h.code} ${h.uri}${h.ms ? ` 响应${h.ms}ms` : ''} → ${h.dst}`).join('\n');
    }

    // 异常 TCP 流生命周期
    const flows = (anomalousFlows || []).slice(0, 15);
    if (flows.length > 0) {
        out += `\n\n### 异常 TCP 流生命周期（共 ${anomalousFlows.length} 条，展示前 ${flows.length} 条）\n`;
        for (const fl of flows) {
            let line = `  ${fl.key}: `;
            if (fl.synTs) {
                line += `SYN ${rt(fl.synTs)}`;
                if (fl.synAckTs) line += ` → SYN-ACK ${rt(fl.synAckTs)} (握手${((fl.synAckTs - fl.synTs) * 1000).toFixed(0)}ms)`;
                else line += ` (无SYN-ACK，连接未建立)`;
            }
            if (fl.retransCount > 0) line += ` | 重传${fl.retransCount}次`;
            if (fl.rstTs) line += ` | RST ${rt(fl.rstTs)}`;
            else if (fl.finTs) line += ` | FIN ${rt(fl.finTs)}`;
            out += line + '\n';
        }
    }

    return out ? '\n' + out + '\n' : '';
}

/**
 * 生成 Markdown 诊断报告内容
 * @private
 */
function _buildMarkdownReport(diagnosis, stats, packetCount) {
    const now = new Date().toLocaleString('zh-CN');
    const severityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    const priorityIcon = { high: '⚡', medium: '📌', low: '💡' };

    let md = `# 网络诊断报告

> 生成时间：${now}  
> 数据包总数：${packetCount}  
> 网络健康评分：**${diagnosis.health_score || 0}/100**

---

## 总体评估

${diagnosis.summary || '无评估内容'}

---

## 故障清单

`;
    if (diagnosis.issues && diagnosis.issues.length > 0) {
        diagnosis.issues.forEach((issue, i) => {
            const icon = severityIcon[issue.severity] || '⚪';
            md += `### ${i + 1}. ${icon} ${issue.title}\n\n`;
            md += `**严重程度**: ${issue.severity}\n\n`;
            md += `**描述**: ${issue.description}\n\n`;
            if (issue.evidence) md += `**数据依据**: ${issue.evidence}\n\n`;
            md += '---\n\n';
        });
    } else {
        md += '_未发现明显故障_\n\n';
    }

    md += `## 修复建议\n\n`;
    if (diagnosis.recommendations && diagnosis.recommendations.length > 0) {
        diagnosis.recommendations.forEach((rec, i) => {
            const icon = priorityIcon[rec.priority] || '📌';
            md += `### ${i + 1}. ${icon} ${rec.title}\n\n`;
            md += `**优先级**: ${rec.priority}\n\n`;
            md += `**操作步骤**: ${rec.action}\n\n`;
        });
    } else {
        md += '_暂无修复建议_\n\n';
    }

    md += `---\n*由 NetTools TsharkAnalyzer 生成*\n`;
    return md;
}

// ==================== 注册处理程序 ====================

/**
 * 注册 Tshark 分析器相关 IPC 处理程序
 */
function registerTsharkAnalyzerHandlers(context, dependencies = {}) {
    const { getMainWindow } = context;
    const ipc = dependencies.ipcMain || ipcMain;
    const dialogApi = dependencies.dialog || dialog;
    const appApi = dependencies.app || app;
    const createToolWindow = dependencies.createToolWindow || defaultCreateToolWindow;
    const spawnProcess = dependencies.spawn || spawn;
    const killProcess = dependencies.killProcess || _killProcess;
    const resolveTsharkPath = dependencies.findTshark || findTshark;
    const importController = createTsharkImportController({
        spawnProcess,
        killProcess,
        setTimeoutFn: dependencies.setTimeout,
        clearTimeoutFn: dependencies.clearTimeout,
        timeoutMs: dependencies.importTimeoutMs
    });
    let activeImportRequest = null;
    let captureStartRequest = null;
    let captureJob = null;

    const ensureTsharkPath = async () => {
        if (typeof dependencies.findTshark === 'function' || !cachedTsharkPath) {
            cachedTsharkPath = await resolveTsharkPath();
        }
        return cachedTsharkPath;
    };

    const sendToOwner = (owner, channel, payload) => {
        if (!owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) return false;
        try {
            owner.send(channel, payload);
            return true;
        } catch (_) {
            return false;
        }
    };

    const finishCapture = (job, options = {}) => {
        if (!job || job.settled) return false;
        job.settled = true;
        if (captureJob === job) captureJob = null;
        if (job.flushInterval !== null) {
            clearInterval(job.flushInterval);
            job.flushInterval = null;
        }
        try { job.owner?.removeListener?.('destroyed', job.onOwnerDestroyed); } catch (_) {}

        if (options.flush && job.pendingBatch.length > 0) {
            sendToOwner(job.owner, 'tshark:packets', job.pendingBatch);
        }
        job.pendingBatch = [];
        job.buffer = '';

        if (options.kill) {
            try { killProcess(job.proc); } catch (_) {}
        }
        if (options.error) {
            sendToOwner(job.owner, 'tshark:error', options.error);
        }
        if (options.notify !== false) {
            sendToOwner(job.owner, 'tshark:stopped', {
                code: options.code ?? 0,
                stopped: Boolean(options.stopped)
            });
        }
        return true;
    };

    const cancelCapture = (reason, notify = true) => {
        let cancelled = false;
        if (captureStartRequest) {
            captureStartRequest.cancelled = true;
            captureStartRequest.reason = reason;
            captureStartRequest.spawnWaiter?.cancel(reason);
            if (captureStartRequest.proc && !captureStartRequest.procKilled) {
                captureStartRequest.procKilled = true;
                try { killProcess(captureStartRequest.proc); } catch (_) {}
            }
            cancelled = true;
        }
        if (captureJob) {
            cancelled = finishCapture(captureJob, {
                code: 0,
                stopped: true,
                kill: true,
                flush: false,
                notify
            }) || cancelled;
        }
        return cancelled;
    };

    const cancelImport = (reason) => {
        if (activeImportRequest) {
            activeImportRequest.cancelled = true;
            activeImportRequest.reason = reason;
        }
        return importController.stop(reason);
    };

    ipc.handle('tshark:open', async () => {
        if (analyzerWindow && !analyzerWindow.isDestroyed()) {
            analyzerWindow.focus();
            return { success: true };
        }

        const basePath = appApi.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : path.join(__dirname, '..', '..');
        const indexPath = path.join(basePath, 'TsharkAnalyzer', 'index.html');

        if (!fs.existsSync(indexPath)) {
            return { success: false, error: '找不到 TsharkAnalyzer 工具文件' };
        }

        ({ win: analyzerWindow } = createToolWindow({
            toolId: 'tshark-analyzer',
            width: 1440,
            height: 920,
            minWidth: 1100,
            minHeight: 720,
            resizable: true,
            title: 'TsharkAnalyzer - AI 智能网络分析'
        }, indexPath));

        analyzerWindow.on('closed', () => {
            analyzerWindow = null;
            cancelImport('分析窗口已关闭');
            cancelCapture('分析窗口已关闭', false);
        });

        return { success: true };
    });

    ipc.handle('tshark:checkVersion', async (event, customPath) => {
        let targetPath;
        if (typeof customPath === 'string' && customPath.trim()) {
            try {
                targetPath = validateCustomTsharkPath(customPath);
            } catch (error) {
                return { found: false, version: null, path: null, error: error.message };
            }
        } else if (customPath !== undefined && customPath !== null) {
            return { found: false, version: null, path: null, error: 'TShark 路径无效' };
        } else {
            targetPath = await ensureTsharkPath();
        }
        if (!targetPath) return { found: false, version: null, path: null, error: '未找到 tshark，请安装 Wireshark' };
        const result = await checkTsharkVersion(targetPath);
        if (result.found) cachedTsharkPath = targetPath;
        return result;
    });

    ipc.handle('tshark:browseTshark', async () => {
        const win = analyzerWindow || null;
        const result = await dialogApi.showOpenDialog(win, {
            title: '选择 tshark 可执行文件',
            defaultPath: 'C:\\Program Files\\Wireshark',
            filters: [
                { name: 'tshark', extensions: ['exe'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths.length) return { canceled: true };
        return { canceled: false, path: result.filePaths[0] };
    });

    ipc.handle('tshark:getInterfaces', async () => {
        await ensureTsharkPath();
        if (!cachedTsharkPath) return { success: false, error: '未找到 tshark，请安装 Wireshark 并将其加入系统 PATH' };
        const interfaces = await getTsharkInterfaces(cachedTsharkPath);
        return { success: true, interfaces };
    });

    ipc.handle('tshark:start', async (event, options) => {
        if (activeImportRequest || importController.isRunning()) {
            return { success: false, error: '正在导入抓包文件，请先停止导入任务' };
        }
        if (captureStartRequest || captureJob) {
            return { success: false, error: '已有抓包任务正在运行' };
        }
        const owner = event?.sender || analyzerWindow?.webContents || null;
        if (!owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) {
            return { success: false, error: '分析窗口已关闭', cancelled: true };
        }

        const request = {
            cancelled: false,
            reason: null,
            owner,
            proc: null,
            procKilled: false,
            spawnWaiter: null,
            onOwnerDestroyed: null
        };
        request.onOwnerDestroyed = () => {
            request.cancelled = true;
            request.reason = '分析窗口已关闭';
            request.spawnWaiter?.cancel(request.reason);
            if (request.proc && !request.procKilled) {
                request.procKilled = true;
                try { killProcess(request.proc); } catch (_) {}
            }
        };
        captureStartRequest = request;
        try { owner.once?.('destroyed', request.onOwnerDestroyed); } catch (_) {}
        try {
            await ensureTsharkPath();
            if (request.cancelled || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) {
                return { success: false, error: request.reason || '抓包启动已取消', cancelled: true };
            }
            if (!cachedTsharkPath) return { success: false, error: '未找到 tshark，请先安装 Wireshark' };

            packetCounter = 0;

            const { interfaceIndex, captureFilter, displayFilter } = options || {};
            // 生成临时 pcap 路径，与 JSON 解析并行写入
            tmpPcapPath = path.join(appApi.getPath('temp'), `tshark-cap-${Date.now()}.pcap`);
            const args = [
                '-i', String(interfaceIndex || 1),
                '-T', 'ek', '-l', '-n',
                '-w', tmpPcapPath,
                ...TSHARK_FIELDS
            ];
            if (captureFilter) args.push('-f', captureFilter);
            if (displayFilter) args.push('-Y', displayFilter);

            let proc = null;
            let job = null;
            try {
                proc = spawnProcess(cachedTsharkPath, args, { windowsHide: true });
                request.proc = proc;
                request.spawnWaiter = createProcessSpawnWaiter(proc);
                const spawnResult = await request.spawnWaiter.promise;
                request.spawnWaiter = null;
                if (request.cancelled || spawnResult.cancelled) {
                    request.proc = null;
                    return { success: false, error: request.reason || spawnResult.error || '抓包启动已取消', cancelled: true };
                }
                if (!spawnResult.success) {
                    request.proc = null;
                    return { success: false, error: `无法启动 Tshark: ${spawnResult.error}` };
                }
                if (request.cancelled) {
                    if (!request.procKilled) {
                        request.procKilled = true;
                        killProcess(proc);
                    }
                    request.proc = null;
                    return { success: false, error: request.reason || '抓包启动已取消', cancelled: true };
                }

                try { owner.removeListener?.('destroyed', request.onOwnerDestroyed); } catch (_) {}
                job = {
                    proc,
                    owner,
                    settled: false,
                    buffer: '',
                    pendingBatch: [],
                    flushInterval: null,
                    onOwnerDestroyed: null
                };
                job.onOwnerDestroyed = () => {
                    finishCapture(job, { kill: true, flush: false, notify: false });
                };
                captureJob = job;
                request.proc = null;
                try { owner.once?.('destroyed', job.onOwnerDestroyed); } catch (_) {}
                if (job.settled || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) {
                    finishCapture(job, { kill: true, flush: false, notify: false });
                    return { success: false, error: '分析窗口已关闭', cancelled: true };
                }

                // 攻包定时推送（每 100ms 一批），避免高流量时淡没渲染进程 IPC
                job.flushInterval = setInterval(() => {
                    if (job.settled || captureJob !== job || job.pendingBatch.length === 0) return;
                    if (sendToOwner(job.owner, 'tshark:packets', job.pendingBatch)) {
                        job.pendingBatch = [];
                    }
                }, 100);

                proc.stdout.on('data', (data) => {
                    if (job.settled || captureJob !== job) return;
                    job.buffer += data.toString();
                    const lines = job.buffer.split('\n');
                    job.buffer = lines.pop();
                    for (const line of lines) {
                        const t = line.trim();
                        if (!t || t.startsWith('{"index"')) continue;
                        const pkt = _parseEkPacket(t);
                        if (pkt) job.pendingBatch.push(pkt);
                    }
                });
                proc.stdout.once('error', (error) => {
                    finishCapture(job, {
                        code: -1,
                        error: `抓包输出流错误: ${error.message}`,
                        kill: true,
                        flush: false
                    });
                });

                proc.stderr.on('data', (data) => {
                    if (job.settled || captureJob !== job) return;
                    sendToOwner(job.owner, 'tshark:error', data.toString());
                });
                proc.stderr.once('error', (error) => {
                    finishCapture(job, {
                        code: -1,
                        error: `抓包错误流异常: ${error.message}`,
                        kill: true,
                        flush: false
                    });
                });

                proc.on('close', (code) => {
                    finishCapture(job, { code, flush: true });
                });

                proc.on('error', (err) => {
                    finishCapture(job, {
                        code: -1,
                        error: `启动失败: ${err.message}`,
                        kill: true,
                        flush: false
                    });
                });

                return { success: true };
            } catch (error) {
                if (job) {
                    finishCapture(job, { kill: true, flush: false, notify: false });
                } else if (proc) {
                    try { killProcess(proc); } catch (_) {}
                }
                return { success: false, error: error.message };
            }
        } finally {
            try { owner.removeListener?.('destroyed', request.onOwnerDestroyed); } catch (_) {}
            if (captureStartRequest === request) captureStartRequest = null;
        }
    });

    ipc.handle('tshark:stop', async () => {
        const stoppedCapture = cancelCapture('抓包已停止');
        const stoppedImport = cancelImport('导入已停止');
        return { success: true, stoppedCapture, stoppedImport };
    });

    ipc.handle('tshark:importFile', async (event) => {
        if (captureStartRequest || captureJob) {
            return { success: false, error: '正在抓包，请先停止抓包任务' };
        }
        if (activeImportRequest || importController.isRunning()) {
            return { success: false, error: '已有 Tshark 文件导入任务正在运行' };
        }

        const request = { cancelled: false, reason: null };
        activeImportRequest = request;
        try {
            const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
            const result = await dialogApi.showOpenDialog(win, {
                title: '导入抓包文件',
                filters: [{ name: 'PCAP 文件', extensions: ['pcap', 'pcapng', 'cap'] }],
                properties: ['openFile']
            });
            if (request.cancelled) {
                return { success: false, error: request.reason || '导入已停止', cancelled: true };
            }
            if (result.canceled || !result.filePaths.length) {
                return { success: false, error: '取消', cancelled: true };
            }

            await ensureTsharkPath();
            if (request.cancelled) {
                return { success: false, error: request.reason || '导入已停止', cancelled: true };
            }
            if (!cachedTsharkPath) return { success: false, error: '未找到 tshark' };

            const owner = event?.sender || analyzerWindow?.webContents || null;
            if (!owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) {
                return { success: false, error: '分析窗口已关闭', cancelled: true };
            }

            packetCounter = 0;
            const filePath = result.filePaths[0];
            const args = ['-r', filePath, '-T', 'ek', '-n', ...TSHARK_FIELDS];
            try { owner.send('tshark:importStart'); } catch (_) {
                return { success: false, error: '无法通知分析窗口开始导入', cancelled: true };
            }

            return await importController.start({
                tsharkPath: cachedTsharkPath,
                filePath,
                args,
                owner,
                onPackets: (packets) => {
                    if (request.cancelled || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) return;
                    owner.send('tshark:packets', packets);
                }
            });
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            if (activeImportRequest === request) activeImportRequest = null;
        }
    });

    ipc.handle('tshark:aiDiagnose', async (event, { stats, packetCount, config }) => {
        try {
            const prompt = _buildDiagnosticPrompt(stats, packetCount);
            const result = await _callAiApi(config, prompt);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipc.handle('tshark:exportMarkdown', async (event, { diagnosis, stats, packetCount }) => {
        const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
        const result = await dialogApi.showSaveDialog(win, {
            title: '导出诊断报告',
            defaultPath: `network-diagnosis-${new Date().toISOString().slice(0, 10)}.md`,
            filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
        });
        if (result.canceled) return { success: false, error: '取消' };
        try {
            const content = _buildMarkdownReport(diagnosis, stats, packetCount);
            fs.writeFileSync(result.filePath, content, 'utf8');
            return { success: true, path: result.filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipc.handle('tshark:exportPdf', async (event, { htmlContent }) => {
        const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
        const result = await dialogApi.showSaveDialog(win, {
            title: '导出 PDF 报告',
            defaultPath: `network-diagnosis-${new Date().toISOString().slice(0, 10)}.pdf`,
            filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
        });
        if (result.canceled) return { success: false, error: '取消' };
        try {
            const pdfWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
            await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
            await new Promise(r => setTimeout(r, 800));
            const pdfData = await pdfWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
            pdfWin.close();
            fs.writeFileSync(result.filePath, pdfData);
            return { success: true, path: result.filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipc.handle('tshark:saveConfig', async (event, config) => {
        try {
            const configPath = path.join(appApi.getPath('userData'), 'tshark-analyzer-config.json');
            const toSave = { ...config };
            // 使用 safeStorage 加密 API Key
            if (toSave.apiKey && safeStorage.isEncryptionAvailable()) {
                toSave.apiKey_encrypted = safeStorage.encryptString(toSave.apiKey).toString('base64');
                delete toSave.apiKey;
            }
            fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // ==================== 数据包导出 ====================

    ipc.handle('tshark:exportCsv', async (event, { packets }) => {
        const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
        const result = await dialogApi.showSaveDialog(win, {
            title: '导出数据包 CSV',
            defaultPath: `packets-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        });
        if (result.canceled) return { success: false, error: '取消' };
        try {
            const header = 'No.,时间(s),相对时间(s),源地址,目标地址,协议,长度,信息\n';
            const rows = packets.map(p => {
                const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;
                return [p.id, p.timestamp, p.relTime || '', p.srcIp || '', p.dstIp || '',
                    p.protocol || '', p.length || 0, p.info || ''].map(esc).join(',');
            });
            fs.writeFileSync(result.filePath, '\uFEFF' + header + rows.join('\n'), 'utf8');
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    });

    ipc.handle('tshark:exportJson', async (event, { packets }) => {
        const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
        const result = await dialogApi.showSaveDialog(win, {
            title: '导出数据包 JSON',
            defaultPath: `packets-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
            filters: [{ name: 'JSON 文件', extensions: ['json'] }]
        });
        if (result.canceled) return { success: false, error: '取消' };
        try {
            fs.writeFileSync(result.filePath, JSON.stringify(packets, null, 2), 'utf8');
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    });

    ipc.handle('tshark:exportPcap', async () => {
        const win = analyzerWindow || (getMainWindow ? getMainWindow() : null);
        if (!tmpPcapPath || !fs.existsSync(tmpPcapPath)) {
            return { success: false, error: '无可用的 PCAP 数据，请先进行实时抓包后再导出' };
        }
        const result = await dialogApi.showSaveDialog(win, {
            title: '导出为 PCAP 文件',
            defaultPath: `capture-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pcap`,
            filters: [{ name: 'PCAP 文件', extensions: ['pcap', 'pcapng'] }]
        });
        if (result.canceled) return { success: false, error: '取消' };
        try {
            fs.copyFileSync(tmpPcapPath, result.filePath);
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    });

    ipc.handle('tshark:loadConfig', async () => {
        try {
            const configPath = path.join(appApi.getPath('userData'), 'tshark-analyzer-config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                // 解密 API Key（兼容旧版明文存储）
                if (config.apiKey_encrypted && safeStorage.isEncryptionAvailable()) {
                    try {
                        config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKey_encrypted, 'base64'));
                    } catch (_) {}
                    delete config.apiKey_encrypted;
                }
                return { success: true, config };
            }
            return { success: true, config: {} };
        } catch {
            return { success: true, config: {} };
        }
    });
}

module.exports = {
    TSHARK_IMPORT_TIMEOUT_MS,
    killTsharkProcess: _killProcess,
    createTsharkImportTask,
    createTsharkImportController,
    registerTsharkAnalyzerHandlers
};
