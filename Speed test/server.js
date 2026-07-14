const express = require('express');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const app = express();
const PORT = 8888;

// 解析 JSON
app.use(express.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 存储测速记录（内存中）
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

// 下载测速接口 - 生成指定大小的随机数据
app.get('/api/download', (req, res) => {
    const size = parseInt(req.query.size) || 1024 * 1024; // 默认 1MB
    const maxSize = 100 * 1024 * 1024; // 最大 100MB
    const actualSize = Math.min(size, maxSize);
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', actualSize);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // 分块发送数据
    const chunkSize = 64 * 1024; // 64KB 块
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
    req.on('data', chunk => {
        size += chunk.length;
    });
    req.on('end', () => {
        res.json({ received: size });
    });
});

// 获取测速记录
app.get('/api/records', (req, res) => {
    res.json(speedRecords.slice(-50)); // 返回最近50条
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
    
    // 只保留最近100条记录
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
app.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('\n========================================');
    console.log('   内网测速服务器已启动');
    console.log('========================================');
    console.log(`\n本机访问: http://localhost:${PORT}`);
    console.log(`局域网访问: http://${localIP}:${PORT}`);
    console.log('\n其他设备请在浏览器中输入上述局域网地址进行测速');
    console.log('按 Ctrl+C 停止服务器\n');
});
