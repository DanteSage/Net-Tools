/**
 * FTP 客户端工具窗口模块 (ftp-client)
 */
const path = require('path');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let ftpClientWindow = null;

/**
 * 注册 FTP 客户端工具相关 IPC 处理程序
 */
function registerFtpClientHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('ftpClient:open', async () => {
        if (ftpClientWindow && !ftpClientWindow.isDestroyed()) {
            ftpClientWindow.focus();
            return { success: true };
        }
        
        ({ win: ftpClientWindow } = createToolWindow({
            toolId: 'ftp-client',
            width: 1100,
            height: 780,
            resizable: true
        }, path.join(__dirname, '..', '..', 'FtpClient', 'index.html')));
        
        ftpClientWindow.on('closed', () => {
            ftpClientWindow = null;
        });
        
        return { success: true };
    });
}

module.exports = { registerFtpClientHandlers };
