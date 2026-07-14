/**
 * 通用辅助函数模块
 */

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 清理备份输出内容
 * 移除 ANSI 转义序列、终端控制字符等，确保保存的文件是纯文本
 * @param {string} output - 原始输出
 * @returns {string} 清理后的输出
 */
function cleanBackupOutput(output) {
    if (!output) return '';
    
    let cleaned = output
        // 移除 ANSI/VT100 转义序列（颜色、光标控制等）
        // ESC[ ... 序列 (CSI)
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
        .replace(/\x1B\[[\?]?[0-9;]*[A-Za-z]/g, '')
        // ESC] ... BEL 序列 (OSC)
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        // ESC P ... ESC\ 序列 (DCS)
        .replace(/\x1BP[^\x1B]*\x1B\\/g, '')
        // 其他 ESC 序列
        .replace(/\x1B[\x20-\x2F]*[\x30-\x7E]/g, '')
        .replace(/\x1B[78]/g, '')  // ESC 7/8 保存/恢复光标
        .replace(/\x1B[=>]/g, '')  // 键盘模式
        .replace(/\x1Bc/g, '')     // 重置终端
        // 移除所有剩余的 ESC 字符
        .replace(/\x1B/g, '')
        // 移除其他控制字符（保留 \t \n）
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // 统一换行符
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // 移除行尾空白
        .replace(/[ \t]+$/gm, '')
        // 移除空行（只保留单个换行）
        .replace(/\n{2,}/g, '\n')
        // 移除文件开头和结尾的空白
        .trim();
    
    return cleaned;
}

/**
 * 过滤敏感信息（账号密码）
 * @param {string} output - 原始输出
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {string} 过滤后的输出
 */
function filterSensitiveOutput(output, username, password) {
    if (!output) return output;
    let filtered = output;
    
    // 过滤密码（替换为星号）
    if (password && password.length > 0) {
        const escapedPwd = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filtered = filtered.replace(new RegExp(escapedPwd, 'g'), '******');
    }
    
    // 过滤用户名后跟的密码行（常见的登录输出）
    filtered = filtered.replace(/^(password|密码)[:\s].*$/gim, '$1: ******');
    
    return filtered;
}

/**
 * 获取本机IP地址
 * @returns {string}
 */
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

/**
 * 解析端口范围字符串
 * @param {string} portStr - 端口字符串，如 "22,80,443,1000-2000"
 * @returns {number[]} 端口数组
 */
function parsePortRange(portStr) {
    const ports = [];
    const parts = portStr.split(',').map(s => s.trim());

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let i = start; i <= end; i++) {
                    if (i >= 1 && i <= 65535 && !ports.includes(i)) {
                        ports.push(i);
                    }
                }
            }
        } else {
            const p = parseInt(part, 10);
            if (!isNaN(p) && p >= 1 && p <= 65535 && !ports.includes(p)) {
                ports.push(p);
            }
        }
    }

    return ports.sort((a, b) => a - b);
}

module.exports = {
    delay,
    cleanBackupOutput,
    filterSensitiveOutput,
    getLocalIP,
    parsePortRange
};
