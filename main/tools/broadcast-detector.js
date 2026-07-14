/**
 * 广播与环路检测工具主进程模块 (BroadcastDetector)
 */
const path = require('path');
const { spawn, exec } = require('child_process');
const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('fs');
const { createToolWindow } = require('../utils/toolWindow');

let detectorWindow = null;
let captureProcess = null;
let cachedTsharkPath = null;

const TSHARK_SEARCH_PATHS = [
    'tshark',
    'C:\\Program Files\\Wireshark\\tshark.exe',
    'C:\\Program Files (x86)\\Wireshark\\tshark.exe'
];

const TSHARK_FIELDS = [
    '-e', 'frame.time_epoch',
    '-e', 'frame.len',
    '-e', 'eth.src',
    '-e', 'eth.dst',
    '-e', 'ip.src',
    '-e', 'ip.dst',
    '-e', 'ip.proto',
    '-e', 'ip.id',
    '-e', 'arp.opcode',
    '-e', 'arp.src.proto_ipv4',
    '-e', 'arp.dst.proto_ipv4',
    '-e', 'arp.src.hw_mac'
];

/**
 * 强制终止抓包进程（Windows 需杀整个进程树）
 * @private
 */
function _killProcess(proc) {
    if (!proc) return;
    try {
        if (process.platform === 'win32' && proc.pid) {
            exec(`taskkill /F /T /PID ${proc.pid}`, () => {});
        }
        proc.kill();
    } catch (_) {}
}

/**
 * 查找 tshark 可执行文件路径
 * @private
 */
async function _findTshark() {
    for (const p of TSHARK_SEARCH_PATHS) {
        try {
            await new Promise((resolve, reject) => {
                exec(`"${p}" --version`, { timeout: 3000 }, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            return p;
        } catch {}
    }
    return null;
}

/**
 * 获取网络接口列表
 * @private
 */
async function _getInterfaces(tshark) {
    return new Promise((resolve) => {
        exec(`"${tshark}" -D 2>&1`, { timeout: 5000 }, (err, stdout) => {
            if (!stdout) { resolve([]); return; }
            const lines = stdout.split('\n').filter(l => l.trim());
            const interfaces = lines.map(line => {
                const m = line.match(/^(\d+)\.\s+(.+?)(?:\s+\((.+)\))?\s*$/);
                if (!m) return null;
                return { index: parseInt(m[1]), name: m[2].trim(), description: (m[3] || m[2]).trim() };
            }).filter(Boolean);
            resolve(interfaces);
        });
    });
}

/**
 * 解析 tshark -T ek 单行输出为数据包对象
 * @private
 */
function _parseEkPacket(line) {
    try {
        const data = JSON.parse(line);
        if (data.index) return null;
        const layers = data._source?.layers || data.layers;
        if (!layers) return null;

        const getVal = (key) => {
            const k = key.replace(/\./g, '_');
            const v = layers[k] ?? layers[key];
            if (Array.isArray(v)) return v[0] || '';
            return v || '';
        };

        return {
            timestamp: parseFloat(getVal('frame.time_epoch')) || (Date.now() / 1000),
            length: parseInt(getVal('frame.len')) || 0,
            ethSrc: getVal('eth.src'),
            ethDst: getVal('eth.dst'),
            ipSrc: getVal('ip.src'),
            ipDst: getVal('ip.dst'),
            ipProto: getVal('ip.proto'),
            ipId: getVal('ip.id'),
            arpOpcode: getVal('arp.opcode'),
            arpSrcIp: getVal('arp.src.proto_ipv4'),
            arpDstIp: getVal('arp.dst.proto_ipv4'),
            arpSrcMac: getVal('arp.src.hw_mac')
        };
    } catch (_) {
        return null;
    }
}

/**
 * 注册广播与环路检测相关 IPC 处理程序
 */
function registerBroadcastDetectorHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('broadcastDetector:open', async () => {
        if (detectorWindow && !detectorWindow.isDestroyed()) {
            detectorWindow.focus();
            return { success: true };
        }

        const indexPath = path.join(__dirname, '..', '..', 'BroadcastDetector', 'index.html');

        if (!fs.existsSync(indexPath)) {
            return { success: false, error: '找不到 BroadcastDetector 工具文件' };
        }

        ({ win: detectorWindow } = createToolWindow({
            width: 1150,
            height: 780,
            minWidth: 1000,
            minHeight: 650,
            resizable: true,
            title: '广播与环路检测工具'
        }, indexPath));

        detectorWindow.on('closed', () => {
            detectorWindow = null;
            if (captureProcess) {
                const proc = captureProcess;
                captureProcess = null;
                _killProcess(proc);
            }
        });

        return { success: true };
    });

    ipcMain.handle('broadcastDetector:checkVersion', async (event, customPath) => {
        const targetPath = customPath || cachedTsharkPath || await _findTshark();
        if (!targetPath) return { found: false, version: null, path: null, error: '未找到 tshark，请安装 Wireshark' };
        return new Promise((resolve) => {
            exec(`"${targetPath}" --version`, { timeout: 4000 }, (err, stdout) => {
                if (err) {
                    resolve({ found: false, version: null, path: targetPath, error: err.message });
                    return;
                }
                const m = stdout.match(/TShark[^\d]*(\d+\.\d+\.\d+)/i);
                const version = m ? m[1] : stdout.split('\n')[0].trim();
                cachedTsharkPath = targetPath;
                resolve({ found: true, version, path: targetPath });
            });
        });
    });

    ipcMain.handle('broadcastDetector:browseTshark', async () => {
        const win = detectorWindow || null;
        const result = await dialog.showOpenDialog(win, {
            title: '选择 tshark 可执行文件',
            defaultPath: 'C:\\Program Files\\Wireshark',
            filters: [
                { name: 'tshark', extensions: ['exe'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths.length) return { canceled: true };
        return { canceled: false, path: result.filePaths[0] };
    });

    ipcMain.handle('broadcastDetector:getInterfaces', async () => {
        if (!cachedTsharkPath) cachedTsharkPath = await _findTshark();
        if (!cachedTsharkPath) return { success: false, error: '未找到 tshark，请安装 Wireshark 并将其加入系统 PATH' };
        const interfaces = await _getInterfaces(cachedTsharkPath);
        return { success: true, interfaces };
    });

    ipcMain.handle('broadcastDetector:start', async (event, options) => {
        if (!cachedTsharkPath) cachedTsharkPath = await _findTshark();
        if (!cachedTsharkPath) return { success: false, error: '未找到 tshark，请先安装 Wireshark' };

        if (captureProcess) {
            const old = captureProcess;
            captureProcess = null;
            _killProcess(old);
        }

        const { interfaceIndex } = options;
        const filter = 'arp or ether dst ff:ff:ff:ff:ff:ff or multicast';
        const args = [
            '-i', String(interfaceIndex || 1),
            '-T', 'ek', '-l', '-n',
            '-f', filter,
            ...TSHARK_FIELDS
        ];

        try {
            captureProcess = spawn(cachedTsharkPath, args, { windowsHide: true });
            let buffer = '';
            let pendingBatch = [];

            // 100ms 缓冲定时推送，避免阻塞 Electron IPC 主进程
            const flushInterval = setInterval(() => {
                if (pendingBatch.length > 0 && detectorWindow && !detectorWindow.isDestroyed()) {
                    detectorWindow.webContents.send('broadcastDetector:packets', pendingBatch);
                    pendingBatch = [];
                }
            }, 100);

            captureProcess.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const t = line.trim();
                    if (!t || t.startsWith('{"index"')) continue;
                    const pkt = _parseEkPacket(t);
                    if (pkt) pendingBatch.push(pkt);
                }
            });

            captureProcess.stderr.on('data', (data) => {
                const msg = data.toString();
                if (detectorWindow && !detectorWindow.isDestroyed()) {
                    detectorWindow.webContents.send('broadcastDetector:error', msg);
                }
            });

            captureProcess.on('close', (code) => {
                clearInterval(flushInterval);
                captureProcess = null;
                if (pendingBatch.length > 0 && detectorWindow && !detectorWindow.isDestroyed()) {
                    detectorWindow.webContents.send('broadcastDetector:packets', pendingBatch);
                    pendingBatch = [];
                }
                if (detectorWindow && !detectorWindow.isDestroyed()) {
                    detectorWindow.webContents.send('broadcastDetector:stopped', { code });
                }
            });

            captureProcess.on('error', (err) => {
                captureProcess = null;
                if (detectorWindow && !detectorWindow.isDestroyed()) {
                    detectorWindow.webContents.send('broadcastDetector:error', `启动失败: ${err.message}`);
                    detectorWindow.webContents.send('broadcastDetector:stopped', { code: -1 });
                }
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('broadcastDetector:stop', async () => {
        if (captureProcess) {
            const proc = captureProcess;
            captureProcess = null;
            _killProcess(proc);
        }
        return { success: true };
    });
}

module.exports = { registerBroadcastDetectorHandlers };
