/**
 * 测速服务器工具模块
 */
const path = require('path');
const { ipcMain } = require('electron');
const { getLocalIP } = require('../utils/helpers');
const { createToolWindow } = require('../utils/toolWindow');

// Express 和 crypto
let express, crypto;
try {
    express = require('express');
    crypto = require('crypto');
} catch (e) {
    console.log('Express not available for speed test');
}

let speedTestServer = null;
let speedTestStartPromise = null;
let speedTestStopPromise = null;
let speedTestWindow = null;
let speedTestInfo = { port: 8888, localIP: '' };
let speedTestRecords = [];

function reportSpeedTestError(scope, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[测速服务器] ${scope}: ${message}`);
}

function attachSpeedTestRequestLifecycle(req, res, onError = reportSpeedTestError) {
    if (res.locals?.speedTestLifecycle) {
        return res.locals.speedTestLifecycle;
    }

    let closed = false;
    const markClosed = () => {
        closed = true;
    };

    req.on('error', error => {
        markClosed();
        onError('请求错误', error);
    });
    req.on('aborted', markClosed);
    req.on('close', () => {
        if (!req.complete) markClosed();
    });
    res.on('error', error => {
        markClosed();
        onError('响应错误', error);
    });
    res.on('close', markClosed);

    const lifecycle = {
        isClosed: () => closed || Boolean(req.aborted) ||
            Boolean(req.destroyed && !req.complete) ||
            Boolean(res.destroyed) || Boolean(res.writableEnded)
    };

    res.locals = res.locals || {};
    res.locals.speedTestLifecycle = lifecycle;
    return lifecycle;
}

function destroyResponse(res, onError = reportSpeedTestError) {
    if (res.destroyed) return;

    try {
        if (typeof res.destroy === 'function') {
            res.destroy();
        } else if (res.socket && typeof res.socket.destroy === 'function') {
            res.socket.destroy();
        }
    } catch (error) {
        onError('响应终止错误', error);
    }
}

function sendRandomData(req, res, totalSize, options = {}) {
    const chunkSize = Math.max(1, Number(options.chunkSize) || 1024 * 1024);
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const onError = options.onError || reportSpeedTestError;
    const lifecycle = attachSpeedTestRequestLifecycle(req, res, onError);
    const size = Math.max(0, Number(totalSize) || 0);
    let sent = 0;
    let stopped = false;

    const stop = () => {
        stopped = true;
        res.removeListener('drain', sendChunk);
    };

    function sendChunk() {
        if (stopped || lifecycle.isClosed()) return;

        try {
            while (sent < size) {
                if (stopped || lifecycle.isClosed()) return;

                const currentChunk = Math.min(chunkSize, size - sent);
                const buffer = randomBytes(currentChunk);
                const canContinue = res.write(buffer);
                sent += currentChunk;

                if (!canContinue) {
                    if (!lifecycle.isClosed()) res.once('drain', sendChunk);
                    return;
                }
            }

            if (!stopped && !lifecycle.isClosed()) res.end();
        } catch (error) {
            stop();
            destroyResponse(res, onError);
            onError('下载响应写入错误', error);
        }
    }

    req.once('aborted', stop);
    res.once('close', stop);
    res.once('error', stop);
    sendChunk();
}

function handleEmptyRequest(req, res, onError = reportSpeedTestError) {
    const lifecycle = attachSpeedTestRequestLifecycle(req, res, onError);
    const respond = () => {
        if (lifecycle.isClosed()) return;
        try {
            res.status(200).end();
        } catch (error) {
            destroyResponse(res, onError);
            onError('空响应写入错误', error);
        }
    };

    if (req.method === 'POST') {
        if (req.readableEnded || req.complete) {
            respond();
            return;
        }
        req.on('data', () => {});
        req.once('end', respond);
        return;
    }

    respond();
}

function createSpeedTestApp(options = {}) {
    const expressImpl = options.expressImpl || express;
    const cryptoImpl = options.cryptoImpl || crypto;
    const onError = options.onError || reportSpeedTestError;
    if (!expressImpl || !cryptoImpl) {
        throw new Error('测速服务依赖不可用');
    }

    const app = expressImpl();
    app.use((req, res, next) => {
        attachSpeedTestRequestLifecycle(req, res, onError);
        next();
    });
    app.use(expressImpl.json());
    app.use(expressImpl.static(path.join(__dirname, '..', '..', 'Speed test', 'public')));
    app.use('/styles', expressImpl.static(path.join(__dirname, '..', '..', 'styles')));

    // 下载测速接口
    app.get('/backend/garbage.php', (req, res) => {
        const ckSize = parseInt(req.query.ckSize) || 100;
        const size = Math.min(ckSize * 1024 * 1024, 100 * 1024 * 1024);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        sendRandomData(req, res, size, {
            chunkSize: 1024 * 1024,
            randomBytes: cryptoImpl.randomBytes,
            onError
        });
    });

    // 上传/Ping接口
    app.all('/backend/empty.php', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache');
        res.setHeader('Connection', 'keep-alive');
        handleEmptyRequest(req, res, onError);
    });

    // 获取IP
    app.get('/backend/getIP.php', (req, res) => {
        let clientIP = req.ip || req.connection.remoteAddress || '';
        if (clientIP.startsWith('::ffff:')) clientIP = clientIP.substring(7);
        res.json({ processedString: clientIP, rawIspInfo: '' });
    });

    // 获取测速记录
    app.get('/api/records', (req, res) => {
        res.json(speedTestRecords.slice(-50));
    });

    // 保存测速记录
    app.post('/api/records', (req, res) => {
        const record = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('zh-CN'),
            clientIP: req.ip || req.connection.remoteAddress,
            ...req.body
        };
        speedTestRecords.push(record);
        if (speedTestRecords.length > 100) {
            speedTestRecords = speedTestRecords.slice(-100);
        }
        res.json({ success: true, record });
    });

    // 清空记录
    app.delete('/api/records', (req, res) => {
        speedTestRecords = [];
        res.json({ success: true });
    });

    return app;
}

function listenSpeedTestApp(app, options = {}) {
    const port = options.port ?? speedTestInfo.port;
    const host = options.host || '0.0.0.0';
    const onError = options.onError || (error => reportSpeedTestError('监听服务器错误', error));
    const onListening = options.onListening || (() => {});
    let server;

    try {
        server = app.listen(port, host);
    } catch (error) {
        onError(error, null);
        return null;
    }

    server.on('error', error => onError(error, server));
    server.once('listening', () => onListening(server));
    return server;
}

/**
 * 启动测速服务器
 */
function startSpeedTestServer(options = {}) {
    if (speedTestServer?.listening) return Promise.resolve(speedTestServer);
    if (speedTestStopPromise) {
        const stopping = speedTestStopPromise;
        return stopping.then(async () => {
            if (speedTestStartPromise) {
                await speedTestStartPromise.catch(() => {});
            }
            return startSpeedTestServer(options);
        });
    }
    if (speedTestStartPromise) return speedTestStartPromise;
    if (!express || !crypto) {
        return Promise.reject(new Error('测速服务依赖不可用'));
    }

    let app;
    try {
        app = createSpeedTestApp();
    } catch (error) {
        return Promise.reject(error);
    }

    speedTestInfo.localIP = getLocalIP();
    const port = options.port ?? speedTestInfo.port;
    const host = options.host || '0.0.0.0';
    const startup = new Promise((resolve, reject) => {
        let settled = false;
        let server = null;

        const fail = (error, failedServer) => {
            reportSpeedTestError('监听服务器错误', error);
            if (failedServer && speedTestServer === failedServer && !failedServer.listening) {
                speedTestServer = null;
            }
            if (!settled) {
                settled = true;
                reject(new Error(`测速服务启动失败: ${error.message}`));
            }
        };

        server = listenSpeedTestApp(app, {
            port,
            host,
            onError: fail,
            onListening: listeningServer => {
                if (settled) return;
                settled = true;
                const listeningPort = listeningServer.address()?.port ?? port;
                console.log(`测速服务器已启动: http://${speedTestInfo.localIP}:${listeningPort}`);
                resolve(listeningServer);
            }
        });

        if (!server) return;
        speedTestServer = server;
        server.once('close', () => {
            if (speedTestServer === server) speedTestServer = null;
            if (!settled) {
                settled = true;
                reject(new Error('测速服务启动已取消'));
            }
        });
    });

    speedTestStartPromise = startup.finally(() => {
        speedTestStartPromise = null;
    });
    return speedTestStartPromise;
}

/**
 * 停止测速服务器
 */
function stopSpeedTestServer() {
    if (speedTestStopPromise) return speedTestStopPromise;

    const server = speedTestServer;
    speedTestServer = null;
    if (!server) return Promise.resolve();

    speedTestStopPromise = new Promise(resolve => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                reportSpeedTestError('停止服务器错误', error);
            }
            resolve();
        };

        try {
            server.close(finish);
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
        } catch (error) {
            finish(error);
        }
    }).finally(() => {
        speedTestStopPromise = null;
    });

    return speedTestStopPromise;
}

/**
 * 注册测速工具相关 IPC 处理程序
 */
function registerSpeedTestHandlers(context, dependencies = {}) {
    const ipc = dependencies.ipcMain || ipcMain;
    const startServer = dependencies.startSpeedTestServer || startSpeedTestServer;
    const stopServer = dependencies.stopSpeedTestServer || stopSpeedTestServer;
    const createWindow = dependencies.createSpeedTestWindow || (() => createToolWindow({
        toolId: 'speedtest',
        width: 500,
        height: 560,
        resizable: false
    }, path.join(__dirname, '..', '..', 'Speed test', 'server-ui.html')));
    let openPromise = null;

    const openSpeedTestWindow = async () => {
        const existingWindow = speedTestWindow;
        if (existingWindow && !existingWindow.isDestroyed()) {
            await startServer();
            if (speedTestWindow === existingWindow && !existingWindow.isDestroyed()) {
                existingWindow.focus();
                return { success: true };
            }
            return openSpeedTestWindow();
        }

        await startServer();
        if (speedTestWindow && !speedTestWindow.isDestroyed()) {
            speedTestWindow.focus();
            return { success: true };
        }

        let createdWindow;
        try {
            ({ win: createdWindow } = createWindow());
            speedTestWindow = createdWindow;
        } catch (error) {
            await stopServer();
            throw error;
        }

        createdWindow.webContents.on('did-finish-load', () => {
            if (!createdWindow.isDestroyed()) {
                createdWindow.webContents.send('server-info', speedTestInfo);
            }
        });

        createdWindow.on('closed', () => {
            if (speedTestWindow !== createdWindow) return;
            speedTestWindow = null;
            stopServer();
        });

        return { success: true };
    };

    ipc.handle('speedtest:open', () => {
        if (openPromise) return openPromise;

        const opening = openSpeedTestWindow();
        openPromise = opening.finally(() => {
            openPromise = null;
        });
        return openPromise;
    });
}

module.exports = {
    attachSpeedTestRequestLifecycle,
    destroyResponse,
    sendRandomData,
    handleEmptyRequest,
    createSpeedTestApp,
    listenSpeedTestApp,
    startSpeedTestServer,
    registerSpeedTestHandlers,
    stopSpeedTestServer
};
