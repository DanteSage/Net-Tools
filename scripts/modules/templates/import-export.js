/**
 * 命令模板模块 - 导入导出
 * @module templates/import-export
 */

// ==================== 下载导入模板 ====================

/**
 * 下载命令模板导入模板
 */
async function downloadTemplateImportTemplate() {
    try {
        // CSV 模板内容（使用 UTF-8 BOM 确保 Excel 正确识别中文）
        const BOM = '\uFEFF';
        
        // 创建模板说明和表头
        const templateLines = [
            // 表头行
            TEMPLATE_CSV_HEADERS_CN.join(','),
            // 示例数据行
            '"查看设备信息","info","h3c","display version\\ndisplay device\\ndisplay cpu\\ndisplay memory","H3C设备基础信息收集"',
            '"接口状态检查","troubleshoot","all","display interface brief\\ndisplay ip interface brief","检查接口状态"',
            '"配置备份","backup","huawei","display current-configuration\\ndisplay saved-configuration","华为设备配置备份"',
            '',
            '# ===== 导入说明 =====',
            '# 1. 请删除此说明行和示例数据后填写您的模板信息',
            '# 2. 模板名称和命令内容为必填项',
            '# 3. 分类可选值: info(信息收集) / config(配置管理) / backup(备份恢复) / troubleshoot(故障排查) / security(安全审计) / other(其他)',
            '# 4. 适用设备可选值: all(通用) / h3c / h3c-ap / huawei / cisco / ruijie / juniper / linux / other',
            '# 5. 命令内容支持多行: 使用双引号包裹内容，命令之间用换行符分隔',
            '# 6. 如果内容包含双引号，需要用两个双引号表示转义，如: ""示例""',
            '# 7. 导入前请删除所有以 # 开头的说明行',
            '# 8. 请确保文件保存为 CSV 格式(逗号分隔)，编码为 UTF-8',
        ];
        
        const csvContent = BOM + templateLines.join('\r\n');
        
        const filePath = await window.api.dialog.saveFile({
            defaultPath: '命令模板导入模板.csv',
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        });
        
        if (filePath) {
            await window.api.fs.writeFile(filePath, csvContent);
            showToast('模板已下载，请按说明填写后导入', 'success');
        }
    } catch (error) {
        console.error('下载模板失败:', error);
        showToast('下载模板失败: ' + error.message, 'error');
    }
}

// ==================== 导入模板 ====================

/**
 * 导入模板
 */
async function importTemplates() {
    try {
        const filePath = await window.api.dialog.selectFile({
            filters: [
                { name: 'CSV 文件', extensions: ['csv'] },
                { name: '所有支持的格式', extensions: ['csv'] }
            ]
        });
        
        if (!filePath) return;
        
        const content = await window.api.fs.readFile(filePath);
        
        if (!filePath.endsWith('.csv')) {
            showToast('请使用 CSV 格式的文件导入', 'warning');
            return;
        }
        
        const importedTemplates = parseCSVTemplates(content);
        
        if (!Array.isArray(importedTemplates) || importedTemplates.length === 0) {
            showToast('无有效模板数据，请检查文件格式', 'warning');
            return;
        }
        
        // 验证并处理导入的模板
        let validCount = 0;
        let invalidCount = 0;
        
        importedTemplates.forEach(tpl => {
            if (tpl.name && tpl.commands) {
                tpl.id = generateId();
                tpl.createdAt = new Date().toISOString();
                tpl.updatedAt = new Date().toISOString();
                validCount++;
            } else {
                invalidCount++;
            }
        });
        
        // 过滤无效模板
        const validTemplates = importedTemplates.filter(tpl => tpl.name && tpl.commands);
        
        if (validTemplates.length === 0) {
            showToast('没有有效的模板数据，请检查模板名称和命令内容是否填写', 'warning');
            return;
        }
        
        // 合并模板
        state.templates = [...state.templates, ...validTemplates];
        
        await window.api.templates.save(state.templates);
        renderTemplatesList();
        
        let message = `成功导入 ${validCount} 个模板`;
        if (invalidCount > 0) {
            message += `，跳过 ${invalidCount} 条无效数据`;
        }
        showToast(message, 'success');
    } catch (error) {
        console.error('导入模板失败:', error);
        showToast('导入失败: ' + error.message, 'error');
    }
}

/**
 * 解析CSV模板数据
 * 支持中文表头和英文表头
 */
function parseCSVTemplates(content) {
    // 移除 UTF-8 BOM
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    
    const lines = content.split(/\r?\n/).filter(l => {
        const trimmed = l.trim();
        // 过滤空行和注释行
        return trimmed && !trimmed.startsWith('#');
    });
    
    if (lines.length < 2) return [];
    
    // 解析表头，支持中英文
    const rawHeaders = parseTemplateCSVLine(lines[0]);
    const headers = rawHeaders.map(h => {
        const trimmed = h.trim();
        // 中文表头映射到英文
        const cnIndex = TEMPLATE_CSV_HEADERS_CN.indexOf(trimmed);
        if (cnIndex >= 0) {
            return TEMPLATE_CSV_HEADERS[cnIndex];
        }
        return trimmed.toLowerCase();
    });
    
    const templates = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseTemplateCSVLine(lines[i]);
        const template = {};
        
        headers.forEach((h, idx) => {
            const value = values[idx]?.trim();
            if (value !== undefined && value !== '') {
                template[h] = value;
            }
        });
        
        // 验证必填字段
        if (template.name && template.commands) {
            // 设置默认值和标准化
            template.category = normalizeTemplateCategory(template.category) || 'other';
            template.deviceType = normalizeTemplateDeviceType(template.deviceType) || 'all';
            template.description = template.description || '';
            templates.push(template);
        }
    }
    
    return templates;
}

/**
 * 解析 CSV 行（处理引号、逗号和多行内容）
 */
function parseTemplateCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // 转义的双引号
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
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
 * 标准化模板分类
 */
function normalizeTemplateCategory(category) {
    if (!category) return null;
    const lower = category.toLowerCase().trim();
    
    // 直接匹配英文
    if (TEMPLATE_CATEGORIES[lower]) return lower;
    
    // 中文匹配
    for (const [key, value] of Object.entries(TEMPLATE_CATEGORIES)) {
        if (value === category.trim()) return key;
    }
    
    return lower;
}

/**
 * 标准化模板设备类型
 */
function normalizeTemplateDeviceType(deviceType) {
    if (!deviceType) return null;
    const lower = deviceType.toLowerCase().trim();
    
    // 直接匹配英文
    if (TEMPLATE_DEVICE_TYPES[lower]) return lower;
    
    // 中文匹配
    for (const [key, value] of Object.entries(TEMPLATE_DEVICE_TYPES)) {
        if (value === deviceType.trim()) return key;
    }
    
    return lower;
}

// ==================== 导出模板 ====================

/**
 * 导出模板为 CSV 格式
 */
async function exportTemplates() {
    if (state.templates.length === 0) {
        showToast('没有可导出的模板', 'warning');
        return;
    }
    
    try {
        // UTF-8 BOM
        const BOM = '\uFEFF';
        
        // 表头行
        const csvLines = [TEMPLATE_CSV_HEADERS_CN.join(',')];
        
        // 数据行
        state.templates.forEach(tpl => {
            const row = TEMPLATE_CSV_HEADERS.map(header => {
                let value = tpl[header] || '';
                
                // 如果值包含逗号、引号或换行，需要用引号包裹
                if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r'))) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                
                return value;
            });
            csvLines.push(row.join(','));
        });
        
        const csvContent = BOM + csvLines.join('\r\n');
        
        const filePath = await window.api.dialog?.saveFile?.({
            defaultPath: `命令模板_${new Date().toISOString().slice(0, 10)}.csv`,
            filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        });
        
        if (!filePath) return;
        
        await window.api.fs?.writeFile?.(filePath, csvContent);
        showToast(`已导出 ${state.templates.length} 个模板`, 'success');
    } catch (error) {
        console.error('导出模板失败:', error);
        showToast('导出失败', 'error');
    }
}
