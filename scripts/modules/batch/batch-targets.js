/**
 * 批量执行目标管理
 * @module batch/targets
 */

// ==================== 目标模式初始化 ====================

/**
 * 初始化目标模式切换
 */
function initTargetModes() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            batchState.targetMode = mode;
            
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.target-mode-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`mode-${mode}`)?.classList.add('active');
        });
    });
}

// ==================== 设备列表选择 ====================

/**
 * 初始化设备列表选择
 */
function initDeviceSelection() {
    const selectAllBtn = document.getElementById('btn-batch-select-all');
    const deselectAllBtn = document.getElementById('btn-batch-deselect-all');
    const filterInput = document.getElementById('batch-device-filter');
    const clearSelectedBtn = document.getElementById('btn-clear-selected-targets');
    
    // 清空已选目标
    clearSelectedBtn?.addEventListener('click', clearAllSelectedTargets);
    
    selectAllBtn?.addEventListener('click', () => {
        document.querySelectorAll('#batch-device-list .batch-device-item:not([style*="display: none"]) input[type="checkbox"]')
            .forEach(cb => { 
                cb.checked = true;
                cb.closest('.batch-device-item')?.classList.add('selected');
            });
        updateSelectedTargetsFromDevices();
        updateDeviceStats();
        updateSelectionButtons();
    });
    
    deselectAllBtn?.addEventListener('click', () => {
        document.querySelectorAll('#batch-device-list input[type="checkbox"]')
            .forEach(cb => { 
                cb.checked = false;
                cb.closest('.batch-device-item')?.classList.remove('selected');
            });
        updateSelectedTargetsFromDevices();
        updateDeviceStats();
        updateSelectionButtons();
    });
    
    filterInput?.addEventListener('input', debounce((e) => {
        const keyword = e.target.value.toLowerCase().trim();
        const container = document.getElementById('batch-device-list');
        const items = container?.querySelectorAll('.batch-device-item') || [];
        let visibleCount = 0;
        
        // 移除之前的无结果提示
        container?.querySelector('.no-results')?.remove();
        
        items.forEach(item => {
            const name = item.querySelector('.device-name')?.textContent.toLowerCase() || '';
            const host = item.querySelector('.device-host')?.textContent.toLowerCase() || '';
            const isMatch = !keyword || name.includes(keyword) || host.includes(keyword);
            item.dataset.searchMatch = isMatch ? '1' : '0';
            if (isMatch) visibleCount++;
        });
        
        // 显示无结果提示
        if (keyword && visibleCount === 0 && items.length > 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <span>未找到匹配 "${escapeHtml(keyword)}" 的设备</span>
            `;
            container?.appendChild(noResults);
        }
        
        applyBatchGroupFilter();
        updateSelectionButtons();
    }, 200));
}

// ==================== 分组快速选择 ====================

/**
 * 初始化分组选取事件
 */
function initGroupSelection() {
    document.getElementById('btn-batch-add-group')?.addEventListener('click', () => {
        addGroupDevicesToTargets();
    });
    document.getElementById('batch-group-select')?.addEventListener('change', () => {
        applyBatchGroupFilter();
        updateBatchGroupMeta();
    });
}

/**
 * 获取设备分组名称（含默认分组归一化）
 * @param {Object} device
 * @returns {string}
 */
function getDeviceGroupName(device) {
    const defaultGroup = window.deviceState?.defaultGroup || '默认分组';
    const group = device.group && device.group.trim() ? device.group.trim() : defaultGroup;
    return group;
}

/**
 * 渲染批量分组下拉选项
 */
function renderBatchGroupSelect() {
    const select = document.getElementById('batch-group-select');
    const addBtn = document.getElementById('btn-batch-add-group');
    if (!select || !addBtn) return;

    const devices = state.devices || [];
    const defaultGroup = window.deviceState?.defaultGroup || '默认分组';
    const groupCounts = new Map();

    // 统计设备中存在的分组
    devices.forEach(device => {
        const groupName = getDeviceGroupName(device);
        groupCounts.set(groupName, (groupCounts.get(groupName) || 0) + 1);
    });

    // 确保设备分组列表中的分组也出现在下拉（即便当前无设备）
    const definedGroups = Array.isArray(window.deviceState?.groups) ? window.deviceState.groups : [];
    definedGroups.forEach(g => {
        const name = g && g.trim() ? g.trim() : defaultGroup;
        if (!groupCounts.has(name)) {
            groupCounts.set(name, 0);
        }
    });

    // 排序：默认分组优先，其余按设备数量降序，再按中文排序
    const groups = Array.from(groupCounts.keys()).sort((a, b) => {
        if (a === defaultGroup) return -1;
        if (b === defaultGroup) return 1;
        const countDiff = (groupCounts.get(b) || 0) - (groupCounts.get(a) || 0);
        if (countDiff !== 0) return countDiff;
        return a.localeCompare(b, 'zh-CN');
    });
    const currentValue = select.value;

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择分组';
    select.appendChild(placeholder);

    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = `${group} (${groupCounts.get(group) || 0} 台)`;
        select.appendChild(option);
    });

    if (currentValue && groups.includes(currentValue)) {
        select.value = currentValue;
    }

    addBtn.disabled = groups.length === 0;
    updateBatchGroupMeta();
}

/**
 * 将分组中的设备添加到批量目标
 */
function addGroupDevicesToTargets() {
    const select = document.getElementById('batch-group-select');
    if (!select) return;

    const groupName = select.value;
    if (!groupName) {
        showToast('请选择分组', 'warning');
        return;
    }

    const devices = (state.devices || []).filter(d => getDeviceGroupName(d) === groupName);
    if (devices.length === 0) {
        showToast('该分组暂无设备', 'info');
        return;
    }

    const existingIds = new Set(batchState.selectedTargets.map(t => t.id));
    const newTargets = devices
        .filter(d => !existingIds.has(d.id))
        .map(d => ({
            id: d.id,
            name: d.name,
            host: d.host,
            port: d.port || (d.protocol === 'telnet' ? 23 : 22),
            protocol: d.protocol || 'ssh',
            type: d.type,
            username: d.username,
            password: d.password,
            enablePassword: d.enablePassword
        }));

    if (newTargets.length === 0) {
        showToast(`分组「${groupName}」的设备已全部在目标列表中`, 'info');
        return;
    }

    batchState.selectedTargets = [...batchState.selectedTargets, ...newTargets];
    updateSelectedTargetsList();
    updateStepButtons();
    updateBatchDeviceStats();
    updateSelectionButtons();
    if (typeof updateDeviceStats === 'function') {
        updateDeviceStats();
    }
    updateBatchGroupMeta();
    showToast(`已添加分组「${groupName}」的 ${newTargets.length} 台设备`, 'success');
}

/**
 * 清空所有已选目标
 */
async function clearAllSelectedTargets() {
    if (batchState.selectedTargets.length === 0) {
        showToast('没有已选目标', 'info');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '清空已选目标',
        message: `确定要清空全部 ${batchState.selectedTargets.length} 个已选目标吗？`,
        confirmText: '清空',
        type: 'warning'
    });
    
    if (!confirmed) return;
    
    // 清空状态
    batchState.selectedTargets = [];
    
    // 清除设备列表的选中状态
    document.querySelectorAll('#batch-device-list input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.closest('.batch-device-item')?.classList.remove('selected');
    });
    
    // 清空解析结果显示（但保留输入框内容）
    document.getElementById('parsed-targets').innerHTML = '';
    
    updateSelectedTargetsList();
    updateBatchDeviceStats();
    updateBatchGroupMeta();
    updateDeviceStats();
    updateSelectionButtons();
    showToast('已清空所有目标', 'success');
}

/**
 * 更新全选/清空按钮状态
 */
function updateSelectionButtons() {
    const selectAllBtn = document.getElementById('btn-batch-select-all');
    const deselectAllBtn = document.getElementById('btn-batch-deselect-all');
    
    const visibleItems = document.querySelectorAll('#batch-device-list .batch-device-item:not([style*="display: none"])');
    const checkedItems = document.querySelectorAll('#batch-device-list input[type="checkbox"]:checked');
    const visibleChecked = document.querySelectorAll('#batch-device-list .batch-device-item:not([style*="display: none"]) input[type="checkbox"]:checked');
    
    // 全选按钮：当所有可见项都已选中时禁用
    if (selectAllBtn) {
        selectAllBtn.disabled = visibleItems.length === 0 || visibleChecked.length === visibleItems.length;
    }
    
    // 清空按钮：当没有选中项时禁用
    if (deselectAllBtn) {
        deselectAllBtn.disabled = checkedItems.length === 0;
    }
}

/**
 * 获取设备类型图标
 */
function getBatchDeviceIcon(type) {
    const icons = {
        router: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
        switch: '<path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 7h2v2H5V7zm0 4h2v2H5v-2zm0 4h2v2H5v-2zm14 2H9v-2h10v2zm0-4H9v-2h10v2zm0-4H9V7h10v2z"/>',
        firewall: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
        server: '<path d="M4 1h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V3c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm0 8h16c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2zm1-12v2h2V5H5zm0 8v2h2v-2H5zm0 8v2h2v-2H5z"/>',
        default: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>'
    };
    return icons[type] || icons.default;
}

/**
 * 获取设备类型显示名称
 */
function getDeviceTypeLabel(type) {
    const labels = {
        router: '路由器',
        switch: '交换机',
        firewall: '防火墙',
        server: '服务器',
        h3c: 'H3C',
        huawei: 'Huawei',
        cisco: 'Cisco',
        ruijie: 'Ruijie',
        juniper: 'Juniper',
        linux: 'Linux'
    };
    return labels[type] || type || '设备';
}

/**
 * 加载设备列表到批量执行页面
 */
async function loadBatchDevices() {
    const container = document.getElementById('batch-device-list');
    if (!container) return;
    
    if (!state.devices || state.devices.length === 0) {
        await loadDevices();
    }
    const devices = state.devices || [];

    // 更新分组选项
    renderBatchGroupSelect();
    
    // 更新设备总数
    const totalEl = document.getElementById('batch-device-total');
    if (totalEl) totalEl.textContent = devices.length;
    
    if (devices.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>
                </svg>
                <div class="empty-title">暂无设备</div>
                <div class="empty-desc">请先在设备管理中添加设备</div>
            </div>
        `;
        updateSelectionButtons();
        return;
    }
    
    container.innerHTML = devices.map(device => {
        const iconPath = getBatchDeviceIcon(device.type);
        const protocol = device.protocol || 'ssh';
        const port = device.port || (protocol === 'telnet' ? 23 : 22);
        const typeLabel = getDeviceTypeLabel(device.type);
        const groupName = escapeHtml(getDeviceGroupName(device));
        return `
            <div class="batch-device-item" data-id="${device.id}" data-type="${device.type || 'default'}" data-group="${groupName}">
                <div class="device-checkbox">
                    <input type="checkbox" id="batch-dev-${device.id}" value="${device.id}">
                    <span class="checkbox-mark">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                    </span>
                </div>
                <div class="device-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${iconPath}</svg>
                </div>
                <div class="device-info">
                    <div class="device-name">${escapeHtml(device.name)}</div>
                    <div class="device-meta">
                        <span class="device-host">${escapeHtml(device.host)}:${port}</span>
                    </div>
                </div>
                <div class="device-tags">
                    <span class="device-protocol ${protocol}">${protocol.toUpperCase()}</span>
                    <span class="device-type-tag">${typeLabel}</span>
                </div>
            </div>
        `;
    }).join('');
    
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const item = e.target.closest('.batch-device-item');
            item?.classList.toggle('selected', e.target.checked);
            updateSelectedTargetsFromDevices();
            updateBatchDeviceStats();
        });
    });
    
    container.querySelectorAll('.batch-device-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.device-checkbox')) {
                const cb = item.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                item.classList.toggle('selected', cb.checked);
                updateSelectedTargetsFromDevices();
                updateBatchDeviceStats();
                updateSelectionButtons();
            }
        });
    });
    
    // 初始化按钮状态
    updateSelectionButtons();
    applyBatchGroupFilter();
}

/**
 * 更新批量设备选择统计
 */
function updateBatchDeviceStats() {
    const visibleItems = document.querySelectorAll('#batch-device-list .batch-device-item:not([style*="display: none"])');
    const total = visibleItems.length;
    const selected = document.querySelectorAll('#batch-device-list .batch-device-item:not([style*="display: none"]) input[type="checkbox"]:checked').length;
    
    const selectedEl = document.getElementById('batch-device-selected');
    if (selectedEl) {
        selectedEl.textContent = selected > 0 ? ` 已选 ${selected}` : '';
    }
}

/**
 * 从设备列表更新已选目标
 */
async function updateSelectedTargetsFromDevices() {
    const selectedIds = Array.from(
        document.querySelectorAll('#batch-device-list input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    
    const devices = state.devices || [];
    batchState.selectedTargets = devices
        .filter(d => selectedIds.includes(d.id))
        .map(d => ({
            id: d.id,
            name: d.name,
            host: d.host,
            port: d.port || 22,
            protocol: d.protocol || 'ssh',
            type: d.type,
            username: d.username,
            password: d.password,
            enablePassword: d.enablePassword
        }));
    
    updateSelectedTargetsList();
    updateStepButtons();
}

// ==================== 地址范围输入 ====================

/**
 * 初始化地址范围输入
 */
function initRangeInput() {
    document.getElementById('btn-parse-range')?.addEventListener('click', parseIPRange);
    
    // 协议选择关联端口
    document.getElementById('batch-range-protocol')?.addEventListener('change', (e) => {
        const portInput = document.getElementById('batch-range-port');
        if (portInput) {
            portInput.value = e.target.value === 'telnet' ? '23' : '22';
        }
    });
    
    // 设备类型关联 Enable 密码和用户名
    document.getElementById('batch-range-type')?.addEventListener('change', (e) => {
        const enableGroup = document.getElementById('batch-range-enable-group');
        const usernameInput = document.getElementById('batch-range-username');
        const usernameGroup = usernameInput?.closest('.credential-item');
        
        if (enableGroup) {
            enableGroup.style.display = (e.target.value === 'cisco' || e.target.value === 'ruijie') ? '' : 'none';
        }
        // H3C-AP 类型隐藏用户名
        if (usernameGroup) {
            usernameGroup.style.display = (e.target.value === 'h3c-ap') ? 'none' : '';
        }
    });
}

/**
 * 解析IP地址范围
 */
function parseIPRange() {
    const rangeInput = document.getElementById('batch-ip-range')?.value.trim();
    if (!rangeInput) {
        showToast('请输入IP地址范围', 'warning');
        return;
    }
    
    const protocol = document.getElementById('batch-range-protocol')?.value || 'ssh';
    const port = parseInt(document.getElementById('batch-range-port')?.value) || 22;
    const type = document.getElementById('batch-range-type')?.value || 'h3c';
    const username = document.getElementById('batch-range-username')?.value || '';
    const password = document.getElementById('batch-range-password')?.value || '';
    const enablePassword = document.getElementById('batch-range-enable')?.value || '';
    
    // H3C-AP 类型不需要用户名
    if (type !== 'h3c-ap' && !username) {
        showToast('请输入用户名', 'warning');
        return;
    }
    
    const ips = expandIPRange(rangeInput);
    if (ips.length === 0) {
        showToast('无法解析IP地址范围', 'error');
        return;
    }
    
    const newTargets = ips.map((ip, idx) => ({
        id: `range_${Date.now()}_${idx}`,
        name: ip,
        host: ip,
        port,
        protocol,
        type,
        username,
        password,
        enablePassword: (type === 'cisco' || type === 'ruijie') ? enablePassword : ''
    }));
    
    batchState.selectedTargets = [...batchState.selectedTargets, ...newTargets];
    
    const container = document.getElementById('parsed-targets');
    if (container) {
        container.innerHTML = `
            <div style="margin-bottom: 12px; color: var(--success);">
                ✓ 已解析 ${ips.length} 个地址
            </div>
            <div class="parsed-targets-grid">
                ${ips.slice(0, 20).map(ip => `<div class="parsed-target-item">${ip}</div>`).join('')}
                ${ips.length > 20 ? `<div class="parsed-target-item">... 还有 ${ips.length - 20} 个</div>` : ''}
            </div>
        `;
    }
    
    updateSelectedTargetsList();
    updateStepButtons();
    showToast(`已添加 ${ips.length} 个目标`, 'success');
}

/**
 * 展开IP地址范围
 */
function expandIPRange(range) {
    const ips = [];
    
    // CIDR 格式
    const cidrMatch = range.match(/^(\d+\.\d+\.\d+)\.(\d+)\/(\d+)$/);
    if (cidrMatch) {
        const prefix = cidrMatch[1];
        const maskBits = parseInt(cidrMatch[3]);
        const hostBits = 32 - maskBits;
        const count = Math.min(Math.pow(2, hostBits), 256);
        for (let i = 1; i < count - 1 && i < 255; i++) {
            ips.push(`${prefix}.${i}`);
        }
        return ips;
    }
    
    // 范围格式: 192.168.1.1-10
    const rangeMatch = range.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
    if (rangeMatch) {
        const prefix = rangeMatch[1];
        const start = parseInt(rangeMatch[2]);
        const end = parseInt(rangeMatch[3]);
        for (let i = start; i <= end && i <= 255; i++) {
            ips.push(`${prefix}.${i}`);
        }
        return ips;
    }
    
    // 列表格式: 192.168.1.[1,2,5-10]
    const listMatch = range.match(/^(\d+\.\d+\.\d+)\.\[(.+)\]$/);
    if (listMatch) {
        const prefix = listMatch[1];
        const parts = listMatch[2].split(',');
        parts.forEach(part => {
            const subRange = part.trim().match(/^(\d+)-(\d+)$/);
            if (subRange) {
                const start = parseInt(subRange[1]);
                const end = parseInt(subRange[2]);
                for (let i = start; i <= end && i <= 255; i++) {
                    ips.push(`${prefix}.${i}`);
                }
            } else {
                const num = parseInt(part.trim());
                if (!isNaN(num) && num >= 0 && num <= 255) {
                    ips.push(`${prefix}.${num}`);
                }
            }
        });
        return ips;
    }
    
    // 单个IP
    if (/^\d+\.\d+\.\d+\.\d+$/.test(range)) {
        ips.push(range);
    }
    
    return ips;
}

// ==================== 手动输入 ====================

/**
 * 初始化手动输入
 */
function initManualInput() {
    document.getElementById('btn-parse-manual')?.addEventListener('click', parseManualTargets);
    
    // 协议选择关联端口
    document.getElementById('batch-manual-protocol')?.addEventListener('change', (e) => {
        const portInput = document.getElementById('batch-manual-port');
        if (portInput) {
            portInput.value = e.target.value === 'telnet' ? '23' : '22';
        }
    });
    
    // 设备类型关联 Enable 密码和用户名
    document.getElementById('batch-manual-type')?.addEventListener('change', (e) => {
        const enableGroup = document.getElementById('batch-manual-enable-group');
        const usernameInput = document.getElementById('batch-manual-username');
        const usernameGroup = usernameInput?.closest('.credential-item');
        
        if (enableGroup) {
            enableGroup.style.display = (e.target.value === 'cisco' || e.target.value === 'ruijie') ? '' : 'none';
        }
        // H3C-AP 类型隐藏用户名
        if (usernameGroup) {
            usernameGroup.style.display = (e.target.value === 'h3c-ap') ? 'none' : '';
        }
    });
}

/**
 * 解析手动输入的目标
 */
function parseManualTargets() {
    const text = document.getElementById('batch-manual-targets')?.value.trim();
    if (!text) {
        showToast('请输入目标列表', 'warning');
        return;
    }
    
    const defaultProtocol = document.getElementById('batch-manual-protocol')?.value || 'ssh';
    const defaultPort = parseInt(document.getElementById('batch-manual-port')?.value) || 22;
    const defaultType = document.getElementById('batch-manual-type')?.value || 'h3c';
    const defaultUsername = document.getElementById('batch-manual-username')?.value || '';
    const defaultPassword = document.getElementById('batch-manual-password')?.value || '';
    const defaultEnablePassword = document.getElementById('batch-manual-enable')?.value || '';
    
    const lines = text.split('\n').filter(l => l.trim());
    const targets = [];
    
    lines.forEach((line, idx) => {
        const parts = line.split(',').map(p => p.trim());
        const ip = parts[0];
        
        if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
        
        const targetType = parts[5] || defaultType;
        targets.push({
            id: `manual_${Date.now()}_${idx}`,
            name: ip,
            host: ip,
            port: parseInt(parts[1]) || defaultPort,
            protocol: parts[2] || defaultProtocol,
            username: parts[3] || defaultUsername,
            password: parts[4] || defaultPassword,
            type: targetType,
            enablePassword: (targetType === 'cisco' || targetType === 'ruijie') ? defaultEnablePassword : ''
        });
    });
    
    if (targets.length === 0) {
        showToast('未能解析出有效目标', 'error');
        return;
    }
    
    batchState.selectedTargets = [...batchState.selectedTargets, ...targets];
    updateSelectedTargetsList();
    updateStepButtons();
    showToast(`已添加 ${targets.length} 个目标`, 'success');
}

// ==================== 目标列表管理 ====================

/**
 * 更新已选目标列表显示
 */
function updateSelectedTargetsList() {
    const container = document.getElementById('selected-targets-list');
    const countEl = document.getElementById('batch-target-count');
    
    if (countEl) {
        countEl.textContent = `${batchState.selectedTargets.length} 台设备`;
    }
    
    if (!container) return;
    
    if (batchState.selectedTargets.length === 0) {
        container.innerHTML = `
            <div class="empty-targets">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                <p>请选择或输入目标设备</p>
                <span>从左侧设备列表选择，或使用地址范围/手动输入</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `<div class="selected-targets-tags">${batchState.selectedTargets.map(target => {
        const iconPath = getBatchDeviceIcon(target.type);
        return `
            <div class="selected-target-item" data-id="${target.id}">
                <div class="target-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">${iconPath}</svg>
                </div>
                <div class="target-info">
                    <div class="target-name">${escapeHtml(target.name || target.host)}</div>
                    <div class="target-meta">
                        <span class="target-ip">${escapeHtml(target.host)}</span>
                        <span class="target-protocol">${target.protocol}</span>
                    </div>
                </div>
                <div class="target-remove" onclick="removeTarget('${target.id}')" title="移除">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </div>
            </div>
        `;
    }).join('')}</div>`;
    
    // 同步更新设备列表中的选中状态
    document.querySelectorAll('#batch-device-list .batch-device-item').forEach(item => {
        const id = item.dataset.id;
        const isSelected = batchState.selectedTargets.some(t => t.id === id);
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = isSelected;
        item.classList.toggle('selected', isSelected);
    });

    updateBatchDeviceStats();
    updateBatchGroupMeta();
}

/**
 * 移除目标
 */
function removeTarget(id) {
    batchState.selectedTargets = batchState.selectedTargets.filter(t => t.id !== id);
    updateSelectedTargetsList();
    updateStepButtons();
    updateDeviceStats();
    updateSelectionButtons();
    
    const checkbox = document.querySelector(`#batch-device-list input[value="${id}"]`);
    if (checkbox) {
        checkbox.checked = false;
        checkbox.closest('.batch-device-item')?.classList.remove('selected');
    }
}

/**
 * 更新步骤按钮状态
 */
function updateStepButtons() {
    const btn = document.getElementById('btn-to-step-2');
    const count = batchState.selectedTargets.length;
    if (btn) {
        btn.disabled = count === 0;
    }
    const hint = document.getElementById('batch-step1-hint');
    if (hint) {
        hint.textContent = count === 0
            ? '请先选择目标设备，至少需要 1 台'
            : `已选 ${count} 台设备，可进入下一步`;
    }
}

// 暴露全局函数
window.removeTarget = removeTarget;

/**
 * 更新分组选择的元数据（已选/总数）
 */
function updateBatchGroupMeta() {
    const meta = document.getElementById('batch-group-meta');
    const select = document.getElementById('batch-group-select');
    if (!meta || !select) return;

    const groupName = select.value;
    if (!groupName) {
        meta.textContent = '';
        return;
    }

    const devices = state.devices || [];
    const total = devices.filter(d => getDeviceGroupName(d) === groupName).length;
    const selected = batchState.selectedTargets.filter(t => getDeviceGroupName(t) === groupName).length;

    meta.textContent = `已选 ${selected}/${total}`;
}

/**
 * 根据当前分组筛选设备列表
 */
function applyBatchGroupFilter() {
    const select = document.getElementById('batch-group-select');
    const groupName = select?.value || '';
    const items = document.querySelectorAll('#batch-device-list .batch-device-item');

    let visibleCount = 0;
    items.forEach(item => {
        const itemGroup = item.dataset.group || '';
        const searchMatch = item.dataset.searchMatch !== '0';
        const show = (!groupName || itemGroup === groupName) && searchMatch;
        item.style.display = show ? '' : 'none';
        if (show) visibleCount++;
    });

    const totalEl = document.getElementById('batch-device-total');
    if (totalEl) totalEl.textContent = visibleCount;

    updateBatchDeviceStats();
    updateSelectionButtons();
    updateBatchGroupMeta();
}
