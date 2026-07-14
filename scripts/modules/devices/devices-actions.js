/**
 * 设备操作模块
 * @module devices/actions
 */

// ==================== 设备模态框 ====================

/**
 * 初始化设备模态框
 */
function initDeviceModal() {
    const modal = document.getElementById('device-modal');
    const addBtn = document.getElementById('btn-add-device');
    const closeBtn = document.getElementById('device-modal-close');
    const cancelBtn = document.getElementById('btn-cancel-device');
    const saveBtn = document.getElementById('btn-save-device');
    const selectKeyBtn = document.getElementById('btn-select-key');
    const protocolSelect = document.getElementById('device-protocol');
    const deviceTypeSelect = document.getElementById('device-type');
    
    addBtn.addEventListener('click', () => {
        document.getElementById('device-modal-title').textContent = '添加设备';
        document.getElementById('device-form').reset();
        document.getElementById('device-id').value = '';
        document.getElementById('device-port').value = '22';
        updateProtocolFields('ssh');
        updateEnablePasswordVisibility('h3c');
        updateDeviceGroupSelect();
        modal.classList.add('active');
    });
    
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        resetTestConnectionButton();
    });
    cancelBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        resetTestConnectionButton();
    });
    
    protocolSelect.addEventListener('change', (e) => updateProtocolFields(e.target.value));
    deviceTypeSelect.addEventListener('change', (e) => updateEnablePasswordVisibility(e.target.value));
    
    selectKeyBtn.addEventListener('click', async () => {
        const filePath = await window.api.dialog.selectFile({
            filters: [{ name: '私钥文件', extensions: ['pem', 'key', 'ppk', '*'] }]
        });
        if (filePath) document.getElementById('device-key').value = filePath;
    });
    
    saveBtn.addEventListener('click', saveDevice);
    
    // 密码显示/隐藏切换
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            const iconEye = btn.querySelector('.icon-eye');
            const iconEyeOff = btn.querySelector('.icon-eye-off');
            
            if (input.type === 'password') {
                input.type = 'text';
                iconEye.style.display = 'none';
                iconEyeOff.style.display = 'block';
            } else {
                input.type = 'password';
                iconEye.style.display = 'block';
                iconEyeOff.style.display = 'none';
            }
        });
    });
    
    // 连接测试按钮
    document.getElementById('btn-test-connection')?.addEventListener('click', testConnection);
    
    // 串口刷新按钮
    document.getElementById('btn-refresh-ports')?.addEventListener('click', refreshSerialPorts);
}

/**
 * 根据协议类型显示/隐藏配置区域，并自动设置默认端口
 */
function updateProtocolFields(protocol) {
    const networkConfig = document.getElementById('network-config');
    const serialConfig = document.getElementById('serial-config');
    const hostGroup = document.getElementById('device-host').closest('.form-group');
    const portRow = document.getElementById('device-port').closest('.form-row');
    const portInput = document.getElementById('device-port');
    
    if (protocol === 'console') {
        networkConfig.style.display = 'none';
        serialConfig.style.display = 'block';
        hostGroup.style.display = 'none';
        portRow.querySelector('.form-group').style.display = 'none';
    } else {
        networkConfig.style.display = 'block';
        serialConfig.style.display = 'none';
        hostGroup.style.display = 'block';
        portRow.querySelector('.form-group').style.display = 'block';
        
        // 自动设置默认端口
        const currentPort = parseInt(portInput.value);
        if (protocol === 'ssh' && (currentPort === 23 || currentPort === 21 || !currentPort)) {
            portInput.value = 22;
        } else if (protocol === 'telnet' && (currentPort === 22 || currentPort === 21 || !currentPort)) {
            portInput.value = 23;
        } else if (protocol === 'ftp' && (currentPort === 22 || currentPort === 23 || !currentPort)) {
            portInput.value = 21;
        }
    }
}

/**
 * 根据设备类型显示/隐藏Enable密码输入框和用户名字段
 */
function updateEnablePasswordVisibility(deviceType) {
    const enableGroup = document.getElementById('enable-password-group');
    const usernameGroup = document.getElementById('device-username')?.closest('.form-group');
    
    if (enableGroup) {
        enableGroup.style.display = (deviceType === 'cisco' || deviceType === 'ruijie') ? 'block' : 'none';
    }
    
    // H3C-AP 类型不需要用户名
    if (usernameGroup) {
        usernameGroup.style.display = (deviceType === 'h3c-ap') ? 'none' : '';
    }
}

/**
 * 保存设备
 */
async function saveDevice() {
    const id = document.getElementById('device-id').value;
    const protocol = document.getElementById('device-protocol').value;
    
    const device = {
        id: id || generateId(),
        name: document.getElementById('device-name').value,
        type: document.getElementById('device-type').value,
        protocol: protocol,
        group: document.getElementById('device-group')?.value || '',
        description: document.getElementById('device-description').value,
        tags: document.getElementById('device-tags').value,
        createdAt: id ? state.devices.find(d => d.id === id)?.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // 保留原有的收藏状态
    if (id) {
        const existing = state.devices.find(d => d.id === id);
        if (existing) {
            device.favorite = existing.favorite;
        }
    }
    
    if (protocol === 'console') {
        device.comPort = document.getElementById('device-com-port').value;
        device.baudRate = parseInt(document.getElementById('device-baudrate').value);
        device.dataBits = parseInt(document.getElementById('device-databits').value);
        device.parity = document.getElementById('device-parity').value;
        device.stopBits = parseFloat(document.getElementById('device-stopbits').value);
        device.rtscts = document.getElementById('device-rtscts').checked;
        device.xon = document.getElementById('device-xonxoff').checked;
        device.xoff = device.xon;
        device.encoding = state.devices.find(d => d.id === id)?.encoding || 'utf-8';
        device.host = device.comPort;
    } else {
        device.host = document.getElementById('device-host').value;
        device.port = parseInt(document.getElementById('device-port').value) || 22;
        device.username = document.getElementById('device-username').value;
        device.password = document.getElementById('device-password').value;
        device.privateKey = document.getElementById('device-key').value;
        if (device.type === 'cisco' || device.type === 'ruijie') {
            device.enablePassword = document.getElementById('device-enable-password').value;
        }
    }
    
    if (!device.name) {
        showToast('请填写设备名称', 'warning');
        return;
    }
    if (protocol === 'console' && !device.comPort) {
        showToast('请选择串口', 'warning');
        return;
    }
    if (protocol === 'console' && (!Number.isInteger(device.baudRate) || device.baudRate <= 0 || device.baudRate > 10000000)) {
        showToast('波特率必须是 1 到 10000000 之间的整数', 'warning');
        return;
    }
    // H3C-AP 类型不需要用户名
    const needsUsername = protocol !== 'console' && device.type !== 'h3c-ap';
    if (protocol !== 'console' && !device.host) {
        showToast('请填写主机地址', 'warning');
        return;
    }
    if (needsUsername && !device.username) {
        showToast('请填写用户名', 'warning');
        return;
    }
    
    if (id) {
        const index = state.devices.findIndex(d => d.id === id);
        if (index !== -1) state.devices[index] = device;
    } else {
        state.devices.push(device);
    }
    
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
        showToast(id ? '设备已更新' : '设备已添加', 'success');
        if (window.addRuntimeLog) addRuntimeLog('success', id ? '设备已更新' : '设备已添加', device.name);
        document.getElementById('device-modal').classList.remove('active');
        renderDeviceList();
    } catch (error) {
        console.error('保存设备失败:', error);
        showToast('保存失败', 'error');
    }
}

/**
 * 编辑设备
 */
function editDevice(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device) return;
    
    document.getElementById('device-modal-title').textContent = '编辑设备';
    document.getElementById('device-id').value = device.id;
    document.getElementById('device-name').value = device.name || '';
    document.getElementById('device-type').value = device.type || 'cisco';
    document.getElementById('device-protocol').value = device.protocol || 'ssh';
    
    // 设置分组
    updateDeviceGroupSelect();
    const groupSelect = document.getElementById('device-group');
    if (groupSelect) groupSelect.value = device.group || '';
    
    document.getElementById('device-description').value = device.description || '';
    document.getElementById('device-tags').value = device.tags || '';
    
    const protocol = device.protocol || 'ssh';
    const deviceType = device.type || 'h3c';
    updateProtocolFields(protocol);
    updateEnablePasswordVisibility(deviceType);
    
    if (protocol === 'console') {
        document.getElementById('device-com-port').value = device.comPort || 'COM1';
        document.getElementById('device-baudrate').value = device.baudRate || 9600;
        document.getElementById('device-databits').value = device.dataBits || 8;
        document.getElementById('device-parity').value = device.parity || 'none';
        document.getElementById('device-stopbits').value = device.stopBits || 1;
        document.getElementById('device-rtscts').checked = Boolean(device.rtscts);
        document.getElementById('device-xonxoff').checked = Boolean(device.xon || device.xoff);
    } else {
        document.getElementById('device-host').value = device.host || '';
        document.getElementById('device-port').value = device.port || 22;
        document.getElementById('device-username').value = device.username || '';
        document.getElementById('device-password').value = device.password || '';
        document.getElementById('device-key').value = device.privateKey || '';
        document.getElementById('device-enable-password').value = device.enablePassword || '';
    }
    
    document.getElementById('device-modal').classList.add('active');
}

/**
 * 删除设备
 */
async function deleteDevice(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device) return;
    
    const confirmed = await showConfirm({
        title: '删除设备',
        message: `确定要删除设备「${device.name}」吗？此操作无法撤销。`,
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    state.devices = state.devices.filter(d => d.id !== id);
    
    try {
        await window.api.devices.save(state.devices);
        showToast('设备已删除', 'success');
        if (window.addRuntimeLog) addRuntimeLog('info', '设备已删除', device.name);
        renderDeviceList();
    } catch (error) {
        showToast('删除失败', 'error');
    }
}

/**
 * 复制设备
 */
function copyDevice(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device) return;
    
    const copy = { ...device };
    copy.id = generateId();
    copy.name = device.name + ' (副本)';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    delete copy._encrypted;
    delete copy._enableEncrypted;
    
    state.devices.push(copy);
    
    encryptDevicePasswords(state.devices).then(encrypted => {
        window.api.devices.save(encrypted);
        showToast('设备已复制', 'success');
        renderDeviceList();
    });
}

// ==================== 连接测试 ====================

/**
 * 测试连接
 */
async function testConnection() {
    const btn = document.getElementById('btn-test-connection');
    const protocol = document.getElementById('device-protocol').value;
    
    // 获取表单数据
    const host = document.getElementById('device-host').value.trim();
    const port = parseInt(document.getElementById('device-port').value) || 22;
    const username = document.getElementById('device-username').value.trim();
    const password = document.getElementById('device-password').value;
    const privateKey = document.getElementById('device-key').value;
    
    // 验证必填字段
    if (protocol === 'console') {
        const comPort = document.getElementById('device-com-port').value;
        if (!comPort) {
            showToast('请选择串口', 'warning');
            return;
        }
        showToast('串口测试暂不支持', 'info');
        return;
    }
    
    if (!host) {
        showToast('请输入主机地址', 'warning');
        return;
    }
    
    // H3C-AP 类型不需要用户名
    const deviceType = document.getElementById('device-type').value;
    if (deviceType !== 'h3c-ap' && !username) {
        showToast('请输入用户名', 'warning');
        return;
    }
    
    // 更新按钮状态
    btn.classList.remove('success', 'error');
    btn.classList.add('testing');
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
        </svg>
        测试中...
    `;
    
    try {
        let result;
        
        // H3C-AP 使用 Telnet 协议测试（只测试 TCP 连接）
        if (deviceType === 'h3c-ap' || protocol === 'telnet') {
            result = await window.api.telnet.test({
                host,
                port: port || 23
            });
        } else {
            result = await window.api.ssh.test({
                host,
                port,
                username,
                password,
                privateKey: privateKey || undefined
            });
        }
        
        if (result.success) {
            btn.classList.remove('testing');
            btn.classList.add('success');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                连接成功
            `;
            showToast('连接测试成功', 'success');
            if (window.addRuntimeLog) addRuntimeLog('success', '连接测试成功', host + ':' + port);
        } else {
            btn.classList.remove('testing');
            btn.classList.add('error');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
                连接失败
            `;
            showToast('连接失败: ' + result.error, 'error');
            if (window.addRuntimeLog) addRuntimeLog('error', '连接测试失败', host + ':' + port, result.error);
        }
    } catch (error) {
        btn.classList.remove('testing');
        btn.classList.add('error');
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
            连接失败
        `;
        showToast('连接测试出错', 'error');
    }
    
    btn.disabled = false;
    
    // 3秒后恢复按钮状态
    setTimeout(() => {
        resetTestConnectionButton();
    }, 3000);
}

/**
 * 重置测试连接按钮状态
 */
function resetTestConnectionButton() {
    const btn = document.getElementById('btn-test-connection');
    if (!btn) return;
    
    btn.classList.remove('success', 'error', 'testing');
    btn.disabled = false;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        测试连接
    `;
}

// ==================== 串口检测 ====================

/**
 * 刷新串口列表
 */
async function refreshSerialPorts(options = {}) {
    const select = document.getElementById('device-com-port');
    const btn = document.getElementById('btn-refresh-ports');
    const notify = options?.notify !== false;
    
    // 保存当前选中值
    const currentValue = select.value;
    
    // 显示加载状态
    select.innerHTML = '<option value="">检测中...</option>';
    btn.disabled = true;
    btn.querySelector('svg').classList.add('spin');
    
    try {
        const result = await window.api.serial.list();
        
        if (result.success && result.ports.length > 0) {
            select.innerHTML = result.ports.map(port => 
                `<option value="${port.path}">${port.path}${port.manufacturer ? ` - ${port.manufacturer}` : ''}</option>`
            ).join('');
            
            // 恢复之前选中的值
            if (currentValue && result.ports.some(p => p.path === currentValue)) {
                select.value = currentValue;
            }
            
            if (notify) showToast(`检测到 ${result.ports.length} 个串口`, 'success');
        } else {
            select.innerHTML = '<option value="">未检测到串口</option>';
            if (notify) showToast('未检测到可用串口', 'warning');
        }
    } catch (error) {
        select.innerHTML = '<option value="">检测失败</option>';
        if (notify) showToast('串口检测失败', 'error');
    }
    
    btn.disabled = false;
    btn.querySelector('svg').classList.remove('spin');
}

/**
 * 初始化时检测串口
 */
function initSerialPorts() {
    refreshSerialPorts({ notify: false });
}

// ==================== 分组管理 ====================

/**
 * 打开分组管理模态框
 */
function openGroupModal() {
    renderGroupList();
    document.getElementById('group-modal').classList.add('active');
}

/**
 * 关闭分组管理模态框
 */
function closeGroupModal() {
    document.getElementById('group-modal').classList.remove('active');
}

/**
 * 渲染分组列表
 */
function renderGroupList() {
    const container = document.getElementById('group-list');
    const defaultGroup = deviceState.defaultGroup;
    
    if (deviceState.groups.length === 0) {
        container.innerHTML = `
            <div class="group-empty">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style="opacity: 0.3">
                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
                <p>暂无分组</p>
                <p style="font-size: 12px; opacity: 0.6">创建分组以便分类管理设备</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = deviceState.groups.map(group => {
        const isDefault = group === defaultGroup;
        // 默认分组计算未分组设备
        const count = isDefault 
            ? state.devices.filter(d => !d.group || !d.group.trim() || d.group === group).length
            : state.devices.filter(d => d.group === group).length;
        return `
            <div class="group-item ${isDefault ? 'default-group' : ''}" data-group="${escapeHtml(group)}">
                <div class="group-info">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                    <span class="group-name">${escapeHtml(group)}${isDefault ? ' <span style="font-size:10px;opacity:0.6">(默认)</span>' : ''}</span>
                    <span class="group-count">${count} 台设备</span>
                </div>
                <div class="group-actions">
                    ${!isDefault ? `
                    <button class="btn btn-sm btn-secondary" onclick="editGroupName('${escapeHtml(group)}')" title="重命名">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteGroup('${escapeHtml(group)}')" title="删除分组">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 创建新分组
 */
async function createGroup() {
    const input = document.getElementById('new-group-input');
    const name = input.value.trim();
    
    if (!name) {
        showToast('请输入分组名称', 'warning');
        return;
    }
    
    if (deviceState.groups.includes(name)) {
        showToast('分组已存在', 'warning');
        return;
    }
    
    deviceState.groups.push(name);
    // 排序，但保持默认分组在最前面
    const defaultGroup = deviceState.defaultGroup;
    deviceState.groups.sort();
    const idx = deviceState.groups.indexOf(defaultGroup);
    if (idx > 0) {
        deviceState.groups.splice(idx, 1);
        deviceState.groups.unshift(defaultGroup);
    }
    
    // 保存分组列表
    await saveGroups();
    
    input.value = '';
    renderGroupList();
    updateGroupFilter();
    updateDeviceGroupSelect();
    renderDeviceList();
    showToast('分组创建成功', 'success');
}

/**
 * 重命名分组
 */
async function editGroupName(oldName) {
    // 默认分组不能重命名
    if (oldName === deviceState.defaultGroup) {
        showToast('默认分组不能重命名', 'warning');
        return;
    }
    
    const newName = await showPrompt({
        title: '重命名分组',
        message: '请输入新的分组名称',
        defaultValue: oldName,
        placeholder: '分组名称'
    });
    
    if (!newName || newName === oldName) return;
    
    if (deviceState.groups.includes(newName)) {
        showToast('分组名称已存在', 'warning');
        return;
    }
    
    // 更新设备的分组
    state.devices.forEach(device => {
        if (device.group === oldName) {
            device.group = newName;
        }
    });
    
    // 更新分组列表
    const idx = deviceState.groups.indexOf(oldName);
    if (idx !== -1) {
        deviceState.groups[idx] = newName;
        // 排序，但保持默认分组在最前面
        const defaultGroup = deviceState.defaultGroup;
        deviceState.groups.sort();
        const defaultIdx = deviceState.groups.indexOf(defaultGroup);
        if (defaultIdx > 0) {
            deviceState.groups.splice(defaultIdx, 1);
            deviceState.groups.unshift(defaultGroup);
        }
    }
    
    // 保存设备和分组
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
        await saveGroups();
        renderGroupList();
        updateGroupFilter();
        updateDeviceGroupSelect();
        renderDeviceList();
        showToast('分组已重命名', 'success');
    } catch (error) {
        showToast('保存失败', 'error');
    }
}

/**
 * 删除分组
 */
async function deleteGroup(name) {
    // 默认分组不能删除
    if (name === deviceState.defaultGroup) {
        showToast('默认分组不能删除', 'warning');
        return;
    }
    
    const count = state.devices.filter(d => d.group === name).length;
    const message = count > 0 
        ? `分组「${name}」中有 ${count} 台设备，删除分组后设备将移至默认分组。` 
        : `确定要删除分组「${name}」吗？`;
    
    const confirmed = await showConfirm({
        title: '删除分组',
        message: message,
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    // 将设备移动到默认分组
    state.devices.forEach(device => {
        if (device.group === name) {
            device.group = '';
        }
    });
    
    // 移除分组
    deviceState.groups = deviceState.groups.filter(g => g !== name);
    
    // 保存设备和分组
    try {
        const devicesToSave = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(devicesToSave);
        await saveGroups();
        renderGroupList();
        updateGroupFilter();
        updateDeviceGroupSelect();
        renderDeviceList();
        showToast('分组已删除', 'success');
    } catch (error) {
        showToast('保存失败', 'error');
    }
}

/**
 * 更新设备表单中的分组选择器
 */
function updateDeviceGroupSelect() {
    const select = document.getElementById('device-group');
    if (!select) return;
    
    const currentValue = select.value;
    const defaultGroup = deviceState.defaultGroup;
    select.innerHTML = '';
    
    deviceState.groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group === defaultGroup ? '' : group; // 默认分组的值为空
        // 截断显示名称，最多6个字符
        const displayName = group.length > 6 ? group.substring(0, 6) + '...' : group;
        option.textContent = displayName;
        option.title = group; // 鼠标悬停显示完整名称
        select.appendChild(option);
    });
    
    if (currentValue && deviceState.groups.includes(currentValue)) {
        select.value = currentValue;
    }
}

/**
 * 显示输入提示框
 */
function showPrompt({ title, message, defaultValue = '', placeholder = '' }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('prompt-modal');
        const titleEl = document.getElementById('prompt-title');
        const messageEl = document.getElementById('prompt-message');
        const input = document.getElementById('prompt-input');
        const confirmBtn = document.getElementById('prompt-confirm');
        const cancelBtn = document.getElementById('prompt-cancel');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        input.value = defaultValue;
        input.placeholder = placeholder;
        
        const cleanup = () => {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeydown);
        };
        
        const onConfirm = () => {
            cleanup();
            resolve(input.value.trim());
        };
        
        const onCancel = () => {
            cleanup();
            resolve(null);
        };
        
        const onKeydown = (e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
        };
        
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeydown);
        
        modal.classList.add('active');
        input.focus();
        input.select();
    });
}

/**
 * 初始化分组模态框事件
 */
function initGroupModal() {
    const modal = document.getElementById('group-modal');
    const closeBtn = document.getElementById('group-modal-close');
    const createBtn = document.getElementById('btn-create-group');
    const input = document.getElementById('new-group-input');
    
    closeBtn?.addEventListener('click', closeGroupModal);
    createBtn?.addEventListener('click', createGroup);
    
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createGroup();
    });
    
    // 点击背景关闭
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeGroupModal();
    });
}

// 暴露全局函数
window.editDevice = editDevice;
window.deleteDevice = deleteDevice;
window.refreshSerialPorts = refreshSerialPorts;
window.openGroupModal = openGroupModal;
window.closeGroupModal = closeGroupModal;
window.createGroup = createGroup;
window.editGroupName = editGroupName;
window.showPrompt = showPrompt;
window.deleteGroup = deleteGroup;
