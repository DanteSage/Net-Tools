/**
 * 连接管理器入口模块
 * 管理所有类型的连接（SSH、Telnet、串口）
 */
const { registerSSHHandlers } = require('./ssh');
const { registerTelnetHandlers } = require('./telnet');
const { registerSerialHandlers } = require('./serial');
const { registerFTPHandlers } = require('./ftp');
const { registerBroadcastDetectorHandlers } = require('../tools/broadcast-detector');
const { registerEncodingHandlers, removeConnectionEncoding } = require('./encoding-manager');
const { registerTerminalFlowControl } = require('./terminal-flow-control');

// 存储活跃的连接
const activeConnections = new Map();      // SSH / FTP 连接
const activeTelnetConnections = new Map(); // Telnet 连接
const activeSerialPorts = new Map();       // 串口连接

/**
 * 注册所有连接相关的 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerConnectionHandlers(context) {
    const fullContext = {
        ...context,
        activeConnections,
        activeTelnetConnections,
        activeSerialPorts
    };

    registerSSHHandlers(fullContext);
    registerTelnetHandlers(fullContext);
    registerSerialHandlers(fullContext);
    registerTerminalFlowControl(fullContext);
    registerFTPHandlers(fullContext);
    registerBroadcastDetectorHandlers(fullContext);
    registerEncodingHandlers();
}

/**
 * 关闭所有活跃连接
 */
function closeAllConnections() {
    // 关闭所有 SSH / FTP 连接
    activeConnections.forEach((conn, id) => {
        try {
            if (conn && typeof conn.end === 'function') {
                conn.end();
            } else if (conn && typeof conn.disconnect === 'function') {
                conn.disconnect();
            }
        } catch (e) {}
        removeConnectionEncoding(id);
    });
    activeConnections.clear();
    
    // 关闭所有 Telnet 连接
    activeTelnetConnections.forEach((socket, id) => {
        try {
            if (socket && typeof socket.destroy === 'function') {
                socket.destroy();
            }
        } catch (e) {}
        removeConnectionEncoding(id);
    });
    activeTelnetConnections.clear();
    
    // 关闭所有串口连接
    activeSerialPorts.forEach((port, id) => {
        try {
            if (port && port.isOpen) {
                port.close();
            }
        } catch (e) {}
        removeConnectionEncoding(id);
    });
    activeSerialPorts.clear();
}

module.exports = {
    registerConnectionHandlers,
    closeAllConnections,
    activeConnections,
    activeTelnetConnections,
    activeSerialPorts
};
