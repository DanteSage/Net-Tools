const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startSpeedServer, getServerInfo, stopServer } = require('./speedtest_server');

let mainWindow;

// 创建服务器管理窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 560,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, '..', 'main', 'utils', 'tool-preload.js'),
            additionalArguments: ['--net-tools-tool-id=speedtest']
        },
        icon: path.join(__dirname, 'icon.png')
    });

    mainWindow.setMenu(null);
    mainWindow.loadFile('server-ui.html');

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('server-info', getServerInfo());
    });
}

app.whenReady().then(() => {
    startSpeedServer();
    createWindow();
});

app.on('window-all-closed', () => {
    stopServer();
    app.quit();
});
