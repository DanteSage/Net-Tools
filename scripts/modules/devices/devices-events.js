/**
 * 设备事件处理
 * @module devices/events
 */

// ==================== 事件初始化 ====================

/**
 * 初始化设备工具栏事件
 */
function initDeviceToolbar() {
    // 搜索
    const searchInput = document.getElementById('device-search-input');
    const clearBtn = document.getElementById('btn-clear-search');
    
    searchInput?.addEventListener('input', debounce((e) => {
        deviceState.searchKeyword = e.target.value.trim();
        clearBtn.style.display = deviceState.searchKeyword ? '' : 'none';
        renderDeviceList();
    }, 200));
    
    clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        deviceState.searchKeyword = '';
        clearBtn.style.display = 'none';
        renderDeviceList();
    });
    
    // 筛选器
    document.getElementById('device-group-filter')?.addEventListener('change', (e) => {
        deviceState.filterGroup = e.target.value;
        renderDeviceList();
    });
    
    document.getElementById('device-type-filter')?.addEventListener('change', (e) => {
        deviceState.filterType = e.target.value;
        renderDeviceList();
    });
    
    document.getElementById('device-status-filter')?.addEventListener('change', (e) => {
        deviceState.filterStatus = e.target.value;
        renderDeviceList();
    });
    
    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            deviceState.viewMode = btn.dataset.view;
            renderDeviceList();
        });
    });
    
    // 紧凑模式切换
    document.getElementById('btn-compact-mode')?.addEventListener('click', () => {
        deviceState.compactMode = !deviceState.compactMode;
        const btn = document.getElementById('btn-compact-mode');
        btn.classList.toggle('active', deviceState.compactMode);
        
        const container = document.getElementById('device-list');
        container.classList.toggle('compact', deviceState.compactMode);
    });
    
    // 下载模板、导入导出
    document.getElementById('btn-download-template')?.addEventListener('click', downloadDeviceTemplate);
    document.getElementById('btn-import-devices')?.addEventListener('click', importDevices);
    document.getElementById('btn-export-devices')?.addEventListener('click', () => exportDevices(state.devices));
    
    // 批量操作
    document.getElementById('btn-batch-delete')?.addEventListener('click', batchDeleteDevices);
    document.getElementById('btn-batch-cancel')?.addEventListener('click', clearDeviceSelection);
    
    // 全选
    document.getElementById('device-select-all')?.addEventListener('change', (e) => {
        const filtered = getFilteredDevices();
        if (e.target.checked) {
            filtered.forEach(d => deviceState.selectedDevices.add(d.id));
        } else {
            deviceState.selectedDevices.clear();
        }
        renderDeviceList();
    });
    
    document.getElementById('table-select-all')?.addEventListener('change', (e) => {
        const filtered = getFilteredDevices();
        if (e.target.checked) {
            filtered.forEach(d => deviceState.selectedDevices.add(d.id));
        } else {
            deviceState.selectedDevices.clear();
        }
        renderDeviceList();
    });
}

/**
 * 初始化设备卡片事件
 */
function initDeviceCardEvents() {
    const container = document.getElementById('device-list');
    
    container.querySelectorAll('.device-card').forEach(card => {
        // 双击快速连接
        card.addEventListener('dblclick', (e) => {
            if (e.target.closest('.device-card-actions') || e.target.closest('.card-checkbox') || e.target.closest('.card-favorite')) return;
            const id = card.dataset.id;
            const device = state.devices.find(d => d.id === id);
            if (device) {
                const isConnected = Array.from(state.sessions.values()).some(s => s.deviceId === id && s.connected);
                if (!isConnected) connectToDevice(id);
            }
        });
        
        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showDeviceContextMenu(e, card.dataset.id);
        });
        
        // 拖拽
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', card.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => card.classList.add('dragging'), 0);
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            reorderDevices();
        });
        
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = container.querySelector('.dragging');
            if (dragging && dragging !== card) {
                card.classList.add('drag-over');
                const rect = card.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.clientX < midX) {
                    card.parentNode.insertBefore(dragging, card);
                } else {
                    card.parentNode.insertBefore(dragging, card.nextSibling);
                }
            }
        });
        
        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });
        
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
        });
    });
}

/**
 * 初始化表格行事件
 */
function initTableRowEvents() {
    const tbody = document.getElementById('device-table-body');
    
    document.querySelectorAll('#device-table-body tr').forEach(row => {
        row.draggable = true;
        
        row.addEventListener('dblclick', (e) => {
            if (e.target.closest('.table-actions') || e.target.type === 'checkbox' || e.target.closest('.table-favorite')) return;
            const id = row.dataset.id;
            const device = state.devices.find(d => d.id === id);
            if (device) {
                const isConnected = Array.from(state.sessions.values()).some(s => s.deviceId === id && s.connected);
                if (!isConnected) connectToDevice(id);
            }
        });
        
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showDeviceContextMenu(e, row.dataset.id);
        });
        
        // 列表拖拽
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', row.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => row.classList.add('dragging'), 0);
        });
        
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            tbody.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            reorderDevicesFromTable();
        });
        
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = tbody.querySelector('.dragging');
            if (dragging && dragging !== row) {
                row.classList.add('drag-over');
                const rect = row.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    tbody.insertBefore(dragging, row);
                } else {
                    tbody.insertBefore(dragging, row.nextSibling);
                }
            }
        });
        
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });
        
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
        });
    });
}

/**
 * 重新排序设备并保存
 */
async function reorderDevices() {
    const container = document.getElementById('device-list');
    const cards = container.querySelectorAll('.device-card');
    const newDevices = [];
    
    cards.forEach(card => {
        const device = state.devices.find(d => d.id === card.dataset.id);
        if (device) newDevices.push(device);
    });
    
    state.devices = newDevices;
    
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
    } catch (e) {
        console.error('保存设备顺序失败:', e);
    }
}

/**
 * 从表格重新排序设备并保存
 */
async function reorderDevicesFromTable() {
    const tbody = document.getElementById('device-table-body');
    const rows = tbody.querySelectorAll('tr');
    const newDevices = [];
    
    rows.forEach(row => {
        const device = state.devices.find(d => d.id === row.dataset.id);
        if (device) newDevices.push(device);
    });
    
    state.devices = newDevices;
    
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
    } catch (e) {
        console.error('保存设备顺序失败:', e);
    }
}

// ==================== 选择与批量操作 ====================

/**
 * 切换设备选中状态
 */
function toggleDeviceSelect(id) {
    if (deviceState.selectedDevices.has(id)) {
        deviceState.selectedDevices.delete(id);
    } else {
        deviceState.selectedDevices.add(id);
    }
    renderDeviceList();
}

/**
 * 清除设备选择
 */
function clearDeviceSelection() {
    deviceState.selectedDevices.clear();
    renderDeviceList();
}

/**
 * 更新批量操作栏
 */
function updateBatchBar() {
    const bar = document.getElementById('device-batch-bar');
    const count = deviceState.selectedDevices.size;
    
    if (count > 0) {
        bar.style.display = '';
        document.getElementById('selected-count').textContent = count;
    } else {
        bar.style.display = 'none';
    }
}

/**
 * 批量删除设备
 */
async function batchDeleteDevices() {
    const count = deviceState.selectedDevices.size;
    if (count === 0) return;
    
    const confirmed = await showConfirm({
        title: '批量删除',
        message: `确定要删除选中的 ${count} 台设备吗？此操作无法撤销。`,
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    state.devices = state.devices.filter(d => !deviceState.selectedDevices.has(d.id));
    deviceState.selectedDevices.clear();
    
    try {
        await window.api.devices.save(state.devices);
        showToast(`已删除 ${count} 台设备`, 'success');
        renderDeviceList();
    } catch (error) {
        showToast('删除失败', 'error');
    }
}

// ==================== 收藏功能 ====================

/**
 * 切换设备收藏状态
 */
async function toggleFavorite(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device) return;
    
    device.favorite = !device.favorite;
    
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
        renderDeviceList();
    } catch (error) {
        console.error('保存收藏状态失败:', error);
    }
}

// 暴露全局函数
window.toggleDeviceSelect = toggleDeviceSelect;
window.toggleFavorite = toggleFavorite;
