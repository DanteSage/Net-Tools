/**
 * IPv6 子网计算器工具模块 (ipv6-subnetting)
 */
const path = require('path');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let ipv6SubnettingWindow = null;

/**
 * 注册 IPv6 子网计算器工具相关 IPC 处理程序
 */
function registerIpv6SubnettingHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('ipv6Subnetting:open', async () => {
        if (ipv6SubnettingWindow && !ipv6SubnettingWindow.isDestroyed()) {
            ipv6SubnettingWindow.focus();
            return { success: true };
        }
        
        ({ win: ipv6SubnettingWindow } = createToolWindow({
            width: 950,
            height: 750,
            resizable: true
        }, path.join(__dirname, '..', '..', 'IPv6Subnetting', 'index.html')));
        
        ipv6SubnettingWindow.on('closed', () => {
            ipv6SubnettingWindow = null;
        });
        
        return { success: true };
    });
}

module.exports = { registerIpv6SubnettingHandlers };
