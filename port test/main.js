const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const {
    normalizeScanConcurrency,
    normalizeScanTimeout
} = require('../main/utils/scan-options');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, '..', 'main', 'utils', 'tool-preload.js'),
            additionalArguments: ['--net-tools-tool-id=portscanner']
        },
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.setMenu(null);
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

// TCP 端口扫描
function scanTcpPort(host, port, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'closed';

        socket.setTimeout(normalizeScanTimeout(timeout));

        socket.on('connect', () => {
            status = 'open';
            socket.destroy();
        });

        socket.on('timeout', () => {
            status = 'filtered';
            socket.destroy();
        });

        socket.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                status = 'closed';
            } else {
                status = 'filtered';
            }
        });

        socket.on('close', () => {
            resolve({ port, status, protocol: 'TCP' });
        });

        socket.connect(port, host);
    });
}

// UDP 端口扫描
function scanUdpPort(host, port, timeout = 3000) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let responded = false;
        const scanTimeout = normalizeScanTimeout(timeout);

        const timer = setTimeout(() => {
            if (!responded) {
                responded = true;
                socket.close();
                resolve({ port, status: 'open|filtered', protocol: 'UDP' });
            }
        }, scanTimeout);

        socket.on('error', (err) => {
            if (!responded) {
                responded = true;
                clearTimeout(timer);
                socket.close();
                if (err.code === 'ECONNREFUSED') {
                    resolve({ port, status: 'closed', protocol: 'UDP' });
                } else {
                    resolve({ port, status: 'filtered', protocol: 'UDP' });
                }
            }
        });

        socket.on('message', () => {
            if (!responded) {
                responded = true;
                clearTimeout(timer);
                socket.close();
                resolve({ port, status: 'open', protocol: 'UDP' });
            }
        });

        // 发送空数据包探测
        const message = Buffer.alloc(0);
        socket.send(message, 0, 0, port, host, (err) => {
            if (err && !responded) {
                responded = true;
                clearTimeout(timer);
                socket.close();
                resolve({ port, status: 'error', protocol: 'UDP' });
            }
        });
    });
}

// 解析端口范围
function parsePorts(portStr) {
    const ports = [];
    const parts = portStr.split(',').map(s => s.trim());

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) {
                    if (i >= 1 && i <= 65535 && !ports.includes(i)) {
                        ports.push(i);
                    }
                }
            }
        } else {
            const p = parseInt(part, 10);
            if (!isNaN(p) && p >= 1 && p <= 65535 && !ports.includes(p)) {
                ports.push(p);
            }
        }
    }

    return ports.sort((a, b) => a - b);
}

// 常用端口预设
const COMMON_PORTS = {
    tcp: [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017],
    udp: [53, 67, 68, 69, 123, 137, 138, 161, 162, 500, 514, 520, 1900, 4500, 5353]
};

// IPC 处理
ipcMain.handle('scan-ports', async (event, { host, ports, protocol, timeout, concurrency }) => {
    const portList = parsePorts(ports);
    const batchSize = normalizeScanConcurrency(concurrency);
    const scanTimeout = normalizeScanTimeout(timeout);
    const results = [];
    let completed = 0;
    const total = portList.length;

    // 并发控制
    const scanPort = protocol === 'TCP' ? scanTcpPort : scanUdpPort;

    for (let i = 0; i < portList.length; i += batchSize) {
        const batch = portList.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(port => scanPort(host, port, scanTimeout))
        );

        for (const result of batchResults) {
            results.push(result);
            completed++;
            mainWindow.webContents.send('scan-progress', {
                current: completed,
                total,
                result
            });
        }
    }

    return results;
});

ipcMain.handle('get-common-ports', () => COMMON_PORTS);

// 单端口快速测试
ipcMain.handle('quick-test', async (event, { host, port, protocol, timeout }) => {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
        return { error: '无效端口号' };
    }

    if (protocol === 'TCP') {
        return await scanTcpPort(host, p, normalizeScanTimeout(timeout));
    } else {
        return await scanUdpPort(host, p, normalizeScanTimeout(timeout));
    }
});
