/**
 * Ping 测试工具模块
 */
const path = require('path');
const net = require('net');
const { domainToASCII } = require('url');
const { execFile } = require('child_process');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let pingWindow = null;
let pingRunning = false;

/**
 * 校验并规范化 Ping 目标。
 * 允许 IPv4、IPv6（含安全的 zone id）、ASCII/IDN 域名，不允许命令或参数字符。
 */
function normalizePingHost(input) {
    if (typeof input !== 'string') {
        throw new Error('目标主机格式无效');
    }

    const host = input.trim();
    if (!host || host.length > 253 || /[\x00-\x20\x7f]/.test(host)) {
        throw new Error('目标主机格式无效');
    }

    if (net.isIP(host)) return host;

    // 链路本地 IPv6 可带接口 zone id，例如 fe80::1%12 或 fe80::1%eth0。
    const zoneIndex = host.lastIndexOf('%');
    if (zoneIndex > 0) {
        const address = host.slice(0, zoneIndex);
        const zone = host.slice(zoneIndex + 1);
        if (net.isIP(address) === 6 && /^[A-Za-z0-9_.-]+$/.test(zone)) {
            return `${address}%${zone}`;
        }
        throw new Error('目标主机格式无效');
    }

    const asciiHost = domainToASCII(host);
    const normalizedHost = asciiHost.endsWith('.') ? asciiHost.slice(0, -1) : asciiHost;
    if (!normalizedHost || normalizedHost.length > 253) {
        throw new Error('目标主机格式无效');
    }

    const labels = normalizedHost.split('.');
    const validLabel = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/;
    if (labels.some(label => !validLabel.test(label))) {
        throw new Error('目标主机格式无效');
    }

    return normalizedHost;
}

function normalizeBoundedInteger(value, defaultValue, min, max, fieldName) {
    const candidate = value === undefined ? defaultValue : Number(value);
    if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
        throw new Error(`${fieldName}必须是 ${min}-${max} 之间的整数`);
    }
    return candidate;
}

function buildPingInvocation(host, timeout, platform = process.platform) {
    const normalizedHost = normalizePingHost(host);
    if (platform === 'win32') {
        return {
            file: 'ping.exe',
            args: ['-n', '1', '-w', String(timeout), normalizedHost]
        };
    }

    return {
        file: 'ping',
        args: ['-c', '1', '-W', String(Math.ceil(timeout / 1000)), normalizedHost]
    };
}

/**
 * Ping 实现 - 使用系统 ping 命令
 */
function pingHost(host, timeout, runExecFile = execFile) {
    return new Promise((resolve) => {
        let invocation;
        try {
            invocation = buildPingInvocation(host, timeout);
        } catch (error) {
            resolve({ success: false, host: String(host || ''), time: 0, error: error.message });
            return;
        }
        
        const startTime = Date.now();
        
        runExecFile(invocation.file, invocation.args, {
            timeout: timeout + 2000,
            windowsHide: true,
            encoding: 'utf8'
        }, (error, stdout) => {
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
            toolId: 'ping',
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
        const normalizedHost = normalizePingHost(host);
        const normalizedCount = normalizeBoundedInteger(count, 10, 1, 10000, 'Ping 次数');
        const normalizedTimeout = normalizeBoundedInteger(timeout, 3000, 500, 30000, '超时时间');
        const normalizedInterval = normalizeBoundedInteger(interval, 1000, 100, 10000, 'Ping 间隔');

        pingRunning = true;
        
        for (let i = 0; i < normalizedCount && pingRunning; i++) {
            const result = await pingHost(normalizedHost, normalizedTimeout);
            
            if (pingWindow && !pingWindow.isDestroyed()) {
                pingWindow.webContents.send('ping:result', result);
            }
            
            if (i < normalizedCount - 1 && pingRunning) {
                await new Promise(r => setTimeout(r, normalizedInterval));
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

module.exports = {
    buildPingInvocation,
    normalizePingHost,
    pingHost,
    registerPingHandlers
};
