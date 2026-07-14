/**
 * 命令模板模块 - 编辑功能
 * @module templates/editor
 */

// ==================== 编辑功能 ====================

/**
 * 初始化模板编辑模态框
 */
function initTemplateModal() {
    const modal = document.getElementById('template-modal');
    const addBtn = document.getElementById('btn-add-template');
    const closeBtn = document.getElementById('template-modal-close');
    const cancelBtn = document.getElementById('btn-cancel-template');
    const saveBtn = document.getElementById('btn-save-template');
    const commandsTextarea = document.getElementById('template-commands');
    const lineNumbers = document.getElementById('template-line-numbers');
    const cmdCountBadge = document.getElementById('template-cmd-count');
    
    if (!modal) return;
    
    // 行号同步函数
    function updateLineNumbers() {
        if (!commandsTextarea || !lineNumbers) return;
        const lines = commandsTextarea.value.split('\n');
        const lineCount = lines.length;
        lineNumbers.innerHTML = Array.from({ length: lineCount }, (_, i) => i + 1).join('<br>');
        if (cmdCountBadge) {
            const nonEmptyLines = lines.filter(l => l.trim()).length;
            cmdCountBadge.textContent = `${nonEmptyLines} 条命令`;
        }
    }
    
    // 滚动同步函数
    function syncScroll() {
        if (lineNumbers) lineNumbers.scrollTop = commandsTextarea.scrollTop;
    }
    
    // 绑定事件
    commandsTextarea?.addEventListener('input', updateLineNumbers);
    commandsTextarea?.addEventListener('scroll', syncScroll);
    
    addBtn?.addEventListener('click', () => {
        document.getElementById('template-modal-title').textContent = '新建模板';
        document.getElementById('template-form').reset();
        document.getElementById('template-id').value = '';
        updateLineNumbers();
        modal.classList.add('active');
    });
    
    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));
    cancelBtn?.addEventListener('click', () => modal.classList.remove('active'));
    saveBtn?.addEventListener('click', saveTemplate);
}

/**
 * 保存模板
 */
async function saveTemplate() {
    const id = document.getElementById('template-id').value;
    const template = {
        id: id || generateId(),
        name: document.getElementById('template-name').value,
        category: document.getElementById('template-category').value,
        deviceType: document.getElementById('template-device-type').value,
        commands: document.getElementById('template-commands').value,
        description: document.getElementById('template-description').value,
        createdAt: id ? state.templates.find(t => t.id === id)?.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    if (!template.name) {
        showToast('请输入模板名称', 'warning');
        return;
    }
    
    if (!template.commands) {
        showToast('请输入命令内容', 'warning');
        return;
    }
    
    if (id) {
        const index = state.templates.findIndex(t => t.id === id);
        if (index !== -1) state.templates[index] = template;
    } else {
        state.templates.push(template);
    }
    
    try {
        await window.api.templates.save(state.templates);
        showToast(id ? '模板已更新' : '模板已创建', 'success');
        document.getElementById('template-modal').classList.remove('active');
        renderTemplatesList();
    } catch (error) {
        console.error('保存模板失败:', error);
        showToast('保存失败', 'error');
    }
}

/**
 * 编辑模板
 */
function editTemplate(id) {
    const template = state.templates.find(t => t.id === id);
    if (!template) return;
    
    document.getElementById('template-modal-title').textContent = '编辑模板';
    document.getElementById('template-id').value = template.id;
    document.getElementById('template-name').value = template.name || '';
    document.getElementById('template-category').value = template.category || 'other';
    document.getElementById('template-device-type').value = template.deviceType || 'all';
    document.getElementById('template-commands').value = template.commands || '';
    document.getElementById('template-description').value = template.description || '';
    
    // 触发行号更新
    const commandsTextarea = document.getElementById('template-commands');
    commandsTextarea?.dispatchEvent(new Event('input'));
    
    document.getElementById('template-modal').classList.add('active');
}

// ==================== 暴露到全局 ====================

window.editTemplate = editTemplate;
