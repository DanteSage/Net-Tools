/**
 * DHCP 服务端子窗口与 IPC 交互模块 (dhcp-server)
 */
const path = require('path');
const { ipcMain } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const DhcpServerBackend = require('./dhcp-server-backend');

let dhcpServerWindow = null;
let dhcpServerInstance = null;
let forceClose = false;

/**
 * 注册 DHCP 服务端工具相关 IPC 处理程序
 */
function registerDhcpServerHandlers(context) {
    // 监听渲染进程发来的确认关闭通知
    ipcMain.on('dhcpServer:confirm-close', () => {
        forceClose = true;
        if (dhcpServerWindow && !dhcpServerWindow.isDestroyed()) {
            dhcpServerWindow.close();
        }
    });

    // 监听渲染进程发来的回收租约通知
    ipcMain.on('dhcpServer:revoke-lease', (event, mac) => {
        if (dhcpServerInstance) {
            dhcpServerInstance.revokeLease(mac);
        }
    });

    // 打开 DHCP 服务端独立窗口
    ipcMain.handle('dhcpServer:open', async () => {
        if (dhcpServerWindow && !dhcpServerWindow.isDestroyed()) {
            dhcpServerWindow.focus();
            return { success: true };
        }

        forceClose = false;
        ({ win: dhcpServerWindow } = createToolWindow({
            toolId: 'dhcp-server',
            width: 1000,
            height: 700,
            resizable: true
        }, path.join(__dirname, '..', '..', 'DhcpServer', 'index.html')));

        dhcpServerWindow.on('close', (e) => {
            if (dhcpServerInstance && !forceClose) {
                e.preventDefault();
                dhcpServerWindow.webContents.send('dhcpServer:request-close');
            }
        });

        dhcpServerWindow.on('closed', () => {
            dhcpServerWindow = null;
            // 窗口关闭时自动释放服务器，回收端口
            if (dhcpServerInstance) {
                dhcpServerInstance.stop().catch(() => {});
                dhcpServerInstance = null;
            }
        });

        return { success: true };
    });

    // 开启 DHCP 服务器
    ipcMain.handle('dhcpServer:start', async (event, config) => {
        if (dhcpServerInstance) {
            return { success: false, error: 'DHCP 服务器已在运行中' };
        }

        try {
            dhcpServerInstance = new DhcpServerBackend({
                interfaceIp: config.interfaceIp,
                startIp: config.startIp,
                endIp: config.endIp,
                subnetMask: config.subnetMask,
                gateway: config.gateway || null,
                dnsList: config.dnsList || [],
                leaseTime: config.leaseTime
            });
            const currentServerInstance = dhcpServerInstance;

            // 监听日志事件
            dhcpServerInstance.on('log', (logObj) => {
                if (dhcpServerWindow && !dhcpServerWindow.isDestroyed()) {
                    try {
                        dhcpServerWindow.webContents.send('dhcpServer:log', logObj);
                    } catch (e) {}
                }
            });

            // 监听租约状态事件
            dhcpServerInstance.on('leases', (leases) => {
                if (dhcpServerWindow && !dhcpServerWindow.isDestroyed()) {
                    try {
                        dhcpServerWindow.webContents.send('dhcpServer:leases', leases);
                    } catch (e) {}
                }
            });

            // 使用普通自定义事件承接运行期 Socket 错误，避免 EventEmitter
            // 对未监听的特殊 `error` 事件执行抛异常语义。
            dhcpServerInstance.on('server-error', (err) => {
                if (dhcpServerInstance === currentServerInstance) {
                    dhcpServerInstance = null;
                }
                if (dhcpServerWindow && !dhcpServerWindow.isDestroyed()) {
                    try {
                        dhcpServerWindow.webContents.send('dhcpServer:log', {
                            message: `DHCP 服务已因 Socket 错误停止: ${err.message}`,
                            type: 'error'
                        });
                    } catch (e) {}
                }
            });

            await dhcpServerInstance.start();
            return { success: true };
        } catch (err) {
            dhcpServerInstance = null;
            return { success: false, error: err.message };
        }
    });

    // 停止 DHCP 服务器
    ipcMain.handle('dhcpServer:stop', async () => {
        if (!dhcpServerInstance) {
            return { success: true };
        }

        try {
            await dhcpServerInstance.stop();
            dhcpServerInstance = null;
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerDhcpServerHandlers };
