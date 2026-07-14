/**
 * 设备连接模块
 * @module devices/connect
 */

// ==================== 连接操作 ====================

/**
 * 从设备卡片连接 - 调用终端模块的公共连接函数
 */
async function connectToDevice(id) {
    // 切换到终端页面
    document.querySelector('.nav-item[data-page="terminal"]').click();
    
    // 设置设备选择框并触发连接
    const hiddenInput = document.getElementById('terminal-device-select');
    if (hiddenInput) {
        hiddenInput.value = id;
        // 调用终端模块的连接函数
        if (typeof handleConnect === 'function') {
            await handleConnect();
        }
    }
}

/**
 * 从设备卡片断开
 */
async function disconnectDevice(id) {
    for (const [sessionId, session] of state.sessions) {
        if (session.deviceId === id && session.connectionId) {
            if (session.connectionType === 'serial') {
                await window.api.serial.disconnect(session.connectionId);
            } else if (session.connectionType === 'telnet') {
                await window.api.telnet.disconnect(session.connectionId);
            } else {
                await window.api.ssh.disconnect(session.connectionId);
            }
            session.connected = false;
            session.connectionId = null;
            if (session.terminal) {
                session.terminal.write('\r\n\x1b[33m--- 已断开连接 ---\x1b[0m\r\n');
            }
        }
    }
    
    updateTabs();
    updateTerminalStatus();
    renderDeviceList();
    showToast('已断开连接', 'info');
}

// 暴露全局函数
window.connectToDevice = connectToDevice;
window.disconnectDevice = disconnectDevice;
