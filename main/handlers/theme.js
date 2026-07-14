/**
 * 主题持久化处理
 * 让独立窗口（splash / password）能在创建时读到主窗口选择的主题
 */
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

function getThemeFile() {
    return path.join(app.getPath('userData'), 'theme.json');
}

/**
 * 读取存储的主题
 */
function getStoredTheme() {
    try {
        const file = getThemeFile();
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (data && typeof data.key === 'string') {
                return {
                    key: data.key,
                    mode: data.mode === 'dark' ? 'dark' : 'light'
                };
            }
        }
    } catch (e) {
        // 忽略读取失败
    }
    return { key: 'light', mode: 'light' };
}

const THEME_OVERLAY_COLORS = {
    'dark': { background: '#0f172a', symbol: '#f1f5f9' },
    'one-dark': { background: '#282c34', symbol: '#abb2bf' },
    'monokai': { background: '#272822', symbol: '#f8f8f2' },
    'dracula': { background: '#282a36', symbol: '#f8f8f2' },
    'solarized-dark': { background: '#002b36', symbol: '#eee8d5' },
    'github-dark': { background: '#0d1117', symbol: '#e6edf3' },
    'light': { background: '#f8fafc', symbol: '#1e293b' },
    'github-light': { background: '#ffffff', symbol: '#1f2328' },
    'solarized-light': { background: '#fdf6e3', symbol: '#073642' },
    'quiet-light': { background: '#f5f5f5', symbol: '#333333' }
};

function getThemeColorsByKey(key, mode) {
    if (THEME_OVERLAY_COLORS[key]) {
        return THEME_OVERLAY_COLORS[key];
    }
    if (mode === 'light') {
        return { background: '#f8fafc', symbol: '#1e293b' };
    }
    return { background: '#0f172a', symbol: '#f1f5f9' };
}

/**
 * 写入主题
 */
function saveStoredTheme(theme) {
    try {
        const file = getThemeFile();
        const payload = {
            key: theme && theme.key ? String(theme.key) : 'light',
            mode: theme && theme.mode === 'dark' ? 'dark' : 'light'
        };
        fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');

        // 广播主题变更事件给所有窗口，并更新窗口原生标题栏颜色
        const { BrowserWindow } = require('electron');
        const colors = getThemeColorsByKey(payload.key, payload.mode);
        BrowserWindow.getAllWindows().forEach(win => {
            try {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('theme:changed', payload);
                    if (typeof win.setTitleBarOverlay === 'function') {
                        win.setTitleBarOverlay({
                            color: colors.background,
                            symbolColor: colors.symbol
                        });
                    }
                }
            } catch (_) {}
        });

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * 注册 IPC 处理程序
 */
function registerThemeHandlers() {
    ipcMain.handle('theme:get', async () => getStoredTheme());
    ipcMain.handle('theme:save', async (event, theme) => saveStoredTheme(theme));
}

module.exports = { registerThemeHandlers, getStoredTheme, getThemeColorsByKey };
