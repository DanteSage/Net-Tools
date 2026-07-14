/**
 * 操作日志模块 - 批量操作
 * @module oplogs/batch
 */

// ==================== 批量操作 ====================

/**
 * 切换单个选择
 */
function toggleOplogSelect(id) {
    if (oplogState.selectedIds.has(id)) {
        oplogState.selectedIds.delete(id);
    } else {
        oplogState.selectedIds.add(id);
    }
    
    // 更新UI
    const item = document.querySelector(`.oplog-item[data-id="${id}"]`);
    if (item) {
        item.classList.toggle('selected', oplogState.selectedIds.has(id));
    }
    
    updateBatchButtons();
}

/**
 * 全选/取消全选
 */
function toggleSelectAllOplogs() {
    const filtered = getFilteredAndSortedOplogs();
    const allFilteredSelected = filtered.length > 0 && filtered.every(o => oplogState.selectedIds.has(o.id));
    
    if (allFilteredSelected) {
        filtered.forEach(o => oplogState.selectedIds.delete(o.id));
    } else {
        filtered.forEach(o => oplogState.selectedIds.add(o.id));
    }
    
    renderOplogList();
    updateBatchButtons();
}

/**
 * 更新批量操作按钮状态
 */
function updateBatchButtons() {
    const count = oplogState.selectedIds.size;
    const filtered = getFilteredAndSortedOplogs();
    const batchExportBtn = document.getElementById('btn-batch-export-oplog');
    const batchDeleteBtn = document.getElementById('btn-batch-delete-oplog');
    const selectAllBtn = document.getElementById('btn-select-all-oplog');
    
    if (batchExportBtn) {
        batchExportBtn.disabled = count === 0;
        const exportSpan = batchExportBtn.querySelector('span');
        if (exportSpan) exportSpan.textContent = count > 0 ? `导出(${count})` : '导出';
    }
    
    if (batchDeleteBtn) {
        batchDeleteBtn.disabled = count === 0;
        const deleteSpan = batchDeleteBtn.querySelector('span');
        if (deleteSpan) deleteSpan.textContent = count > 0 ? `删除(${count})` : '删除';
    }
    
    if (selectAllBtn) {
        const allFilteredSelected = filtered.length > 0 && filtered.every(o => oplogState.selectedIds.has(o.id));
        const selectSpan = selectAllBtn.querySelector('span');
        if (selectSpan) selectSpan.textContent = allFilteredSelected ? '取消全选' : '全选';
    }
    
    // 更新统计
    updateStats();
}

/**
 * 批量导出
 */
async function batchExportOplogs() {
    if (oplogState.selectedIds.size === 0) {
        showToast('请先选择要导出的记录', 'warning');
        return;
    }
    
    let exportCount = 0;
    for (const id of oplogState.selectedIds) {
        const oplog = await window.api.oplog.get(id);
        if (oplog) {
            downloadOplog(oplog);
            exportCount++;
            // 延迟避免浏览器阻止多次下载
            await new Promise(r => setTimeout(r, 200));
        }
    }
    
    showToast(`已导出 ${exportCount} 条记录`, 'success');
}

/**
 * 批量删除
 */
async function batchDeleteOplogs() {
    const count = oplogState.selectedIds.size;
    if (count === 0) {
        showToast('请先选择要删除的记录', 'warning');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '批量删除',
        message: `确定要删除选中的 ${count} 条记录吗？此操作无法撤销。`,
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    for (const id of oplogState.selectedIds) {
        await window.api.oplog.delete(id);
    }
    
    oplogState.selectedIds.clear();
    oplogState.currentOplogId = null;
    loadOplogList();
    resetOplogViewer();
    showToast(`已删除 ${count} 条记录`, 'success');
}

/**
 * 快捷键处理
 */
function handleOplogKeydown(e) {
    // 只在操作记录页面激活时处理
    const oplogPage = document.getElementById('page-oplog');
    if (!oplogPage || !oplogPage.classList.contains('active')) return;
    
    // 忽略输入框中的按键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Delete 键删除选中
    if (e.key === 'Delete' && oplogState.selectedIds.size > 0) {
        e.preventDefault();
        batchDeleteOplogs();
    }
    
    // Ctrl+A 全选
    if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        toggleSelectAllOplogs();
    }
    
    // Escape 取消选择
    if (e.key === 'Escape') {
        oplogState.selectedIds.clear();
        renderOplogList();
        updateBatchButtons();
    }
}
