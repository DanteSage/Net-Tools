/**
 * 窗口控制 IPC 处理程序
 * 提供无边框窗口的最小化、最大化/还原、关闭等操作
 */
const { ipcMain, BrowserWindow } = require('electron');

/**
 * 注册窗口控制处理程序
 * @param {Object} _context - 保留的注册上下文
 */
function registerWindowHandlers(_context, dependencies = {}) {
    const ipc = dependencies.ipcMain || ipcMain;
    const browserWindowApi = dependencies.BrowserWindow || BrowserWindow;

    /**
     * 获取触发事件的窗口（优先使用事件发送者所属窗口）
     */
    function _resolveWindow(event) {
        if (!event || !event.sender) return null;
        const senderWindow = browserWindowApi.fromWebContents(event.sender);
        if (senderWindow && !senderWindow.isDestroyed()) return senderWindow;
        return null;
    }

    ipc.handle('window:minimize', (event) => {
        const win = _resolveWindow(event);
        if (win && !win.isDestroyed()) win.minimize();
    });

    ipc.handle('window:toggleMaximize', (event) => {
        const win = _resolveWindow(event);
        if (!win || win.isDestroyed()) return false;
        if (win.isMaximized()) {
            win.unmaximize();
            return false;
        }
        win.maximize();
        return true;
    });

    ipc.handle('window:close', (event) => {
        const win = _resolveWindow(event);
        if (win && !win.isDestroyed()) win.close();
    });

    ipc.handle('window:isMaximized', (event) => {
        const win = _resolveWindow(event);
        if (!win || win.isDestroyed()) return false;
        return win.isMaximized();
    });
}

module.exports = { registerWindowHandlers };
