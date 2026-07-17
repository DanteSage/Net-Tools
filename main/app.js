/**
 * 应用窗口和生命周期管理模块
 */
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { getStoredTheme } = require('./handlers/theme');
const { registerAppCloseController } = require('./utils/app-close-controller');

let mainWindow = null;
let splashWindow = null;
let passwordWindow = null;
let isQuitting = false;
let isUnlocked = false;

const appCloseController = registerAppCloseController({
    ipcMain,
    getIsQuitting: () => isQuitting
});

/**
 * 创建启动画面窗口
 */
function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 500,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
     });

    const theme = getStoredTheme();
    splashWindow.loadFile(path.join(__dirname, '..', 'splash.html'), {
        search: 'mode=' + theme.mode + '&theme=' + theme.key
    });
    splashWindow.center();
}

/**
 * 创建密码验证窗口
 */
function createPasswordWindow() {
    passwordWindow = new BrowserWindow({
        width: 400,
        height: 520,
        frame: false,
        transparent: true,
        resizable: false,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'password-preload.js')
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    const pwdTheme = getStoredTheme();
    passwordWindow.loadFile(path.join(__dirname, '..', 'password.html'), {
        search: 'mode=' + pwdTheme.mode + '&theme=' + pwdTheme.key
    });
    passwordWindow.center();

    // 监听密码验证成功
    ipcMain.once('password:unlockSuccess', () => {
        isUnlocked = true;
        if (passwordWindow && !passwordWindow.isDestroyed()) {
            passwordWindow.close();
            passwordWindow = null;
        }
        // 显示主窗口
        if (mainWindow) {
            mainWindow.show();
        }
    });

    passwordWindow.on('closed', () => {
        passwordWindow = null;
        // 如果未解锁就关闭了密码窗口，退出应用
        if (!isUnlocked) {
            app.quit();
        }
    });

    return passwordWindow;
}

/**
 * 创建主窗口
 * @param {boolean} requirePassword - 是否需要密码验证
 */
function createMainWindow(requirePassword = false) {
    const window = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        show: false,
        frame: false,
        backgroundColor: getStoredTheme().mode === 'light' ? '#ffffff' : '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'preload.js')
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        title: 'Net Tools'
    });
    mainWindow = window;

    // 同步最大化/还原状态到渲染进程
    window.on('maximize', () => {
        if (!window.isDestroyed()) {
            window.webContents.send('window:maximized', true);
        }
    });
    window.on('unmaximize', () => {
        if (!window.isDestroyed()) {
            window.webContents.send('window:maximized', false);
        }
    });

    window.loadFile(path.join(__dirname, '..', 'index.html'));

    window.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.close();
                splashWindow = null;
            }

            // 如果需要密码验证，显示密码窗口
            if (requirePassword && !isUnlocked) {
                createPasswordWindow();
            } else {
                isUnlocked = true;
                if (!window.isDestroyed()) {
                    window.show();
                }
            }
        }, 1500);
    });

    appCloseController.attachWindow(window);
    window.once('closed', () => {
        if (mainWindow === window) {
            mainWindow = null;
        }
    });

    // 开发模式下打开开发者工具
    if (process.argv.includes('--enable-logging')) {
        window.webContents.openDevTools();
    }

    return window;
}

/**
 * 获取主窗口
 */
function getMainWindow() {
    return mainWindow;
}

/**
 * 设置退出标志
 */
function setQuitting(value) {
    isQuitting = value;
}

/**
 * 检查是否正在退出
 */
function getIsQuitting() {
    return isQuitting;
}

/**
 * 检查是否已解锁
 */
function getIsUnlocked() {
    return isUnlocked;
}

/**
 * 设置解锁状态
 */
function setUnlocked(value) {
    isUnlocked = value;
}

module.exports = {
    createSplashWindow,
    createPasswordWindow,
    createMainWindow,
    getMainWindow,
    setQuitting,
    isQuitting: getIsQuitting,
    isUnlocked: getIsUnlocked,
    setUnlocked
};
