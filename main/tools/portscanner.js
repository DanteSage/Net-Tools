/**
 * 端口扫描工具模块
 */
const path = require('path');
const net = require('net');
const { ipcMain } = require('electron');
const { parsePortRange } = require('../utils/helpers');
const { normalizeScanConcurrency } = require('../utils/scan-options');
const { createToolWindow } = require('../utils/toolWindow');

let portScannerWindow = null;
let portScanCancelled = false;

/**
 * TCP 端口扫描
 */
function scanTcpPort(host, port, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'closed';

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            status = 'open';
            socket.destroy();
        });

        socket.on('timeout', () => {
            status = 'closed';
            socket.destroy();
        });

        socket.on('error', () => {
            status = 'closed';
        });

        socket.on('close', () => {
            resolve({ port, status, protocol: 'TCP' });
        });

        socket.connect(port, host);
    });
}

/**
 * 注册端口扫描工具相关 IPC 处理程序
 */
function registerPortScannerHandlers(context, dependencies = {}) {
    const ipc = dependencies.ipcMain || ipcMain;
    const scanPort = dependencies.scanTcpPort || scanTcpPort;

    ipc.handle('portscanner:open', async () => {
        if (portScannerWindow && !portScannerWindow.isDestroyed()) {
            portScannerWindow.focus();
            return { success: true };
        }
        
        ({ win: portScannerWindow } = createToolWindow({
            toolId: 'portscanner',
            width: 850,
            height: 750,
            resizable: true
        }, path.join(__dirname, '..', '..', 'port test', 'index.html')));
        
        portScannerWindow.on('closed', () => {
            portScannerWindow = null;
        });
        
        return { success: true };
    });

    // 端口扫描
    ipc.handle('scan-ports', async (event, { host, ports, protocol, timeout, concurrency }) => {
        portScanCancelled = false;
        const portList = parsePortRange(ports);
        const batchSize = normalizeScanConcurrency(concurrency);
        const results = [];
        let completed = 0;
        const total = portList.length;

        for (let i = 0; i < portList.length; i += batchSize) {
            if (portScanCancelled) break;
            
            const batch = portList.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(port => scanPort(host, port, timeout))
            );

            for (const result of batchResults) {
                if (portScanCancelled) break;
                results.push(result);
                completed++;
            }
            if (portScannerWindow && !portScannerWindow.isDestroyed()) {
                portScannerWindow.webContents.send('scan-progress', {
                    current: completed,
                    total,
                    batchResults: batchResults
                });
            }
        }

        return results;
    });

    // 停止扫描
    ipc.handle('stop-scan', async () => {
        portScanCancelled = true;
        return { success: true };
    });

    // 单端口快速测试
    ipc.handle('quick-test', async (event, { host, port, protocol, timeout }) => {
        const p = parseInt(port, 10);
        if (isNaN(p) || p < 1 || p > 65535) {
            return { error: '无效端口号' };
        }
        return await scanPort(host, p, timeout);
    });
}

module.exports = { scanTcpPort, registerPortScannerHandlers };
