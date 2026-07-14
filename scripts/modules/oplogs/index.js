/**
 * 操作日志模块 - 入口文件
 * @module oplogs
 * 
 * 此模块整合了所有 oplogs 子模块的功能：
 * - state.js: 状态管理
 * - icons.js: 设备图标
 * - logger.js: 日志记录核心
 * - list.js: 列表渲染
 * - viewer.js: 查看器（含虚拟滚动）
 * - search.js: 搜索功能
 * - batch.js: 批量操作
 * - settings.js: 设置功能
 */

// ==================== 初始化 ====================

/**
 * 初始化操作记录页面
 */
function initOplogPage() {
    const refreshBtn = document.getElementById('btn-refresh-oplog');
    const clearAllBtn = document.getElementById('btn-clear-all-oplog');
    const searchInput = document.getElementById('oplog-search');
    const dateFilter = document.getElementById('oplog-date-filter');
    const sortSelect = document.getElementById('oplog-sort');
    const selectAllBtn = document.getElementById('btn-select-all-oplog');
    const batchExportBtn = document.getElementById('btn-batch-export-oplog');
    const batchDeleteBtn = document.getElementById('btn-batch-delete-oplog');
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadOplogList);
    }
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllOplogs);
    }
    
    // 搜索框
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterOplogs(e.target.value));
    }
    
    // 日期筛选
    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => filterOplogsByDate(e.target.value));
    }
    
    // 排序
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => sortOplogs(e.target.value));
    }
    
    // 批量操作按钮
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', toggleSelectAllOplogs);
    }
    
    if (batchExportBtn) {
        batchExportBtn.addEventListener('click', batchExportOplogs);
    }
    
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', batchDeleteOplogs);
    }
    
    // 快捷键支持
    document.addEventListener('keydown', handleOplogKeydown);
}
