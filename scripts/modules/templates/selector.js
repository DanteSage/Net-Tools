/**
 * 命令模板模块 - 选择器
 * @module templates/selector
 */

// ==================== 模板选择器 (批量执行使用) ====================

/**
 * 初始化模板选择器模态框
 */
function initTemplateSelectorModal() {
    const modal = document.getElementById('template-selector-modal');
    const closeBtn = document.getElementById('template-selector-close');
    const cancelBtn = document.getElementById('btn-cancel-selector');
    const useBtn = document.getElementById('btn-use-template');
    
    if (!modal) return;
    
    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));
    cancelBtn?.addEventListener('click', () => modal.classList.remove('active'));
    useBtn?.addEventListener('click', applySelectedTemplate);
    
    // 分类筛选 (支持新旧两种类名)
    document.querySelectorAll('.selector-tab, .selector-tab-h').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.selector-tab, .selector-tab-h').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderTemplateSelectorList(tab.dataset.category);
        });
    });
    
    // 搜索
    document.getElementById('template-selector-search')?.addEventListener('input', debounce((e) => {
        const activeTab = document.querySelector('.selector-tab.active, .selector-tab-h.active');
        renderTemplateSelectorList(activeTab?.dataset.category || 'all', e.target.value);
    }, 200));
}

/**
 * 显示模板选择器
 */
async function showTemplateSelector() {
    templateState.selectedTemplateId = null;
    const modal = document.getElementById('template-selector-modal');
    
    // 确保模板数据已加载
    if (!state.templates || state.templates.length === 0) {
        try {
            state.templates = await window.api.templates.getAll();
        } catch (error) {
            console.error('加载模板失败:', error);
            state.templates = [];
        }
    }
    
    // 重置状态
    document.querySelectorAll('.selector-tab, .selector-tab-h').forEach(t => t.classList.remove('active'));
    document.querySelector('.selector-tab[data-category="all"], .selector-tab-h[data-category="all"]')?.classList.add('active');
    document.getElementById('template-selector-search').value = '';
    document.getElementById('btn-use-template').disabled = true;
    document.getElementById('template-preview-content').textContent = '选择模板查看命令内容';
    document.getElementById('preview-line-count').textContent = '';
    const previewInfo = document.getElementById('template-preview-info');
    if (previewInfo) previewInfo.style.display = '';
    
    renderTemplateSelectorList('all');
    modal?.classList.add('active');
}

/**
 * 渲染模板选择器列表
 */
function renderTemplateSelectorList(category = 'all', keyword = '') {
    const container = document.getElementById('template-selector-list');
    if (!container) return;
    
    let templates = state.templates || [];
    
    if (category !== 'all') {
        templates = templates.filter(t => t.category === category);
    }
    
    if (keyword) {
        const kw = keyword.toLowerCase();
        templates = templates.filter(t => 
            t.name?.toLowerCase().includes(kw) ||
            t.description?.toLowerCase().includes(kw)
        );
    }
    
    if (templates.length === 0) {
        container.innerHTML = `
            <div class="selector-empty">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
                <p>${keyword ? '未找到匹配的模板' : '暂无模板'}</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = templates.map(tpl => {
        const lineCount = tpl.commands ? tpl.commands.split('\n').filter(l => l.trim()).length : 0;
        const categoryIcon = getCategoryIcon(tpl.category);
        return `
            <div class="selector-item" data-id="${tpl.id}" onclick="selectTemplateItem('${tpl.id}')">
                <div class="selector-item-icon">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${categoryIcon}</svg>
                </div>
                <div class="selector-item-info">
                    <div class="selector-item-name">${escapeHtml(tpl.name)}</div>
                    <div class="selector-item-desc">${escapeHtml(tpl.description || getDeviceTypeName(tpl.deviceType))}</div>
                </div>
                <div class="selector-item-meta">
                    <span class="selector-item-count">${lineCount} 行</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 选择模板项
 */
function selectTemplateItem(id) {
    templateState.selectedTemplateId = id;
    const template = state.templates.find(t => t.id === id);
    
    // 更新选中状态
    document.querySelectorAll('.selector-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === id);
    });
    
    // 更新预览
    const previewContent = document.getElementById('template-preview-content');
    const previewLineCount = document.getElementById('preview-line-count');
    const previewInfo = document.getElementById('template-preview-info');
    
    if (template) {
        previewContent.textContent = template.commands || '';
        const lineCount = template.commands ? template.commands.split('\n').filter(l => l.trim()).length : 0;
        if (previewLineCount) previewLineCount.textContent = `${lineCount} 行`;
        if (previewInfo) previewInfo.style.display = 'none';
    }
    
    // 启用使用按钮
    document.getElementById('btn-use-template').disabled = false;
}

/**
 * 应用选中的模板
 */
function applySelectedTemplate() {
    const template = state.templates.find(t => t.id === templateState.selectedTemplateId);
    if (!template) return;
    
    const cmdInput = document.getElementById('batch-commands');
    if (cmdInput) {
        cmdInput.value = template.commands || '';
    }
    
    document.getElementById('template-selector-modal').classList.remove('active');
    showToast(`已加载模板: ${template.name}`, 'success');
}

// ==================== 保存为模板 ====================

/**
 * 初始化保存为模板模态框
 */
function initSaveTemplateModal() {
    const modal = document.getElementById('save-template-modal');
    const closeBtn = document.getElementById('save-template-close');
    const cancelBtn = document.getElementById('btn-cancel-save-template');
    const saveBtn = document.getElementById('btn-confirm-save-template');
    
    if (!modal) return;
    
    closeBtn?.addEventListener('click', () => modal.classList.remove('active'));
    cancelBtn?.addEventListener('click', () => modal.classList.remove('active'));
    saveBtn?.addEventListener('click', confirmSaveAsTemplate);
}

/**
 * 显示保存为模板模态框
 */
function showSaveTemplateModal() {
    const commands = document.getElementById('batch-commands')?.value.trim();
    if (!commands) {
        showToast('请先输入命令', 'warning');
        return;
    }
    
    const modal = document.getElementById('save-template-modal');
    document.getElementById('save-template-name').value = '';
    document.getElementById('save-template-category').value = 'other';
    document.getElementById('save-template-device').value = 'all';
    document.getElementById('save-template-desc').value = '';
    document.getElementById('save-template-preview').textContent = commands;
    
    // 更新行数统计
    const lineCount = commands.split('\n').filter(l => l.trim()).length;
    const lineCountEl = document.getElementById('save-template-line-count');
    if (lineCountEl) lineCountEl.textContent = `${lineCount} 行`;
    
    modal?.classList.add('active');
}

/**
 * 确认保存为模板
 */
async function confirmSaveAsTemplate() {
    const name = document.getElementById('save-template-name')?.value.trim();
    if (!name) {
        showToast('请输入模板名称', 'warning');
        return;
    }
    
    const template = {
        id: generateId(),
        name: name,
        category: document.getElementById('save-template-category')?.value || 'other',
        deviceType: document.getElementById('save-template-device')?.value || 'all',
        commands: document.getElementById('save-template-preview')?.textContent || '',
        description: document.getElementById('save-template-desc')?.value || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    state.templates.push(template);
    
    try {
        await window.api.templates.save(state.templates);
        showToast('模板已保存', 'success');
        document.getElementById('save-template-modal').classList.remove('active');
    } catch (error) {
        console.error('保存模板失败:', error);
        showToast('保存失败', 'error');
    }
}

// 暴露全局函数
window.selectTemplateItem = selectTemplateItem;
