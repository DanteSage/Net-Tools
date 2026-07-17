/**
 * 设备导入导出
 * @module devices/import-export
 */

// ==================== CSV 模板定义 ====================

// CSV 模板表头定义
const CSV_HEADERS = ['name', 'host', 'port', 'protocol', 'type', 'username', 'password', 'enablePassword', 'group', 'tags', 'description'];
const CSV_HEADERS_CN = ['设备名称', 'IP地址/主机名', '端口', '协议', '设备类型', '用户名', '密码', 'Enable密码', '分组', '标签', '描述'];

// 设备类型映射
const DEVICE_TYPES = {
    'h3c': 'H3C',
    'h3c-ap': 'H3C-AP',
    'huawei': 'Huawei',
    'cisco': 'Cisco',
    'ruijie': 'Ruijie',
    'juniper': 'Juniper',
    'linux': 'Linux',
    'other': '其他'
};

// 协议映射
const PROTOCOLS = {
    'ssh': 'SSH',
    'telnet': 'Telnet',
    'console': '串口'
};

// ==================== 下载导入模板 ====================

/**
 * 下载设备导入模板
 */
async function downloadDeviceTemplate() {
    // CSV 模板内容（使用 UTF-8 BOM 确保 Excel 正确识别中文）
    const BOM = '\uFEFF';
    
    // 创建模板说明和表头
    const templateLines = [
        // 表头行
        CSV_HEADERS_CN.join(','),
        // 示例数据行
        '核心交换机-01,192.168.1.1,22,ssh,h3c,admin,password123,,核心设备,网络设备,核心交换机示例',
        '接入交换机-01,192.168.1.2,23,telnet,huawei,admin,password123,,接入层,网络设备,Telnet连接示例',
        '路由器-01,192.168.1.254,22,ssh,cisco,admin,password123,enable123,核心设备,网络设备,Cisco设备示例(需Enable密码)',
        'Linux服务器-01,192.168.1.100,22,ssh,linux,root,password123,,服务器,服务器,Linux服务器示例',
        '',
        '# ===== 导入说明 =====',
        '# 1. 请删除此说明行和示例数据后填写您的设备信息',
        '# 2. 设备名称和IP地址为必填项，其他字段可留空',
        '# 3. 端口默认值: SSH=22, Telnet=23',
        '# 4. 协议可选值: ssh / telnet / console',
        '# 5. 设备类型可选值: h3c / h3c-ap / huawei / cisco / ruijie / juniper / linux / other',
        '# 6. Enable密码仅 Cisco/Ruijie 设备需要填写',
        '# 7. 分组留空则归入默认分组',
        '# 8. 多个标签请用分号(;)分隔，如: 核心;重要;机戺A',
        '# 9. 导入前请删除所有以 # 开头的说明行',
        '# 10. 请确保文件保存为 CSV 格式(逗号分隔)',
    ];
    
    const csvContent = BOM + templateLines.join('\r\n');
    
    try {
        const result = await window.api.dialog?.writeTextFile?.({
            defaultPath: `设备导入模板.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        }, csvContent);

        if (result) {
            showToast('模板已下载，请按说明填写后导入', 'success');
        }
    } catch (error) {
        console.error('下载设备模板失败:', error);
        showToast('下载模板失败: ' + error.message, 'error');
    }
}

// ==================== 导入设备 ====================

/**
 * 导入设备
 */
async function importDevices() {
    try {
        const selectedFile = await window.api.dialog?.readTextFile?.({
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        });
        if (!selectedFile) return;

        const { filePath, content } = selectedFile;
        let importedDevices = [];
        
        if (filePath.toLowerCase().endsWith('.csv')) {
            importedDevices = parseCSVDevices(content);
        } else {
            showToast('请使用 CSV 格式的文件导入', 'warning');
            return;
        }
        
        if (!Array.isArray(importedDevices) || importedDevices.length === 0) {
            showToast('无有效设备数据，请检查文件格式', 'warning');
            return;
        }
        
        // 验证并处理导入的设备
        let validCount = 0;
        let invalidCount = 0;
        
        importedDevices.forEach(d => {
            if (d.name && d.host) {
                d.id = generateId();
                d.createdAt = new Date().toISOString();
                d.updatedAt = new Date().toISOString();
                delete d._encrypted;
                delete d._enableEncrypted;
                validCount++;
            } else {
                invalidCount++;
            }
        });
        
        // 过滤无效设备
        importedDevices = importedDevices.filter(d => d.name && d.host);
        
        if (importedDevices.length === 0) {
            showToast('没有有效的设备数据，请检查设备名称和IP地址是否填写', 'warning');
            return;
        }
        
        state.devices = [...state.devices, ...importedDevices];
        
        // 检查并添加新分组
        const newGroups = new Set();
        importedDevices.forEach(d => {
            if (d.group && d.group.trim() && !deviceState.groups.includes(d.group.trim())) {
                newGroups.add(d.group.trim());
            }
        });
        if (newGroups.size > 0) {
            deviceState.groups.push(...newGroups);
            // 排序，保持默认分组在前
            const defaultGroup = deviceState.defaultGroup;
            deviceState.groups.sort();
            const idx = deviceState.groups.indexOf(defaultGroup);
            if (idx > 0) {
                deviceState.groups.splice(idx, 1);
                deviceState.groups.unshift(defaultGroup);
            }
            await saveGroups();
            updateGroupFilter();
        }
        
        const encrypted = await encryptDevicePasswords(state.devices);
        await window.api.devices.save(encrypted);
        
        renderDeviceList();
        
        let message = `成功导入 ${validCount} 台设备`;
        if (invalidCount > 0) {
            message += `，跳过 ${invalidCount} 条无效数据`;
        }
        showToast(message, 'success');
    } catch (error) {
        console.error('导入失败:', error);
        showToast('导入失败: ' + error.message, 'error');
    }
}

/**
 * 解析CSV设备数据
 * 支持中文表头和英文表头，自动检测分隔符
 */
function parseCSVDevices(content) {
    // 移除 UTF-8 BOM
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    
    // 清理内容：移除回车符，统一换行
    content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    const lines = content.split('\n').filter(l => {
        const trimmed = l.trim();
        // 过滤空行和注释行
        return trimmed && !trimmed.startsWith('#');
    });
    
    if (lines.length < 2) {
        console.log('[Import] 文件行数不足:', lines.length);
        return [];
    }
    
    // 自动检测分隔符（逗号、分号、制表符）
    const delimiter = detectDelimiter(lines[0]);
    console.log('[Import] 检测到分隔符:', delimiter === '\t' ? 'TAB' : delimiter);
    
    // 解析表头，支持中英文和别名
    const rawHeaders = parseCSVLine(lines[0], delimiter);
    const headers = rawHeaders.map(h => normalizeHeader(h));
    console.log('[Import] 解析表头:', headers);
    
    // 检查是否有必要的列
    const hasName = headers.includes('name');
    const hasHost = headers.includes('host');
    if (!hasName || !hasHost) {
        console.log('[Import] 缺少必要的列 (name/host)，请检查文件编码是否为 UTF-8');
        return [];
    }
    
    const devices = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], delimiter);
        const device = {};
        
        headers.forEach((h, idx) => {
            const value = values[idx]?.trim();
            if (value && h) {
                device[h] = value;
            }
        });
        
        // 验证必填字段
        if (device.name && device.host) {
            // 设置默认值和类型转换
            device.type = normalizeDeviceType(device.type) || 'h3c';
            device.protocol = normalizeProtocol(device.protocol) || 'ssh';
            device.port = parseInt(device.port) || (device.protocol === 'telnet' ? 23 : 22);
            device.favorite = false;
            devices.push(device);
        } else {
            console.log(`[Import] 第${i+1}行无效:`, device);
        }
    }
    
    console.log('[Import] 成功解析设备数:', devices.length);
    return devices;
}

/**
 * 自动检测分隔符
 */
function detectDelimiter(line) {
    const delimiters = [',', ';', '\t', '|'];
    let maxCount = 0;
    let detected = ',';
    
    for (const d of delimiters) {
        const count = (line.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
        if (count > maxCount) {
            maxCount = count;
            detected = d;
        }
    }
    
    return detected;
}

/**
 * 标准化表头名称
 */
function normalizeHeader(h) {
    const trimmed = (h || '').trim();
    if (!trimmed) return '';
    
    // 中文表头映射到英文
    const cnIndex = CSV_HEADERS_CN.indexOf(trimmed);
    if (cnIndex >= 0) {
        return CSV_HEADERS[cnIndex];
    }
    
    // 别名映射
    const aliasMap = {
        '设备名': 'name', '名称': 'name', '主机名': 'name', 'hostname': 'name', 'device': 'name', 'devicename': 'name',
        'ip': 'host', 'ip地址': 'host', '地址': 'host', 'address': 'host', 'ipaddress': 'host',
        '端口': 'port', '端口号': 'port',
        '协议': 'protocol', '连接协议': 'protocol', '连接方式': 'protocol',
        '类型': 'type', '设备类型': 'type', 'devicetype': 'type', 'vendor': 'type', '厂商': 'type',
        '用户': 'username', '账号': 'username', 'user': 'username', 'account': 'username',
        '密码': 'password', 'pass': 'password', 'pwd': 'password',
        'enable': 'enablePassword', 'enable密码': 'enablePassword', '特权密码': 'enablePassword',
        '分组': 'group', '组': 'group', 'category': 'group', '类别': 'group',
        '标签': 'tags', 'tag': 'tags', 'label': 'tags',
        '描述': 'description', '备注': 'description', 'remark': 'description', 'note': 'description', 'comment': 'description'
    };
    
    const lower = trimmed.toLowerCase();
    if (aliasMap[lower]) {
        return aliasMap[lower];
    }
    if (aliasMap[trimmed]) {
        return aliasMap[trimmed];
    }
    
    // 直接返回小写
    return lower;
}

/**
 * 解析 CSV 行（处理引号和分隔符）
 */
function parseCSVLine(line, delimiter = ',') {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    
    return result;
}

/**
 * 标准化设备类型
 */
function normalizeDeviceType(type) {
    if (!type) return null;
    const lower = type.toLowerCase().trim();
    
    // 直接匹配
    if (DEVICE_TYPES[lower]) return lower;
    
    // 中文匹配
    for (const [key, value] of Object.entries(DEVICE_TYPES)) {
        if (value === type) return key;
    }
    
    return lower;
}

/**
 * 标准化协议
 */
function normalizeProtocol(protocol) {
    if (!protocol) return null;
    const lower = protocol.toLowerCase().trim();
    
    if (PROTOCOLS[lower]) return lower;
    
    // 中文匹配
    for (const [key, value] of Object.entries(PROTOCOLS)) {
        if (value === protocol) return key;
    }
    
    return lower;
}

// ==================== 导出设备 ====================

/**
 * 导出设备为 CSV 格式
 */
async function exportDevices(devices) {
    if (devices.length === 0) {
        showToast('没有可导出的设备', 'warning');
        return;
    }
    
    // UTF-8 BOM
    const BOM = '\uFEFF';
    
    // 表头行
    const csvLines = [CSV_HEADERS_CN.join(',')];
    
    // 数据行
    devices.forEach(d => {
        const row = CSV_HEADERS.map(header => {
            let value = d[header] || '';
            
            // 如果值包含逗号、引号或换行，需要用引号包裹
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            
            return value;
        });
        csvLines.push(row.join(','));
    });
    
    const csvContent = BOM + csvLines.join('\r\n');
    
    try {
        const result = await window.api.dialog?.writeTextFile?.({
            defaultPath: `设备列表_${new Date().toISOString().slice(0, 10)}.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        }, csvContent);

        if (result) {
            showToast(`已导出 ${devices.length} 台设备`, 'success');
        }
    } catch (error) {
        console.error('导出设备失败:', error);
        showToast('导出失败: ' + error.message, 'error');
    }
}
