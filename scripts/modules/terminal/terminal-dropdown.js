/**
 * 终端设备下拉菜单模块
 * @module terminal/dropdown
 */

// ==================== 设备图标 ====================

/**
 * 获取设备类型图标路径
 * @param {string} deviceType - 设备类型
 * @returns {string} SVG path
 */
function getDeviceIconPath(deviceType) {
    const icons = {
        router: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
        switch: '<path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 7h2v2H5V7zm0 4h2v2H5v-2zm0 4h2v2H5v-2zm14 2H9v-2h10v2zm0-4H9v-2h10v2zm0-4H9V7h10v2z"/>',
        firewall: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
        server: '<path d="M4 1h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V3c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm1-12v2h2V5H5zm0 8v2h2v-2H5zm0 8v2h2v-2H5z"/>',
        default: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>'
    };
    return icons[deviceType] || icons.default;
}

// ==================== 设备选择框 ====================

/**
 * 更新终端设备选择框
 */
async function updateTerminalDeviceSelect() {
    const hiddenInput = document.getElementById('terminal-device-select');
    const list = document.getElementById('device-dropdown-list');
    const empty = document.getElementById('device-dropdown-empty');
    const trigger = document.getElementById('device-dropdown-trigger');
    
    if (!list || !hiddenInput) return;
    
    const devices = await window.api.devices.getAll();
    
    // 获取在线设备列表
    const onlineDeviceIds = new Set();
    for (const session of state.sessions.values()) {
        if (session.connected && session.deviceId) {
            onlineDeviceIds.add(session.deviceId);
        }
    }
    
    // 排序：收藏 > 在线 > 其他
    const sortedDevices = [...devices].sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        const aOnline = onlineDeviceIds.has(a.id);
        const bOnline = onlineDeviceIds.has(b.id);
        if (aOnline && !bOnline) return -1;
        if (!aOnline && bOnline) return 1;
        return 0;
    });
    
    // 保存设备数据
    state.terminalDevices = sortedDevices;
    
    // 渲染列表
    renderDeviceDropdownList(sortedDevices, onlineDeviceIds);
    
    // 更新显示文本
    if (hiddenInput.value) {
        const selected = devices.find(d => d.id === hiddenInput.value);
        if (selected) {
            const textEl = trigger.querySelector('.device-dropdown-text');
            if (textEl) textEl.textContent = selected.name;
        }
    }
}

/**
 * 渲染设备下拉列表
 * @param {Array} devices - 设备列表
 * @param {Set} onlineDeviceIds - 在线设备ID集合
 */
function renderDeviceDropdownList(devices, onlineDeviceIds) {
    const list = document.getElementById('device-dropdown-list');
    const empty = document.getElementById('device-dropdown-empty');
    const hiddenInput = document.getElementById('terminal-device-select');
    
    if (!list) return;
    
    list.innerHTML = '';
    
    if (devices.length === 0) {
        list.style.display = 'none';
        if (empty) empty.style.display = 'block';
        return;
    }
    
    list.style.display = 'block';
    if (empty) empty.style.display = 'none';
    
    devices.forEach(d => {
        const protocol = d.protocol || 'ssh';
        const address = protocol === 'console' ? d.comPort : d.host;
        const isOnline = onlineDeviceIds?.has(d.id);
        const deviceType = d.type || 'default';
        const iconPath = getDeviceIconPath(deviceType);
        const isSelected = hiddenInput.value === d.id;
        
        const item = document.createElement('div');
        item.className = 'device-dropdown-item' + (isSelected ? ' selected' : '');
        item.dataset.id = d.id;
        item.dataset.name = d.name;
        item.innerHTML = `
            <div class="device-dropdown-item-icon ${deviceType}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">${iconPath}</svg>
            </div>
            <div class="device-dropdown-item-info">
                <div class="device-dropdown-item-name">
                    ${isOnline ? '<span class="online-dot"></span>' : ''}
                    ${d.favorite ? '<span class="star">★</span>' : ''}
                    <span>${escapeHtml(d.name)}</span>
                </div>
                <div class="device-dropdown-item-meta">
                    <span class="device-dropdown-item-protocol ${protocol}">${protocol.toUpperCase()}</span>
                    <span>${address || ''}</span>
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => selectDevice(d.id, d.name));
        list.appendChild(item);
    });
}

/**
 * 选择设备
 * @param {string} deviceId - 设备ID
 * @param {string} deviceName - 设备名称
 */
function selectDevice(deviceId, deviceName) {
    const hiddenInput = document.getElementById('terminal-device-select');
    const trigger = document.getElementById('device-dropdown-trigger');
    const dropdown = document.getElementById('device-dropdown');
    
    hiddenInput.value = deviceId;
    trigger.querySelector('.device-dropdown-text').textContent = deviceName;
    dropdown.classList.remove('open');
    
    // 更新选中状态
    document.querySelectorAll('.device-dropdown-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === deviceId);
    });
}

/**
 * 初始化设备下拉菜单
 */
function initDeviceDropdown() {
    const dropdown = document.getElementById('device-dropdown');
    const trigger = document.getElementById('device-dropdown-trigger');
    
    if (!dropdown || !trigger) return;
    
    // 点击触发器
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
}
