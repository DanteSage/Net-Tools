/**
 * 子网划分工具模块
 */
const path = require('path');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let subnettingWindow = null;

/**
 * 注册子网划分工具相关 IPC 处理程序
 */
function registerSubnettingHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('subnetting:open', async () => {
        if (subnettingWindow && !subnettingWindow.isDestroyed()) {
            subnettingWindow.focus();
            return { success: true };
        }
        
        ({ win: subnettingWindow } = createToolWindow({
            toolId: 'subnetting',
            width: 950,
            height: 750,
            resizable: true
        }, path.join(__dirname, '..', '..', 'Subnetting', 'index.html')));
        
        subnettingWindow.on('closed', () => {
            subnettingWindow = null;
        });
        
        return { success: true };
    });
}

module.exports = { registerSubnettingHandlers };
