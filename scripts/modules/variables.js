/**
 * 定义变量模块
 * @module variables
 */

// ==================== 状态管理 ====================

const variableState = {
    variables: [],
    selectedId: null
};

// 变量值缓存（避免重复生成）
const variableValuesCache = new Map();

// ==================== 初始化 ====================

/**
 * 初始化变量模块
 */
function initVariablesModule() {
    initVariableModal();
    initVariablePageEvents();
}

/**
 * 初始化变量页面事件
 */
function initVariablePageEvents() {
    // 复制全部变量
    document.getElementById('btn-copy-vars')?.addEventListener('click', function() {
        if (!variableState.selectedId) {
            showToast('请先选择一个变量', 'warning');
            return;
        }
        const v = variableState.variables.find(function(x) { return x.id === variableState.selectedId; });
        if (!v) return;
        
        const values = generateVariableValues(v);
        navigator.clipboard.writeText(values.join('\n'))
            .then(function() { showToast('已复制到剪贴板', 'success'); })
            .catch(function() { showToast('复制失败', 'error'); });
    });
}

/**
 * 初始化变量模态框
 */
function initVariableModal() {
    const modal = document.getElementById('variable-modal');
    const addBtn = document.getElementById('btn-add-variable');
    const closeBtn = document.getElementById('variable-modal-close');
    const cancelBtn = document.getElementById('btn-cancel-variable');
    const saveBtn = document.getElementById('btn-save-variable');
    
    if (!modal) return;
    
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            document.getElementById('variable-modal-title').textContent = '新建变量';
            document.getElementById('variable-form').reset();
            document.getElementById('variable-id').value = '';
            document.getElementById('variable-base').value = '1';
            document.getElementById('variable-step').value = '1';
            document.getElementById('variable-count').value = '10';
            updateVarUsagePreview();
            updateVariablePreview();
            modal.classList.add('active');
        });
    }
    
    if (closeBtn) closeBtn.addEventListener('click', function() { modal.classList.remove('active'); });
    if (cancelBtn) cancelBtn.addEventListener('click', function() { modal.classList.remove('active'); });
    if (saveBtn) saveBtn.addEventListener('click', saveVariable);
    
    // 变量名实时更新调用方式预览
    document.getElementById('variable-name')?.addEventListener('input', updateVarUsagePreview);
    
    // 实时预览
    ['variable-base', 'variable-step', 'variable-count', 'variable-prefix', 'variable-suffix'].forEach(function(id) {
        document.getElementById(id)?.addEventListener('input', updateVariablePreview);
    });
}

// ==================== 数据加载 ====================

/**
 * 加载变量列表
 */
async function loadVariables() {
    try {
        variableState.variables = await window.api.variables.getAll() || [];
        renderVariablesList();
    } catch (error) {
        console.error('加载变量失败:', error);
        variableState.variables = [];
        renderVariablesList();
    }
}

// ==================== 渲染函数 ====================

/**
 * 渲染变量列表
 */
function renderVariablesList() {
    const container = document.getElementById('variables-list');
    const countEl = document.getElementById('var-count');
    
    if (!container) return;
    
    if (variableState.variables.length === 0) {
        container.innerHTML = '<div class="variables-empty"><p>暂无变量，点击"新建变量"创建</p></div>';
        if (countEl) countEl.textContent = '0 个变量';
        return;
    }
    
    if (countEl) countEl.textContent = variableState.variables.length + ' 个变量';
    
    container.innerHTML = variableState.variables.map(function(v) {
        return '<div class="var-item ' + (variableState.selectedId === v.id ? 'selected' : '') + '" ' +
            'data-id="' + v.id + '" onclick="selectVariable(\'' + v.id + '\')">' +
            '<span class="var-item-name">${' + escapeHtml(v.name) + '}</span>' +
            '<span class="var-item-config">' +
                '<span>基数: ' + v.base + '</span>' +
                '<span>步长: ' + v.step + '</span>' +
                '<span>次数: ' + v.count + '</span>' +
                (v.prefix ? '<span>前缀: ' + escapeHtml(v.prefix) + '</span>' : '') +
                (v.suffix ? '<span>后缀: ' + escapeHtml(v.suffix) + '</span>' : '') +
            '</span>' +
            '<div class="var-item-actions" onclick="event.stopPropagation()">' +
                '<button class="btn btn-sm btn-secondary" onclick="editVariable(\'' + v.id + '\')">编辑</button>' +
                '<button class="btn btn-sm btn-danger" onclick="deleteVariable(\'' + v.id + '\')">删除</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

/**
 * 选中变量并显示预览
 */
function selectVariable(id) {
    variableState.selectedId = id;
    renderVariablesList();
    
    const v = variableState.variables.find(function(x) { return x.id === id; });
    if (!v) return;
    
    const preview = document.getElementById('var-preview');
    if (!preview) return;
    
    const values = generateVariableValues(v);
    preview.innerHTML = '<div class="var-preview-values">' +
        values.map(function(val) { return '<span class="var-preview-value">' + escapeHtml(val) + '</span>'; }).join('') +
    '</div>';
}

/**
 * 更新变量调用方式预览
 */
function updateVarUsagePreview() {
    const nameInput = document.getElementById('variable-name');
    const usagePreview = document.getElementById('var-usage-preview');
    if (!nameInput || !usagePreview) return;
    
    const name = nameInput.value.trim() || '变量名';
    usagePreview.textContent = '${' + name + '}';
}

/**
 * 更新模态框中的预览
 */
function updateVariablePreview() {
    const previewBox = document.getElementById('variable-preview-box');
    const countBadge = document.getElementById('var-preview-count');
    if (!previewBox) return;
    
    const v = {
        base: document.getElementById('variable-base')?.value || 1,
        step: document.getElementById('variable-step')?.value || 1,
        count: Math.min(parseInt(document.getElementById('variable-count')?.value) || 10, 20),
        prefix: document.getElementById('variable-prefix')?.value || '',
        suffix: document.getElementById('variable-suffix')?.value || ''
    };
    
    const values = generateVariableValues(v);
    const totalCount = parseInt(document.getElementById('variable-count')?.value) || 10;
    
    if (countBadge) {
        countBadge.textContent = totalCount + ' 个值';
    }
    
    let html = '<div class="preview-values">';
    for (let i = 0; i < values.length; i++) {
        html += '<span class="preview-value">' + escapeHtml(values[i]) + '</span>';
    }
    if (totalCount > 20) {
        html += '<span class="preview-value">... 共' + totalCount + '个</span>';
    }
    html += '</div>';
    previewBox.innerHTML = html;
}

// ==================== 变量值生成 ====================

/**
 * 生成变量值序列（带缓存）
 */
function generateVariableValues(v) {
    const cacheKey = (v.id || v.name) + '_' + v.base + '_' + v.step + '_' + v.count + '_' + v.prefix + '_' + v.suffix;
    
    if (variableValuesCache.has(cacheKey)) {
        return variableValuesCache.get(cacheKey);
    }
    
    const values = [];
    const base = parseFloat(v.base) || 0;
    const step = parseFloat(v.step) || 1;
    const count = parseInt(v.count) || 10;
    const prefix = v.prefix || '';
    const suffix = v.suffix || '';
    
    for (let i = 0; i < count; i++) {
        const num = base + (step * i);
        const numStr = Number.isInteger(num) ? num.toString() : num.toFixed(2);
        values.push(prefix + numStr + suffix);
    }
    
    if (variableValuesCache.size > 100) {
        const firstKey = variableValuesCache.keys().next().value;
        variableValuesCache.delete(firstKey);
    }
    variableValuesCache.set(cacheKey, values);
    
    return values;
}

/**
 * 清除变量值缓存
 */
function clearVariableCache() {
    variableValuesCache.clear();
}

// ==================== CRUD 操作 ====================

/**
 * 保存变量
 */
async function saveVariable() {
    const id = document.getElementById('variable-id').value;
    const name = document.getElementById('variable-name').value.trim();
    
    if (!name) {
        showToast('请输入变量名称', 'warning');
        return;
    }
    
    const exists = variableState.variables.some(function(v) { return v.name === name && v.id !== id; });
    if (exists) {
        showToast('变量名称已存在', 'warning');
        return;
    }
    
    const variable = {
        id: id || generateId(),
        name: name,
        base: parseFloat(document.getElementById('variable-base').value) || 1,
        step: parseFloat(document.getElementById('variable-step').value) || 1,
        count: parseInt(document.getElementById('variable-count').value) || 10,
        prefix: document.getElementById('variable-prefix').value || '',
        suffix: document.getElementById('variable-suffix').value || '',
        createdAt: id ? variableState.variables.find(function(v) { return v.id === id; })?.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    if (id) {
        const index = variableState.variables.findIndex(function(v) { return v.id === id; });
        if (index !== -1) variableState.variables[index] = variable;
    } else {
        variableState.variables.push(variable);
    }
    
    try {
        await window.api.variables.save(variableState.variables);
        clearVariableCache();
        showToast(id ? '变量已更新' : '变量已创建', 'success');
        document.getElementById('variable-modal').classList.remove('active');
        renderVariablesList();
    } catch (error) {
        showToast('保存失败', 'error');
    }
}

/**
 * 编辑变量
 */
function editVariable(id) {
    const v = variableState.variables.find(function(x) { return x.id === id; });
    if (!v) return;
    
    document.getElementById('variable-modal-title').textContent = '编辑变量';
    document.getElementById('variable-id').value = v.id;
    document.getElementById('variable-name').value = v.name;
    document.getElementById('variable-base').value = v.base;
    document.getElementById('variable-step').value = v.step;
    document.getElementById('variable-count').value = v.count;
    document.getElementById('variable-prefix').value = v.prefix || '';
    document.getElementById('variable-suffix').value = v.suffix || '';
    updateVarUsagePreview();
    updateVariablePreview();
    document.getElementById('variable-modal').classList.add('active');
}

/**
 * 删除变量
 */
async function deleteVariable(id) {
    const variable = variableState.variables.find(function(v) { return v.id === id; });
    const confirmed = await showConfirm({
        title: '删除变量',
        message: '确定要删除变量「' + (variable?.name || '未命名') + '」吗？',
        confirmText: '删除',
        type: 'danger'
    });
    if (!confirmed) return;
    
    variableState.variables = variableState.variables.filter(function(v) { return v.id !== id; });
    
    try {
        await window.api.variables.save(variableState.variables);
        showToast('变量已删除', 'success');
        if (variableState.selectedId === id) {
            variableState.selectedId = null;
            document.getElementById('var-preview').innerHTML = '<p class="preview-hint">选择变量查看生成的值序列</p>';
        }
        renderVariablesList();
    } catch (error) {
        showToast('删除失败', 'error');
    }
}

// ==================== 对外接口 ====================

/**
 * 获取所有变量用于批量执行（异步确保数据已加载）
 */
async function getDefinedVariablesAsync() {
    if (variableState.variables.length === 0) {
        try {
            variableState.variables = await window.api.variables.getAll() || [];
        } catch (e) {
            console.error('加载变量失败:', e);
        }
    }
    return getDefinedVariables();
}

/**
 * 获取所有变量用于批量执行（同步，使用内存缓存）
 */
function getDefinedVariables() {
    const result = {};
    variableState.variables.forEach(function(v) {
        result[v.name] = generateVariableValues(v);
    });
    return result;
}

/**
 * 获取变量配置信息（用于显示）
 */
function getVariableConfigs() {
    return variableState.variables.map(function(v) {
        return {
            name: v.name,
            base: v.base,
            step: v.step,
            count: v.count,
            prefix: v.prefix || '',
            suffix: v.suffix || '',
            direction: v.step >= 0 ? '递增' : '递减'
        };
    });
}

// ==================== 暴露到全局 ====================

window.selectVariable = selectVariable;
window.editVariable = editVariable;
window.deleteVariable = deleteVariable;
window.getDefinedVariables = getDefinedVariables;
window.getDefinedVariablesAsync = getDefinedVariablesAsync;
window.getVariableConfigs = getVariableConfigs;
