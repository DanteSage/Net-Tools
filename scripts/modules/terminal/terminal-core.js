/**
 * 终端核心模块 - 初始化、xterm实例、事件监听
 * @module terminal/core
 */

// ==================== 初始化 ====================

let terminalResizeObserver = null;
let terminalWindowResizeHandler = null;
let terminalResizeTimeout = null;

/**
 * Ruijie Telnet 匹配辅助（仅用于判定，不影响显示）
 */
function stripAnsiForRuijieTelnet(text) {
    if (!text) return '';
    return String(text)
        // CSI: ESC[ ... command
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        // OSC: ESC] ... (BEL or ST)
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        // other ESC sequences
        .replace(/\x1B[\x20-\x2F]*[\x30-\x7E]/g, '');
}

function getLastPromptCharFromTelnetOutput(text) {
    if (!text) return null;
    const parts = String(text).replace(/\r/g, '\n').split('\n');
    for (let i = parts.length - 1; i >= 0; i--) {
        const line = parts[i].trim();
        if (!line) continue;
        return line[line.length - 1] || null;
    }
    return null;
}

/**
 * 初始化终端模块
 */
function initTerminal() {
    // 防止事件监听器重复注册（页面刷新/热重载时）
    if (window.api.ssh.removeAllListeners) window.api.ssh.removeAllListeners();
    if (window.api.telnet.removeAllListeners) window.api.telnet.removeAllListeners();
    if (window.api.serial.removeAllListeners) window.api.serial.removeAllListeners();
    
    const connectBtn = document.getElementById('btn-connect');
    const disconnectBtn = document.getElementById('btn-disconnect');
    const clearBtn = document.getElementById('btn-clear-terminal');
    const addTabBtn = document.getElementById('btn-add-tab');
    const loggingBtn = document.getElementById('btn-toggle-logging');
    
    connectBtn.addEventListener('click', handleConnect);
    disconnectBtn.addEventListener('click', handleDisconnect);
    clearBtn.addEventListener('click', clearActiveTerminal);
    addTabBtn.addEventListener('click', showNewTabDialog);
    loggingBtn.addEventListener('click', toggleLogging);
    
    const aiDiagnoseBtn = document.getElementById('btn-terminal-ai-diagnose');
    if (aiDiagnoseBtn) {
        aiDiagnoseBtn.addEventListener('click', handleTerminalAiDiagnose);
    }
    
    const sftpToggleBtn = document.getElementById('btn-toggle-sftp');
    if (sftpToggleBtn) {
        sftpToggleBtn.addEventListener('click', () => toggleSftp(false));
    }
    const ftpToggleBtn = document.getElementById('btn-toggle-ftp');
    if (ftpToggleBtn) {
        ftpToggleBtn.addEventListener('click', () => toggleSftp(true));
    }
    
    const encodingSelect = document.getElementById('select-terminal-encoding');
    if (encodingSelect) {
        encodingSelect.addEventListener('change', handleTerminalEncodingChange);
    }
    
    loadConnectionHistory();
    initContextMenu();
    initSearch();
    initQuickConnectModal();
    initTabContextMenu();
    
    // 每秒更新连接时长
    setInterval(updateConnectionDurations, 1000);
    
    // 窗口和内部布局变化时调整活动终端
    if (terminalWindowResizeHandler) {
        window.removeEventListener('resize', terminalWindowResizeHandler);
    }
    if (terminalResizeObserver) {
        terminalResizeObserver.disconnect();
    }
    if (terminalResizeTimeout) {
        clearTimeout(terminalResizeTimeout);
    }

    terminalWindowResizeHandler = () => {
        if (terminalResizeTimeout) clearTimeout(terminalResizeTimeout);
        terminalResizeTimeout = setTimeout(() => {
            terminalResizeTimeout = null;
            const session = getActiveSession();
            fitTerminalSession(session);
        }, 50);
    };

    window.addEventListener('resize', terminalWindowResizeHandler);
    const terminalContainer = document.getElementById('terminal-container');
    if (terminalContainer && typeof ResizeObserver !== 'undefined') {
        terminalResizeObserver = new ResizeObserver(terminalWindowResizeHandler);
        terminalResizeObserver.observe(terminalContainer);
    }
    
    // 监听SSH数据
    window.api.ssh.onData((data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session && session.terminal) {
            // Cisco/Ruijie 自动 enable 处理（隶藏过程）
            if (session.autoEnable && session.autoEnable.enabled && session.autoEnable.state !== 'done') {
                const output = data.data.toLowerCase();
                const trimmedOutput = data.data.trim();
                
                // 已经在特权模式（提示符以 # 结尾），无需 enable，直接完成
                if (session.autoEnable.state === 'waiting' && /[a-zA-Z0-9_-]+#\s*$/.test(trimmedOutput)) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    session.terminal.write(data.data);
                    appendToLog(session, data.data);
                    return;
                }
                
                // 检测用户模式提示符 (以 > 结尾)，发送 enable 命令
                if (session.autoEnable.state === 'waiting' && /[a-zA-Z0-9_-]+>\s*$/.test(trimmedOutput)) {
                    session.autoEnable.state = 'sent_enable';
                    session.terminal.write('\x1b[33m正在进入 Enable 特权模式...\x1b[0m\r');
                    setTimeout(() => {
                        window.api.ssh.write(session.connectionId, 'enable\n');
                    }, 100);
                    return; // 不显示用户模式提示符
                }
                // 检测密码提示，发送 enable 密码
                else if (session.autoEnable.state === 'sent_enable' && 
                         (output.includes('password') || output.includes('密码'))) {
                    session.autoEnable.state = 'sent_password';
                    setTimeout(() => {
                        window.api.ssh.write(session.connectionId, session.autoEnable.password + '\n');
                    }, 100);
                    return; // 不显示密码提示
                }
                // 检测特权模式提示符 (以 # 结尾)，完成自动 enable
                else if ((session.autoEnable.state === 'sent_password' || session.autoEnable.state === 'sent_enable') && 
                         /[a-zA-Z0-9_-]+#\s*$/.test(trimmedOutput)) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    // 清除状态提示，显示特权模式提示符
                    session.terminal.write('\r\x1b[K'); // 清除当前行
                    session.terminal.write(data.data);
                    appendToLog(session, data.data);
                    return;
                }
                // 检测密码错误，停止自动 enable 并显示错误
                else if (session.autoEnable.state === 'sent_password' && 
                         (output.includes('denied') || output.includes('invalid') || output.includes('incorrect') || output.includes('failed'))) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    session.terminal.write('\x1b[31mEnable密码错误\x1b[0m\r\n');
                    session.terminal.write(data.data);
                    appendToLog(session, data.data);
                    return;
                }
                // 其他情况不显示（如 enable 命令回显等）
                return;
            }
            
            session.terminal.write(data.data);
            appendToLog(session, data.data);
        }
    });
    
    window.api.ssh.onClose(async (data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session) {
            if (session.logging) await stopLogging(session);
            session.connected = false;
            session.connectionId = null;
            session.terminalWriteController?.refreshFlowControl();
            if (session.terminal) session.terminal.write('\r\n\x1b[33m--- SSH连接已断开 ---\x1b[0m\r\n');
            updateTabs();
            updateTerminalStatus();
            updateLoggingButton();
            updateTerminalDeviceSelect();
            renderDeviceList();
        }
    });
    
    window.api.serial.onData((data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session && session.terminal) {
            session.terminal.write(data.data);
            appendToLog(session, data.data);
        }
    });
    
    // 监听Telnet数据
    window.api.telnet.onData((data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session && session.terminal) {
            // IAC negotiation is removed by the stateful main-process parser.
            const filteredData = data.data.replace(/[\x00-\x07\x0b\x0c\x0e-\x1a]/g, '');
            
            if (!filteredData) return;
            
            // Telnet 登录中状态 - 检测命令提示符
            if (session.loggingIn && session.telnetAutoLogin) {
                const lowerData = filteredData.toLowerCase();
                const isRuijie = session.deviceType === 'ruijie';
                const ruijieMatchData = isRuijie ? stripAnsiForRuijieTelnet(filteredData) : null;
                const ruijieLowerData = isRuijie ? ruijieMatchData.toLowerCase() : null;
                const ruijiePromptChar = isRuijie ? getLastPromptCharFromTelnetOutput(ruijieMatchData) : null;
                
                // H3C-AP 专用登录逻辑（只需密码，隐藏登录过程）
                if (session.telnetAutoLogin.passwordOnly) {
                    // 检测密码提示（支持多种格式）
                    if (!session.telnetAutoLogin.passwordSent && 
                        (lowerData.includes('password') || lowerData.includes('passwd') || lowerData.includes('密码'))) {
                        if (session.telnetAutoLogin.password) {
                            setTimeout(() => {
                                window.api.telnet.write(session.connectionId, session.telnetAutoLogin.password + '\r\n');
                            }, 100);
                            session.telnetAutoLogin.passwordSent = true;
                        }
                        return;
                    }
                    // 检测命令提示符 - 登录成功
                    else if (lowerData.includes('>') || lowerData.includes('#') || lowerData.includes(']')) {
                        session.telnetAutoLogin.loginComplete = true;
                        session.loggingIn = false;
                        session.connected = true;
                        session.connectedAt = Date.now();
                        // 登录成功后显示数据（先换行避免遮挡连接提示）
                        session.terminal.write('\r\n' + filteredData);
                        appendToLog(session, filteredData);
                        updateTabs();
                        updateTerminalStatus();
                        updateTerminalDeviceSelect();
                        renderDeviceList();
                        showToast('H3C-AP 登录成功', 'success');
                        if (session.deviceForHistory) {
                            addToConnectionHistory(session.deviceForHistory, session.protocolForHistory);
                        }
                        return;
                    }
                    // 登录失败提示
                    else if (lowerData.includes('failed') || lowerData.includes('denied') || lowerData.includes('invalid') || lowerData.includes('incorrect')) {
                        session.telnetAutoLogin.loginComplete = true;
                        session.loggingIn = false;
                        session.terminal.write('\x1b[31m登录失败，请检查密码\x1b[0m\r\n');
                        updateTabs();
                        return;
                    }
                    // 登录过程中的其他数据不显示（隐藏密码输入过程）
                    return;
                }
                // 标准 Telnet 登录逻辑（需要用户名和密码）
                else {
                    // Ruijie 设备特殊处理：如果连接后收到数据但没有登录提示，发送回车触发
                    if (session.deviceType === 'ruijie' && !session.telnetAutoLogin.initialCRSent) {
                        const hasPrompt = ruijieLowerData.includes('username') || ruijieLowerData.includes('login') || 
                                         ruijieLowerData.includes('user name') || ruijieLowerData.includes('password') ||
                                         ruijieLowerData.includes('用户名') || ruijieLowerData.includes('账号') || ruijieLowerData.includes('密码');
                        const hasCommandPrompt = ruijiePromptChar === '>' || ruijiePromptChar === '#';
                        if (!hasPrompt && !hasCommandPrompt) {
                            session.telnetAutoLogin.initialCRSent = true;
                            setTimeout(() => {
                                window.api.telnet.write(session.connectionId, '\r\n');
                            }, 200);
                            return;
                        }
                    }
                    
                    // 检测用户名提示（增强匹配模式）
                    if (!session.telnetAutoLogin.usernameSet && 
                        ((lowerData.includes('username') || lowerData.includes('login:') || lowerData.includes('user name') || lowerData.includes('login name')) ||
                         (isRuijie && (
                             ruijieLowerData.includes('username') || ruijieLowerData.includes('login:') || ruijieLowerData.includes('user name') || ruijieLowerData.includes('login name') ||
                             ruijieLowerData.includes('用户名') || ruijieLowerData.includes('账号')
                         )))) {
                        if (session.telnetAutoLogin.username) {
                            setTimeout(() => {
                                window.api.telnet.write(session.connectionId, session.telnetAutoLogin.username + '\r\n');
                            }, 50);
                            session.telnetAutoLogin.usernameSet = true;
                        }
                        return;
                    }
                    // 检测密码提示
                    else if (!session.telnetAutoLogin.passwordSent && (
                        lowerData.includes('password') || lowerData.includes('passwd') ||
                        (isRuijie && (ruijieLowerData.includes('password') || ruijieLowerData.includes('passwd') || ruijieLowerData.includes('密码')))
                    )) {
                        if (session.telnetAutoLogin.password) {
                            setTimeout(() => {
                                window.api.telnet.write(session.connectionId, session.telnetAutoLogin.password + '\r\n');
                            }, 50);
                            session.telnetAutoLogin.passwordSent = true;
                        }
                        return;
                    }
                    // 检测命令提示符 - 登录成功
                    else if (
                        lowerData.includes('>') || lowerData.includes('#') || lowerData.includes('$') || 
                        lowerData.includes('welcome') || lowerData.includes('last login') ||
                        (isRuijie && (
                            ruijiePromptChar === '>' || ruijiePromptChar === '#' ||
                            ruijieLowerData.includes('welcome') || ruijieLowerData.includes('last login') ||
                            ruijieLowerData.includes('>') || ruijieLowerData.includes('#') || ruijieLowerData.includes('$')
                        ))
                    ) {
                        session.telnetAutoLogin.loginComplete = true;
                        session.loggingIn = false;
                        session.connected = true;
                        session.connectedAt = Date.now();
                        
                        // Cisco/Ruijie 自动 enable：检测到用户模式 > 且有 enablePassword
                        const shouldAutoEnable = isRuijie
                            ? ruijiePromptChar === '>'
                            : /[a-zA-Z0-9_-]+>\s*$/.test(filteredData.trim());
                        if (session.autoEnable && session.autoEnable.enabled && shouldAutoEnable) {
                            // 直接触发 enable 流程
                            session.autoEnable.state = 'sent_enable';
                            session.terminal.write('\x1b[33m正在进入 Enable 特权模式...\x1b[0m\r');
                            setTimeout(() => {
                                window.api.telnet.write(session.connectionId, 'enable\r\n');
                            }, 100);
                            updateTabs();
                            updateTerminalStatus();
                            updateTerminalDeviceSelect();
                            renderDeviceList();
                            if (session.deviceForHistory) {
                                addToConnectionHistory(session.deviceForHistory, session.protocolForHistory);
                            }
                            return;
                        }
                        
                        // 已经在特权模式（包含 #），直接完成 autoEnable
                        const isPrivPrompt = isRuijie ? ruijiePromptChar === '#' : lowerData.includes('#');
                        if (session.autoEnable && session.autoEnable.enabled && isPrivPrompt) {
                            session.autoEnable.state = 'done';
                            session.autoEnable.enabled = false;
                        }
                        
                        // 清除"待登录中..."提示，换行显示设备数据
                        session.terminal.write('\r\n');
                        session.terminal.write(filteredData);
                        appendToLog(session, filteredData);
                        updateTabs();
                        updateTerminalStatus();
                        updateTerminalDeviceSelect();
                        renderDeviceList();
                        showToast('Telnet 登录成功', 'success');
                        if (session.deviceForHistory) {
                            addToConnectionHistory(session.deviceForHistory, session.protocolForHistory);
                        }
                        return;
                    }
                    // 登录失败提示
                    else if (lowerData.includes('failed') || lowerData.includes('denied') || lowerData.includes('invalid') || lowerData.includes('incorrect')) {
                        session.telnetAutoLogin.loginComplete = true;
                        session.loggingIn = false;
                        session.terminal.write('\x1b[31m登录失败，请检查用户名和密码\x1b[0m\r\n');
                        session.terminal.write(filteredData);
                        appendToLog(session, filteredData);
                        updateTabs();
                        return;
                    }
                    // 用户名发送后，等待密码提示，不显示回显
                    else if (session.telnetAutoLogin.usernameSet && !session.telnetAutoLogin.passwordSent) {
                        return;
                    }
                }
            }
            
            // Cisco/Ruijie Telnet 自动 enable 处理（登录完成后）
            if (session.autoEnable && session.autoEnable.enabled && session.autoEnable.state !== 'done') {
                const output = filteredData.toLowerCase();
                const trimmedOutput = filteredData.trim();
                const isRuijie = session.deviceType === 'ruijie';
                const ruijieMatchData = isRuijie ? stripAnsiForRuijieTelnet(filteredData) : null;
                const ruijieLowerData = isRuijie ? ruijieMatchData.toLowerCase() : null;
                const ruijiePromptChar = isRuijie ? getLastPromptCharFromTelnetOutput(ruijieMatchData) : null;
                
                // Ruijie：部分机型登录提示/提示符带控制码，可能导致 loggingIn 阶段未命中；在此处做一次安全兜底置位
                if (isRuijie && session.loggingIn && !session.connected && (ruijiePromptChar === '>' || ruijiePromptChar === '#')) {
                    if (session.telnetAutoLogin) session.telnetAutoLogin.loginComplete = true;
                    session.loggingIn = false;
                    session.connected = true;
                    session.connectedAt = session.connectedAt || Date.now();
                    updateTabs();
                    updateTerminalStatus();
                    updateTerminalDeviceSelect();
                    renderDeviceList();
                    if (session.deviceForHistory) {
                        addToConnectionHistory(session.deviceForHistory, session.protocolForHistory);
                    }
                }
                
                // 已经在特权模式（包含 #），直接完成 autoEnable
                const hasPrivPrompt = isRuijie ? ruijiePromptChar === '#' : output.includes('#');
                if (session.autoEnable.state === 'waiting' && hasPrivPrompt) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    // 清除"待登录中..."提示，换行显示
                    session.terminal.write('\r\n');
                    session.terminal.write(filteredData);
                    appendToLog(session, filteredData);
                    return;
                }
                
                // 检测用户模式提示符 (以 > 结尾)，发送 enable 命令
                const hasUserPrompt = isRuijie ? ruijiePromptChar === '>' : /[a-zA-Z0-9_-]+>\s*$/.test(trimmedOutput);
                if (session.autoEnable.state === 'waiting' && hasUserPrompt) {
                    session.autoEnable.state = 'sent_enable';
                    session.terminal.write('\x1b[33m正在进入 Enable 特权模式...\x1b[0m\r');
                    setTimeout(() => {
                        window.api.telnet.write(session.connectionId, 'enable\r\n');
                    }, 100);
                    return;
                }
                // 检测密码提示，发送 enable 密码
                else if (session.autoEnable.state === 'sent_enable' && 
                         (output.includes('password') || output.includes('密码') ||
                          (isRuijie && (ruijieLowerData.includes('password') || ruijieLowerData.includes('passwd') || ruijieLowerData.includes('密码'))))) {
                    session.autoEnable.state = 'sent_password';
                    setTimeout(() => {
                        window.api.telnet.write(session.connectionId, session.autoEnable.password + '\r\n');
                    }, 100);
                    return;
                }
                // 检测特权模式提示符 (以 # 结尾)，完成自动 enable
                else if ((session.autoEnable.state === 'sent_password' || session.autoEnable.state === 'sent_enable') && (
                    isRuijie ? ruijiePromptChar === '#' : /[a-zA-Z0-9_-]+#\s*$/.test(trimmedOutput)
                )) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    session.terminal.write('\r\x1b[K');
                    session.terminal.write(filteredData);
                    appendToLog(session, filteredData);
                    showToast('Telnet 登录成功', 'success');
                    return;
                }
                // 检测密码错误
                else if (session.autoEnable.state === 'sent_password' && 
                         (output.includes('denied') || output.includes('invalid') || output.includes('incorrect') || output.includes('failed'))) {
                    session.autoEnable.state = 'done';
                    session.autoEnable.enabled = false;
                    session.terminal.write('\x1b[31mEnable密码错误\x1b[0m\r\n');
                    session.terminal.write(filteredData);
                    appendToLog(session, filteredData);
                    return;
                }
                // 其他情况不显示
                return;
            }
            
            session.terminal.write(filteredData);
            appendToLog(session, filteredData);
        }
    });
    
    window.api.telnet.onError((data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session && session.terminal) {
            session.terminal.write(`\r\n\x1b[31m[Telnet错误] ${data.error}\x1b[0m\r\n`);
        }
    });
    
    window.api.telnet.onClose(async (data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session) {
            if (session.logging) await stopLogging(session);
            session.connected = false;
            session.loggingIn = false;
            session.connectionId = null;
            session.terminalWriteController?.refreshFlowControl();
            if (session.terminal) session.terminal.write('\r\n\x1b[33m--- Telnet连接已断开 ---\x1b[0m\r\n');
            updateTabs();
            updateTerminalStatus();
            updateLoggingButton();
            updateTerminalDeviceSelect();
            renderDeviceList();
        }
    });
    
    window.api.serial.onError((data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session && session.terminal) {
            session.terminal.write(`\r\n\x1b[31m[串口错误] ${data.error}\x1b[0m\r\n`);
        }
    });
    
    window.api.serial.onClose(async (data) => {
        const session = findSessionByConnectionId(data.connectionId);
        if (session) {
            if (session.logging) await stopLogging(session);
            session.connected = false;
            session.connectionId = null;
            session.terminalWriteController?.refreshFlowControl();
            if (session.terminal) session.terminal.write('\r\n\x1b[33m--- 串口连接已断开 ---\x1b[0m\r\n');
            updateTabs();
            updateTerminalStatus();
            updateLoggingButton();
            updateTerminalDeviceSelect();
            renderDeviceList();
        }
    });
}

/**
 * 监听并处理终端编码更改
 */
async function handleTerminalEncodingChange() {
    const session = getActiveSession();
    if (!session || !session.connectionId) return;
    
    const encodingSelect = document.getElementById('select-terminal-encoding');
    if (!encodingSelect) return;
    
    const selectedEncoding = encodingSelect.value;
    
    try {
        // 更新主连接的编码
        await window.api.connection.setEncoding(session.connectionId, selectedEncoding);
        
        // 如果存在 Telnet 伴生的 FTP 后台连接，也需要同步更新其编码配置
        if (session.ftpConnectionId) {
            await window.api.connection.setEncoding(session.ftpConnectionId, selectedEncoding);
        }
        
        session.encoding = selectedEncoding;
        if (session.deviceConfig) session.deviceConfig.encoding = selectedEncoding;
        
        if (session.terminal) {
            session.terminal.write(`\r\n\x1b[33m--- [终端字符编码切换为 ${selectedEncoding.toUpperCase()}] ---\x1b[0m\r\n`);
        }
        
        showToast(`终端字符编码已切换为 ${selectedEncoding.toUpperCase()}`, 'success');
    } catch (e) {
        console.error('切换终端字符编码失败:', e);
        showToast('切换终端字符编码失败: ' + e.message, 'error');
    }
}

// ==================== xterm.js 实例 ====================

/**
 * 创建xterm.js终端实例
 * @param {Object} session - 会话对象
 * @returns {Terminal} 终端实例
 */
function createTerminalInstance(session) {
    const container = document.getElementById('terminal-container');
    
    const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: "'Monaco', 'Consolas', 'Courier New', monospace",
        theme: getCurrentTerminalTheme(),
        scrollback: 10000,
        allowTransparency: false
    });
    
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    
    const searchAddon = new SearchAddon.SearchAddon();
    terminal.loadAddon(searchAddon);
    
    try {
        const unicode11Addon = new Unicode11Addon.Unicode11Addon();
        terminal.loadAddon(unicode11Addon);
        terminal.unicode.activeVersion = '11';
    } catch (e) { /* Unicode11 加载失败不影响基本功能 */ }
    
    terminal.open(container);
    installTerminalWriteController(session, terminal, {
        active: session.id === state.activeSessionId
    });
    installTerminalRendererController(session, terminal);
    
    // 延迟再适配一次，覆盖字体和容器过渡完成后的尺寸
    setTimeout(() => fitTerminalSession(session), 100);
    
    // 快捷键处理
    terminal.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            toggleSearchBar();
            return false;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'c') {
            const selection = terminal.getSelection();
            // 如果是 Ctrl + Shift + C，或者存在选中文本的 Ctrl + C，执行复制
            if (e.shiftKey || (selection && selection.length > 0)) {
                if (selection) {
                    navigator.clipboard.writeText(selection);
                    showToast('已复制到剪贴板', 'success');
                }
                return false; // 拦截事件，不发给终端
            }
            // 否则（无选中文本的 Ctrl + C），让终端处理以发送中断信号 \x03
            return true;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'v') {
            navigator.clipboard.readText().then(text => {
                if (text && session.connected) sendToSession(session, text);
            });
            return false;
        }
        return true;
    });
    
    terminal.onData((data) => {
        if (session.aiTakeover) {
            terminal.write('\r\n\x1b[31m[AI 警告] 当前终端正在被 AI 接管执行中，请等待或在智能助手面板点击【停止】按钮终止。\x1b[0m\r\n');
            return;
        }
        if (session.connected && session.connectionId) {
            if (session.connectionType === 'serial' && session.deviceConfig?.localEcho) {
                terminal.write(data === '\r' ? '\r\n' : data);
            }
            sendToSession(session, data);
        }
    });

    terminal.onResize(({ cols, rows }) => {
        scheduleRemoteTerminalResize(session, cols, rows);
    });
    
    terminal.element.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, session);
    });
    
    // 点击终端时确保获得焦点
    terminal.element.addEventListener('click', () => {
        terminal.focus();
    });
    
    session.terminal = terminal;
    session.fitAddon = fitAddon;
    session.searchAddon = searchAddon;
    
    return terminal;
}

/**
 * 提取终端滚动缓冲区中的最近文本内容
 * @param {Terminal} terminal - xterm.js 实例
 * @param {number} maxLines - 最大提取行数
 * @returns {string}
 */
function getTerminalScrollback(terminal, maxLines = 150) {
    if (!terminal || !terminal.buffer || !terminal.buffer.active) {
        return '';
    }
    const buffer = terminal.buffer.active;
    const totalLines = buffer.length;
    const startLine = Math.max(0, totalLines - maxLines);
    let lines = [];
    for (let i = startLine; i < totalLines; i++) {
        const line = buffer.getLine(i);
        if (line) {
            lines.push(line.translateToString(true));
        }
    }
    return lines.join('\n');
}

/**
 * 终端回显一键 AI 诊断的处理函数
 */
function handleTerminalAiDiagnose() {
    const session = getActiveSession();
    if (!session || !session.terminal) {
        showToast('当前无活动终端会话', 'warning');
        return;
    }
    
    let content = session.terminal.getSelection();
    let isSelection = true;
    
    if (!content || !content.trim()) {
        content = getTerminalScrollback(session.terminal, 150);
        isSelection = false;
    }
    
    if (!content || !content.trim()) {
        showToast('终端无有效回显内容可供诊断', 'warning');
        return;
    }
    
    const deviceName = session.deviceName || '未知设备';
    const deviceType = session.deviceType || '未知厂商';
    
    if (typeof window.diagnoseTerminalContent === 'function') {
        window.diagnoseTerminalContent(content, deviceName, deviceType, isSelection, session.id);
    } else {
        showToast('AI 诊断接口未就绪，请稍后重试', 'error');
    }
}
