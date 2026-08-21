/**
 * 路由追踪工具模块（含 Trippy 风格连续探测）
 */
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const http = require('http');
const { spawn, exec } = require('child_process');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let tracerouteWindow = null;
let tracerouteProcess = null;
let tracerouteRunning = false;

// ==================== Trippy 状态 ====================

let trippyRunning = false;
let trippyTimer = null;
let trippyDiscoveryProc = null;
let trippyState = {
    hops: [],
    options: null,
    targetHost: null
};

const HISTORY_SIZE = 60;
const geoipCache = new Map();

/**
 * 解析 Windows tracert 输出行
 */
function parseTracertLine(line, hopNum) {
    if (!line.trim() || 
        line.includes('Tracing route') || line.includes('通过最多') ||
        line.includes('over a maximum') || line.includes('跟踪到') ||
        line.includes('Trace complete') || line.includes('跟踪完成') ||
        line.includes('报告') || line.includes('Report')) {
        return null;
    }
    
    // 匹配超时行
    const timeoutMatch = line.match(/^\s*(\d+)\s+\*\s+\*\s+\*/);
    if (timeoutMatch) {
        return {
            hop: parseInt(timeoutMatch[1]),
            ip: null,
            hostname: null,
            times: [-1, -1, -1],
            timeout: true
        };
    }
    
    // 匹配正常行
    const normalMatch = line.match(/^\s*(\d+)\s+([<\d]+\s*(?:ms|毫秒)|\*)\s+([<\d]+\s*(?:ms|毫秒)|\*)\s+([<\d]+\s*(?:ms|毫秒)|\*)\s+(.+)$/);
    if (normalMatch) {
        const hop = parseInt(normalMatch[1]);
        const times = [normalMatch[2], normalMatch[3], normalMatch[4]].map(t => {
            if (t === '*') return -1;
            const ms = t.replace(/[<\s]|ms|毫秒/g, '');
            return parseInt(ms) || 1;
        });
        
        let hostPart = normalMatch[5].trim();
        let ip = hostPart;
        let hostname = null;
        
        const hostMatch = hostPart.match(/^(.+?)\s+\[([\d.]+)\]$/);
        if (hostMatch) {
            hostname = hostMatch[1];
            ip = hostMatch[2];
        }
        
        return {
            hop,
            ip,
            hostname,
            times,
            timeout: times.every(t => t === -1)
        };
    }
    
    return null;
}

/**
 * 注册路由追踪工具相关 IPC 处理程序
 */
function registerTracerouteHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('traceroute:open', async () => {
        if (tracerouteWindow && !tracerouteWindow.isDestroyed()) {
            tracerouteWindow.focus();
            return { success: true };
        }
        
        ({ win: tracerouteWindow } = createToolWindow({
            width: 1280,
            height: 860,
            minWidth: 660,
            minHeight: 640,
            resizable: true
        }, path.join(__dirname, '..', '..', 'Route Tracking', 'index.html')));
        
        tracerouteWindow.on('closed', () => {
            tracerouteWindow = null;
            tracerouteRunning = false;
            if (tracerouteProcess) {
                tracerouteProcess.kill();
                tracerouteProcess = null;
            }
            cleanupTrippy();
        });
        
        return { success: true };
    });

    // DNS 反向解析
    ipcMain.handle('traceroute:reverseDns', async (event, ip) => {
        if (!ip || ip === '*') return null;
        try {
            const hostnames = await dns.reverse(ip);
            return hostnames[0] || null;
        } catch (e) {
            return null;
        }
    });

    // 开始路由追踪
    ipcMain.handle('traceroute:start', async (event, { host, maxHops, timeout, protocol = 'icmp' }) => {
        tracerouteRunning = true;
        let reached = false;
        
        return new Promise((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            let cmd, args;
            
            if (protocol === 'tcp' && !isWindows) {
                cmd = 'traceroute';
                args = ['-T', '-m', maxHops.toString(), '-w', Math.floor(timeout / 1000).toString(), host];
            } else {
                cmd = isWindows ? 'tracert' : 'traceroute';
                args = isWindows 
                    ? ['-h', maxHops.toString(), '-w', Math.floor(timeout).toString(), host]
                    : ['-m', maxHops.toString(), '-w', Math.floor(timeout / 1000).toString(), host];
            }
            
            tracerouteProcess = spawn(cmd, args, { windowsHide: true });
            
            let buffer = '';
            let hopCount = 0;
            
            tracerouteProcess.stdout.on('data', (data) => {
                if (!tracerouteRunning) return;
                
                let text = data.toString();
                buffer += text;
                const lines = buffer.split('\n');
                buffer = lines.pop();
                
                for (const line of lines) {
                    const result = parseTracertLine(line.replace(/\r/g, ''), hopCount + 1);
                    if (result) {
                        hopCount++;
                        
                        if (result.ip === host || (result.hostname && result.hostname.includes(host))) {
                            reached = true;
                        }
                        
                        if (tracerouteWindow && !tracerouteWindow.isDestroyed()) {
                            tracerouteWindow.webContents.send('traceroute:hop', result);
                        }
                    }
                }
            });
            
            tracerouteProcess.stderr.on('data', (data) => {
                console.error('Traceroute stderr:', data.toString());
            });
            
            tracerouteProcess.on('close', (code) => {
                tracerouteRunning = false;
                tracerouteProcess = null;
                
                if (tracerouteWindow && !tracerouteWindow.isDestroyed()) {
                    tracerouteWindow.webContents.send('traceroute:complete', { reached, code });
                }
                
                resolve({ success: true, reached });
            });
            
            tracerouteProcess.on('error', (err) => {
                tracerouteRunning = false;
                tracerouteProcess = null;
                reject(err);
            });
        });
    });

    // 停止路由追踪
    ipcMain.handle('traceroute:stop', () => {
        tracerouteRunning = false;
        if (tracerouteProcess) {
            tracerouteProcess.kill();
            tracerouteProcess = null;
        }
        return { success: true };
    });

    // ==================== Trippy 模式 ====================

    /** 发送事件到窗口 */
    function sendToWindow(channel, payload) {
        if (tracerouteWindow && !tracerouteWindow.isDestroyed()) {
            tracerouteWindow.webContents.send(channel, payload);
        }
    }

    /** ICMP 探测：使用 ping 命令 */
    function probeIcmp(ip, timeout) {
        return new Promise((resolve) => {
            const isWin = process.platform === 'win32';
            const cmd = isWin
                ? `ping -n 1 -w ${timeout} ${ip}`
                : `ping -c 1 -W ${Math.ceil(timeout / 1000)} ${ip}`;
            const start = Date.now();
            exec(cmd, { timeout: timeout + 1500, windowsHide: true }, (err, stdout) => {
                if (err && !stdout) return resolve(null);
                const m = stdout && stdout.match(/[时间|time][=<](\d+\.?\d*)\s*ms/i);
                const ok = stdout && /TTL=|ttl=|字节=|bytes from/i.test(stdout);
                if (!ok) return resolve(null);
                const t = m ? parseFloat(m[1]) : (Date.now() - start);
                resolve(Math.max(t, 0.1));
            });
        });
    }

    /** TCP 探测：connect 到指定端口测量 RTT */
    function probeTcp(ip, port, timeout) {
        return new Promise((resolve) => {
            const sock = new net.Socket();
            const start = Date.now();
            let settled = false;
            const done = (val) => {
                if (settled) return;
                settled = true;
                try { sock.destroy(); } catch (_) {}
                resolve(val);
            };
            sock.setTimeout(timeout);
            sock.once('connect', () => done(Date.now() - start));
            sock.once('timeout', () => done(null));
            sock.once('error', (err) => {
                // 端口关闭也算可达（说明跳点有响应）
                const t = Date.now() - start;
                done(err && err.code === 'ECONNREFUSED' ? t : null);
            });
            try { sock.connect(port, ip); } catch (_) { done(null); }
        });
    }

    /** UDP 探测：发送数据包后等待 ICMP 响应（best-effort） */
    function probeUdp(ip, port, timeout) {
        return new Promise((resolve) => {
            const dgram = require('dgram');
            const sock = dgram.createSocket('udp4');
            const start = Date.now();
            let settled = false;
            const done = (val) => {
                if (settled) return;
                settled = true;
                try { sock.close(); } catch (_) {}
                resolve(val);
            };
            const timer = setTimeout(() => done(null), timeout);
            // 已连接 UDP socket：收到 ICMP unreachable 会触发 error
            sock.connect(port, ip, () => {
                sock.send('trippy-probe', (err) => {
                    if (err) {
                        clearTimeout(timer);
                        done(null);
                    }
                });
            });
            sock.on('message', () => {
                clearTimeout(timer);
                done(Date.now() - start);
            });
            sock.on('error', (err) => {
                clearTimeout(timer);
                // ECONNREFUSED 表示收到 ICMP port unreachable -> 该 IP 可达
                if (err && err.code === 'ECONNREFUSED') {
                    done(Date.now() - start);
                } else {
                    done(null);
                }
            });
        });
    }

    /** 根据协议选择探测方式 */
    function probeHop(ip, opts) {
        if (!ip) return Promise.resolve(null);
        const t = opts.timeout || 3000;
        if (opts.protocol === 'tcp') return probeTcp(ip, opts.port || 80, t);
        if (opts.protocol === 'udp') return probeUdp(ip, opts.port || 33434, t);
        return probeIcmp(ip, t);
    }

    /** 通过 tracert/traceroute 发现路由 */
    function discoverRoute(host, maxHops, timeout, protocol) {
        return new Promise((resolve) => {
            const isWin = process.platform === 'win32';
            let cmd, args;
            if (isWin) {
                cmd = 'tracert';
                args = ['-h', String(maxHops), '-w', String(timeout), '-d', host];
            } else {
                cmd = 'traceroute';
                args = ['-n', '-m', String(maxHops), '-w', String(Math.ceil(timeout / 1000))];
                if (protocol === 'tcp') args.unshift('-T');
                else if (protocol === 'udp') args.unshift('-U');
                args.push(host);
            }

            const proc = spawn(cmd, args, { windowsHide: true });
            trippyDiscoveryProc = proc;
            const hops = [];
            let buffer = '';

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const r = parseTracertLine(line.replace(/\r/g, ''), hops.length + 1);
                    if (r) {
                        hops.push(r);
                        sendToWindow('traceroute:trippy-hop-discovered', r);
                    }
                }
            });

            proc.on('close', () => {
                trippyDiscoveryProc = null;
                resolve(hops);
            });

            proc.on('error', () => {
                trippyDiscoveryProc = null;
                resolve(hops);
            });
        });
    }

    /** 计算逐跳统计 */
    function computeHopStats(hop) {
        const arr = hop.history;
        if (!arr.length) {
            return {
                hop: hop.hop, ip: hop.ip, hostname: hop.hostname,
                sent: hop.sent, recv: hop.recv,
                loss: hop.sent ? ((hop.sent - hop.recv) / hop.sent) * 100 : 0,
                last: null, min: null, max: null, avg: null, stdev: null,
                history: []
            };
        }
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
        return {
            hop: hop.hop, ip: hop.ip, hostname: hop.hostname,
            sent: hop.sent, recv: hop.recv,
            loss: hop.sent ? ((hop.sent - hop.recv) / hop.sent) * 100 : 0,
            last: arr[arr.length - 1],
            min, max, avg,
            stdev: Math.sqrt(variance),
            history: arr.slice()
        };
    }

    /** 启动 Trippy 连续探测 */
    ipcMain.handle('traceroute:trippy-start', async (event, opts) => {
        if (trippyRunning) {
            return { success: false, error: '已有正在运行的 Trippy 探测' };
        }
        trippyRunning = true;
        trippyState.options = opts;
        trippyState.targetHost = opts.host;
        trippyState.hops = [];

        sendToWindow('traceroute:trippy-state', { state: 'discovering', host: opts.host });

        // 发现阶段
        const route = await discoverRoute(
            opts.host,
            opts.maxHops || 30,
            opts.timeout || 3000,
            opts.protocol || 'icmp'
        );

        if (!trippyRunning) {
            sendToWindow('traceroute:trippy-state', { state: 'stopped' });
            return { success: true, cancelled: true };
        }

        trippyState.hops = route.map(r => ({
            hop: r.hop,
            ip: r.ip,
            hostname: r.hostname || null,
            sent: 0,
            recv: 0,
            history: []
        }));

        sendToWindow('traceroute:trippy-state', {
            state: 'probing',
            host: opts.host,
            hopCount: trippyState.hops.length
        });

        // 持续探测循环
        const runRound = async () => {
            if (!trippyRunning) return;
            const hops = trippyState.hops;
            const probeOpts = trippyState.options;
            const results = await Promise.all(
                hops.map(h => probeHop(h.ip, probeOpts))
            );

            const updates = [];
            for (let i = 0; i < hops.length; i++) {
                const h = hops[i];
                const rtt = results[i];
                h.sent++;
                if (rtt != null) {
                    h.recv++;
                    h.history.push(rtt);
                    if (h.history.length > HISTORY_SIZE) h.history.shift();
                }
                updates.push(computeHopStats(h));
            }
            sendToWindow('traceroute:trippy-update', { updates, time: Date.now() });

            if (trippyRunning) {
                trippyTimer = setTimeout(runRound, opts.interval || 1000);
            }
        };
        runRound();

        return { success: true, hopCount: trippyState.hops.length };
    });

    /** 停止 Trippy 探测 */
    ipcMain.handle('traceroute:trippy-stop', () => {
        trippyRunning = false;
        if (trippyTimer) {
            clearTimeout(trippyTimer);
            trippyTimer = null;
        }
        if (trippyDiscoveryProc) {
            try { trippyDiscoveryProc.kill(); } catch (_) {}
            trippyDiscoveryProc = null;
        }
        sendToWindow('traceroute:trippy-state', { state: 'stopped' });
        return { success: true };
    });

    /** GeoIP / ASN 查询（使用 ip-api.com 免费接口） */
    ipcMain.handle('traceroute:lookup-geoip', async (event, ip) => {
        if (!ip) return null;
        if (geoipCache.has(ip)) return geoipCache.get(ip);
        // 私有地址不查询
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.|169\.254\.|0\.|255\.)/.test(ip)) {
            const result = { ip, private: true };
            geoipCache.set(ip, result);
            return result;
        }
        try {
            const result = await new Promise((resolve, reject) => {
                const req = http.get(
                    `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,as,org,query`,
                    { timeout: 4000 },
                    (res) => {
                        let body = '';
                        res.on('data', (chunk) => body += chunk);
                        res.on('end', () => {
                            try {
                                const data = JSON.parse(body);
                                if (data.status !== 'success') return resolve(null);
                                const asMatch = (data.as || '').match(/^AS(\d+)\s+(.+)$/);
                                resolve({
                                    ip: data.query,
                                    country: data.country || null,
                                    countryCode: data.countryCode || null,
                                    city: data.city || null,
                                    asn: asMatch ? asMatch[1] : null,
                                    org: asMatch ? asMatch[2] : (data.org || data.as || null)
                                });
                            } catch (e) { resolve(null); }
                        });
                    }
                );
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });
            if (result) geoipCache.set(ip, result);
            return result;
        } catch (e) {
            return null;
        }
    });
}

/** 清理 Trippy 状态（窗口关闭时调用） */
function cleanupTrippy() {
    trippyRunning = false;
    if (trippyTimer) { clearTimeout(trippyTimer); trippyTimer = null; }
    if (trippyDiscoveryProc) { try { trippyDiscoveryProc.kill(); } catch (_) {} trippyDiscoveryProc = null; }
}

module.exports = { registerTracerouteHandlers };
