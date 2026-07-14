/**
 * 连接字符编码管理器
 * 用于维护每个连接的编码格式并使用 iconv-lite 进行状态化字节流解码
 */
const { ipcMain } = require('electron');
const iconv = require('iconv-lite');

// 存储连接 ID 到其对应的编码格式和解码器的映射关系
const connectionEncodings = new Map();

/**
 * 设置特定连接的编码格式
 * @param {string} connectionId - 连接 ID
 * @param {string} encoding - 编码名称 (如 utf-8, gbk, gb2312, latin1)
 */
function setConnectionEncoding(connectionId, encoding) {
    if (!encoding) {
        encoding = 'utf-8';
    }
    const normalized = encoding.toLowerCase();
    
    // 获取/创建 iconv-lite 的状态化解码器
    let decoder;
    try {
        decoder = iconv.getDecoder(normalized);
    } catch (e) {
        console.error(`无法获取编码 ${normalized} 的解码器，回退至 utf-8:`, e);
        decoder = iconv.getDecoder('utf-8');
    }
    
    connectionEncodings.set(connectionId, {
        encoding: normalized,
        decoder: decoder
    });
}

/**
 * 获取连接的当前编码及解码器
 * @param {string} connectionId - 连接 ID
 * @returns {Object} { encoding: string, decoder: Object }
 */
function getConnectionEncoding(connectionId) {
    let state = connectionEncodings.get(connectionId);
    if (!state) {
        // 默认回退至 utf-8
        const normalized = 'utf-8';
        const decoder = iconv.getDecoder(normalized);
        state = { encoding: normalized, decoder };
        connectionEncodings.set(connectionId, state);
    }
    return state;
}

/**
 * 对接收到的网络 Chunk 进行状态化解码为 UTF-8 字符串
 * @param {string} connectionId - 连接 ID
 * @param {Buffer} buffer - 二进制 Buffer
 * @returns {string} 解码后的字符串
 */
function decodeChunk(connectionId, buffer) {
    const { decoder } = getConnectionEncoding(connectionId);
    return decoder.write(buffer);
}

/**
 * 将写入文本转换成连接的目标编码字节流 Buffer
 * @param {string} connectionId - 连接 ID
 * @param {string} str - 写入的文本字符串
 * @returns {Buffer} 转换后的 Buffer
 */
function encodeString(connectionId, str) {
    const { encoding } = getConnectionEncoding(connectionId);
    return iconv.encode(str, encoding);
}

/**
 * 清理指定连接的编码状态
 * @param {string} connectionId - 连接 ID
 */
function removeConnectionEncoding(connectionId) {
    connectionEncodings.delete(connectionId);
}

/**
 * 注册编码相关的 IPC 处理器
 */
function registerEncodingHandlers() {
    // 设置连接编码
    ipcMain.handle('connection:setEncoding', async (event, { connectionId, encoding }) => {
        try {
            setConnectionEncoding(connectionId, encoding);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = {
    setConnectionEncoding,
    getConnectionEncoding,
    decodeChunk,
    encodeString,
    removeConnectionEncoding,
    registerEncodingHandlers
};
