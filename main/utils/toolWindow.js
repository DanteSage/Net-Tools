/**
 * 工具子窗口创建辅助
 * 让所有网络工具窗口跟随主程序当前主题，并应用主题化的标题栏。
 */
const path = require('path');
const { BrowserWindow } = require('electron');
const { getStoredTheme, getThemeColorsByKey } = require('../handlers/theme');

/**
 * 创建一个跟随主题的工具窗口
 * @param {Object} options BrowserWindow 配置（不含主题相关字段）
 * @param {string} filePath 要加载的 HTML 文件绝对路径
 * @returns {{ win: BrowserWindow, theme: { mode: string, key: string } }}
 */
function createToolWindow(options, filePath) {
    const theme = getStoredTheme();
    const colors = getThemeColorsByKey(theme.key, theme.mode);

    const win = new BrowserWindow({
        ...options,
        backgroundColor: colors.background,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: colors.background,
            symbolColor: colors.symbol,
            height: 32
        },
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            ...(options.webPreferences || {})
        }
    });

    win.setMenu(null);

    if (filePath) {
        win.loadFile(filePath, {
            search: 'mode=' + encodeURIComponent(theme.mode) + '&theme=' + encodeURIComponent(theme.key)
        });
    }

    return { win, theme };
}

module.exports = { createToolWindow };
