/**
 * TFTP 服务端子窗口与 IPC 交互模块 (tftp-server)
 */
const path = require('path');
const fs = require('fs');
const { ipcMain, dialog } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const TftpServerBackend = require('./tftp-server-backend');

let tftpServerWindow = null;
let tftpServerInstance = null;
let forceClose = false;

/**
 * 注册 TFTP 服务端工具相关 IPC 处理程序
 */
function registerTftpServerHandlers(context) {
    // 监听渲染进程发来的确认关闭通知
    ipcMain.on('tftpServer:confirm-close', () => {
        forceClose = true;
        if (tftpServerWindow && !tftpServerWindow.isDestroyed()) {
            tftpServerWindow.close();
        }
    });

    // 打开 TFTP 服务端独立窗口
    ipcMain.handle('tftpServer:open', async () => {
        if (tftpServerWindow && !tftpServerWindow.isDestroyed()) {
            tftpServerWindow.focus();
            return { success: true };
        }

        forceClose = false;
        ({ win: tftpServerWindow } = createToolWindow({
            toolId: 'tftp-server',
            width: 1100,
            height: 750,
            resizable: true
        }, path.join(__dirname, '..', '..', 'TftpServer', 'index.html')));

        tftpServerWindow.on('close', (e) => {
            if (tftpServerInstance && !forceClose) {
                e.preventDefault();
                tftpServerWindow.webContents.send('tftpServer:request-close');
            }
        });

        tftpServerWindow.on('closed', () => {
            tftpServerWindow = null;
            // 窗口关闭时自动停止服务器，释放资源和端口
            if (tftpServerInstance) {
                tftpServerInstance.stop().catch(() => {});
                tftpServerInstance = null;
            }
        });

        return { success: true };
    });

    // 浏览并选择共享根目录
    ipcMain.handle('tftpServer:selectDirectory', async () => {
        if (!tftpServerWindow || tftpServerWindow.isDestroyed()) return null;

        const result = await dialog.showOpenDialog(tftpServerWindow, {
            properties: ['openDirectory', 'createDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // 列出指定目录的文件列表 (用于前端共享目录浏览器)
    ipcMain.handle('tftpServer:listFiles', async (event, dirPath) => {
        try {
            if (!dirPath || !fs.existsSync(dirPath)) return [];
            const files = fs.readdirSync(dirPath);
            const list = [];
            for (const file of files) {
                const fullPath = path.join(dirPath, file);
                try {
                    const stat = fs.statSync(fullPath);
                    list.push({
                        name: file,
                        size: stat.size,
                        mtime: stat.mtime.toLocaleString(),
                        isDirectory: stat.isDirectory()
                    });
                } catch (_) {}
            }
            // 文件夹排在前，文件在后，并按字母排序
            return list.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });
        } catch (err) {
            throw new Error(err.message);
        }
    });

    // 开启 TFTP 服务器
    ipcMain.handle('tftpServer:start', async (event, config) => {
        if (tftpServerInstance) {
            return { success: false, error: '服务器已在运行中' };
        }

        try {
            tftpServerInstance = new TftpServerBackend({
                port: config.port,
                host: config.host,
                rootDirectory: config.rootDirectory,
                writable: config.writable,
                timeout: config.timeout,
                retries: config.retries,
                maxBlockSize: config.maxBlockSize
            });

            // 监听底层日志事件并推送到前端
            tftpServerInstance.on('log', (logObj) => {
                if (tftpServerWindow && !tftpServerWindow.isDestroyed()) {
                    try {
                        tftpServerWindow.webContents.send('tftpServer:log', logObj);
                    } catch (e) {}
                }
            });

            // 监听底层传输会话列表更新并推送到前端
            tftpServerInstance.on('transfers', (transfers) => {
                if (tftpServerWindow && !tftpServerWindow.isDestroyed()) {
                    try {
                        tftpServerWindow.webContents.send('tftpServer:transfers', transfers);
                    } catch (e) {}
                }
            });

            await tftpServerInstance.start();
            return { success: true };
        } catch (err) {
            tftpServerInstance = null;
            return { success: false, error: err.message };
        }
    });

    // 停止 TFTP 服务器
    ipcMain.handle('tftpServer:stop', async () => {
        if (!tftpServerInstance) {
            return { success: true };
        }

        try {
            await tftpServerInstance.stop();
            tftpServerInstance = null;
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerTftpServerHandlers };
