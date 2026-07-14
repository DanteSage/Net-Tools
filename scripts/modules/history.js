/**
 * 连接历史模块
 * @module history
 */

/**
 * 加载连接历史
 */
async function loadConnectionHistory() {
    try {
        state.connectionHistory = await window.api.history.getAll();
        updateHistoryList();
    } catch (e) {
        console.error('加载连接历史失败:', e);
    }
}

/**
 * 获取设备类型图标
 */
function getDeviceTypeIcon(deviceType) {
    const icons = {
        router: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
        switch: '<path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 7h2v2H5V7zm0 4h2v2H5v-2zm0 4h2v2H5v-2zm14 2H9v-2h10v2zm0-4H9v-2h10v2zm0-4H9V7h10v2z"/>',
        firewall: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
        server: '<path d="M4 1h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V3c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm1-12v2h2V5H5zm0 8v2h2v-2H5zm0 8v2h2v-2H5z"/>',
        default: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>'
    };
    return icons[deviceType] || icons.default;
}

/**
 * 更新历史列表
 */
function updateHistoryList() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    const header = document.getElementById('history-header');
    if (!list || !empty) return;
    
    list.innerHTML = '';
    
    if (state.connectionHistory.length === 0) {
        list.style.display = 'none';
        empty.style.display = 'flex';
        if (header) header.style.display = 'none';
        return;
    }
    
    list.style.display = 'block';
    empty.style.display = 'none';
    if (header) header.style.display = 'flex';
    
    state.connectionHistory.forEach(record => {
        const time = new Date(record.timestamp).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // 查找设备获取类型
        const device = state.devices.find(d => d.id === record.deviceId);
        const deviceType = device?.type || 'default';
        const iconPath = getDeviceTypeIcon(deviceType);
        
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.deviceId = record.deviceId;
        item.dataset.protocol = record.protocol;
        item.innerHTML = `
            <div class="history-item-icon ${deviceType}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    ${iconPath}
                </svg>
            </div>
            <div class="history-item-info">
                <div class="history-item-name">${escapeHtml(record.deviceName)}</div>
                <div class="history-item-meta">
                    <span class="history-item-protocol ${record.protocol}">${record.protocol.toUpperCase()}</span>
                    <span>${record.host || ''}</span>
                    <span>${time}</span>
                </div>
            </div>
            <button class="history-item-delete" title="删除此记录">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;
        
        // 点击连接
        item.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-delete')) return;
            connectFromHistory(record.deviceId);
            closeHistoryDropdown();
        });
        
        // 删除按钮
        item.querySelector('.history-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteHistoryItem(record.deviceId, record.timestamp);
        });
        
        list.appendChild(item);
    });
}

/**
 * 删除单条历史记录
 */
async function deleteHistoryItem(deviceId, timestamp) {
    try {
        await window.api.history.delete(deviceId, timestamp);
        await loadConnectionHistory();
        showToast('已删除记录', 'success');
    } catch (e) {
        console.error('删除历史记录失败:', e);
        showToast('删除失败', 'error');
    }
}

/**
 * 清空所有历史记录
 */
async function clearAllHistory() {
    try {
        await window.api.history.clear();
        await loadConnectionHistory();
        showToast('已清空历史记录', 'success');
    } catch (e) {
        console.error('清空历史记录失败:', e);
        showToast('清空失败', 'error');
    }
}

/**
 * 初始化历史下拉菜单
 */
function initHistoryDropdown() {
    const trigger = document.getElementById('history-trigger');
    const dropdown = trigger?.closest('.history-dropdown');
    const clearBtn = document.getElementById('btn-clear-history');
    
    if (!trigger || !dropdown) return;
    
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });
    
    // 清空按钮
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAllHistory();
        });
    }
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
}

/**
 * 关闭历史下拉菜单
 */
function closeHistoryDropdown() {
    const dropdown = document.querySelector('.history-dropdown');
    if (dropdown) dropdown.classList.remove('open');
}

/**
 * 添加到连接历史
 */
async function addToConnectionHistory(device, protocol) {
    try {
        await window.api.history.add({
            deviceId: device.id,
            deviceName: device.name,
            protocol: protocol,
            host: device.host,
            port: device.port
        });
        await loadConnectionHistory();
    } catch (e) {
        console.error('添加连接历史失败:', e);
    }
}

/**
 * 从历史快速连接
 */
async function connectFromHistory(deviceId) {
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) {
        showToast('设备不存在，可能已被删除', 'warning');
        return;
    }
    
    document.getElementById('terminal-device-select').value = deviceId;
    handleConnect();
}
