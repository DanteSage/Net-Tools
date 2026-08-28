/**
 * Ping 测试工具模块
 */
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const {
    assertIpcSender,
    buildPingInvocation,
    normalizeHost,
    requireInteger,
    requirePlainObject
} = require('../utils/security');

let pingWindow = null;
let pingRunning = false;
let activePingProcess = null;

/**
 * Ping 实现 - 使用系统 ping 命令
 */
function pingHost(host, timeout) {
    return new Promise((resolve) => {
        const { command, args } = buildPingInvocation(host, timeout);
        
        const startTime = Date.now();
        
        const child = execFile(command, args, {
            timeout: timeout + 2000,
            windowsHide: true,
            shell: false,
            maxBuffer: 1024 * 1024
        }, (error, stdout) => {
            if (activePingProcess === child) activePingProcess = null;
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
        activePingProcess = child;
    });
}

function stopPing() {
    pingRunning = false;
    if (activePingProcess) {
        try { activePingProcess.kill(); } catch (_) {}
        activePingProcess = null;
    }
}

/**
 * 注册 Ping 工具相关 IPC 处理程序
 */
function registerPingHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('ping:open', async (event) => {
        assertIpcSender(event, [getMainWindow], 'ping:open');
        if (pingWindow && !pingWindow.isDestroyed()) {
            pingWindow.focus();
            return { success: true };
        }
        
        ({ win: pingWindow } = createToolWindow({
            width: 1100,
            height: 820,
            minWidth: 600,
            minHeight: 620,
            resizable: true
        }, path.join(__dirname, '..', '..', 'ping test', 'index.html')));
        
        pingWindow.on('closed', () => {
            pingWindow = null;
            stopPing();
        });
        
        return { success: true };
    });

    // 开始 Ping
    ipcMain.handle('ping:start', async (event, request) => {
        assertIpcSender(event, [() => pingWindow], 'ping:start');
        requirePlainObject(request);
        const host = normalizeHost(request.host);
        const count = requireInteger(request.count, '探测次数', 1, 10000);
        const timeout = requireInteger(request.timeout, '超时时间', 100, 60000);
        const interval = requireInteger(request.interval ?? 1000, '探测间隔', 100, 60000);
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
    ipcMain.handle('ping:stop', (event) => {
        assertIpcSender(event, [() => pingWindow], 'ping:stop');
        stopPing();
        return { success: true };
    });

    // 直接 Ping 单个主机（TCP 方式）
    ipcMain.handle('ping:host', async (event, host, port = 22, timeout = 3000) => {
        assertIpcSender(event, [getMainWindow], 'ping:host');
        host = normalizeHost(host);
        port = requireInteger(port, '端口', 1, 65535);
        timeout = requireInteger(timeout, '超时时间', 100, 60000);
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
