/**
 * 工具子窗口创建辅助
 * 让所有网络工具窗口跟随主程序当前主题，并应用主题化的标题栏。
 */
const path = require('path');
const { BrowserWindow } = require('electron');
const { getStoredTheme, getThemeColorsByKey } = require('../handlers/theme');
const { getToolScope } = require('./tool-ipc-scopes');

/**
 * 创建一个跟随主题的工具窗口
 * @param {Object} options BrowserWindow 配置，必须包含已登记的 toolId
 * @param {string} filePath 要加载的 HTML 文件绝对路径
 * @returns {{ win: BrowserWindow, theme: { mode: string, key: string } }}
 */
function createToolWindow(options, filePath) {
    const {
        toolId,
        webPreferences: requestedWebPreferences = {},
        ...browserWindowOptions
    } = options;
    if (!getToolScope(toolId)) {
        throw new Error(`Unknown or missing toolId: ${toolId || '(empty)'}`);
    }
    const additionalArguments = (requestedWebPreferences.additionalArguments || [])
        .filter(argument => !String(argument).startsWith('--net-tools-tool-id='));

    const theme = getStoredTheme();
    const colors = getThemeColorsByKey(theme.key, theme.mode);

    const win = new BrowserWindow({
        ...browserWindowOptions,
        backgroundColor: colors.background,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: colors.background,
            symbolColor: colors.symbol,
            height: 32
        },
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        webPreferences: {
            ...requestedWebPreferences,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            preload: path.join(__dirname, 'tool-preload.js'),
            additionalArguments: [
                `--net-tools-tool-id=${toolId}`,
                ...additionalArguments
            ]
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
