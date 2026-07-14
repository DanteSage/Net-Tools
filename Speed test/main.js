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
            nodeIntegration: true,
            contextIsolation: false
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
