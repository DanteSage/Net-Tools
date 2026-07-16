/**
 * 批量执行辅助函数模块
 */
const { delay } = require('../utils/helpers');

// 设备提示符正则表达式
const PROMPT_PATTERNS = {
    h3c: /[<\[].+[>\]]\s*$/,
    huawei: /[<\[].+[>\]]\s*$/,
    cisco: /[#>]\s*$/,
    ruijie: /[#>]\s*$/,
    juniper: /[#>%]\s*$/,
    linux: /[$#]\s*$/,
    default: /[#>$%]\s*$/
};

// 禁用分页命令
const DISABLE_PAGER_COMMANDS = {
    'h3c': 'screen-length disable',
    'h3c-ap': 'screen-length disable',
    'huawei': 'screen-length 0 temporary',
    'cisco': 'terminal length 0',
    'ruijie': 'terminal length 0',
    'juniper': 'set cli screen-length 0',
    'linux': '',
    'default': ''
};

/**
 * 等待设备提示符（支持智能空闲检测，适用于大型配置文件）
 * @param {Stream} stream - SSH 流
 * @param {string} deviceType - 设备类型
 * @param {number} timeout - 超时时间
 * @param {number} idleThreshold - 空闲检测阈值
 * @returns {Promise<string>}
 */
function waitForPrompt(stream, deviceType, timeout = 10000, idleThreshold = 3000) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        let timer = null;
        let idleTimer = null;
        let lastDataTime = Date.now();
        const pattern = PROMPT_PATTERNS[deviceType] || PROMPT_PATTERNS.default;
        
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (idleTimer) clearInterval(idleTimer);
            stream.removeListener('data', checkPrompt);
            stream.removeListener('error', handleError);
        };

        const handleError = (error) => {
            cleanup();
            reject(error);
        };
        
        const checkPrompt = (data) => {
            buffer += data.toString();
            lastDataTime = Date.now();
        };
        
        stream.on('data', checkPrompt);
        stream.once('error', handleError);
        
        // 空闲检测（无新数据且检测到提示符则完成）
        idleTimer = setInterval(() => {
            const idleTime = Date.now() - lastDataTime;
            if (idleTime > idleThreshold) {
                if (pattern.test(buffer) || buffer.length > 1000) {
                    cleanup();
                    resolve(buffer);
                }
            }
        }, 500);
        
        // 总超时保护
        timer = setTimeout(() => {
            cleanup();
            resolve(buffer);
        }, timeout);
    });
}

/**
 * Telnet 智能等待数据接收完成
 * @param {Socket} socket - Telnet socket
 * @param {number} idleThreshold - 空闲检测阈值
 * @param {number} timeout - 超时时间
 * @returns {Promise}
 */
function waitForTelnetIdle(socket, idleThreshold = 3000, timeout = 60000) {
    return new Promise((resolve) => {
        let lastDataTime = Date.now();
        let timer = null;
        let idleTimer = null;
        
        const onData = () => {
            lastDataTime = Date.now();
        };
        
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (idleTimer) clearInterval(idleTimer);
            socket.removeListener('data', onData);
        };
        
        socket.on('data', onData);
        
        // 空闲检测
        idleTimer = setInterval(() => {
            const idleTime = Date.now() - lastDataTime;
            if (idleTime > idleThreshold) {
                cleanup();
                resolve();
            }
        }, 500);
        
        // 总超时保护
        timer = setTimeout(() => {
            cleanup();
            resolve();
        }, timeout);
    });
}

/**
 * 获取退出命令
 * @param {string} deviceType - 设备类型
 * @returns {string}
 */
function getExitCommand(deviceType) {
    return ['huawei', 'h3c', 'h3c-ap'].includes(deviceType) ? 'quit' : 'exit';
}

/**
 * 获取禁用分页命令
 * @param {string} deviceType - 设备类型
 * @returns {string}
 */
function getDisablePagerCommand(deviceType) {
    return DISABLE_PAGER_COMMANDS[deviceType] || DISABLE_PAGER_COMMANDS.default;
}

/**
 * 替换命令中的变量
 * @param {string} cmd - 原始命令
 * @param {Object} target - 目标设备信息
 * @param {Object} variables - 自定义变量
 * @returns {string}
 */
function replaceVariables(cmd, target, variables = {}) {
    let result = cmd;
    
    // 替换自定义变量
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    
    // 替换内置变量
    result = result.replace(/\$\{ip\}/g, target.host);
    result = result.replace(/\$\{hostname\}/g, target.name || target.host);
    result = result.replace(/\$\{type\}/g, target.type || '');
    result = result.replace(/\$\{username\}/g, target.username || '');
    
    return result;
}

module.exports = {
    PROMPT_PATTERNS,
    DISABLE_PAGER_COMMANDS,
    waitForPrompt,
    waitForTelnetIdle,
    getExitCommand,
    getDisablePagerCommand,
    replaceVariables
};
