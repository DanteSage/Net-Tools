/**
 * 抓包工具模块
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { ipcMain, app } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');

let packetCaptureWindow = null;

/**
 * 注册抓包工具相关 IPC 处理程序
 */
function registerPacketCaptureHandlers(context) {
    const { getMainWindow } = context;

    ipcMain.handle('packetCapture:open', async () => {
        const basePath = app.isPackaged 
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : path.join(__dirname, '..', '..');
        const packetCapturePath = path.join(basePath, 'PacketCapture');
        
        const portableExePath = path.join(packetCapturePath, 'dist', 'PacketCapture-Portable.exe');
        const mainJsPath = path.join(packetCapturePath, 'main.js');
        
        try {
            if (fs.existsSync(portableExePath)) {
                // 启动预打包的 exe（以管理员权限）
                const psCommand = `Start-Process -FilePath '${portableExePath}' -Verb RunAs`;
                exec(`powershell -Command "${psCommand}"`, (error) => {
                    if (error) console.error('启动 PacketCapture 失败:', error);
                });
                return { success: true };
            } else if (!app.isPackaged && fs.existsSync(mainJsPath)) {
                // 开发模式：用当前 electron 启动
                const electronPath = process.execPath;
                const psCommand = `Start-Process -FilePath '${electronPath}' -ArgumentList '"${mainJsPath}"' -Verb RunAs`;
                exec(`powershell -Command "${psCommand}"`, { cwd: packetCapturePath }, (error) => {
                    if (error) console.error('启动 PacketCapture 失败:', error);
                });
                return { success: true };
            } else {
                // 回退：作为子窗口打开
                const indexPath = path.join(packetCapturePath, 'src', 'index.html');
                if (!fs.existsSync(indexPath)) {
                    return { success: false, error: '找不到 PacketCapture 工具' };
                }
                
                if (packetCaptureWindow && !packetCaptureWindow.isDestroyed()) {
                    packetCaptureWindow.focus();
                    return { success: true };
                }
                
                ({ win: packetCaptureWindow } = createToolWindow({
                    width: 1100,
                    height: 750,
                    resizable: true
                }, indexPath));
                packetCaptureWindow.on('closed', () => { packetCaptureWindow = null; });
                
                return { success: true, warning: '以非管理员模式运行，部分功能可能不可用' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerPacketCaptureHandlers };
