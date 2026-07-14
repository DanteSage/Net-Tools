/**
 * 设备数据加载与管理
 * @module devices/data
 */

// ==================== 数据加载 ====================

/**
 * 加载设备列表
 */
async function loadDevices() {
    try {
        // 先加载分组列表
        await loadGroups();
        
        const devices = await window.api.devices.getAll();
        for (const device of devices) {
            if (device._encrypted && device.password) {
                try {
                    const result = await window.api.crypto.decrypt(device.password);
                    if (result.success) device.password = result.data;
                } catch (e) {
                    console.error('解密密码失败:', e);
                }
            }
            if (device._enableEncrypted && device.enablePassword) {
                try {
                    const result = await window.api.crypto.decrypt(device.enablePassword);
                    if (result.success) device.enablePassword = result.data;
                } catch (e) {
                    console.error('解密Enable密码失败:', e);
                }
            }
        }
        state.devices = devices;
        
        // 确保设备中的分组也在分组列表中
        mergeDeviceGroups();
        updateGroupFilter();
        
        renderDeviceList();
        updateDeviceStats();

        // 批量执行页面的分组下拉刷新
        if (typeof renderBatchGroupSelect === 'function') {
            renderBatchGroupSelect();
        }
    } catch (error) {
        console.error('加载设备失败:', error);
        showToast('加载设备失败', 'error');
    }
}

/**
 * 加载分组列表
 */
async function loadGroups() {
    try {
        const groups = await window.api.groups.getAll();
        const defaultGroup = deviceState.defaultGroup;
        
        // 确保默认分组存在
        if (!groups.includes(defaultGroup)) {
            groups.unshift(defaultGroup);
        }
        
        deviceState.groups = groups;
    } catch (error) {
        console.error('加载分组失败:', error);
        // 加载失败时使用默认分组
        deviceState.groups = [deviceState.defaultGroup];
    }
}

/**
 * 保存分组列表
 */
async function saveGroups() {
    try {
        await window.api.groups.save(deviceState.groups);
    } catch (error) {
        console.error('保存分组失败:', error);
    }
}

/**
 * 合并设备中的分组到分组列表
 */
function mergeDeviceGroups() {
    const defaultGroup = deviceState.defaultGroup;
    
    // 从设备中提取分组
    state.devices.forEach(device => {
        if (device.group && device.group.trim() && !deviceState.groups.includes(device.group.trim())) {
            deviceState.groups.push(device.group.trim());
        }
    });
    
    // 排序，但保持默认分组在最前面
    deviceState.groups.sort();
    const idx = deviceState.groups.indexOf(defaultGroup);
    if (idx > 0) {
        deviceState.groups.splice(idx, 1);
        deviceState.groups.unshift(defaultGroup);
    }
}

/**
 * 更新分组筛选下拉框
 */
function updateGroupFilter() {
    const select = document.getElementById('device-group-filter');
    if (!select) return;
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">全部分组</option>';
    
    deviceState.groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        // 截断显示名称，最多6个字符
        const displayName = group.length > 6 ? group.substring(0, 6) + '...' : group;
        option.textContent = displayName;
        option.title = group; // 鼠标悬停显示完整名称
        select.appendChild(option);
    });
    
    // 恢复之前的选择
    if (currentValue && deviceState.groups.includes(currentValue)) {
        select.value = currentValue;
    }
}

/**
 * 更新设备统计信息
 */
function updateDeviceStats() {
    const total = state.devices ? state.devices.length : 0;
    let online = 0;
    
    if (state.devices && state.sessions) {
        state.devices.forEach(device => {
            const isConnected = Array.from(state.sessions.values()).some(
                s => s.deviceId === device.id && s.connected
            );
            if (isConnected) online++;
        });
    }
    
    const totalEl = document.getElementById('stat-total-devices');
    const onlineEl = document.getElementById('stat-online-devices');
    const offlineEl = document.getElementById('stat-offline-devices');
    
    if (totalEl) totalEl.textContent = total;
    if (onlineEl) onlineEl.textContent = online;
    if (offlineEl) offlineEl.textContent = total - online;
}

/**
 * 加密设备密码
 */
async function encryptDevicePasswords(devices) {
    const encrypted = [];
    for (const device of devices) {
        const copy = { ...device };
        if (copy.password && !copy._encrypted) {
            try {
                const result = await window.api.crypto.encrypt(copy.password);
                if (result.success) {
                    copy.password = result.data;
                    copy._encrypted = true;
                }
            } catch (e) {
                console.error('加密密码失败:', e);
            }
        }
        if (copy.enablePassword && !copy._enableEncrypted) {
            try {
                const result = await window.api.crypto.encrypt(copy.enablePassword);
                if (result.success) {
                    copy.enablePassword = result.data;
                    copy._enableEncrypted = true;
                }
            } catch (e) {
                console.error('加密Enable密码失败:', e);
            }
        }
        encrypted.push(copy);
    }
    return encrypted;
}

// ==================== 筛选与搜索 ====================

/**
 * 获取筛选后的设备列表
 */
function getFilteredDevices() {
    return state.devices.filter(device => {
        if (deviceState.searchKeyword) {
            const keyword = deviceState.searchKeyword.toLowerCase();
            const matchName = device.name?.toLowerCase().includes(keyword);
            const matchHost = device.host?.toLowerCase().includes(keyword);
            const matchTags = device.tags?.toLowerCase().includes(keyword);
            const matchGroup = device.group?.toLowerCase().includes(keyword);
            if (!matchName && !matchHost && !matchTags && !matchGroup) return false;
        }
        
        if (deviceState.filterType && device.type !== deviceState.filterType) return false;
        
        // 分组筛选
        if (deviceState.filterGroup) {
            const defaultGroup = deviceState.defaultGroup;
            if (deviceState.filterGroup === defaultGroup) {
                // 默认分组匹配未分组的设备和明确分配到默认分组的设备
                if (device.group && device.group.trim() && device.group !== defaultGroup) return false;
            } else {
                if (device.group !== deviceState.filterGroup) return false;
            }
        }
        
        if (deviceState.filterStatus) {
            const isConnected = Array.from(state.sessions.values()).some(
                s => s.deviceId === device.id && s.connected
            );
            if (deviceState.filterStatus === 'online' && !isConnected) return false;
            if (deviceState.filterStatus === 'offline' && isConnected) return false;
            if (deviceState.filterStatus === 'favorite' && !device.favorite) return false;
        }
        
        return true;
    });
}

// ==================== 工具函数 ====================

/**
 * 获取设备类型名称
 */
function getDeviceTypeName(type) {
    const types = {
        'h3c': 'H3C', 'h3c-ap': 'H3C-AP', 'huawei': 'Huawei', 'ruijie': 'Ruijie', 'cisco': 'Cisco',
        'juniper': 'Juniper', 'linux': 'Linux', 'other': '其他'
    };
    return types[type] || type;
}

/**
 * 获取协议名称
 */
function getProtocolName(protocol) {
    const protocols = { 'ssh': 'SSH', 'telnet': 'Telnet', 'console': '串口' };
    return protocols[protocol] || protocol?.toUpperCase() || 'SSH';
}

/**
 * 获取设备类型图标
 */
function getDeviceIcon(type) {
    const icons = {
        'h3c': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM4 19V5h16v14H4z"/><path d="M6 7h5v2H6zm0 4h5v2H6zm0 4h5v2H6zm7-8h5v2h-5zm0 4h5v2h-5zm0 4h5v2h-5z"/></svg>',
        'h3c-ap': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C7.46 3 3.34 4.78.29 7.67c-.18.18-.29.43-.29.71 0 .28.11.53.29.71l11 11c.18.18.43.29.71.29s.53-.11.71-.29l11-11c.18-.18.29-.43.29-.71 0-.28-.11-.53-.29-.71C20.66 4.78 16.54 3 12 3zm0 2c3.33 0 6.37 1.13 8.82 3L12 16.82 3.18 8C5.63 6.13 8.67 5 12 5z"/></svg>',
        'huawei': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M12 8v8"/></svg>',
        'cisco': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>',
        'ruijie': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z"/><path d="M7 12h10M12 7v10"/></svg>',
        'juniper': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M12 6v6l4 2"/></svg>',
        'linux': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/></svg>'
    };
    return icons[type] || icons['cisco'];
}
