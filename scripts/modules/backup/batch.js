/**
 * 配置备份模块 - 批量操作
 * @module backup/batch
 */

// ==================== 批量操作 ====================

function toggleSelectAllBackups(checked) {
    document.querySelectorAll('#backup-list .backup-checkbox').forEach(function(cb) {
        cb.checked = checked;
    });
    updateSelectedBackups();
}

function updateSelectedBackups() {
    backupState.selectedBackups = Array.from(
        document.querySelectorAll('#backup-list .backup-checkbox:checked')
    ).map(function(cb) { return cb.value; });
    
    const count = backupState.selectedBackups.length;
    const countEl = document.getElementById('backup-selected-count');
    const deleteBtn = document.getElementById('btn-batch-delete-backup');
    const compareBtn = document.getElementById('btn-compare-backup');
    
    if (countEl) countEl.textContent = '已选 ' + count + ' 项';
    if (deleteBtn) deleteBtn.disabled = count === 0;
    if (compareBtn) compareBtn.disabled = count < 2;
    
    backupState.compareFiles = backupState.selectedBackups.slice(0, 2);
}

async function batchDeleteBackups() {
    if (backupState.selectedBackups.length === 0) {
        showToast('请先选择要删除的备份', 'warning');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '批量删除',
        message: '确定要删除选中的 ' + backupState.selectedBackups.length + ' 个备份文件吗？',
        type: 'danger'
    });
    
    if (confirmed) {
        let successCount = 0;
        const deletedFiles = [];
        for (let i = 0; i < backupState.selectedBackups.length; i++) {
            try {
                await window.api.backup.delete(backupState.selectedBackups[i]);
                deletedFiles.push(backupState.selectedBackups[i]);
                successCount++;
            } catch (e) {
                console.error('删除失败:', e);
            }
        }
        showToast('已删除 ' + successCount + ' 个备份', 'success');
        if (backupState.selectedPreview && deletedFiles.includes(backupState.selectedPreview)) {
            backupState.selectedPreview = null;
            resetBackupPreview();
        }
        backupState.selectedBackups = [];
        loadBackups();
    }
}
