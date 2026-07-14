/**
 * 终端标签页模块
 * @module terminal/tabs
 */

// ==================== 标签页管理 ====================

/**
 * 格式化连接时长
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的时长
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * 更新连接时长显示
 */
function updateConnectionDurations() {
    state.sessions.forEach(session => {
        if (session.connected && session.connectedAt) {
            const duration = Date.now() - session.connectedAt;
            const durationEl = document.querySelector(`.terminal-tab[data-session-id="${session.id}"] .terminal-tab-duration`);
            if (durationEl) {
                durationEl.textContent = formatDuration(duration);
            }
        }
    });
}

/**
 * 更新标签页
 */
function updateTabs() {
    const container = document.getElementById('terminal-tabs');
    
    if (state.sessions.size === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = Array.from(state.sessions.values()).map(session => {
        const deviceType = session.deviceType || 'default';
        const iconPath = getDeviceIconPath(deviceType);
        const duration = session.connected && session.connectedAt 
            ? formatDuration(Date.now() - session.connectedAt) 
            : '';
        
        // 状态类名
        let statusClass = '';
        if (session.connecting) {
            statusClass = 'connecting';
        } else if (session.loggingIn) {
            statusClass = 'logging-in';
        } else if (session.connected) {
            statusClass = 'connected';
        }
        
        return `
            <div class="terminal-tab ${session.id === state.activeSessionId ? 'active' : ''}" 
                 data-session-id="${session.id}" draggable="true" onclick="switchTab('${session.id}')">
                <span class="terminal-tab-icon ${deviceType}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">${iconPath}</svg>
                </span>
                <span class="terminal-tab-status ${statusClass}"></span>
                <span class="terminal-tab-name">${escapeHtml(session.deviceName)}</span>
                ${session.connected ? `<span class="terminal-tab-duration">${duration}</span>` : ''}
                <span class="terminal-tab-close" onclick="event.stopPropagation(); closeTab('${session.id}')">&times;</span>
            </div>
        `;
    }).join('');
    
    initTabDragDrop();
    updateSftpVisibility();
}

/**
 * 初始化标签页拖拽和右键菜单
 */
function initTabDragDrop() {
    const container = document.getElementById('terminal-tabs');
    const tabs = container.querySelectorAll('.terminal-tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tab.dataset.sessionId);
            tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = container.querySelector('.dragging');
            if (dragging && dragging !== tab) {
                const rect = tab.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.clientX < midX) {
                    tab.parentNode.insertBefore(dragging, tab);
                } else {
                    tab.parentNode.insertBefore(dragging, tab.nextSibling);
                }
            }
        });
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            reorderSessions();
        });
        // 标签页右键菜单
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTabContextMenu(e.clientX, e.clientY, tab.dataset.sessionId);
        });
    });
}

// 当前右键菜单对应的会话ID
let tabContextSessionId = null;

/**
 * 显示标签页右键菜单
 */
function showTabContextMenu(x, y, sessionId) {
    const menu = document.getElementById('tab-context-menu');
    tabContextSessionId = sessionId;
    
    const menuWidth = 160, menuHeight = 150;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');
    
    // 检查会话状态，决定是否启用重新连接
    const session = state.sessions.get(sessionId);
    const reconnectItem = menu.querySelector('[data-action="reconnect"]');
    if (session && session.connected) {
        reconnectItem.style.opacity = '0.5';
        reconnectItem.style.pointerEvents = 'none';
    } else {
        reconnectItem.style.opacity = '1';
        reconnectItem.style.pointerEvents = 'auto';
    }
}

/**
 * 隐藏标签页右键菜单
 */
function hideTabContextMenu() {
    document.getElementById('tab-context-menu').classList.remove('show');
}

/**
 * 初始化标签页右键菜单事件
 */
function initTabContextMenu() {
    const menu = document.getElementById('tab-context-menu');
    
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;
            
            switch (action) {
                case 'reconnect':
                    await reconnectSession(tabContextSessionId);
                    break;
                case 'close':
                    await closeTab(tabContextSessionId);
                    break;
                case 'closeOthers':
                    await closeOtherTabs(tabContextSessionId);
                    break;
                case 'closeAll':
                    await closeAllTabs();
                    break;
            }
            hideTabContextMenu();
        });
    });
    
    document.addEventListener('click', hideTabContextMenu);
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#tab-context-menu') && !e.target.closest('.terminal-tab')) {
            hideTabContextMenu();
        }
    });
}

/**
 * 重新连接会话
 */
async function reconnectSession(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    
    // 如果已连接，不重新连接
    if (session.connected) {
        showToast('当前会话已连接', 'info');
        return;
    }
    
    // 检查是否有保存的设备信息
    if (!session.deviceConfig) {
        showToast('无法重新连接：缺少设备信息', 'warning');
        return;
    }
    
    const device = session.deviceConfig;
    const protocol = device.protocol || 'ssh';
    
    // 切换到该标签页
    switchTab(sessionId);
    
    session.connecting = true;
    updateTabs();
    session.terminal.write('\r\n\x1b[33m正在重新连接...\x1b[0m\r\n');
    
    try {
        let result;
        
        if (protocol === 'telnet') {
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
            }
        } else if (protocol === 'console') {
            result = await window.api.serial.connect(buildSerialConnectConfig(device, session));
            
            if (result.success) {
                session.connectionId = result.connectionId;
                session.terminalWriteController?.refreshFlowControl();
                session.connected = true;
                session.connecting = false;
                session.connectedAt = Date.now();
                session.terminal.write('\x1b[32m串口重新连接成功!\x1b[0m\r\n');
                updateTabs();
                updateTerminalStatus();
                renderDeviceList();
                showToast('串口重新连接成功', 'success');
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m重新连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('重新连接失败: ' + result.error, 'error');
            }
        } else if (protocol === 'ftp') {
            session.terminal.write(`正在重新连接 ${device.host}:${device.port || 21} (FTP)...\r\n`);
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
                session.terminal.write('\x1b[32mFTP 重新连接并登录成功!\x1b[0m\r\n\x1b[32m正在自动加载可视化文件管理器...\x1b[0m\r\n');
                
                updateTabs();
                updateTerminalStatus();
                renderDeviceList();
                showToast('重新连接成功', 'success');
                
                // 自动滑出可视化 FTP 文件管理器面板
                initSftpClient();
                const sftpPanel = document.getElementById('sftp-panel');
                if (sftpPanel) sftpPanel.classList.remove('hidden');
                setTimeout(() => {
                    loadSftpDirectory(session, '/');
                }, 500);
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m重新连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('重新连接失败: ' + result.error, 'error');
            }
        } else {
            // SSH
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
                    renderDeviceList();
                    showToast('重新连接成功', 'success');
                } else {
                    session.connecting = false;
                    session.terminal.write(`\x1b[31m创建Shell失败: ${shellResult.error}\x1b[0m\r\n`);
                    updateTabs();
                }
            } else {
                session.connecting = false;
                session.terminal.write(`\x1b[31m重新连接失败: ${result.error}\x1b[0m\r\n`);
                updateTabs();
                showToast('重新连接失败: ' + result.error, 'error');
            }
        }
    } catch (error) {
        session.connecting = false;
        session.terminal.write(`\x1b[31m错误: ${error.message}\x1b[0m\r\n`);
        updateTabs();
        showToast('重新连接错误', 'error');
    }
}

/**
 * 关闭其他标签页
 */
async function closeOtherTabs(keepSessionId) {
    const sessionIds = Array.from(state.sessions.keys()).filter(id => id !== keepSessionId);
    for (const id of sessionIds) {
        await closeTab(id);
    }
}

/**
 * 关闭全部标签页
 */
async function closeAllTabs() {
    const sessionIds = Array.from(state.sessions.keys());
    for (const id of sessionIds) {
        await closeTab(id);
    }
}

/**
 * 重新排序会话
 */
function reorderSessions() {
    const container = document.getElementById('terminal-tabs');
    const tabs = container.querySelectorAll('.terminal-tab');
    const newSessions = new Map();
    
    tabs.forEach(tab => {
        const sessionId = tab.dataset.sessionId;
        if (state.sessions.has(sessionId)) {
            newSessions.set(sessionId, state.sessions.get(sessionId));
        }
    });
    
    state.sessions = newSessions;
}

/**
 * 切换标签页
 * @param {string} sessionId - 会话ID
 */
function switchTab(sessionId) {
    if (!state.sessions.has(sessionId)) return;
    state.activeSessionId = sessionId;
    
    if (searchState.isOpen) hideSearchBar();
    
    hideAllTerminals();
    const session = getActiveSession();
    if (session && session.terminal) {
        setTerminalSessionActive(session, true);
        session.terminal.focus();
        fitTerminalSession(session);
    }
    
    // 更新 AI 接管指示光晕
    const termContainer = document.getElementById('terminal-container');
    if (termContainer) {
        if (session && session.aiTakeover) {
            termContainer.classList.add('ai-takeover-active');
        } else {
            termContainer.classList.remove('ai-takeover-active');
        }
    }
    
    updateTabs();
    updateTerminalStatus();
    updateLoggingButton();
    updateSftpVisibility();
}

/**
 * 关闭标签页
 * @param {string} sessionId - 会话ID
 */
async function closeTab(sessionId) {
    const session = state.sessions.get(sessionId);
    if (!session) return;
    
    if (session.logging) await stopLogging(session);
    
    if (session.remoteResizeTimer) {
        clearTimeout(session.remoteResizeTimer);
    }
    
    if (session.connectionId) {
        if (session.connectionType === 'serial') {
            await window.api.serial.disconnect(session.connectionId);
        } else if (session.connectionType === 'telnet') {
            await window.api.telnet.disconnect(session.connectionId);
        } else if (session.connectionType === 'ftp') {
            await window.api.ftp.disconnect(session.connectionId);
        } else {
            await window.api.ssh.disconnect(session.connectionId);
        }
    }
    
    // 如果存在 Telnet 伴生的 FTP 后台连接，进行释放销毁
    if (session.ftpConnectionId) {
        await window.api.ftp.disconnect(session.ftpConnectionId);
    }
    if (session.terminalRendererController) session.terminalRendererController.dispose();
    
    if (session.terminalWriteController) session.terminalWriteController.dispose();
    if (session.terminal) session.terminal.dispose();
    state.sessions.delete(sessionId);
    
    if (state.activeSessionId === sessionId) {
        const remaining = Array.from(state.sessions.keys());
        state.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    
    if (state.activeSessionId) {
        const activeSession = getActiveSession();
        if (activeSession && activeSession.terminal) {
            hideAllTerminals();
            setTerminalSessionActive(activeSession, true);
            activeSession.terminal.focus();
            fitTerminalSession(activeSession);
        }
        
        // 更新 AI 接管指示光晕
        const termContainer = document.getElementById('terminal-container');
        if (termContainer) {
            if (activeSession && activeSession.aiTakeover) {
                termContainer.classList.add('ai-takeover-active');
            } else {
                termContainer.classList.remove('ai-takeover-active');
            }
        }
    } else {
        hideTerminalContainer();
        // 清理 AI 接管光晕
        const termContainer = document.getElementById('terminal-container');
        if (termContainer) termContainer.classList.remove('ai-takeover-active');
    }
    
    updateTabs();
    updateTerminalStatus();
    updateLoggingButton();
    renderDeviceList();
    updateSftpVisibility();
}

/**
 * 更新终端状态栏
 */
function updateTerminalStatus() {
    const status = document.getElementById('terminal-status');
    const session = getActiveSession();
    const encodingWrapper = document.getElementById('terminal-encoding-wrapper');
    const encodingSelect = document.getElementById('select-terminal-encoding');
    
    document.getElementById('btn-disconnect').disabled = !session || !session.connected;
    
    if (session) {
        if (session.connected) {
            status.textContent = `已连接 - ${session.deviceName}`;
            status.classList.add('connected');
            if (encodingWrapper) encodingWrapper.style.display = 'inline-flex';
            if (encodingSelect) encodingSelect.value = session.encoding || 'utf-8';
        } else {
            status.textContent = `已断开 - ${session.deviceName}`;
            status.classList.remove('connected');
            if (encodingWrapper) encodingWrapper.style.display = 'none';
        }
    } else {
        status.textContent = '无活动会话';
        status.classList.remove('connected');
        if (encodingWrapper) encodingWrapper.style.display = 'none';
    }
}
/**
 * 更新文件传输与AI诊断区域的可见性及控制按钮状态
 */
function updateSftpVisibility() {
    const session = getActiveSession();
    const sftpToggleBtn = document.getElementById('btn-toggle-sftp');
    const ftpToggleBtn = document.getElementById('btn-toggle-ftp');
    const sftpPanel = document.getElementById('sftp-panel');
    const aiDiagnoseBtn = document.getElementById('btn-terminal-ai-diagnose');
    
    if (session && session.connected) {
        if (aiDiagnoseBtn) {
            aiDiagnoseBtn.style.display = 'inline-flex';
        }
        if (session.connectionType === 'ssh') {
            // SSH 会话同时显式提供 SFTP 和 FTP 两个文件管理通道按钮
            if (sftpToggleBtn) sftpToggleBtn.style.display = 'inline-flex';
            if (ftpToggleBtn) ftpToggleBtn.style.display = 'inline-flex';
        } else if (session.connectionType === 'ftp' || session.connectionType === 'telnet') {
            // FTP 或 Telnet 伴生会话只显式提供 FTP 通道按钮
            if (sftpToggleBtn) sftpToggleBtn.style.display = 'none';
            if (ftpToggleBtn) ftpToggleBtn.style.display = 'inline-flex';
        } else {
            if (sftpToggleBtn) sftpToggleBtn.style.display = 'none';
            if (ftpToggleBtn) ftpToggleBtn.style.display = 'none';
        }
        
        if (session.sftpOpen) {
            if (sftpPanel) sftpPanel.classList.remove('hidden');
            if (session.sftpCurrentPath) {
                renderSftpFiles(session);
            } else {
                const defaultPath = (session.connectionType === 'ftp' || session.connectionType === 'telnet' || session.useFtpFallback) ? '/' : '.';
                loadSftpDirectory(session, defaultPath);
            }
        } else {
            if (sftpPanel) sftpPanel.classList.add('hidden');
        }
    } else {
        if (aiDiagnoseBtn) {
            aiDiagnoseBtn.style.display = 'none';
        }
        if (sftpToggleBtn) sftpToggleBtn.style.display = 'none';
        if (ftpToggleBtn) ftpToggleBtn.style.display = 'none';
        if (sftpPanel) sftpPanel.classList.add('hidden');
    }
}

// 暴露全局函数
window.switchTab = switchTab;
window.closeTab = closeTab;
window.updateSftpVisibility = updateSftpVisibility;
