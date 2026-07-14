/**
 * 命令模板模块 - 列表渲染
 * @module templates/list
 */

// ==================== 列表功能 ====================

/**
 * 加载模板列表
 */
async function loadTemplates() {
    try {
        state.templates = await window.api.templates.getAll();
        renderTemplatesList();
    } catch (error) {
        console.error('加载模板失败:', error);
        state.templates = [];
        renderTemplatesList();
    }
}

/**
 * 渲染模板列表
 */
function renderTemplatesList() {
    const container = document.getElementById('templates-grid');
    if (!container) return;
    
    let templates = state.templates || [];
    
    // 分类筛选
    if (templateState.currentCategory !== 'all') {
        templates = templates.filter(t => t.category === templateState.currentCategory);
    }
    
    // 搜索筛选
    if (templateState.searchKeyword) {
        templates = templates.filter(t => 
            t.name?.toLowerCase().includes(templateState.searchKeyword) ||
            t.description?.toLowerCase().includes(templateState.searchKeyword) ||
            t.commands?.toLowerCase().includes(templateState.searchKeyword)
        );
    }
    
    if (templates.length === 0) {
        container.innerHTML = `
            <div class="templates-empty">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
                <h3>暂无模板</h3>
                <p>${templateState.searchKeyword ? '未找到匹配的模板' : '点击"新建模板"创建第一个命令模板'}</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = templates.map(tpl => `
        <div class="template-card" data-id="${tpl.id}">
            <div class="template-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                <span class="template-toggle">▶</span>
                <div class="template-card-info">
                    <span class="template-card-title">${escapeHtml(tpl.name)}</span>
                    <div class="template-card-meta">
                        <span class="template-tag">${getCategoryName(tpl.category)}</span>
                        <span class="template-device-tag">${getDeviceTypeName(tpl.deviceType)}</span>
                    </div>
                    <span class="template-desc-brief">${escapeHtml(tpl.description || '')}</span>
                </div>
                <span class="template-time">${formatTime(tpl.updatedAt || tpl.createdAt)}</span>
                <div class="template-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-sm btn-primary" onclick="useTemplate('${tpl.id}')">使用</button>
                    <button class="btn btn-sm btn-secondary" onclick="editTemplate('${tpl.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTemplate('${tpl.id}')">删除</button>
                </div>
            </div>
            <div class="template-card-body">
                <div class="template-preview">${escapeHtml(tpl.commands || '')}</div>
            </div>
        </div>
    `).join('');
}

/**
 * 使用模板 (跳转到批量执行)
 */
function useTemplate(id) {
    const template = state.templates.find(t => t.id === id);
    if (!template) return;
    
    document.querySelector('.nav-item[data-page="batch"]')?.click();
    setTimeout(() => {
        const cmdInput = document.getElementById('batch-commands');
        if (cmdInput) {
            cmdInput.value = template.commands || '';
            showToast(`已加载模板: ${template.name}`, 'success');
        }
    }, 100);
}

/**
 * 删除模板
 */
async function deleteTemplate(id) {
    const template = state.templates.find(t => t.id === id);
    const confirmed = await showConfirm({
        title: '删除模板',
        message: `确定要删除模板「${template?.name || '未命名'}」吗？`,
        confirmText: '删除',
        type: 'danger'
    });
    if (!confirmed) return;
    
    state.templates = state.templates.filter(t => t.id !== id);
    
    try {
        await window.api.templates.save(state.templates);
        showToast('模板已删除', 'success');
        renderTemplatesList();
    } catch (error) {
        console.error('删除模板失败:', error);
        showToast('删除失败', 'error');
    }
}

// ==================== 暴露到全局 ====================

window.useTemplate = useTemplate;
window.deleteTemplate = deleteTemplate;
