/**
 * Netcat 风格 TCP 工具模块
 * 功能：TCP 客户端、TCP 服务端（监听）、Banner 批量抓取
 */
const path = require('path');
const net = require('net');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

// ==================== 模块状态 ====================

let netcatWindow = null;
let clientSocket = null;        // 当前活动的客户端连接
let clientConnectAttempt = null;
let serverInstance = null;      // 当前监听的服务端
let serverClients = new Map();  // 服务端的连入客户端：id -> socket
let serverClientIdSeq = 1;
let bannerCancelled = false;

// ==================== 工具函数 ====================

/**
 * 安全地把 Buffer 解码为字符串（无法解码的字节用 . 替代）
 * @param {Buffer} buf
 * @returns {string}
 */
function bufferToText(buf) {
    if (!buf) return '';
    try {
        return buf.toString('utf8');
    } catch (e) {
        return buf.toString('binary');
    }
}

/**
 * 把输入字符串按指定格式编码为 Buffer
 * @param {string} input
 * @param {'text'|'hex'} format
 * @param {boolean} appendNewline 是否追加换行
 * @returns {Buffer}
 */
function encodeData(input, format, appendNewline) {
    if (format === 'hex') {
        const cleaned = String(input || '').replace(/\s+/g, '');
        if (cleaned.length % 2 !== 0 || /[^0-9a-fA-F]/.test(cleaned)) {
            throw new Error('HEX 格式不合法');
        }
        return Buffer.from(cleaned, 'hex');
    }
    let s = String(input == null ? '' : input);
    if (appendNewline) {
        s += '\r\n';
    }
    return Buffer.from(s, 'utf8');
}

/**
 * 向窗口安全发送事件
 */
function sendToWindow(channel, payload) {
    if (netcatWindow && !netcatWindow.isDestroyed()) {
        netcatWindow.webContents.send(channel, payload);
    }
}

/**
 * 安全地销毁所有连接，用于窗口关闭时
 */
function cleanupAll() {
    if (clientConnectAttempt) {
        clientConnectAttempt.cancel('窗口已关闭');
    } else if (clientSocket) {
        try { clientSocket.destroy(); } catch (_) {}
        clientSocket = null;
    }
    for (const sock of serverClients.values()) {
        try { sock.destroy(); } catch (_) {}
    }
    serverClients.clear();
    if (serverInstance) {
        try { serverInstance.close(); } catch (_) {}
        serverInstance = null;
    }
    bannerCancelled = true;
}

// ==================== 客户端 ====================

/**
 * 建立 TCP 客户端连接
 */
function clientConnect(host, port, timeout, dependencies = {}) {
    return new Promise((resolve) => {
        if (clientConnectAttempt) {
            clientConnectAttempt.cancel('连接已被新的请求替换');
        }
        if (clientSocket) {
            try { clientSocket.destroy(); } catch (_) {}
            clientSocket = null;
        }

        const createSocket = dependencies.createSocket || (() => new net.Socket());
        let sock;
        try {
            sock = createSocket();
        } catch (error) {
            resolve({ success: false, error: error.message });
            return;
        }
        clientSocket = sock;
        let settled = false;

        const isCurrent = () => clientSocket === sock;
        const settle = (result, destroySocket = false) => {
            if (settled) return false;
            settled = true;
            if (clientConnectAttempt && clientConnectAttempt.socket === sock) {
                clientConnectAttempt = null;
            }
            if (!result.success && isCurrent()) {
                clientSocket = null;
            }
            if (destroySocket) {
                try { sock.destroy(); } catch (_) {}
            }
            resolve(result);
            return true;
        };
        const cancel = (message = '连接已取消') => {
            if (isCurrent()) {
                sendToWindow('netcat:client-state', { state: 'closed', hadError: false });
            }
            settle({ success: false, error: message }, true);
        };

        clientConnectAttempt = { socket: sock, cancel };
        sock.setTimeout(Math.max(timeout || 5000, 1000));

        sendToWindow('netcat:client-state', { state: 'connecting', host, port });

        sock.once('connect', () => {
            if (!isCurrent()) {
                settle({ success: false, error: '连接已失效' }, true);
                return;
            }
            sock.setTimeout(0);
            sendToWindow('netcat:client-state', {
                state: 'connected',
                host,
                port,
                local: { address: sock.localAddress, port: sock.localPort }
            });
            settle({ success: true });
        });

        sock.on('data', (buf) => {
            if (!isCurrent()) return;
            sendToWindow('netcat:client-data', {
                time: Date.now(),
                size: buf.length,
                text: bufferToText(buf),
                hex: buf.toString('hex')
            });
        });

        sock.once('timeout', () => {
            if (isCurrent()) {
                sendToWindow('netcat:client-state', { state: 'error', message: '连接超时' });
            }
            settle({ success: false, error: '连接超时' }, true);
        });

        sock.once('error', (err) => {
            const current = isCurrent();
            if (current) {
                sendToWindow('netcat:client-state', { state: 'error', message: err.message });
            }
            if (!settle({ success: false, error: err.message }, true) && current) {
                clientSocket = null;
                try { sock.destroy(); } catch (_) {}
            }
        });

        sock.once('close', (hadError) => {
            if (isCurrent()) {
                clientSocket = null;
                sendToWindow('netcat:client-state', { state: 'closed', hadError: !!hadError });
            }
            settle({ success: false, error: '连接被关闭' });
        });

        try {
            sock.connect(port, host);
        } catch (e) {
            if (isCurrent()) {
                sendToWindow('netcat:client-state', { state: 'error', message: e.message });
            }
            settle({ success: false, error: e.message }, true);
        }
    });
}

// ==================== 服务端 ====================

/**
 * 启动 TCP 服务端监听
 */
function serverStart(port, host) {
    return new Promise((resolve) => {
        if (serverInstance) {
            return resolve({ success: false, error: '已有正在运行的监听' });
        }

        const server = net.createServer((sock) => {
            const id = serverClientIdSeq++;
            serverClients.set(id, sock);
            const remote = { address: sock.remoteAddress, port: sock.remotePort };
            sendToWindow('netcat:server-client', { event: 'connected', id, ...remote });

            sock.on('data', (buf) => {
                sendToWindow('netcat:server-data', {
                    id,
                    time: Date.now(),
                    size: buf.length,
                    text: bufferToText(buf),
                    hex: buf.toString('hex')
                });
            });

            sock.on('error', () => { /* swallow, close 会触发清理 */ });

            sock.on('close', () => {
                serverClients.delete(id);
                sendToWindow('netcat:server-client', { event: 'disconnected', id });
            });
        });

        server.on('error', (err) => {
            sendToWindow('netcat:server-state', { state: 'error', message: err.message });
            serverInstance = null;
            resolve({ success: false, error: err.message });
        });

        const listenHost = host || '0.0.0.0';
        server.listen(port, listenHost, () => {
            serverInstance = server;
            const addr = server.address();
            sendToWindow('netcat:server-state', {
                state: 'listening',
                host: listenHost,
                port: addr && addr.port ? addr.port : port
            });
            resolve({ success: true, port: addr && addr.port ? addr.port : port });
        });
    });
}

/**
 * 停止服务端监听
 */
function serverStop() {
    return new Promise((resolve) => {
        if (!serverInstance) {
            return resolve({ success: true });
        }
        const srv = serverInstance;
        serverInstance = null;
        // 主动关掉所有连入客户端
        for (const sock of serverClients.values()) {
            try { sock.destroy(); } catch (_) {}
        }
        serverClients.clear();
        srv.close(() => {
            sendToWindow('netcat:server-state', { state: 'closed' });
            resolve({ success: true });
        });
    });
}

// ==================== Banner 抓取 ====================

/**
 * 单次 banner 抓取
 * @param {string} host
 * @param {number} port
 * @param {number} timeout
 * @param {string} probe 主动发送的探测字符串（可空）
 * @returns {Promise<Object>}
 */
function grabBanner(host, port, timeout, probe) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        const chunks = [];
        let done = false;
        let connected = false;

        const finish = (status, error) => {
            if (done) return;
            done = true;
            try { sock.destroy(); } catch (_) {}
            const banner = Buffer.concat(chunks);
            resolve({
                host,
                port,
                status,
                error: error || null,
                bannerText: bufferToText(banner).slice(0, 500),
                bannerHex: banner.toString('hex').slice(0, 1000),
                size: banner.length
            });
        };

        sock.setTimeout(timeout || 3000);

        sock.once('connect', () => {
            connected = true;
            // 对 HTTP 端口主动发送一个简单请求触发 banner
            if (probe) {
                try { sock.write(probe); } catch (_) {}
            } else if (port === 80 || port === 8080 || port === 8000) {
                try { sock.write('HEAD / HTTP/1.0\r\n\r\n'); } catch (_) {}
            }
        });

        sock.on('data', (buf) => {
            chunks.push(buf);
            // 收到一段数据就快速结束（最多再等 200ms 看是否还有）
            setTimeout(() => finish(connected ? 'open' : 'closed'), 200);
        });

        sock.once('timeout', () => {
            // 已连上但没收到数据 -> open 但没 banner
            finish(connected ? 'open' : 'timeout');
        });

        sock.once('error', (err) => {
            finish(connected ? 'open' : 'closed', err.message);
        });

        sock.once('close', () => {
            finish(connected ? 'open' : 'closed');
        });

        try {
            sock.connect(port, host);
        } catch (e) {
            finish('error', e.message);
        }
    });
}

// ==================== IPC 注册 ====================

/**
 * 注册 Netcat 相关 IPC 处理程序
 */
function registerNetcatHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('netcat:open', async () => {
        if (netcatWindow && !netcatWindow.isDestroyed()) {
            netcatWindow.focus();
            return { success: true };
        }

        ({ win: netcatWindow } = createToolWindow({
            toolId: 'netcat',
            width: 900,
            height: 720,
            resizable: true,
            parent: getMainWindow(),
            modal: false
        }, path.join(__dirname, '..', '..', 'Netcat', 'index.html')));

        netcatWindow.on('closed', () => {
            cleanupAll();
            netcatWindow = null;
        });

        return { success: true };
    });

    // ===== 客户端 =====
    ipcMain.handle('netcat:client-connect', async (event, { host, port, timeout }) => {
        try {
            return await clientConnect(host, port, timeout);
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('netcat:client-send', async (event, { data, format, appendNewline }) => {
        if (!clientSocket || clientSocket.destroyed) {
            return { success: false, error: '尚未连接' };
        }
        try {
            const buf = encodeData(data, format, appendNewline);
            clientSocket.write(buf);
            return { success: true, size: buf.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('netcat:client-disconnect', async () => {
        if (clientConnectAttempt) {
            clientConnectAttempt.cancel('连接已取消');
        } else if (clientSocket) {
            const socket = clientSocket;
            clientSocket = null;
            sendToWindow('netcat:client-state', { state: 'closed', hadError: false });
            try { socket.destroy(); } catch (_) {}
        }
        return { success: true };
    });

    // ===== 服务端 =====
    ipcMain.handle('netcat:server-start', async (event, { port, host }) => {
        try {
            return await serverStart(port, host);
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('netcat:server-stop', async () => {
        try {
            return await serverStop();
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('netcat:server-send', async (event, { id, data, format, appendNewline }) => {
        const sock = serverClients.get(id);
        if (!sock || sock.destroyed) {
            return { success: false, error: '客户端已断开' };
        }
        try {
            const buf = encodeData(data, format, appendNewline);
            sock.write(buf);
            return { success: true, size: buf.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('netcat:server-kick', async (event, { id }) => {
        const sock = serverClients.get(id);
        if (sock) {
            try { sock.destroy(); } catch (_) {}
        }
        return { success: true };
    });

    // ===== Banner 抓取 =====
    ipcMain.handle('netcat:banner-grab', async (event, { targets, timeout, concurrency, probe }) => {
        bannerCancelled = false;
        const list = Array.isArray(targets) ? targets : [];
        const results = [];
        const total = list.length;
        const cc = Math.max(1, Math.min(concurrency || 20, 100));
        let completed = 0;

        for (let i = 0; i < list.length; i += cc) {
            if (bannerCancelled) break;
            const batch = list.slice(i, i + cc);
            const batchResults = await Promise.all(
                batch.map(t => grabBanner(t.host, t.port, timeout || 3000, probe))
            );
            for (const r of batchResults) {
                if (bannerCancelled) break;
                results.push(r);
                completed++;
                sendToWindow('netcat:banner-progress', { current: completed, total, result: r });
            }
        }
        return { success: true, results, cancelled: bannerCancelled };
    });

    ipcMain.handle('netcat:banner-stop', async () => {
        bannerCancelled = true;
        return { success: true };
    });
}

module.exports = {
    clientConnect,
    registerNetcatHandlers,
    cleanupNetcat: cleanupAll
};
