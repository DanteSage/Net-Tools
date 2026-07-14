/**
 * 测速服务器模块 - 兼容 LibreSpeed
 */

const express = require('express');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

let server = null;
let serverInfo = { port: 8888, localIP: '' };
let speedRecords = [];

// 获取本机 IP 地址
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// 启动测速服务器
function startSpeedServer() {
    const app = express();
    
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // ========== LibreSpeed 兼容接口 ==========

    // 下载测速 - garbage.php 替代
    app.get('/backend/garbage.php', (req, res) => {
        const ckSize = parseInt(req.query.ckSize) || 100;
        const size = ckSize * 1024 * 1024; // MB
        const maxSize = 100 * 1024 * 1024;
        const actualSize = Math.min(size, maxSize);
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Description', 'File Transfer');
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Cache-Control', 'post-check=0, pre-check=0');
        res.setHeader('Pragma', 'no-cache');
        
        const chunkSize = 1024 * 1024; // 1MB chunks
        let sent = 0;
        
        const sendChunk = () => {
            while (sent < actualSize) {
                const remaining = actualSize - sent;
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

    // 上传测速和 Ping - empty.php 替代
    app.all('/backend/empty.php', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Cache-Control', 'post-check=0, pre-check=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // 消耗上传数据
        if (req.method === 'POST') {
            req.on('data', () => {});
            req.on('end', () => res.status(200).end());
        } else {
            res.status(200).end();
        }
    });

    // 获取客户端 IP - getIP.php 替代
    app.get('/backend/getIP.php', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        
        let clientIP = req.ip || req.connection.remoteAddress || '';
        // 移除 IPv6 前缀
        if (clientIP.startsWith('::ffff:')) {
            clientIP = clientIP.substring(7);
        }
        
        const response = {
            processedString: clientIP,
            rawIspInfo: ''
        };
        
        res.json(response);
    });

    // ========== 自定义接口 ==========

    // 简化的下载测速接口
    app.get('/api/download', (req, res) => {
        const size = parseInt(req.query.size) || 1024 * 1024;
        const maxSize = 100 * 1024 * 1024;
        const actualSize = Math.min(size, maxSize);
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', actualSize);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        const chunkSize = 64 * 1024;
        let sent = 0;
        
        const sendChunk = () => {
            while (sent < actualSize) {
                const remaining = actualSize - sent;
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

    // 上传测速接口
    app.post('/api/upload', (req, res) => {
        let size = 0;
        req.on('data', chunk => { size += chunk.length; });
        req.on('end', () => res.json({ received: size }));
    });

    // Ping 接口
    app.get('/api/ping', (req, res) => {
        res.json({ t: Date.now() });
    });

    // 获取测速记录
    app.get('/api/records', (req, res) => {
        res.json(speedRecords.slice(-50));
    });

    // 保存测速记录
    app.post('/api/records', (req, res) => {
        const record = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('zh-CN'),
            clientIP: req.ip || req.connection.remoteAddress,
            ...req.body
        };
        speedRecords.push(record);
        if (speedRecords.length > 100) {
            speedRecords = speedRecords.slice(-100);
        }
        res.json({ success: true, record });
    });

    // 清空记录
    app.delete('/api/records', (req, res) => {
        speedRecords = [];
        res.json({ success: true });
    });

    // 启动服务器
    serverInfo.localIP = getLocalIP();
    
    server = app.listen(serverInfo.port, '0.0.0.0', () => {
        console.log(`测速服务器已启动: http://${serverInfo.localIP}:${serverInfo.port}`);
    });
    
    return server;
}

// 获取服务器信息
function getServerInfo() {
    return serverInfo;
}

// 停止服务器
function stopServer() {
    if (server) {
        server.close();
        server = null;
    }
}

module.exports = {
    startSpeedServer,
    getServerInfo,
    stopServer
};
