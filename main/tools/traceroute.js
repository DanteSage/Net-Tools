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

const CLASSIC_TRACE_MIN_WATCHDOG_MS = 30 * 1000;
const CLASSIC_TRACE_MAX_WATCHDOG_MS = 10 * 60 * 1000;
const CLASSIC_TRACE_WATCHDOG_GRACE_MS = 15 * 1000;
const CLASSIC_TRACE_STDERR_LIMIT = 4096;

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

function normalizeClassicTraceOptions(options = {}) {
    const parsedMaxHops = Number.parseInt(options.maxHops, 10);
    const parsedTimeout = Number.parseInt(options.timeout, 10);
    return {
        host: String(options.host || '').trim(),
        maxHops: Number.isFinite(parsedMaxHops) ? Math.min(64, Math.max(1, parsedMaxHops)) : 30,
        timeout: Number.isFinite(parsedTimeout) ? Math.min(30000, Math.max(500, parsedTimeout)) : 3000,
        protocol: options.protocol === 'tcp' ? 'tcp' : 'icmp'
    };
}

function calculateClassicTraceWatchdogMs(maxHops, timeout) {
    const normalized = normalizeClassicTraceOptions({ maxHops, timeout });
    const effectiveProbeTimeout = Math.max(1000, normalized.timeout);
    const expectedWorstCase = normalized.maxHops * effectiveProbeTimeout * 3
        + CLASSIC_TRACE_WATCHDOG_GRACE_MS;
    return Math.min(
        CLASSIC_TRACE_MAX_WATCHDOG_MS,
        Math.max(CLASSIC_TRACE_MIN_WATCHDOG_MS, expectedWorstCase)
    );
}

function createClassicTraceTask(options = {}) {
    const spawnProcess = typeof options.spawnProcess === 'function' ? options.spawnProcess : spawn;
    const killProcess = typeof options.killProcess === 'function'
        ? options.killProcess
        : (proc) => { try { proc?.kill(); } catch (_) {} };
    const setTimeoutFn = typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout;
    const clearTimeoutFn = typeof options.clearTimeoutFn === 'function' ? options.clearTimeoutFn : clearTimeout;
    const onHop = typeof options.onHop === 'function' ? options.onHop : () => true;
    const onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
    const owner = options.owner || null;
    const traceOptions = normalizeClassicTraceOptions(options);
    const requestId = typeof options.requestId === 'string' || typeof options.requestId === 'number'
        ? String(options.requestId).trim().slice(0, 128) || null
        : null;
    const watchdogMs = Number.isFinite(options.watchdogMs) && options.watchdogMs > 0
        ? Math.max(1, Math.floor(options.watchdogMs))
        : calculateClassicTraceWatchdogMs(traceOptions.maxHops, traceOptions.timeout);

    let proc = null;
    let timer = null;
    let settled = false;
    let reached = false;
    let buffer = '';
    let stderrTail = '';
    let hopCount = 0;
    let resolveTask;

    const promise = new Promise(resolve => {
        resolveTask = resolve;
    });

    const onOwnerDestroyed = () => {
        finish({
            success: false,
            error: '路由追踪窗口已关闭',
            cancelled: true,
            code: null
        }, { terminateProcess: true, notify: false });
    };

    const removeOwnerListener = () => {
        if (!owner) return;
        try { owner.removeListener?.('destroyed', onOwnerDestroyed); } catch (_) {}
    };

    function finish(result, finishOptions = {}) {
        if (settled) return false;
        settled = true;
        if (timer !== null) {
            try { clearTimeoutFn(timer); } catch (_) {}
            timer = null;
        }
        removeOwnerListener();
        if (finishOptions.terminateProcess && proc) {
            try { killProcess(proc); } catch (_) {}
        }

        const finalResult = { ...result, reached, requestId };
        if (finishOptions.notify !== false) {
            try { onComplete(finalResult); } catch (_) {}
        }
        resolveTask(finalResult);
        return true;
    }

    const task = {
        promise,
        stop(reason = '路由追踪已停止', stopOptions = {}) {
            return finish({
                success: false,
                error: reason,
                cancelled: true,
                code: null
            }, {
                terminateProcess: true,
                notify: stopOptions.notify !== false
            });
        },
        isSettled() {
            return settled;
        },
        get process() {
            return proc;
        }
    };

    if (!traceOptions.host) {
        finish({ success: false, error: '请输入有效的目标主机', code: null });
        return task;
    }

    if (owner && typeof owner.once === 'function') {
        try { owner.once('destroyed', onOwnerDestroyed); } catch (_) {}
    }
    if (owner && typeof owner.isDestroyed === 'function' && owner.isDestroyed()) {
        onOwnerDestroyed();
        return task;
    }

    const isWindows = (options.platform || process.platform) === 'win32';
    let cmd;
    let args;
    if (traceOptions.protocol === 'tcp' && !isWindows) {
        cmd = 'traceroute';
        args = [
            '-T', '-m', String(traceOptions.maxHops),
            '-w', String(Math.max(1, Math.floor(traceOptions.timeout / 1000))),
            traceOptions.host
        ];
    } else {
        cmd = isWindows ? 'tracert' : 'traceroute';
        args = isWindows
            ? ['-h', String(traceOptions.maxHops), '-w', String(traceOptions.timeout), traceOptions.host]
            : [
                '-m', String(traceOptions.maxHops),
                '-w', String(Math.max(1, Math.floor(traceOptions.timeout / 1000))),
                traceOptions.host
            ];
    }

    try {
        proc = spawnProcess(cmd, args, { windowsHide: true });
    } catch (error) {
        finish({ success: false, error: error.message, code: null });
        return task;
    }

    const processLine = (line) => {
        if (settled) return;
        const result = parseTracertLine(line.replace(/\r/g, ''), hopCount + 1);
        if (!result) return;
        hopCount += 1;
        if (result.ip === traceOptions.host || (result.hostname && result.hostname.includes(traceOptions.host))) {
            reached = true;
        }
        try {
            if (onHop({ ...result, requestId }) === false) {
                finish({
                    success: false,
                    error: '路由追踪窗口已关闭',
                    cancelled: true,
                    code: null
                }, { terminateProcess: true, notify: false });
            }
        } catch (error) {
            finish({
                success: false,
                error: `发送路由追踪结果失败: ${error.message}`,
                code: null
            }, { terminateProcess: true, notify: false });
        }
    };

    proc.stdout?.on('data', (data) => {
        if (settled) return;
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) processLine(line);
    });
    proc.stdout?.once('error', (error) => {
        finish({
            success: false,
            error: `路由追踪输出流错误: ${error.message}`,
            code: null
        }, { terminateProcess: true });
    });

    proc.stderr?.on('data', (data) => {
        if (settled) return;
        stderrTail = (stderrTail + data.toString()).slice(-CLASSIC_TRACE_STDERR_LIMIT);
    });
    proc.stderr?.once('error', (error) => {
        finish({
            success: false,
            error: `路由追踪错误流异常: ${error.message}`,
            code: null
        }, { terminateProcess: true });
    });

    proc.once('error', (error) => {
        finish({ success: false, error: error.message, code: null }, { terminateProcess: true });
    });

    proc.once('close', (code, signal) => {
        if (settled) return;
        if (buffer.trim()) processLine(buffer);
        if (settled) return;
        if (code === 0 && !signal) {
            finish({ success: true, code, signal: null });
            return;
        }
        const detail = stderrTail.trim();
        const suffix = detail ? `: ${detail}` : '';
        finish({
            success: false,
            error: `路由追踪异常退出（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）${suffix}`,
            code: code ?? null,
            signal: signal || null
        });
    });

    try {
        timer = setTimeoutFn(() => {
            finish({
                success: false,
                error: '路由追踪超时，进程已终止',
                timedOut: true,
                code: null
            }, { terminateProcess: true });
        }, watchdogMs);
        timer?.unref?.();
    } catch (error) {
        finish({
            success: false,
            error: `无法启动路由追踪看门狗: ${error.message}`,
            code: null
        }, { terminateProcess: true });
    }

    return task;
}

function createClassicTraceController(options = {}) {
    let activeTask = null;

    return {
        start(params = {}) {
            if (activeTask && !activeTask.isSettled()) {
                const requestId = typeof params.requestId === 'string' || typeof params.requestId === 'number'
                    ? String(params.requestId).trim().slice(0, 128) || null
                    : null;
                return Promise.resolve({
                    success: false,
                    error: '已有正在运行的路由追踪任务',
                    busy: true,
                    reached: false,
                    requestId
                });
            }
            const task = createClassicTraceTask({
                ...params,
                spawnProcess: options.spawnProcess,
                killProcess: options.killProcess,
                setTimeoutFn: options.setTimeoutFn,
                clearTimeoutFn: options.clearTimeoutFn,
                watchdogMs: options.watchdogMs,
                platform: options.platform
            });
            activeTask = task;
            return task.promise.finally(() => {
                if (activeTask === task) activeTask = null;
            });
        },
        stop(reason, stopOptions) {
            if (!activeTask || activeTask.isSettled()) return false;
            return activeTask.stop(reason, stopOptions);
        },
        isRunning() {
            return Boolean(activeTask && !activeTask.isSettled());
        }
    };
}

/**
 * 注册路由追踪工具相关 IPC 处理程序
 */
function registerTracerouteHandlers(context, dependencies = {}) {
    const ipc = dependencies.ipcMain || ipcMain;
    const classicTraceController = createClassicTraceController({
        spawnProcess: dependencies.spawnProcess,
        killProcess: dependencies.killProcess,
        setTimeoutFn: dependencies.setTimeoutFn,
        clearTimeoutFn: dependencies.clearTimeoutFn,
        watchdogMs: dependencies.watchdogMs,
        platform: dependencies.platform
    });

    const sendToOwner = (owner, channel, payload) => {
        if (!owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) return false;
        try {
            owner.send(channel, payload);
            return true;
        } catch (_) {
            return false;
        }
    };

    ipc.handle('traceroute:open', async () => {
        if (tracerouteWindow && !tracerouteWindow.isDestroyed()) {
            tracerouteWindow.focus();
            return { success: true };
        }
        
        const rendererPath = path.join(__dirname, '..', '..', 'Route Tracking', 'index.html');
        if (dependencies.createToolWindow) {
            ({ win: tracerouteWindow } = dependencies.createToolWindow({
                toolId: 'traceroute',
                width: 1000,
                height: 750,
                resizable: true
            }, rendererPath));
        } else {
            ({ win: tracerouteWindow } = createToolWindow({
                toolId: 'traceroute',
                width: 1000,
                height: 750,
                resizable: true
            }, rendererPath));
        }

        const openedWindow = tracerouteWindow;
        openedWindow.on('closed', () => {
            if (tracerouteWindow === openedWindow) tracerouteWindow = null;
            classicTraceController.stop('路由追踪窗口已关闭', { notify: false });
            cleanupTrippy();
        });
        
        return { success: true };
    });

    // DNS 反向解析
    ipc.handle('traceroute:reverseDns', async (event, ip) => {
        if (!ip || ip === '*') return null;
        try {
            const hostnames = await dns.reverse(ip);
            return hostnames[0] || null;
        } catch (e) {
            return null;
        }
    });

    // 开始路由追踪
    ipc.handle('traceroute:start', async (event, options = {}) => {
        const owner = event?.sender || tracerouteWindow?.webContents || null;
        return classicTraceController.start({
            ...options,
            owner,
            onHop: (result) => sendToOwner(owner, 'traceroute:hop', result),
            onComplete: (result) => sendToOwner(owner, 'traceroute:complete', result)
        });
    });

    // 停止路由追踪
    ipc.handle('traceroute:stop', () => {
        const stopped = classicTraceController.stop('路由追踪已停止');
        return { success: true, stopped };
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
    ipc.handle('traceroute:trippy-start', async (event, opts) => {
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
    ipc.handle('traceroute:trippy-stop', () => {
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
    ipc.handle('traceroute:lookup-geoip', async (event, ip) => {
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

module.exports = {
    CLASSIC_TRACE_MIN_WATCHDOG_MS,
    CLASSIC_TRACE_MAX_WATCHDOG_MS,
    calculateClassicTraceWatchdogMs,
    createClassicTraceTask,
    createClassicTraceController,
    registerTracerouteHandlers
};
