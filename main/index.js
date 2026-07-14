/**
 * 主入口文件
 * 整合所有模块，注册所有 IPC 处理程序
 */
const { app, BrowserWindow } = require('electron');

// Windows 控制台编码统一为 UTF-8，避免 console.log 中文乱码
if (process.platform === 'win32') {
    try { require('child_process').execSync('chcp 65001', { shell: true, stdio: 'ignore' }); } catch (_) {}
}

// 配置和应用模块
const { loadSettings, ensureDirectories } = require('./config');
const { createSplashWindow, createMainWindow, getMainWindow, setQuitting, isQuitting } = require('./app');
const { setupMenu } = require('./menu');

// 连接模块
const { registerConnectionHandlers, closeAllConnections, activeConnections, activeTelnetConnections, activeSerialPorts } = require('./connections');

// 批量执行模块
const { registerBatchHandlers } = require('./batch');

// IPC 处理模块
const { registerDeviceHandlers } = require('./handlers/devices');
const { registerTemplateHandlers } = require('./handlers/templates');
const { registerBackupHandlers } = require('./handlers/backup');
const { registerOplogHandlers } = require('./handlers/oplog');
const { registerLogHandlers } = require('./handlers/logs');
const { registerDialogHandlers } = require('./handlers/dialog');
const { registerHistoryHandlers } = require('./handlers/history');
const { registerCryptoHandlers } = require('./handlers/crypto');
const { registerPasswordHandlers, isPasswordRequired } = require('./handlers/password');
const { registerWindowHandlers } = require('./handlers/window');
const { registerThemeHandlers } = require('./handlers/theme');

// 工具模块
const { registerSpeedTestHandlers, stopSpeedTestServer } = require('./tools/speedtest');
const { registerPortScannerHandlers } = require('./tools/portscanner');
const { registerPingHandlers } = require('./tools/ping');
const { registerTracerouteHandlers } = require('./tools/traceroute');
const { registerSubnettingHandlers } = require('./tools/subnetting');
const { registerIpv6SubnettingHandlers } = require('./tools/ipv6-subnetting');
const { registerPacketCaptureHandlers } = require('./tools/packet-capture');
const { registerNetcatHandlers } = require('./tools/netcat');
const { registerDnsLookupHandlers } = require('./tools/dns-lookup');
const { registerTsharkAnalyzerHandlers } = require('./tools/tshark-analyzer');
const { registerFtpClientHandlers } = require('./tools/ftp-client');
const { registerFtpServerHandlers } = require('./tools/ftp-server');
const { registerCopilotHandlers } = require('./tools/copilot');
const { registerDhcpServerHandlers } = require('./tools/dhcp-server');
const { registerTftpServerHandlers } = require('./tools/tftp-server');
const { registerReconnaissanceHandlers } = require('./tools/reconnaissance');

/**
 * 注册所有 IPC 处理程序
 */
function registerAllHandlers() {
    const context = {
        getMainWindow,
        isQuitting,
        activeConnections,
        activeTelnetConnections,
        activeSerialPorts
    };

    // 注册连接相关处理程序
    registerConnectionHandlers(context);

    // 注册批量执行处理程序
    registerBatchHandlers(context);

    // 注册各 IPC 处理程序
    registerDeviceHandlers();
    registerTemplateHandlers();
    registerBackupHandlers(context);
    registerOplogHandlers(context);
    registerLogHandlers(context);
    registerDialogHandlers(context);
    registerHistoryHandlers();
    registerCryptoHandlers();
    registerPasswordHandlers();
    registerWindowHandlers(context);
    registerThemeHandlers();

    // 注册工具处理程序
    registerSpeedTestHandlers(context);
    registerPortScannerHandlers(context);
    registerPingHandlers(context);
    registerTracerouteHandlers(context);
    registerSubnettingHandlers(context);
    registerIpv6SubnettingHandlers(context);
    registerPacketCaptureHandlers(context);
    registerNetcatHandlers(context);
    registerDnsLookupHandlers(context);
    registerTsharkAnalyzerHandlers(context);
    registerFtpClientHandlers(context);
    registerFtpServerHandlers(context);
    registerCopilotHandlers(context);
    registerDhcpServerHandlers(context);
    registerTftpServerHandlers(context);
    registerReconnaissanceHandlers(context);
}

/**
 * 应用初始化
 */
app.whenReady().then(() => {
    // 初始化配置
    ensureDirectories();
    loadSettings();
    ensureDirectories(); // 再次确保备份目录存在

    // 注册所有 IPC 处理程序（需要在创建窗口前注册密码处理程序）
    registerAllHandlers();

    // 检查是否需要密码验证
    const requirePassword = isPasswordRequired();

    // 创建窗口
    createSplashWindow();
    createMainWindow(requirePassword);

    // 设置菜单
    setupMenu(createMainWindow, getMainWindow);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow(isPasswordRequired());
        }
    });
});

/**
 * 退出前处理
 */
app.on('before-quit', () => {
    setQuitting(true);
});

/**
 * 所有窗口关闭时
 */
app.on('window-all-closed', () => {
    setQuitting(true);

    // 关闭所有连接
    closeAllConnections();

    // 停止测速服务器
    stopSpeedTestServer();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});
