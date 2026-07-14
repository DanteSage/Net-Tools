/**
 * Ping 测试工具模块
 */
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let pingWindow = null;
let pingRunning = false;

/**
 * Ping 实现 - 使用系统 ping 命令
 */
function pingHost(host, timeout) {
    return new Promise((resolve) => {
        const timeoutSec = Math.ceil(timeout / 1000);
        const cmd = process.platform === 'win32'
            ? `ping -n 1 -w ${timeout} ${host}`
            : `ping -c 1 -W ${timeoutSec} ${host}`;
        
        const startTime = Date.now();
        
        exec(cmd, { timeout: timeout + 2000, windowsHide: true }, (error, stdout, stderr) => {
            const totalTime = Date.now() - startTime;
            
            if (error) {
                resolve({ success: false, host, time: 0 });
                return;
            }
            
            // 解析延迟时间
            const timeMatch = stdout.match(/[时间|time][=<](\d+\.?\d*)\s*ms/i);
            const time = timeMatch ? Math.round(parseFloat(timeMatch[1])) : totalTime;
            
            // 检查是否 ping 成功
            const isSuccess = /TTL=|ttl=|字节=|bytes from/i.test(stdout);
            
            resolve({ success: isSuccess, host, time: isSuccess ? time : 0 });
        });
    });
}

/**
 * 注册 Ping 工具相关 IPC 处理程序
 */
function registerPingHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('ping:open', async () => {
        if (pingWindow && !pingWindow.isDestroyed()) {
            pingWindow.focus();
            return { success: true };
        }
        
        ({ win: pingWindow } = createToolWindow({
            width: 750,
            height: 650,
            resizable: true
        }, path.join(__dirname, '..', '..', 'ping test', 'index.html')));
        
        pingWindow.on('closed', () => {
            pingWindow = null;
            pingRunning = false;
        });
        
        return { success: true };
    });

    // 开始 Ping
    ipcMain.handle('ping:start', async (event, { host, count, timeout, interval = 1000 }) => {
        pingRunning = true;
        
        for (let i = 0; i < count && pingRunning; i++) {
            const result = await pingHost(host, timeout);
            
            if (pingWindow && !pingWindow.isDestroyed()) {
                pingWindow.webContents.send('ping:result', result);
            }
            
            if (i < count - 1 && pingRunning) {
                await new Promise(r => setTimeout(r, interval));
            }
        }
        
        if (pingWindow && !pingWindow.isDestroyed()) {
            pingWindow.webContents.send('ping:complete');
        }
        
        pingRunning = false;
        return { success: true };
    });

    // 停止 Ping
    ipcMain.handle('ping:stop', () => {
        pingRunning = false;
        return { success: true };
    });

    // 直接 Ping 单个主机（TCP 方式）
    ipcMain.handle('ping:host', async (event, host, port = 22, timeout = 3000) => {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const socket = new net.Socket();
            
            socket.setTimeout(timeout);
            
            socket.on('connect', () => {
                const time = Date.now() - startTime;
                socket.destroy();
                resolve({ alive: true, host, time });
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve({ alive: false, host, time: 0 });
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve({ alive: false, host, time: 0 });
            });
            
            socket.connect(port, host);
        });
    });
}

module.exports = { registerPingHandlers };
