/**
 * 设备右键菜单
 * @module devices/context-menu
 */

// ==================== 右键菜单 ====================

/**
 * 显示设备右键菜单
 */
function showDeviceContextMenu(e, deviceId) {
    const existing = document.querySelector('.device-context-menu');
    if (existing) existing.remove();
    
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) return;
    
    const isConnected = Array.from(state.sessions.values()).some(s => s.deviceId === deviceId && s.connected);
    
    const menu = document.createElement('div');
    menu.className = 'device-context-menu';
    menu.innerHTML = `
        <div class="menu-item" data-action="connect">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            ${isConnected ? '新建连接' : '连接'}
        </div>
        ${isConnected ? `
        <div class="menu-item" data-action="disconnect">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            断开连接
        </div>
        ` : ''}
        <div class="menu-divider"></div>
        <div class="menu-item" data-action="favorite">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
            ${device.favorite ? '取消收藏' : '收藏'}
        </div>
        <div class="menu-item" data-action="edit">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            编辑
        </div>
        <div class="menu-item" data-action="copy">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            复制设备
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item danger" data-action="delete">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            删除
        </div>
    `;
    
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    
    // 确保菜单不超出屏幕
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    
    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.remove();
            handleContextMenuAction(action, deviceId);
        });
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
}

/**
 * 处理右键菜单操作
 */
function handleContextMenuAction(action, deviceId) {
    switch (action) {
        case 'connect': connectToDevice(deviceId); break;
        case 'disconnect': disconnectDevice(deviceId); break;
        case 'favorite': toggleFavorite(deviceId); break;
        case 'edit': editDevice(deviceId); break;
        case 'copy': copyDevice(deviceId); break;
        case 'delete': deleteDevice(deviceId); break;
    }
}

// ==================== 分组右键菜单 ====================

/**
 * 显示分组右键菜单
 */
function showGroupContextMenu(e, groupName) {
    e.preventDefault();
    e.stopPropagation();
    
    const existing = document.querySelector('.device-context-menu');
    if (existing) existing.remove();
    
    const isDefault = groupName === deviceState.defaultGroup;
    const groupDevices = getGroupDevices(groupName);
    const deviceCount = groupDevices.length;
    
    const menu = document.createElement('div');
    menu.className = 'device-context-menu';
    menu.innerHTML = `
        <div class="menu-item" data-action="ping" ${deviceCount === 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            连通性测试 (${deviceCount})
        </div>
        <div class="menu-item" data-action="connect-all" ${deviceCount === 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            一键连接 (${deviceCount})
        </div>
        <div class="menu-divider"></div>
        ${!isDefault ? `
        <div class="menu-item" data-action="rename">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            重命名分组
        </div>
        ` : ''}
        <div class="menu-item danger" data-action="delete-devices" ${deviceCount === 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            删除组内设备 (${deviceCount})
        </div>
        ${!isDefault ? `
        <div class="menu-item danger" data-action="delete-group">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            删除分组
        </div>
        ` : ''}
    `;
    
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    
    // 确保菜单不超出屏幕
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    
    menu.querySelectorAll('.menu-item:not([disabled])').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            menu.remove();
            handleGroupContextMenuAction(action, groupName);
        });
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
}

/**
 * 获取分组内的设备
 */
function getGroupDevices(groupName) {
    const defaultGroup = deviceState.defaultGroup;
    if (groupName === defaultGroup) {
        return state.devices.filter(d => !d.group || !d.group.trim() || d.group === defaultGroup);
    }
    return state.devices.filter(d => d.group === groupName);
}

/**
 * 处理分组右键菜单操作
 */
function handleGroupContextMenuAction(action, groupName) {
    const devices = getGroupDevices(groupName);
    
    switch (action) {
        case 'ping':
            testGroupConnectivity(groupName, devices);
            break;
        case 'connect-all':
            connectGroupDevices(groupName, devices);
            break;
        case 'rename':
            editGroupName(groupName);
            break;
        case 'delete-devices':
            deleteGroupDevices(groupName, devices);
            break;
        case 'delete-group':
            deleteGroup(groupName);
            break;
    }
}

/**
 * 测试分组连通性 - 实时显示测试进度
 */
async function testGroupConnectivity(groupName, devices) {
    if (devices.length === 0) {
        showToast('分组中没有设备', 'warning');
        return;
    }
    
    // 获取所有设备的IP地址
    const networkDevices = devices.filter(d => d.host && d.protocol !== 'console');
    
    if (networkDevices.length === 0) {
        showToast('分组中没有可测试的网络设备', 'warning');
        return;
    }
    
    // 创建并显示测试弹窗
    const modal = createConnectivityModal(groupName, networkDevices);
    document.body.appendChild(modal);
    
    // 开始逐个测试设备
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < networkDevices.length; i++) {
        const device = networkDevices[i];
        const itemEl = modal.querySelector(`[data-device-id="${device.id}"]`);
        
        // 更新为测试中状态
        if (itemEl) {
            itemEl.className = 'connectivity-item testing';
            itemEl.querySelector('.status-icon').innerHTML = '<div class="status-spinner"></div>';
            itemEl.querySelector('.ping-time').textContent = '测试中...';
        }
        
        // 执行测试，使用设备配置的端口
        const port = device.port || 22;
        try {
            const result = await window.api.ping.host(device.host, port, 3000);
            if (result.alive) {
                successCount++;
                if (itemEl) {
                    itemEl.className = 'connectivity-item success';
                    itemEl.querySelector('.status-icon').innerHTML = `
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--success-color)">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>`;
                    itemEl.querySelector('.ping-time').textContent = result.time + 'ms';
                }
            } else {
                failCount++;
                if (itemEl) {
                    itemEl.className = 'connectivity-item failed';
                    itemEl.querySelector('.status-icon').innerHTML = `
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--danger-color)">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>`;
                    itemEl.querySelector('.ping-time').textContent = '超时';
                }
            }
        } catch (err) {
            failCount++;
            if (itemEl) {
                itemEl.className = 'connectivity-item failed';
                itemEl.querySelector('.status-icon').innerHTML = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--danger-color)">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>`;
                itemEl.querySelector('.ping-time').textContent = '失败';
            }
        }
        
        // 更新进度
        updateConnectivityProgress(modal, i + 1, networkDevices.length, successCount, failCount);
    }
    
    // 测试完成，更新标题和按钮
    const headerTitle = modal.querySelector('.modal-header h2');
    if (headerTitle) {
        headerTitle.textContent = `测试完成 - ${groupName}`;
    }
    
    const footer = modal.querySelector('.modal-footer');
    if (footer) {
        footer.innerHTML = `
            <button class="btn btn-secondary" onclick="this.closest('.modal.active').classList.remove('active'); this.closest('.modal').remove();">关闭</button>
        `;
    }
}

/**
 * 创建连通性测试模态框
 */
function createConnectivityModal(groupName, devices) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'connectivity-test-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 520px;">
            <div class="modal-header">
                <h2>连通性测试 - ${escapeHtml(groupName)}</h2>
                <button class="modal-close" onclick="this.closest('.modal').classList.remove('active'); this.closest('.modal').remove();">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="connectivity-summary">
                    <div class="summary-progress">
                        <div class="progress-text">准备测试 <span class="progress-current">0</span>/<span class="progress-total">${devices.length}</span></div>
                        <div class="progress-bar"><div class="progress-bar-fill" style="width: 0%"></div></div>
                    </div>
                    <div class="summary-stats">
                        <span class="stat-success"><span class="stat-icon">✓</span> <span class="stat-value">0</span></span>
                        <span class="stat-failed"><span class="stat-icon">✗</span> <span class="stat-value">0</span></span>
                    </div>
                </div>
                <div class="connectivity-results">
                    ${devices.map(device => `
                        <div class="connectivity-item pending" data-device-id="${escapeHtml(device.id)}">
                            <span class="status-icon">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-muted)">
                                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"/>
                                </svg>
                            </span>
                            <span class="device-name">${escapeHtml(device.name)}</span>
                            <span class="device-host">${escapeHtml(device.host)}</span>
                            <span class="ping-time">等待中</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" disabled>测试中...</button>
            </div>
        </div>
    `;
    
    // 点击遮罩不关闭（测试进行中）
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            e.stopPropagation();
        }
    });
    
    return modal;
}

/**
 * 更新连通性测试进度
 */
function updateConnectivityProgress(modal, current, total, successCount, failCount) {
    const progressText = modal.querySelector('.progress-text');
    const progressFill = modal.querySelector('.progress-bar-fill');
    const statSuccess = modal.querySelector('.stat-success .stat-value');
    const statFailed = modal.querySelector('.stat-failed .stat-value');
    
    if (progressText) {
        if (current < total) {
            progressText.innerHTML = `正在测试 <span class="progress-current">${current}</span>/<span class="progress-total">${total}</span>`;
        } else {
            progressText.innerHTML = `测试完成 <span class="progress-current">${total}</span>/<span class="progress-total">${total}</span>`;
        }
    }
    if (progressFill) progressFill.style.width = `${(current / total) * 100}%`;
    if (statSuccess) statSuccess.textContent = successCount;
    if (statFailed) statFailed.textContent = failCount;
}

/**
 * 一键连接分组设备
 */
async function connectGroupDevices(groupName, devices) {
    if (devices.length === 0) {
        showToast('分组中没有设备', 'warning');
        return;
    }
    
    // 显示确认框
    const confirmed = await showConfirm({
        title: '一键连接',
        message: `即将连接分组「${groupName}」中的 ${devices.length} 台设备`,
        detail: '每台设备将间隔 0.5 秒依次连接',
        confirmText: '开始连接',
        type: 'info'
    });
    
    if (!confirmed) return;
    
    showToast(`开始连接分组「${groupName}」中的 ${devices.length} 台设备...`, 'info');
    
    // 逐个连接设备，避免同时连接太多
    devices.forEach((device, index) => {
        setTimeout(() => {
            connectToDevice(device.id);
        }, index * 500); // 每个设备间隔500ms
    });
}

/**
 * 删除分组内所有设备
 */
async function deleteGroupDevices(groupName, devices) {
    if (devices.length === 0) {
        showToast('分组中没有设备', 'warning');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '删除组内设备',
        message: `确定要删除分组「${groupName}」中的 ${devices.length} 台设备吗？`,
        detail: '此操作不可撤销！',
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    // 删除所有设备
    const deviceIds = devices.map(d => d.id);
    state.devices = state.devices.filter(d => !deviceIds.includes(d.id));
    
    try {
        await window.api.devices.save(state.devices);
        showToast(`已删除分组「${groupName}」中的 ${deviceIds.length} 台设备`, 'success');
        renderDeviceList();
    } catch (error) {
        console.error('删除设备失败:', error);
        showToast('删除失败', 'error');
    }
}

// 全局暴露分组右键菜单
window.showGroupContextMenu = showGroupContextMenu;
