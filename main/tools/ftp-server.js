/**
 * FTP 服务端子窗口与 IPC 交互模块 (ftp-server)
 */
const path = require('path');
const { ipcMain, dialog } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const FtpServerBackend = require('./ftp-server-backend');

let ftpServerWindow = null;
let ftpServerInstance = null;

/**
 * 注册 FTP 服务端工具相关 IPC 处理程序
 */
function registerFtpServerHandlers(context) {
    const { getMainWindow } = context;

    // 打开 FTP 服务端独立窗口
    ipcMain.handle('ftpServer:open', async () => {
        if (ftpServerWindow && !ftpServerWindow.isDestroyed()) {
            ftpServerWindow.focus();
            return { success: true };
        }

        ({ win: ftpServerWindow } = createToolWindow({
            width: 1000,
            height: 650,
            resizable: true
        }, path.join(__dirname, '..', '..', 'FtpServer', 'index.html')));

        ftpServerWindow.on('closed', () => {
            ftpServerWindow = null;
            // 窗口关闭时自动停止服务器，释放资源和端口
            if (ftpServerInstance) {
                ftpServerInstance.stop().catch(() => {});
                ftpServerInstance = null;
            }
        });

        return { success: true };
    });

    // 浏览并选择共享根目录
    ipcMain.handle('ftpServer:selectDirectory', async () => {
        if (!ftpServerWindow || ftpServerWindow.isDestroyed()) return null;

        const result = await dialog.showOpenDialog(ftpServerWindow, {
            properties: ['openDirectory', 'createDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // 开启 FTP 服务器
    ipcMain.handle('ftpServer:start', async (event, config) => {
        if (ftpServerInstance) {
            return { success: false, error: '服务器已在运行中' };
        }

        try {
            ftpServerInstance = new FtpServerBackend({
                port: config.port,
                host: config.host,
                username: config.username,
                password: config.password,
                rootDirectory: config.rootDirectory,
                timeout: config.timeout,
                onLog: (msg) => {
                    // 安全广播日志给渲染端
                    if (ftpServerWindow && !ftpServerWindow.isDestroyed()) {
                        try {
                            ftpServerWindow.webContents.send('ftpServer:log', msg);
                        } catch (e) {}
                    }
                }
            });

            await ftpServerInstance.start();
            return { success: true };
        } catch (err) {
            ftpServerInstance = null;
            return { success: false, error: err.message };
        }
    });

    // 停止 FTP 服务器
    ipcMain.handle('ftpServer:stop', async () => {
        if (!ftpServerInstance) {
            return { success: true };
        }

        try {
            await ftpServerInstance.stop();
            ftpServerInstance = null;
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerFtpServerHandlers };
