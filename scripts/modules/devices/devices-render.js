/**
 * 设备渲染模块
 * @module devices/render
 */

// ==================== 渲染函数 ====================

/**
 * 渲染设备列表
 */
function renderDeviceList() {
    const filteredDevices = getFilteredDevices();
    
    // 收藏设备置顶，然后按分组排序
    filteredDevices.sort((a, b) => {
        // 先按收藏排序
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        // 再按分组排序
        const groupA = a.group || '';
        const groupB = b.group || '';
        return groupA.localeCompare(groupB);
    });
    
    if (deviceState.viewMode === 'grid') {
        renderGridView(filteredDevices);
    } else {
        renderTableView(filteredDevices);
    }
    
    updateDeviceStats();
    updateBatchBar();
}

/**
 * 渲染卡片视图
 */
function renderGridView(devices) {
    const container = document.getElementById('device-list');
    const tableView = document.getElementById('device-table');
    
    container.style.display = '';
    tableView.style.display = 'none';
    
    // 检查是否在分组内部视图
    const currentGroup = deviceState.currentGroup;
    const defaultGroup = deviceState.defaultGroup;
    
    if (currentGroup) {
        // 在分组内部
        let groupDevices;
        if (currentGroup === defaultGroup) {
            // 默认分组显示未分组的设备和明确分配到默认分组的设备
            groupDevices = devices.filter(d => !d.group || !d.group.trim() || d.group === defaultGroup);
        } else {
            groupDevices = devices.filter(d => d.group === currentGroup);
        }
        renderGroupInnerView(container, currentGroup, groupDevices);
    } else {
        // 在根视图，显示分组文件夹
        renderRootView(container, devices);
    }
}

/**
 * 渲染根视图（分组文件夹）
 */
function renderRootView(container, devices) {
    // 获取所有分组
    let groups = deviceState.groups || [];
    const defaultGroup = deviceState.defaultGroup;
    
    // 计算每个分组的设备数量（未分组设备计入默认分组）
    const groupCounts = {};
    devices.forEach(d => {
        const groupName = (d.group && d.group.trim()) ? d.group.trim() : defaultGroup;
        groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
    });
    
    // 如果有搜索关键词或筛选条件，只显示包含匹配设备的分组
    const hasFilter = deviceState.searchKeyword || deviceState.filterType || deviceState.filterStatus;
    if (hasFilter) {
        groups = groups.filter(groupName => groupCounts[groupName] > 0);
    }
    
    if (groups.length === 0) {
        const isEmpty = state.devices.length === 0;
        container.innerHTML = `
            <div class="device-empty">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        ${isEmpty 
                            ? '<path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z"/><path d="M12 8l-4 4h3v4h2v-4h3z"/>'
                            : '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>'
                        }
                    </svg>
                </div>
                <h3 class="empty-title">${isEmpty ? '开始管理您的网络设备' : '未找到匹配的设备'}</h3>
                <p class="empty-desc">${isEmpty 
                    ? '添加您的第一台网络设备，开始远程管理之旅' 
                    : '尝试调整搜索关键词或筛选条件'}</p>
                ${isEmpty ? `
                <button class="btn btn-primary empty-action" onclick="document.getElementById('btn-add-device').click()">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                    添加设备
                </button>
                ` : `
                <button class="btn btn-secondary empty-action" onclick="document.getElementById('device-search-input').value=''; deviceState.searchKeyword=''; deviceState.filterType=''; deviceState.filterStatus=''; deviceState.filterGroup=''; document.getElementById('device-type-filter').value=''; document.getElementById('device-status-filter').value=''; document.getElementById('device-group-filter').value=''; renderDeviceList();">
                    清除筛选条件
                </button>
                `}
            </div>
        `;
        return;
    }
    
    let html = '<div class="device-grid-cards">';
    
    // 渲染分组文件夹
    groups.forEach(groupName => {
        const count = groupCounts[groupName] || 0;
        const isDefault = groupName === defaultGroup;
        // 截断显示名称，最多显示6个字符
        const displayName = groupName.length > 6 ? groupName.substring(0, 6) + '...' : groupName;
        html += `
            <div class="group-folder-card ${isDefault ? 'default-group' : ''}" 
                 data-group="${escapeHtml(groupName)}"
                 onclick="enterGroup('${escapeHtml(groupName)}')" 
                 oncontextmenu="showGroupContextMenu(event, '${escapeHtml(groupName)}')"
                 title="${escapeHtml(groupName)}">
                <div class="folder-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                </div>
                <div class="folder-name">${escapeHtml(displayName)}</div>
                <div class="folder-count">${count} 台设备</div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * 渲染分组内部视图
 */
function renderGroupInnerView(container, groupName, devices) {
    let html = `
        <div class="group-inner-header">
            <button class="btn btn-secondary btn-back" onclick="exitGroup()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                返回
            </button>
            <div class="group-inner-title">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                <span>${escapeHtml(groupName)}</span>
            </div>
            <div class="group-inner-count">${devices.length} 台设备</div>
        </div>
    `;
    
    if (devices.length === 0) {
        html += `
            <div class="device-empty">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                </div>
                <h3 class="empty-title">分组中暂无设备</h3>
                <p class="empty-desc">在添加或编辑设备时，选择此分组即可将设备加入</p>
            </div>
        `;
    } else {
        html += '<div class="device-grid-cards">';
        devices.forEach(device => {
            html += renderDeviceCard(device);
        });
        html += '</div>';
    }
    
    container.innerHTML = html;
    initDeviceCardEvents();
}

/**
 * 进入分组
 */
function enterGroup(groupName) {
    deviceState.currentGroup = groupName;
    renderDeviceList();
}

/**
 * 退出分组
 */
function exitGroup() {
    deviceState.currentGroup = null;
    renderDeviceList();
}

/**
 * 渲染单个设备卡片
 */
function renderDeviceCard(device) {
    const isConnected = Array.from(state.sessions.values()).some(
        s => s.deviceId === device.id && s.connected
    );
    const isSelected = deviceState.selectedDevices.has(device.id);
    const hostDisplay = device.protocol === 'console' 
        ? `${device.comPort}` 
        : `${device.host}:${device.port || 22}`;
    
    return `
        <div class="device-card ${isSelected ? 'selected' : ''}" data-id="${device.id}" draggable="true">
            <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleDeviceSelect('${device.id}')">
            <button class="card-favorite ${device.favorite ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${device.id}')" title="${device.favorite ? '取消收藏' : '收藏'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="${device.favorite 
                        ? 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'
                        : 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'}"/>
                </svg>
            </button>
            <div class="device-icon">
                ${getDeviceIcon(device.type)}
            </div>
            <div class="device-card-header">
                <div class="device-name" title="${escapeHtml(device.name)}">${escapeHtml(device.name)}</div>
                <div class="device-host">${escapeHtml(hostDisplay)}</div>
                <div class="device-status-badge ${isConnected ? 'online' : 'offline'}">
                    <span class="status-dot"></span>
                    ${isConnected ? '已连接' : '离线'}
                </div>
                <div class="device-meta">
                    <span>${getDeviceTypeName(device.type)}</span>
                    <span>${getProtocolName(device.protocol)}</span>
                </div>
            </div>
            <div class="device-card-actions">
                ${isConnected 
                    ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); disconnectDevice('${device.id}')">断开</button>`
                    : `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); connectToDevice('${device.id}')">连接</button>`
                }
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); editDevice('${device.id}')">编辑</button>
            </div>
        </div>
    `;
}

/**
 * 渲染列表视图
 */
function renderTableView(devices) {
    const container = document.getElementById('device-list');
    const tableView = document.getElementById('device-table');
    const tbody = document.getElementById('device-table-body');
    
    container.style.display = 'none';
    tableView.style.display = '';
    
    // 根据当前分组筛选设备
    const currentGroup = deviceState.currentGroup;
    const defaultGroup = deviceState.defaultGroup;
    
    if (currentGroup) {
        if (currentGroup === defaultGroup) {
            devices = devices.filter(d => !d.group || !d.group.trim() || d.group === defaultGroup);
        } else {
            devices = devices.filter(d => d.group === currentGroup);
        }
    }
    
    if (devices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align:center; padding:40px; color:var(--text-muted);">
                    ${currentGroup ? '分组中暂无设备' : (state.devices.length === 0 ? '暂无设备' : '无匹配设备')}
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = devices.map(device => {
        const isConnected = Array.from(state.sessions.values()).some(
            s => s.deviceId === device.id && s.connected
        );
        const isSelected = deviceState.selectedDevices.has(device.id);
        const hostDisplay = device.protocol === 'console' 
            ? `${device.comPort}` 
            : `${device.host}:${device.port || 22}`;
        const tags = device.tags ? device.tags.split(',').map(t => t.trim()).filter(t => t) : [];
        const groupName = (device.group && device.group.trim()) ? device.group : deviceState.defaultGroup;
        
        return `
        <tr class="${isSelected ? 'selected' : ''}" data-id="${device.id}">
            <td class="col-checkbox">
                <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleDeviceSelect('${device.id}')">
            </td>
            <td class="col-favorite">
                <span class="table-favorite ${device.favorite ? 'active' : ''}" onclick="toggleFavorite('${device.id}')" title="${device.favorite ? '取消收藏' : '收藏'}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="${device.favorite 
                            ? 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'
                            : 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'}"/>
                    </svg>
                </span>
            </td>
            <td class="col-status">
                <span class="table-status ${isConnected ? 'online' : 'offline'}">
                    <span class="status-dot"></span>
                    ${isConnected ? '在线' : '离线'}
                </span>
            </td>
            <td class="col-name"><span class="table-name">${escapeHtml(device.name)}</span></td>
            <td class="col-host"><span class="table-host">${escapeHtml(hostDisplay)}</span></td>
            <td class="col-type">${getDeviceTypeName(device.type)}</td>
            <td class="col-protocol">${getProtocolName(device.protocol)}</td>
            <td class="col-group">
                <span class="table-group-badge">${escapeHtml(groupName)}</span>
            </td>
            <td class="col-tags">
                <div class="table-tags">
                    ${tags.slice(0, 2).map(t => `<span class="table-tag">${escapeHtml(t)}</span>`).join('')}
                    ${tags.length > 2 ? `<span class="table-tag">+${tags.length - 2}</span>` : ''}
                </div>
            </td>
            <td class="col-actions">
                <div class="table-actions">
                    ${isConnected 
                        ? `<button class="btn btn-sm btn-danger" onclick="disconnectDevice('${device.id}')">断开</button>`
                        : `<button class="btn btn-sm btn-primary" onclick="connectToDevice('${device.id}')">连接</button>`
                    }
                    <button class="btn btn-sm btn-secondary" onclick="editDevice('${device.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteDevice('${device.id}')">删除</button>
                </div>
            </td>
        </tr>
    `}).join('');
    
    initTableRowEvents();
}
