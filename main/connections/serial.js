/**
 * 串口连接处理模块
 */
const { ipcMain } = require('electron');
const {
    decodeChunk,
    encodeString,
    removeConnectionEncoding,
    setConnectionEncoding
} = require('./encoding-manager');
const { createTerminalDataBuffer } = require('./terminal-data-buffer');
const { writeStreamWithBackpressure } = require('./stream-write-queue');

const SERIAL_CLEANUP = Symbol('serialCleanup');
const SERIAL_WRITE_OPTIONS = Symbol('serialWriteOptions');
const VALID_DATA_BITS = new Set([5, 6, 7, 8]);
const VALID_STOP_BITS = new Set([1, 1.5, 2]);
const VALID_PARITY = new Set(['none', 'even', 'odd', 'mark', 'space']);

// SerialPort 串口模块
let SerialPort;
try {
    const serialport = require('serialport');
    SerialPort = serialport.SerialPort;
} catch (e) {
    console.log('SerialPort module not installed yet');
}

function normalizeSerialConfig(config = {}) {
    if (!config || typeof config !== 'object') {
        throw new TypeError('串口配置无效');
    }

    const path = typeof config.path === 'string' ? config.path.trim() : '';
    if (!path) throw new TypeError('请选择串口');

    const baudRate = Number(config.baudRate ?? 9600);
    if (!Number.isInteger(baudRate) || baudRate <= 0 || baudRate > 10000000) {
        throw new TypeError('波特率必须是 1 到 10000000 之间的整数');
    }

    const dataBits = Number(config.dataBits ?? 8);
    if (!VALID_DATA_BITS.has(dataBits)) {
        throw new TypeError('数据位必须是 5、6、7 或 8');
    }

    const stopBits = Number(config.stopBits ?? 1);
    if (!VALID_STOP_BITS.has(stopBits)) {
        throw new TypeError('停止位必须是 1、1.5 或 2');
    }

    const parity = String(config.parity ?? 'none').toLowerCase();
    if (!VALID_PARITY.has(parity)) {
        throw new TypeError('校验位配置无效');
    }

    const sendDelayMs = Number(config.sendDelayMs ?? 5);
    if (!Number.isInteger(sendDelayMs) || sendDelayMs < 0 || sendDelayMs > 1000) {
        throw new TypeError('发送间隔必须是 0 到 1000 之间的整数');
    }

    return {
        path,
        baudRate,
        dataBits,
        stopBits,
        parity,
        rtscts: Boolean(config.rtscts),
        xon: Boolean(config.xon),
        xoff: Boolean(config.xoff),
        slowSend: Boolean(config.slowSend),
        sendDelayMs,
        encoding: typeof config.encoding === 'string' && config.encoding.trim()
            ? config.encoding.trim().toLowerCase()
            : 'utf-8'
    };
}

function createSerialPortOptions(config) {
    const normalized = normalizeSerialConfig(config);
    return {
        path: normalized.path,
        baudRate: normalized.baudRate,
        dataBits: normalized.dataBits,
        parity: normalized.parity,
        stopBits: normalized.stopBits,
        rtscts: normalized.rtscts,
        xon: normalized.xon,
        xoff: normalized.xoff,
        xany: false,
        autoOpen: false
    };
}

/**
 * 注册串口相关 IPC 处理程序
 * @param {Object} context - 上下文对象
 */
function registerSerialHandlers(context, dependencies = {}) {
    const { activeSerialPorts, getMainWindow, isQuitting } = context;
    const ipc = dependencies.ipcMain || ipcMain;
    const SerialPortClass = dependencies.SerialPort || SerialPort;

    function sendToRenderer(channel, payload) {
        if (isQuitting()) return false;
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
        try {
            mainWindow.webContents.send(channel, payload);
            return true;
        } catch (e) {
            return false;
        }
    }

    function writeToSerial(connectionId, data, callback) {
        const port = activeSerialPorts.get(connectionId);
        if (!port || !port.isOpen) {
            callback({ success: false, error: '串口未连接' });
            return;
        }

        try {
            const encodedData = encodeString(connectionId, data);
            writeStreamWithBackpressure(port, encodedData, port[SERIAL_WRITE_OPTIONS] || { chunkSize: 4 * 1024 })
                .then(() => callback({ success: true }))
                .catch((error) => callback({ success: false, error: error.message }));
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    }

    // 获取可用串口列表
    ipc.handle('serial:list', async () => {
        if (!SerialPortClass) {
            return { success: false, error: 'SerialPort 模块未安装' };
        }
        
        try {
            const ports = await SerialPortClass.list();
            return { success: true, ports };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 串口连接
    ipc.handle('serial:connect', async (event, config) => {
        if (!SerialPortClass) {
            return { success: false, error: 'SerialPort 模块未安装' };
        }

        let normalizedConfig;
        try {
            normalizedConfig = normalizeSerialConfig(config);
        } catch (error) {
            return { success: false, error: error.message };
        }
        
        return new Promise((resolve) => {
            const connectionId = `serial_${normalizedConfig.path}_${Date.now()}`;
            setConnectionEncoding(connectionId, normalizedConfig.encoding);
            
            try {
                const port = new SerialPortClass(createSerialPortOptions(normalizedConfig));
                
                port.open((err) => {
                    if (err) {
                        removeConnectionEncoding(connectionId);
                        resolve({ success: false, error: err.message });
                        return;
                    }
                    
                    // 存储串口连接
                    activeSerialPorts.set(connectionId, port);
                    const outputBuffer = createTerminalDataBuffer((data) => {
                        sendToRenderer('serial:data', {
                            connectionId,
                            data
                        });
                    });
                    let cleanedUp = false;
                    let terminating = false;

                    const cleanup = () => {
                        if (cleanedUp) return;
                        cleanedUp = true;
                        outputBuffer.dispose(true);
                        activeSerialPorts.delete(connectionId);
                        removeConnectionEncoding(connectionId);
                        sendToRenderer('serial:close', { connectionId });
                    };

                    port[SERIAL_CLEANUP] = cleanup;
                    port[SERIAL_WRITE_OPTIONS] = normalizedConfig.slowSend
                        ? { chunkSize: 1, maxChunksPerTick: 1, chunkDelayMs: normalizedConfig.sendDelayMs }
                        : { chunkSize: 4 * 1024 };
                    
                    // 监听数据 - 动态解码
                    port.on('data', (chunk) => {
                        try {
                            const decodedText = decodeChunk(connectionId, chunk);
                            if (decodedText.length > 0) {
                                outputBuffer.push(decodedText);
                            }
                        } catch (e) {}
                    });
                    
                    // 监听错误
                    port.on('error', (err) => {
                        outputBuffer.flush();
                        sendToRenderer('serial:error', {
                            connectionId,
                            error: err.message
                        });

                        if (terminating) return;
                        terminating = true;
                        if (port.isOpen && !port.closing) {
                            port.close((closeError) => {
                                if (closeError) cleanup();
                            });
                        } else {
                            cleanup();
                        }
                    });
                    
                    // 监听关闭
                    port.on('close', () => {
                        cleanup();
                    });
                    
                    resolve({ success: true, connectionId });
                });
            } catch (error) {
                removeConnectionEncoding(connectionId);
                resolve({ success: false, error: error.message });
            }
        });
    });

    // 串口写入数据
    ipc.handle('serial:write', async (event, { connectionId, data }) => {
        return new Promise((resolve) => {
            writeToSerial(connectionId, data, resolve);
        });
    });

    ipc.on('serial:input', (event, { connectionId, data }) => {
        writeToSerial(connectionId, data, (result) => {
            if (result.success || event.sender.isDestroyed()) return;
            event.sender.send('serial:error', {
                connectionId,
                error: result.error
            });
        });
    });

    // 串口断开连接
    ipc.handle('serial:disconnect', async (event, { connectionId }) => {
        const port = activeSerialPorts.get(connectionId);
        if (port) {
            return new Promise((resolve) => {
                port.close((err) => {
                    if (typeof port[SERIAL_CLEANUP] === 'function') port[SERIAL_CLEANUP]();
                    if (err) {
                        resolve({ success: false, error: err.message });
                    } else {
                        resolve({ success: true });
                    }
                });
            });
        }
        return { success: true };
    });
}

module.exports = {
    createSerialPortOptions,
    normalizeSerialConfig,
    registerSerialHandlers
};
