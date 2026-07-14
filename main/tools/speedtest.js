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
let speedTestWindow = null;
let speedTestInfo = { port: 8888, localIP: '' };
let speedTestRecords = [];

/**
 * 启动测速服务器
 */
function startSpeedTestServer() {
    if (!express || speedTestServer) return;
    
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', '..', 'Speed test', 'public')));
    app.use('/styles', express.static(path.join(__dirname, '..', '..', 'styles')));
    
    // 下载测速接口
    app.get('/backend/garbage.php', (req, res) => {
        const ckSize = parseInt(req.query.ckSize) || 100;
        const size = Math.min(ckSize * 1024 * 1024, 100 * 1024 * 1024);
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        
        const chunkSize = 1024 * 1024;
        let sent = 0;
        
        const sendChunk = () => {
            while (sent < size) {
                const remaining = size - sent;
                const currentChunk = Math.min(chunkSize, remaining);
                const buffer = crypto.randomBytes(currentChunk);
                if (!res.write(buffer)) {
                    res.once('drain', sendChunk);
                    sent += currentChunk;
                    return;
                }
                sent += currentChunk;
            }
            res.end();
        };
        sendChunk();
    });
    
    // 上传/Ping接口
    app.all('/backend/empty.php', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (req.method === 'POST') {
            req.on('data', () => {});
            req.on('end', () => res.status(200).end());
        } else {
            res.status(200).end();
        }
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
    
    speedTestInfo.localIP = getLocalIP();
    speedTestServer = app.listen(speedTestInfo.port, '0.0.0.0', () => {
        console.log(`测速服务器已启动: http://${speedTestInfo.localIP}:${speedTestInfo.port}`);
    });
}

/**
 * 停止测速服务器
 */
function stopSpeedTestServer() {
    if (speedTestServer) {
        speedTestServer.close();
        speedTestServer = null;
    }
}

/**
 * 注册测速工具相关 IPC 处理程序
 */
function registerSpeedTestHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('speedtest:open', async () => {
        if (speedTestWindow && !speedTestWindow.isDestroyed()) {
            speedTestWindow.focus();
            return { success: true };
        }
        
        startSpeedTestServer();
        
        ({ win: speedTestWindow } = createToolWindow({
            width: 500,
            height: 560,
            resizable: false
        }, path.join(__dirname, '..', '..', 'Speed test', 'server-ui.html')));
        
        speedTestWindow.webContents.on('did-finish-load', () => {
            speedTestWindow.webContents.send('server-info', speedTestInfo);
        });
        
        speedTestWindow.on('closed', () => {
            speedTestWindow = null;
            stopSpeedTestServer();
        });
        
        return { success: true };
    });
}

module.exports = { registerSpeedTestHandlers, stopSpeedTestServer };
