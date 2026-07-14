/**
 * 配置备份模块 - 入口文件
 * @module backup
 * 
 * 此模块整合了所有 backup 子模块的功能：
 * - state.js: 状态管理
 * - directory.js: 目录管理
 * - compare.js: 对比功能
 * - list.js: 列表渲染
 * - preview.js: 预览功能
 * - batch.js: 批量操作
 */

// ==================== 初始化 ====================

/**
 * 初始化备份模块
 */
function initBackupModule() {
    const refreshBtn = document.getElementById('btn-refresh-backup');
    const compareBtn = document.getElementById('btn-compare-backup');
    const searchInput = document.getElementById('backup-search');
    const sortSelect = document.getElementById('backup-sort');
    const selectAllCheckbox = document.getElementById('backup-select-all');
    const batchDeleteBtn = document.getElementById('btn-batch-delete-backup');
    const changeDirBtn = document.getElementById('btn-change-backup-dir');
    const openDirBtn = document.getElementById('btn-open-backup-dir');
    const resetDirBtn = document.getElementById('btn-reset-backup-dir');
    const pathDisplay = document.getElementById('backup-path-display');
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadBackups);
    }
    
    if (compareBtn) {
        compareBtn.addEventListener('click', openCompareModal);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            backupState.searchKeyword = this.value.toLowerCase();
            renderBackupList();
        });
    }
    
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            backupState.sortBy = this.value;
            renderBackupList();
        });
    }
    
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            toggleSelectAllBackups(this.checked);
        });
    }
    
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', batchDeleteBackups);
    }
    
    if (changeDirBtn) {
        changeDirBtn.addEventListener('click', changeBackupDir);
    }
    
    if (openDirBtn) {
        openDirBtn.addEventListener('click', openBackupDir);
    }
    
    if (resetDirBtn) {
        resetDirBtn.addEventListener('click', resetBackupDir);
    }
    
    if (pathDisplay) {
        pathDisplay.addEventListener('click', openBackupDir);
    }
    
    loadBackupDir();
    initCompareModal();
}
