/**
 * 终端连接模块
 * @module terminal/connect
 */

// ==================== 连接处理 ====================

const REMOTE_TERMINAL_RESIZE_DELAY_MS = 50;

/**
 * 获取会话当前终端尺寸
 * @param {Object} session - 会话对象
 * @returns {{cols: number, rows: number}}
 */
function getSessionTerminalSize(session) {
    const terminal = session && session.terminal;
    return {
        cols: Math.max(2, Math.floor(Number(terminal && terminal.cols) || 80)),
        rows: Math.max(1, Math.floor(Number(terminal && terminal.rows) || 24))
    };
}

/**
 * 更新终端显示和光标闪烁状态
 * @param {Object} session - 会话对象
 * @param {boolean} active - 是否为活动终端
 */
function setTerminalSessionActive(session, active) {
    if (!session || !session.terminal) return;

    if (session.terminal.element) {
        session.terminal.element.style.display = active ? 'block' : 'none';
    }
    session.terminal.options.cursorBlink = Boolean(active);
    session.terminalWriteController?.setActive(active);
}

/**
 * 按容器尺寸适配终端
 * @param {Object} session - 会话对象
 * @returns {boolean} 是否适配成功
 */
function fitTerminalSession(session) {
    if (!session || !session.terminal || !session.fitAddon) return false;

    try {
        session.fitAddon.fit();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 防抖同步远端 PTY 尺寸
 * @param {Object} session - 会话对象
 * @param {number} cols - 终端列数
 * @param {number} rows - 终端行数
 */
function scheduleRemoteTerminalResize(session, cols, rows) {
    if (!session) return;

    session.pendingRemoteTerminalSize = {
        cols: Math.max(2, Math.floor(Number(cols) || 80)),
        rows: Math.max(1, Math.floor(Number(rows) || 24))
    };

    if (session.remoteResizeTimer) {
        clearTimeout(session.remoteResizeTimer);
    }

    session.remoteResizeTimer = setTimeout(() => {
        session.remoteResizeTimer = null;
        const size = session.pendingRemoteTerminalSize;
        if (!size || !session.connectionId) return;

        const resizeKey = `${session.connectionId}:${size.cols}x${size.rows}`;
        if (session.lastRemoteTerminalSize === resizeKey) return;

        if (session.connectionType === 'ssh' && window.api.ssh.resize) {
            window.api.ssh.resize(session.connectionId, size.cols, size.rows);
        } else if (session.connectionType === 'telnet' && window.api.telnet.resize) {
            window.api.telnet.resize(session.connectionId, size.cols, size.rows);
        } else {
            return;
        }

        session.lastRemoteTerminalSize = resizeKey;
    }, REMOTE_TERMINAL_RESIZE_DELAY_MS);
}

/**
 * 发送数据到会话
 * @param {Object} session - 会话对象
 * @param {string} data - 要发送的数据
 */
function sendToSession(session, data) {
    if (!session || !session.connectionId) return;

    const bsDevices = ['h3c', 'h3c-ap', 'ruijie', 'cisco'];
    if (session.connectionType === 'serial') {
        const config = session.deviceConfig || {};
        const newline = {
            cr: '\r',
            lf: '\n',
            crlf: '\r\n'
        }[config.inputNewline || 'cr'] || '\r';
        data = data.replace(/\r\n|\r|\n/g, newline);

        if (config.backspace === 'bs' || (!config.backspace && bsDevices.includes(session.deviceType))) {
            data = data.replace(/\x7f/g, '\x08');
        } else if (config.backspace === 'del') {
            data = data.replace(/\x08/g, '\x7f');
        }
    } else if (bsDevices.includes(session.deviceType)) {
        data = data.replace(/\x7f/g, '\x08');
    }
    
    try {
        if (session.connectionType === 'serial') {
            window.api.serial.input(session.connectionId, data);
        } else if (session.connectionType === 'telnet') {
            window.api.telnet.input(session.connectionId, data);
        } else if (session.connectionType === 'ssh') {
            window.api.ssh.input(session.connectionId, data);
        }
    } catch (error) {
        console.error('终端输入发送失败:', error);
    }
}

function buildSerialConnectConfig(device, session = null) {
    return {
        path: device.comPort,
        baudRate: Number(device.baudRate) || 9600,
        dataBits: Number(device.dataBits) || 8,
        parity: device.parity || 'none',
        stopBits: Number(device.stopBits) || 1,
        rtscts: Boolean(device.rtscts),
        xon: Boolean(device.xon),
        xoff: Boolean(device.xoff),
        slowSend: Boolean(device.slowSend),
        sendDelayMs: Number(device.sendDelayMs) >= 0 ? Number(device.sendDelayMs) : 5,
        encoding: session?.encoding || device.encoding || 'utf-8'
    };
}

/**
 * 显示快速连接对话框
 */
function showNewTabDialog() {
    const modal = document.getElementById('quick-connect-modal');
    const form = document.getElementById('quick-connect-form');
    
    // 重置表单
    form.reset();
    document.getElementById('qc-port').value = '22';
    document.getElementById('qc-enable-password-group').style.display = 'none';
    
    modal.classList.add('active');
    document.getElementById('qc-host').focus();
}

/**
 * 初始化快速连接模态框事件
 */
function initQuickConnectModal() {
    const modal = document.getElementById('quick-connect-modal');
    const closeBtn = document.getElementById('quick-connect-modal-close');
    const cancelBtn = document.getElementById('btn-cancel-quick-connect');
    const connectBtn = document.getElementById('btn-do-quick-connect');
    const protocolSelect = document.getElementById('qc-protocol');
    const typeSelect = document.getElementById('qc-type');
    
    // 关闭模态框
    const closeModal = () => modal.classList.remove('active');
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    // 协议切换时更新默认端口
    protocolSelect.addEventListener('change', () => {
        const portInput = document.getElementById('qc-port');
        if (protocolSelect.value === 'ssh') {
            portInput.value = '22';
        } else if (protocolSelect.value === 'telnet') {
            portInput.value = '23';
        } else if (protocolSelect.value === 'ftp') {
            portInput.value = '21';
        }
    });
    
    // 设备类型切换时显示/隐藏 Enable 密码
    typeSelect.addEventListener('change', () => {
        const enableGroup = document.getElementById('qc-enable-password-group');
        const needsEnable = ['cisco', 'ruijie'].includes(typeSelect.value);
        enableGroup.style.display = needsEnable ? 'block' : 'none';
    });
    
    // 连接按钮
    connectBtn.addEventListener('click', handleQuickConnect);
    
    // 表单回车提交
    document.getElementById('quick-connect-form').addEventListener('submit', (e) => {
        e.preventDefault();
        handleQuickConnect();
    });
    
    // 密码显示/隐藏切换
    modal.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.querySelector('.icon-eye').style.display = isPassword ? 'none' : 'block';
            btn.querySelector('.icon-eye-off').style.display = isPassword ? 'block' : 'none';
        });
    });
}

/**
 * 处理快速连接
 */
async function handleQuickConnect() {
    const host = document.getElementById('qc-host').value.trim();
    const port = parseInt(document.getElementById('qc-port').value) || 22;
    const username = document.getElementById('qc-username').value.trim();
    const password = document.getElementById('qc-password').value;
    const protocol = document.getElementById('qc-protocol').value;
    const deviceType = document.getElementById('qc-type').value;
    const enablePassword = document.getElementById('qc-enable-password').value;
    
    if (!host) {
        showToast('请输入主机地址', 'warning');
        document.getElementById('qc-host').focus();
        return;
    }
    
    if (!username && deviceType !== 'h3c-ap') {
        showToast('请输入用户名', 'warning');
        document.getElementById('qc-username').focus();
        return;
    }
    
    // 关闭模态框
    document.getElementById('quick-connect-modal').classList.remove('active');
    
    // 创建临时设备对象
    const tempDevice = {
        id: 'quick-' + Date.now(),
        name: host,
        host: host,
        port: port,
        username: username,
        password: password,
        protocol: protocol,
        type: deviceType,
        enablePassword: enablePassword || ''
    };
    
    // 使用现有的连接逻辑
    await connectToDeviceDirectly(tempDevice);
}

/**
 * 直接连接到设备（不依赖下拉框选择）
 * @param {Object} device - 设备对象
 */
async function connectToDeviceDirectly(device) {
    const protocol = device.protocol || 'ssh';
    const connectionType = protocol === 'console' ? 'serial' : (protocol === 'telnet' ? 'telnet' : (protocol === 'ftp' ? 'ftp' : 'ssh'));
    const session = createSession(device.id, device.name, connectionType);
    session.deviceType = device.type || 'default';
    session.encoding = device.encoding || 'utf-8';
    session.deviceConfig = { ...device }; // 保存设备配置用于重新连接
    session.connecting = true;
    state.sessions.set(session.id, session);
    state.activeSessionId = session.id;
    
    hideAllTerminals();
    createTerminalInstance(session);
    showTerminalContainer();
    updateTabs();
    showToast(`正在连接 ${device.name}...`, 'info');
    
    try {
        let result;
        
        if (protocol === 'telnet') {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 23} (Telnet)...\r\n`);
            const terminalSize = getSessionTerminalSize(session);
            result = await window.api.telnet.connect({
                host: device.host,
                port: device.port || 23,
                cols: terminalSize.cols,
                rows: terminalSize.rows
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connecting = false;
                session.loggingIn = true;
                session.terminal.write('\x1b[32mTCP 连接成功, 等待登录中...\x1b[0m\r');
                
                const isPasswordOnly = device.type === 'h3c-ap';
                session.telnetAutoLogin = {
                    username: device.username || '',
                    password: device.password || '',
                    usernameSet: isPasswordOnly,
                    passwordSent: false,
                    loginComplete: false,
                    passwordOnly: isPasswordOnly,
                    initialCRSent: false
                };
                
                if (device.type === 'ruijie') {
                    setTimeout(() => {
                        if (session.loggingIn && !session.telnetAutoLogin.usernameSet) {
                            window.api.telnet.write(session.connectionId, '\r\n');
                            session.telnetAutoLogin.initialCRSent = true;
                        }
                    }, 800);
                }
                
                if ((device.type === 'cisco' || device.type === 'ruijie') && device.enablePassword) {
                    session.autoEnable = {
                        enabled: true,
                        password: device.enablePassword,
                        state: 'waiting',
                        attempts: 0
                    };
                }
                
                updateTabs();
                updateTerminalStatus();
                session.terminal.focus();
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31mTelnet 连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('Telnet 连接失败: ' + result.error, 'error');
            }
        } else if (protocol === 'ftp') {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 21} (FTP)...\r\n`);
            result = await window.api.ftp.connect({
                host: device.host,
                port: device.port || 21,
                username: device.username,
                password: device.password
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connected = true;
                session.connecting = false;
                session.connectedAt = Date.now();
                session.sftpOpen = true;  // 自动打开文件面板
                session.sftpCurrentPath = '/';
                session.terminal.write('\x1b[32mFTP 连接并登录成功!\x1b[0m\r\n\x1b[32m正在自动加载可视化文件管理器...\x1b[0m\r\n');
                
                updateTabs();
                updateTerminalStatus();
                updateTerminalDeviceSelect();
                renderDeviceList();
                showToast('FTP 连接成功', 'success');
                addToConnectionHistory(device, protocol);
                
                // 自动滑出可视化 FTP 文件管理器面板
                initSftpClient();
                const sftpPanel = document.getElementById('sftp-panel');
                if (sftpPanel) sftpPanel.classList.remove('hidden');
                setTimeout(() => {
                    loadSftpDirectory(session, '/');
                }, 500);
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31mFTP 连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('FTP 连接失败: ' + result.error, 'error');
            }
        } else {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 22} (SSH)...\r\n`);
            result = await window.api.ssh.connect({
                host: device.host,
                port: device.port || 22,
                username: device.username,
                password: device.password,
                privateKey: device.privateKey
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.terminal.write('\x1b[32m连接成功!\x1b[0m\r\n');
                
                const terminalSize = getSessionTerminalSize(session);
                const shellResult = await window.api.ssh.shell(
                    result.connectionId,
                    terminalSize.cols,
                    terminalSize.rows
                );
                if (shellResult.success) {
                    session.connected = true;
                    session.connecting = false;
                    session.connectedAt = Date.now();
                    
                    if ((device.type === 'cisco' || device.type === 'ruijie') && device.enablePassword) {
                        session.autoEnable = {
                            enabled: true,
                            password: device.enablePassword,
                            state: 'waiting',
                            attempts: 0
                        };
                    }
                    
                    updateTabs();
                    updateTerminalStatus();
                    updateTerminalDeviceSelect();
                    renderDeviceList();
                    showToast('连接成功', 'success');
                    session.terminal.focus();
                } else {
                    session.connecting = false;
                    session.terminal.write(`\x1b[31m创建Shell失败: ${shellResult.error}\x1b[0m\r\n`);
                    updateTabs();
                }
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('连接失败: ' + result.error, 'error');
            }
        }
    } catch (error) {
        session.connecting = false;
        session.terminal.write(`\x1b[31m错误: ${error.message}\x1b[0m\r\n`);
        updateTabs();
        showToast('连接错误', 'error');
    }
}

/**
 * 处理连接
 */
async function handleConnect() {
    const deviceId = document.getElementById('terminal-device-select').value;
    if (!deviceId) {
        showToast('请选择设备', 'warning');
        return;
    }
    
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) {
        showToast('设备不存在', 'error');
        return;
    }
    
    const protocol = device.protocol || 'ssh';
    const connectionType = protocol === 'console' ? 'serial' : (protocol === 'telnet' ? 'telnet' : (protocol === 'ftp' ? 'ftp' : 'ssh'));
    const session = createSession(deviceId, device.name, connectionType);
    session.deviceType = device.type || 'default';
    session.encoding = device.encoding || 'utf-8';
    session.deviceConfig = { ...device }; // 保存设备配置用于重新连接
    session.connecting = true;
    state.sessions.set(session.id, session);
    state.activeSessionId = session.id;
    
    hideAllTerminals();
    createTerminalInstance(session);
    showTerminalContainer();
    updateTabs();
    showToast(`正在连接 ${device.name}...`, 'info');
    
    try {
        let result;
        
        if (protocol === 'console') {
            session.terminal.write(`正在连接串口 ${device.comPort}...\r\n`);
            result = await window.api.serial.connect(buildSerialConnectConfig(device, session));
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connected = true;
                session.connecting = false;
                session.connectedAt = Date.now();
                session.terminal.write('\x1b[32m串口连接成功!\x1b[0m\r\n\r\n');
                updateTabs();
                updateTerminalStatus();
                updateTerminalDeviceSelect();
                renderDeviceList();
                showToast('串口连接成功', 'success');
                if (window.addRuntimeLog) addRuntimeLog('success', '串口连接成功', device.name + ' (' + device.comPort + ')');
                session.terminal.focus();
                addToConnectionHistory(device, protocol);
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m串口连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('串口连接失败: ' + result.error, 'error');
                if (window.addRuntimeLog) addRuntimeLog('error', '串口连接失败', device.name, result.error);
            }
        } else if (protocol === 'telnet') {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 23} (Telnet)...\r\n`);
            const terminalSize = getSessionTerminalSize(session);
            result = await window.api.telnet.connect({
                host: device.host,
                port: device.port || 23,
                cols: terminalSize.cols,
                rows: terminalSize.rows
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connecting = false;
                session.loggingIn = true;
                session.terminal.write('\x1b[32mTCP 连接成功, 等待登录中...\x1b[0m\r');
                
                // 设置 Telnet 自动登录和提示符检测
                // H3C-AP 类型只需密码，不需要用户名
                const isPasswordOnly = device.type === 'h3c-ap';
                session.telnetAutoLogin = {
                    username: device.username || '',
                    password: device.password || '',
                    usernameSet: isPasswordOnly,  // H3C-AP 跳过用户名步骤
                    passwordSent: false,
                    loginComplete: false,
                    passwordOnly: isPasswordOnly,  // H3C-AP 专用标志
                    initialCRSent: false  // Ruijie 设备用：是否已发送初始回车
                };
                
                // Ruijie 设备特殊处理：连接后延迟发送回车触发登录提示
                if (device.type === 'ruijie') {
                    setTimeout(() => {
                        if (session.loggingIn && !session.telnetAutoLogin.usernameSet) {
                            window.api.telnet.write(session.connectionId, '\r\n');
                            session.telnetAutoLogin.initialCRSent = true;
                        }
                    }, 800);
                }
                session.deviceForHistory = device;
                session.protocolForHistory = protocol;
                
                // Cisco/Ruijie 设备自动 enable 模式配置
                if ((device.type === 'cisco' || device.type === 'ruijie') && device.enablePassword) {
                    session.autoEnable = {
                        enabled: true,
                        password: device.enablePassword,
                        state: 'waiting',
                        attempts: 0
                    };
                }
                
                updateTabs();
                updateTerminalStatus();
                session.terminal.focus();
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31mTelnet 连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('Telnet 连接失败: ' + result.error, 'error');
                if (window.addRuntimeLog) addRuntimeLog('error', 'Telnet 连接失败', device.name + ' (' + device.host + ')', result.error);
            }
        } else if (protocol === 'ftp') {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 21} (FTP)...\r\n`);
            result = await window.api.ftp.connect({
                host: device.host,
                port: device.port || 21,
                username: device.username,
                password: device.password
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connected = true;
                session.connecting = false;
                session.connectedAt = Date.now();
                session.sftpOpen = true;  // 自动打开文件面板
                session.sftpCurrentPath = '/';
                session.terminal.write('\x1b[32mFTP 连接并登录成功!\x1b[0m\r\n\x1b[32m正在自动加载可视化文件管理器...\x1b[0m\r\n');
                
                updateTabs();
                updateTerminalStatus();
                updateTerminalDeviceSelect();
                renderDeviceList();
                showToast('FTP 连接成功', 'success');
                if (window.addRuntimeLog) addRuntimeLog('success', 'FTP 连接成功', device.name + ' (' + device.host + ')');
                addToConnectionHistory(device, protocol);
                
                // 自动滑出可视化 FTP 文件管理器面板
                initSftpClient();
                const sftpPanel = document.getElementById('sftp-panel');
                if (sftpPanel) sftpPanel.classList.remove('hidden');
                loadSftpDirectory(session, '/');
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31mFTP 连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('FTP 连接失败: ' + result.error, 'error');
                if (window.addRuntimeLog) addRuntimeLog('error', 'FTP 连接失败', device.name, result.error);
            }
        } else {
            session.terminal.write(`正在连接 ${device.host}:${device.port || 22} (SSH)...\r\n`);
            result = await window.api.ssh.connect({
                host: device.host,
                port: device.port || 22,
                username: device.username,
                password: device.password,
                privateKey: device.privateKey
            });
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.terminal.write('\x1b[32m连接成功!\x1b[0m\r\n');
                
                const terminalSize = getSessionTerminalSize(session);
                const shellResult = await window.api.ssh.shell(
                    result.connectionId,
                    terminalSize.cols,
                    terminalSize.rows
                );
                if (shellResult.success) {
                    session.connected = true;
                    session.connecting = false;
                    session.connectedAt = Date.now();
                    
                    // Cisco/Ruijie 设备自动 enable 模式配置
                    if ((device.type === 'cisco' || device.type === 'ruijie') && device.enablePassword) {
                        session.autoEnable = {
                            enabled: true,
                            password: device.enablePassword,
                            state: 'waiting',  // waiting -> sent_enable -> sent_password -> done
                            attempts: 0
                        };
                    }
                    
                    updateTabs();
                    updateTerminalStatus();
                    updateTerminalDeviceSelect();
                    renderDeviceList();
                    showToast('连接成功', 'success');
                    if (window.addRuntimeLog) addRuntimeLog('success', 'SSH 连接成功', device.name + ' (' + device.host + ')');
                    session.terminal.focus();
                    addToConnectionHistory(device, protocol);
                } else {
                    session.connecting = false;
                    session.terminal.write(`\x1b[31m创建Shell失败: ${shellResult.error}\x1b[0m\r\n`);
                    updateTabs();
                }
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('连接失败: ' + result.error, 'error');
                if (window.addRuntimeLog) addRuntimeLog('error', 'SSH 连接失败', device.name + ' (' + device.host + ')', result.error);
            }
        }
    } catch (error) {
        session.connecting = false;
        session.terminal.write(`\x1b[31m错误: ${error.message}\x1b[0m\r\n`);
        updateTabs();
        showToast('连接错误', 'error');
        if (window.addRuntimeLog) addRuntimeLog('error', '连接错误', device.name, error.message);
    }
}

/**
 * 处理断开连接
 */
async function handleDisconnect() {
    const session = getActiveSession();
    if (session && session.connectionId) {
        if (session.connectionType === 'serial') {
            await window.api.serial.disconnect(session.connectionId);
        } else if (session.connectionType === 'telnet') {
            await window.api.telnet.disconnect(session.connectionId);
        } else if (session.connectionType === 'ftp') {
            await window.api.ftp.disconnect(session.connectionId);
        } else {
            await window.api.ssh.disconnect(session.connectionId);
        }
        session.connected = false;
        session.connectionId = null;
        session.terminalWriteController?.refreshFlowControl();
        if (session.terminal) session.terminal.write('\r\n\x1b[33m--- 已断开连接 ---\x1b[0m\r\n');
        updateTabs();
        updateTerminalStatus();
        updateTerminalDeviceSelect();
        renderDeviceList();
        showToast('已断开连接', 'info');
    }
}

// ==================== 终端容器 ====================

/**
 * 隐藏所有终端
 */
function hideAllTerminals() {
    for (const session of state.sessions.values()) {
        setTerminalSessionActive(session, false);
    }
}

/**
 * 显示终端容器
 */
function showTerminalContainer() {
    document.getElementById('terminal-container').classList.add('active');
    document.getElementById('terminal-welcome').classList.add('hidden');

    const session = getActiveSession();
    if (session) {
        setTerminalSessionActive(session, true);
        fitTerminalSession(session);
    }
}

/**
 * 隐藏终端容器
 */
function hideTerminalContainer() {
    document.getElementById('terminal-container').classList.remove('active');
    document.getElementById('terminal-welcome').classList.remove('hidden');
}

/**
 * 清空当前终端
 */
function clearActiveTerminal() {
    const session = getActiveSession();
    if (session && session.terminal) session.terminal.clear();
}
