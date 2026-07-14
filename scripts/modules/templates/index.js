/**
 * 命令模板模块 - 入口文件
 * @module templates
 * 
 * 此模块整合了所有 templates 子模块的功能：
 * - constants.js: 常量定义
 * - state.js: 状态管理
 * - list.js: 列表渲染
 * - editor.js: 编辑功能
 * - import-export.js: 导入导出
 * - selector.js: 选择器
 */

// ==================== 初始化 ====================

/**
 * 初始化模板模块
 */
function initTemplatesModule() {
    initTemplatePageEvents();
    initTemplateModal();
    initTemplateSelectorModal();
    initSaveTemplateModal();
}

/**
 * 初始化模板页面事件
 */
function initTemplatePageEvents() {
    // 分类筛选
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            templateState.currentCategory = tab.dataset.category;
            renderTemplatesList();
        });
    });
    
    // 搜索
    const searchInput = document.getElementById('templates-search-input');
    searchInput?.addEventListener('input', debounce((e) => {
        templateState.searchKeyword = e.target.value.toLowerCase();
        renderTemplatesList();
    }, 200));
    
    // 导入导出
    document.getElementById('btn-download-cmd-template')?.addEventListener('click', downloadTemplateImportTemplate);
    document.getElementById('btn-import-template')?.addEventListener('click', importTemplates);
    document.getElementById('btn-export-templates')?.addEventListener('click', exportTemplates);
}
