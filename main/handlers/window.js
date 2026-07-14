/**
 * 窗口控制 IPC 处理程序
 * 提供无边框窗口的最小化、最大化/还原、关闭等操作
 */
const { ipcMain, BrowserWindow } = require('electron');

/**
 * 注册窗口控制处理程序
 * @param {Object} context - 包含 getMainWindow 的上下文
 */
function registerWindowHandlers(context) {
    const { getMainWindow } = context;

    /**
     * 获取触发事件的窗口（优先使用主窗口）
     */
    function _resolveWindow(event) {
        const main = getMainWindow && getMainWindow();
        if (main && !main.isDestroyed()) return main;
        return BrowserWindow.fromWebContents(event.sender);
    }

    ipcMain.handle('window:minimize', (event) => {
        const win = _resolveWindow(event);
        if (win && !win.isDestroyed()) win.minimize();
    });

    ipcMain.handle('window:toggleMaximize', (event) => {
        const win = _resolveWindow(event);
        if (!win || win.isDestroyed()) return false;
        if (win.isMaximized()) {
            win.unmaximize();
            return false;
        }
        win.maximize();
        return true;
    });

    ipcMain.handle('window:close', (event) => {
        const win = _resolveWindow(event);
        if (win && !win.isDestroyed()) win.close();
    });

    ipcMain.handle('window:isMaximized', (event) => {
        const win = _resolveWindow(event);
        if (!win || win.isDestroyed()) return false;
        return win.isMaximized();
    });
}

module.exports = { registerWindowHandlers };
