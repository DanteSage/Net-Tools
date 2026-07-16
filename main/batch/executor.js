/**
 * 批量执行核心逻辑模块
 */
const net = require('net');
const { delay, filterSensitiveOutput } = require('../utils/helpers');
const { handleTelnetNegotiation } = require('../utils/telnet-protocol');
const { SSH_ALGORITHMS_SIMPLE } = require('../connections/algorithms');
const {
    waitForPrompt,
    waitForTelnetIdle,
    getExitCommand,
    getDisablePagerCommand,
    replaceVariables
} = require('./helpers');

// SSH2 客户端
let ssh2;
try {
    ssh2 = require('ssh2');
} catch (e) {}

/**
 * 执行 Telnet 批量命令
 */
async function executeTelnetTarget(target, commands, options, state, context) {
    const { timeout, cmdDelay, saveBackup, variables } = options;
    const { getMainWindow, isQuitting } = context;
    
    const baseTimeout = saveBackup ? Math.max(timeout, 120000) : timeout;
    const cmdTimeout = saveBackup ? 90000 : Math.max(baseTimeout / commands.length, 5000);
    const idleThreshold = saveBackup ? 5000 : 3000;
    
    const socket = new net.Socket();
    const isPasswordOnly = target.type === 'h3c-ap';
    
    // 连接设备
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('连接超时'));
        }, timeout);
        
        socket.connect(target.port || 23, target.host, () => {
            clearTimeout(timer);
            resolve();
        });
        
        socket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
    
    // 执行命令
    const output = await new Promise((resolve, reject) => {
        let fullOutput = '';
        let loginState = isPasswordOnly ? 'password' : 'init';
        let loginResolve = null;
        let initialCRSent = false;
        let dataReceivedAfterConnect = false;
        let enableState = 'none';
        let enableResolve = null;
        let quitSent = false;
        
        const waitForLogin = new Promise((res) => { loginResolve = res; });
        
        const promptPattern = /[#>$%\]]\s*$/;
        const usernamePromptPattern = /username:|login:|user\s*name:|用户名/i;
        const passwordPromptPattern = /password:|passwd:|密码/i;
        
        // Ruijie 设备特殊处理
        if (target.type === 'ruijie' && !isPasswordOnly) {
            setTimeout(() => {
                if (loginState === 'init' && !dataReceivedAfterConnect) {
                    socket.write('\r\n');
                    initialCRSent = true;
                }
            }, 500);
        }
        
        socket.on('data', (data) => {
            const filteredData = handleTelnetNegotiation(data, socket);
            if (filteredData.length === 0) return;
            
            const text = filteredData.toString();
            fullOutput += text;
            dataReceivedAfterConnect = true;
            
            // 用户名提示处理
            if (!isPasswordOnly && (loginState === 'init' || loginState === 'username')) {
                if (usernamePromptPattern.test(text)) {
                    socket.write(target.username + '\r\n');
                    loginState = 'password';
                    return;
                }
                if (target.type === 'ruijie' && loginState === 'init' && !initialCRSent) {
                    if (!usernamePromptPattern.test(text) && !passwordPromptPattern.test(text) && !promptPattern.test(text)) {
                        setTimeout(() => {
                            socket.write('\r\n');
                            initialCRSent = true;
                        }, 200);
                    }
                }
            }
            
            // Enable 模式处理
            if (enableState === 'sent_enable' || enableState === 'wait_password') {
                if (passwordPromptPattern.test(text)) {
                    socket.write(target.enablePassword + '\r\n');
                    enableState = 'sent_password';
                    return;
                }
                if (/User Access Verification/i.test(text)) {
                    enableState = 'wait_password';
                    return;
                }
            }
            if (enableState === 'sent_password') {
                if (/#\s*$/.test(text) || text.includes('#')) {
                    enableState = 'done';
                    if (enableResolve) enableResolve(true);
                    return;
                }
                if (/denied|invalid|incorrect|failed|bad/i.test(text)) {
                    enableState = 'done';
                    if (enableResolve) enableResolve(false);
                    return;
                }
            }
            
            // 密码提示处理
            if ((loginState === 'password' || loginState === 'init') && enableState === 'none') {
                if (passwordPromptPattern.test(text)) {
                    socket.write(target.password + '\r\n');
                    loginState = 'ready';
                    return;
                }
            }
            
            // 登录成功检测
            if (loginState === 'ready') {
                if (promptPattern.test(text) || text.includes('>') || text.includes('#')) {
                    loginState = 'executing';
                    if (loginResolve) loginResolve();
                }
            }
        });
        
        socket.on('close', () => resolve(fullOutput));
        
        socket.on('error', (err) => {
            if (quitSent && err.message.includes('ECONNRESET')) {
                resolve(fullOutput);
            } else {
                reject(err);
            }
        });
        
        // 执行命令逻辑
        const executeCommands = async () => {
            const loginTimeout = setTimeout(() => {
                if (loginState !== 'executing' && loginResolve) loginResolve();
            }, 10000);
            
            await waitForLogin;
            clearTimeout(loginTimeout);
            await delay(500);
            
            // 自动进入 enable 模式
            if ((target.type === 'cisco' || target.type === 'ruijie') && target.enablePassword) {
                const outputTrimmed = fullOutput.replace(/[\x00-\x1F]/g, '').trim();
                const lastLine = outputTrimmed.split('\n').pop() || '';
                const isUserMode = lastLine.includes('>') && !lastLine.includes('#');
                
                if (isUserMode) {
                    const enablePromise = new Promise((res) => { enableResolve = res; });
                    enableState = 'sent_enable';
                    socket.write('enable\r\n');
                    
                    const enableTimeout = setTimeout(() => {
                        if (enableState !== 'done') {
                            enableState = 'done';
                            if (enableResolve) enableResolve(false);
                        }
                    }, 8000);
                    
                    await enablePromise;
                    clearTimeout(enableTimeout);
                    await delay(500);
                }
            }
            
            // 禁用分页
            const pagerCmd = getDisablePagerCommand(target.type);
            if (pagerCmd) {
                socket.write(pagerCmd + '\r\n');
                await delay(1000);
            }
            
            // 执行命令列表
            for (let i = 0; i < commands.length; i++) {
                if (state.shouldStop) break;
                while (state.paused && !state.shouldStop) {
                    await delay(500);
                }
                
                const cmd = replaceVariables(commands[i], target, variables);
                socket.write(cmd + '\r\n');
                
                if (saveBackup) {
                    await waitForTelnetIdle(socket, idleThreshold, cmdTimeout);
                } else {
                    await delay(cmdDelay || 500);
                }
            }
            
            if (saveBackup) {
                await waitForTelnetIdle(socket, idleThreshold, 10000);
            }
            
            const exitCmd = getExitCommand(target.type);
            quitSent = true;
            await delay(500);
            socket.write(exitCmd + '\r\n');
            await delay(1000);
            socket.destroy();
        };
        
        executeCommands().catch(reject);
    });
    
    return filterSensitiveOutput(output, target.username, target.password);
}

/**
 * 执行 SSH 批量命令
 */
async function executeSSHTarget(target, commands, options, state, context, dependencies = {}) {
    const sshModule = dependencies.ssh2 || ssh2;
    if (!sshModule) {
        throw new Error('SSH2模块未安装');
    }
    
    const { timeout, saveBackup, variables } = options;
    const baseTimeout = saveBackup ? Math.max(timeout, 120000) : timeout;
    const cmdTimeout = saveBackup ? 90000 : Math.max(baseTimeout / commands.length, 5000);
    const idleThreshold = saveBackup ? 5000 : 3000;
    
    const conn = new sshModule.Client();

    try {
        // 连接设备
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                conn.end();
                reject(new Error('连接超时'));
            }, timeout);

            conn.on('ready', () => {
                clearTimeout(timer);
                resolve();
            });

            conn.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            conn.connect({
                host: target.host,
                port: target.port || 22,
                username: target.username,
                password: target.password,
                readyTimeout: timeout,
                algorithms: SSH_ALGORITHMS_SIMPLE
            });
        });

        // 使用 shell 模式执行命令
        const output = await new Promise((resolve, reject) => {
            conn.shell({ term: 'xterm' }, async (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let settled = false;
                const settleResolve = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };
                const settleReject = (error) => {
                    if (settled) return;
                    settled = true;
                    reject(error);
                };

                let fullOutput = '';
                stream.on('data', (data) => {
                    fullOutput += data.toString();
                });
                stream.once('error', (error) => {
                    settleReject(error);
                });

                try {
                    await waitForPrompt(stream, target.type, 5000, 2000);

                    // 自动进入 enable 模式
                    if ((target.type === 'cisco' || target.type === 'ruijie') && target.enablePassword) {
                        if (fullOutput.trim().endsWith('>')) {
                            stream.write('enable\n');
                            await waitForPrompt(stream, target.type, 5000, 2000);
                            stream.write(target.enablePassword + '\n');
                            await waitForPrompt(stream, target.type, 5000, 2000);
                        }
                    }

                    // 禁用分页
                    const pagerCmd = getDisablePagerCommand(target.type);
                    if (pagerCmd) {
                        stream.write(pagerCmd + '\n');
                        await waitForPrompt(stream, target.type, 10000, 2000);
                    }

                    // 执行命令列表
                    for (let i = 0; i < commands.length; i++) {
                        if (state.shouldStop) break;
                        while (state.paused && !state.shouldStop) {
                            await delay(500);
                        }

                        const cmd = replaceVariables(commands[i], target, variables);
                        stream.write(cmd + '\n');
                        await waitForPrompt(stream, target.type, cmdTimeout, idleThreshold);
                    }

                    const exitCmd = getExitCommand(target.type);
                    stream.write(exitCmd + '\n');
                    await delay(500);
                    stream.end();

                    settleResolve(fullOutput);
                } catch (cmdErr) {
                    try { stream.end(); } catch (_) {}
                    settleReject(cmdErr);
                }
            });
        });

        return filterSensitiveOutput(output, target.username, target.password);
    } finally {
        try { conn.end(); } catch (_) {}
    }
}

/**
 * 执行单个目标
 */
async function executeTarget(target, commands, options, state, context) {
    const startTime = Date.now();
    const result = {
        name: target.name || target.host,
        host: target.host,
        type: target.type,
        status: 'running',
        output: '',
        error: null,
        timestamp: new Date().toISOString(),
        startTime: startTime,
        duration: 0
    };
    
    // 发送开始状态
    const mainWindow = context.getMainWindow();
    if (!context.isQuitting() && mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('batch:progress', { ...result });
        } catch (e) {}
    }
    
    try {
        if (target.protocol === 'telnet') {
            result.output = await executeTelnetTarget(target, commands, options, state, context);
        } else {
            result.output = await executeSSHTarget(target, commands, options, state, context);
        }
        result.status = 'success';
    } catch (err) {
        result.error = err.message;
        result.status = 'failed';
    }
    
    result.duration = Date.now() - startTime;
    
    // 发送完成状态
    if (!context.isQuitting() && mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('batch:progress', { ...result });
        } catch (e) {}
    }
    
    return result;
}

module.exports = {
    executeTarget,
    executeTelnetTarget,
    executeSSHTarget
};
