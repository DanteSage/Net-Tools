/**
 * DNS 查询工具模块 (DNSPy 风格)
 * 支持：多记录类型 / 多服务器对比 / DoH / DoT / 递归追踪
 */
const path = require('path');
const dgram = require('dgram');
const net = require('net');
const tls = require('tls');
const https = require('https');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const codec = require('../utils/dnsCodec');

let dnsWindow = null;
let traceAbort = false;

// ==================== 根 DNS 服务器（用于递归追踪） ====================

const ROOT_SERVERS = [
    { name: 'a.root-servers.net', ip: '198.41.0.4' },
    { name: 'b.root-servers.net', ip: '170.247.170.2' },
    { name: 'c.root-servers.net', ip: '192.33.4.12' },
    { name: 'd.root-servers.net', ip: '199.7.91.13' },
    { name: 'f.root-servers.net', ip: '192.5.5.241' }
];

// ==================== 传输层实现 ====================

/**
 * UDP 查询
 */
function queryUdp(server, port, query, timeout) {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        let settled = false;
        const done = (err, msg) => {
            if (settled) return;
            settled = true;
            try { sock.close(); } catch (_) {}
            if (err) reject(err); else resolve(msg);
        };
        const timer = setTimeout(() => done(new Error('UDP 超时')), timeout);
        sock.on('message', (msg) => { clearTimeout(timer); done(null, msg); });
        sock.on('error', (err) => { clearTimeout(timer); done(err); });
        sock.send(query, port, server, (err) => {
            if (err) { clearTimeout(timer); done(err); }
        });
    });
}

/**
 * TCP 查询（含 2 字节长度前缀）
 */
function queryTcp(server, port, query, timeout) {
    return new Promise((resolve, reject) => {
        const sock = new net.Socket();
        let settled = false;
        let received = Buffer.alloc(0);
        let expectedLen = null;
        const done = (err, msg) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch (_) {}
            if (err) reject(err); else resolve(msg);
        };
        sock.setTimeout(timeout);
        sock.on('connect', () => {
            const lenBuf = Buffer.alloc(2);
            lenBuf.writeUInt16BE(query.length, 0);
            sock.write(Buffer.concat([lenBuf, query]));
        });
        sock.on('data', (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (expectedLen === null && received.length >= 2) {
                expectedLen = received.readUInt16BE(0);
            }
            if (expectedLen !== null && received.length >= 2 + expectedLen) {
                done(null, received.slice(2, 2 + expectedLen));
            }
        });
        sock.on('timeout', () => done(new Error('TCP 超时')));
        sock.on('error', (err) => done(err));
        sock.connect(port, server);
    });
}

/**
 * DoT 查询（DNS over TLS, 端口 853）
 */
function queryDot(server, port, query, timeout) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let received = Buffer.alloc(0);
        let expectedLen = null;
        const done = (err, msg) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch (_) {}
            if (err) reject(err); else resolve(msg);
        };
        const sock = tls.connect({
            host: server,
            port: port || 853,
            servername: server.match(/^[\d.]+$/) ? undefined : server,
            rejectUnauthorized: false,
            timeout
        });
        sock.on('secureConnect', () => {
            const lenBuf = Buffer.alloc(2);
            lenBuf.writeUInt16BE(query.length, 0);
            sock.write(Buffer.concat([lenBuf, query]));
        });
        sock.on('data', (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (expectedLen === null && received.length >= 2) {
                expectedLen = received.readUInt16BE(0);
            }
            if (expectedLen !== null && received.length >= 2 + expectedLen) {
                done(null, received.slice(2, 2 + expectedLen));
            }
        });
        sock.on('timeout', () => done(new Error('DoT 超时')));
        sock.on('error', (err) => done(err));
    });
}

/**
 * DoH 查询（DNS over HTTPS, RFC 8484 wire format via POST）
 */
function queryDoh(url, query, timeout) {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(url);
        } catch (e) {
            return reject(new Error('无效的 DoH URL'));
        }
        const opts = {
            method: 'POST',
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + (u.search || ''),
            headers: {
                'Accept': 'application/dns-message',
                'Content-Type': 'application/dns-message',
                'Content-Length': query.length,
                'User-Agent': 'electron-Net-DNS/1.0'
            },
            timeout
        };
        const req = https.request(opts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`DoH HTTP ${res.statusCode}`));
                } else {
                    resolve(Buffer.concat(chunks));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('DoH 超时')); });
        req.write(query);
        req.end();
    });
}

/**
 * 根据传输协议派发查询
 */
async function queryByTransport(server, transport, query, timeout = 5000) {
    switch (transport) {
        case 'udp': return queryUdp(server.host, server.port || 53, query, timeout);
        case 'tcp': return queryTcp(server.host, server.port || 53, query, timeout);
        case 'dot': return queryDot(server.host, server.port || 853, query, timeout);
        case 'doh': return queryDoh(server.url, query, timeout);
        default: throw new Error('未知传输协议: ' + transport);
    }
}

// ==================== IPC 处理 ====================

function registerDnsLookupHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('dns:open', async () => {
        if (dnsWindow && !dnsWindow.isDestroyed()) {
            dnsWindow.focus();
            return { success: true };
        }
        ({ win: dnsWindow } = createToolWindow({
            width: 1100,
            height: 760,
            resizable: true
        }, path.join(__dirname, '..', '..', 'DNS Lookup', 'index.html')));

        dnsWindow.on('closed', () => {
            dnsWindow = null;
            traceAbort = true;
        });
        return { success: true };
    });

    /**
     * 单服务器查询：单域名、多记录类型
     */
    ipcMain.handle('dns:query', async (event, params) => {
        const { domain, types, server, transport, timeout = 5000 } = params;
        if (!domain || !types || !types.length || !server || !transport) {
            return { success: false, error: '参数不完整' };
        }

        const results = [];
        for (const typeName of types) {
            const type = codec.TYPES[typeName];
            if (!type) {
                results.push({ type: typeName, error: '不支持的类型' });
                continue;
            }
            const start = Date.now();
            try {
                const query = codec.encodeQuery(domain, type);
                const respBuf = await queryByTransport(server, transport, query, timeout);
                const resp = codec.decodeResponse(respBuf);
                results.push({
                    type: typeName,
                    rcode: resp.rcode,
                    rcodeName: resp.rcodeName,
                    flags: resp.flags,
                    answers: resp.answers.map(formatRecord),
                    authorities: resp.authorities.map(formatRecord),
                    additionals: resp.additionals
                        .filter(rr => rr.type !== codec.TYPES.OPT)
                        .map(formatRecord),
                    time: Date.now() - start
                });
            } catch (e) {
                results.push({
                    type: typeName,
                    error: e.message || String(e),
                    time: Date.now() - start
                });
            }
        }
        return { success: true, results };
    });

    /**
     * 多服务器对比查询：单域名、单类型、多服务器
     */
    ipcMain.handle('dns:multi-query', async (event, params) => {
        const { domain, type: typeName, servers, timeout = 5000 } = params;
        if (!domain || !typeName || !servers || !servers.length) {
            return { success: false, error: '参数不完整' };
        }
        const type = codec.TYPES[typeName];
        if (!type) return { success: false, error: '不支持的类型: ' + typeName };

        const query = codec.encodeQuery(domain, type);
        const tasks = servers.map(async (srv) => {
            const start = Date.now();
            try {
                const respBuf = await queryByTransport(srv, srv.transport, query, timeout);
                const resp = codec.decodeResponse(respBuf);
                return {
                    server: srv,
                    rcode: resp.rcode,
                    rcodeName: resp.rcodeName,
                    answers: resp.answers.map(formatRecord),
                    time: Date.now() - start
                };
            } catch (e) {
                return {
                    server: srv,
                    error: e.message || String(e),
                    time: Date.now() - start
                };
            }
        });
        const results = await Promise.all(tasks);

        // 检测不一致：将所有非空 answers 的 data 集合归类
        const answerSets = results.map(r => {
            if (r.error || !r.answers) return null;
            return new Set(r.answers.map(a => `${a.typeName}|${typeof a.data === 'object' ? a.data.str : a.data}`));
        });
        const validSets = answerSets.filter(s => s && s.size > 0);
        const inconsistent = validSets.length >= 2 && !validSets.every(s =>
            s.size === validSets[0].size &&
            [...s].every(x => validSets[0].has(x))
        );

        return { success: true, results, inconsistent };
    });

    /**
     * 递归追踪：从根服务器逐层追到权威
     * 通过 webContents.send 流式推送每一步
     */
    ipcMain.handle('dns:trace', async (event, params) => {
        const { domain, type: typeName, timeout = 5000 } = params;
        if (!domain || !typeName) {
            return { success: false, error: '参数不完整' };
        }
        const type = codec.TYPES[typeName];
        if (!type) return { success: false, error: '不支持的类型: ' + typeName };

        traceAbort = false;
        const steps = [];
        const sendStep = (step) => {
            steps.push(step);
            if (dnsWindow && !dnsWindow.isDestroyed()) {
                dnsWindow.webContents.send('dns:trace-step', step);
            }
        };

        // 起点：从根开始
        let currentServers = ROOT_SERVERS.map(s => ({ host: s.ip, name: s.name }));
        let depth = 0;
        const MAX_DEPTH = 12;

        try {
            while (depth < MAX_DEPTH && !traceAbort) {
                // 选第一个可用服务器
                let resp = null;
                let queriedServer = null;
                let stepTime = 0;

                for (const srv of currentServers) {
                    if (traceAbort) break;
                    const start = Date.now();
                    try {
                        const query = codec.encodeQuery(domain, type, { recursion: false });
                        const respBuf = await queryUdp(srv.host, 53, query, timeout);
                        resp = codec.decodeResponse(respBuf);
                        queriedServer = srv;
                        stepTime = Date.now() - start;
                        break;
                    } catch (e) {
                        // 尝试下一个
                        continue;
                    }
                }

                if (!resp || !queriedServer) {
                    sendStep({
                        depth, error: '所有候选服务器均无响应',
                        candidates: currentServers
                    });
                    break;
                }

                const step = {
                    depth,
                    server: queriedServer,
                    time: stepTime,
                    rcode: resp.rcode,
                    rcodeName: resp.rcodeName,
                    aa: resp.flags.aa,
                    answers: resp.answers.map(formatRecord),
                    authorities: resp.authorities.map(formatRecord),
                    additionals: resp.additionals
                        .filter(rr => rr.type !== codec.TYPES.OPT)
                        .map(formatRecord)
                };

                // 已得到最终答案（权威响应或 NOERROR 含 answer）
                if (resp.answers.length > 0 || resp.flags.aa === 1) {
                    step.final = true;
                    sendStep(step);
                    break;
                }

                if (resp.rcode !== 0) {
                    step.final = true;
                    sendStep(step);
                    break;
                }

                // 收集下一级 NS 服务器
                const nsRecords = resp.authorities.filter(rr => rr.type === codec.TYPES.NS);
                if (nsRecords.length === 0) {
                    step.final = true;
                    sendStep(step);
                    break;
                }

                sendStep(step);

                // 从 additional 段提取 glue records（NS 主机名 -> IP）
                const glueMap = new Map();
                for (const ar of resp.additionals) {
                    if (ar.type === codec.TYPES.A) {
                        glueMap.set(ar.name.toLowerCase(), ar.data);
                    }
                }

                const nextServers = [];
                for (const ns of nsRecords) {
                    const nsName = (typeof ns.data === 'string') ? ns.data : '';
                    if (!nsName) continue;
                    const ip = glueMap.get(nsName.toLowerCase());
                    if (ip) {
                        nextServers.push({ host: ip, name: nsName });
                    } else {
                        nextServers.push({ host: null, name: nsName, needsResolution: true });
                    }
                }

                // 如果都没有 glue，需要解析 NS 名称
                const resolvable = nextServers.filter(s => s.host);
                if (resolvable.length === 0 && nextServers.length > 0) {
                    // 对第一个 NS 名进行常规 DNS 查询（用根服务器）
                    const target = nextServers[0].name;
                    try {
                        const query = codec.encodeQuery(target, codec.TYPES.A);
                        const respBuf = await queryUdp(ROOT_SERVERS[0].ip, 53, query, timeout);
                        const resolved = codec.decodeResponse(respBuf);
                        // 这里简化处理：实际可能需要再次递归
                        const a = resolved.answers.find(r => r.type === codec.TYPES.A);
                        if (a) resolvable.push({ host: a.data, name: target });
                    } catch (e) {
                        // 忽略
                    }
                }

                if (resolvable.length === 0) {
                    sendStep({
                        depth: depth + 1,
                        error: '无法解析下一级 NS 服务器 IP',
                        candidates: nextServers
                    });
                    break;
                }

                currentServers = resolvable;
                depth++;
            }
        } catch (e) {
            sendStep({ depth, error: e.message || String(e) });
        }

        return { success: true, steps };
    });

    ipcMain.handle('dns:trace-abort', () => {
        traceAbort = true;
        return { success: true };
    });
}

/**
 * 格式化 RR 用于前端展示
 */
function formatRecord(rr) {
    return {
        name: rr.name,
        type: rr.type,
        typeName: rr.typeName,
        ttl: rr.ttl,
        class: rr.class,
        data: rr.data,
        // 给前端用的字符串形式
        text: typeof rr.data === 'string' ? rr.data : (rr.data && rr.data.str) || JSON.stringify(rr.data)
    };
}

module.exports = { registerDnsLookupHandlers };
