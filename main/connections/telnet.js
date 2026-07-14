/**
 * Telnet 连接处理模块
 */
const { ipcMain } = require('electron');
const net = require('net');
const { handleTelnetNegotiation, sendTelnetWindowSize } = require('../utils/telnet-protocol');
const { decodeChunk, encodeString, removeConnectionEncoding } = require('./encoding-manager');
const { createTerminalDataBuffer } = require('./terminal-data-buffer');
const { writeStreamWithBackpressure } = require('./stream-write-queue');

/**
 * 注册 Telnet 相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerTelnetHandlers(context) {
    const { activeTelnetConnections, getMainWindow, isQuitting } = context;

    async function writeToTelnet(connectionId, data) {
        const socket = activeTelnetConnections.get(connectionId);
        if (!socket || socket.destroyed || socket.writable === false) {
            return { success: false, error: '连接不存在' };
        }

        try {
            const encodedData = encodeString(connectionId, data);
            await writeStreamWithBackpressure(socket, encodedData, { chunkSize: 16 * 1024 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Telnet 连接
    ipcMain.handle('telnet:connect', async (event, config) => {
        return new Promise((resolve) => {
            const connectionId = `telnet_${config.host}_${Date.now()}`;
            const socket = new net.Socket();
            socket._terminalCols = Math.max(2, Math.min(65535, Math.floor(Number(config.cols) || 80)));
            socket._terminalRows = Math.max(1, Math.min(65535, Math.floor(Number(config.rows) || 24)));
            let outputBuffer = null;
            
            const timeout = setTimeout(() => {
                socket.destroy();
                resolve({ success: false, error: '连接超时' });
            }, config.timeout || 10000);
            
            socket.connect(config.port || 23, config.host, () => {
                clearTimeout(timeout);
                socket.setNoDelay(true);
                socket.setKeepAlive(true, 15000);
                activeTelnetConnections.set(connectionId, socket);
                outputBuffer = createTerminalDataBuffer((data) => {
                    if (isQuitting()) return;
                    const mainWindow = getMainWindow();
                    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
                    mainWindow.webContents.send('telnet:data', {
                        connectionId,
                        data
                    });
                });
                
                // 监听数据
                socket.on('data', (data) => {
                    if (isQuitting()) return;
                    const mainWindow = getMainWindow();
                    if (!mainWindow || mainWindow.isDestroyed()) return;
                    
                    // 处理 Telnet 协议协商
                    const filteredData = handleTelnetNegotiation(data, socket);
                    
                    // 只发送有效数据到渲染进程
                    if (filteredData.length > 0) {
                        try {
                            const decodedText = decodeChunk(connectionId, filteredData);
                            if (decodedText.length > 0) {
                                outputBuffer.push(decodedText);
                            }
                        } catch (e) {}
                    }
                });
                
                socket.on('close', () => {
                    if (outputBuffer) outputBuffer.dispose(true);
                    activeTelnetConnections.delete(connectionId);
                    if (isQuitting()) return;
                    const mainWindow = getMainWindow();
                    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
                    try {
                        mainWindow.webContents.send('telnet:close', { connectionId });
                    } catch (e) {}
                });
                
                socket.on('error', (err) => {
                    if (outputBuffer) outputBuffer.flush();
                    if (isQuitting()) return;
                    const mainWindow = getMainWindow();
                    if (!mainWindow || mainWindow.isDestroyed()) return;
                    try {
                        mainWindow.webContents.send('telnet:error', {
                            connectionId,
                            error: err.message
                        });
                    } catch (e) {}
                });
                
                resolve({ success: true, connectionId });
            });
            
            socket.on('error', (err) => {
                clearTimeout(timeout);
                resolve({ success: false, error: err.message });
            });
        });
    });

    // Telnet 发送数据
    ipcMain.handle('telnet:write', async (event, { connectionId, data }) => {
        return writeToTelnet(connectionId, data);
    });

    ipcMain.on('telnet:input', (event, { connectionId, data }) => {
        writeToTelnet(connectionId, data);
    });

    ipcMain.on('telnet:resize', (event, { connectionId, cols, rows }) => {
        const socket = activeTelnetConnections.get(connectionId);
        if (!socket) return;
        socket._terminalCols = Math.max(2, Math.min(65535, Math.floor(Number(cols) || 80)));
        socket._terminalRows = Math.max(1, Math.min(65535, Math.floor(Number(rows) || 24)));
        sendTelnetWindowSize(socket, socket._terminalCols, socket._terminalRows);
    });

    // Telnet 断开连接
    ipcMain.handle('telnet:disconnect', async (event, connectionId) => {
        const socket = activeTelnetConnections.get(connectionId);
        if (socket) {
            socket.destroy();
            activeTelnetConnections.delete(connectionId);
            removeConnectionEncoding(connectionId);
        }
        return { success: true };
    });

    // Telnet 测试连接（只测试 TCP 连接）
    ipcMain.handle('telnet:test', async (event, config) => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            
            const timeout = setTimeout(() => {
                socket.destroy();
                resolve({ success: false, error: '连接超时' });
            }, config.timeout || 5000);
            
            socket.connect(config.port || 23, config.host, () => {
                clearTimeout(timeout);
                socket.destroy();
                resolve({ success: true });
            });
            
            socket.on('error', (err) => {
                clearTimeout(timeout);
                resolve({ success: false, error: err.message });
            });
        });
    });
}

module.exports = {
    registerTelnetHandlers
};
