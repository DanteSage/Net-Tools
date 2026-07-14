/**
 * 配置备份模块 - 列表渲染
 * @module backup/list
 */

// ==================== 数据加载 ====================

async function loadBackups() {
    try {
        backupState.backups = await window.api.backup.getAll() || [];
        renderBackupList();
        updateBackupStats();
    } catch (error) {
        console.error('加载备份列表失败:', error);
        backupState.backups = [];
        renderBackupList();
    }
}

function updateBackupStats() {
    const backups = backupState.backups;
    const totalCount = document.getElementById('backup-total-count');
    const totalSize = document.getElementById('backup-total-size');
    const latestTime = document.getElementById('backup-latest-time');
    const deviceCount = document.getElementById('backup-device-count');
    
    if (totalCount) totalCount.textContent = backups.length;
    
    if (totalSize) {
        const size = backups.reduce(function(sum, b) { return sum + (b.size || 0); }, 0);
        totalSize.textContent = formatSize(size);
    }
    
    if (latestTime && backups.length > 0) {
        latestTime.textContent = formatRelativeTime(backups[0].created);
    } else if (latestTime) {
        latestTime.textContent = '-';
    }
    
    if (deviceCount) {
        const devices = {};
        backups.forEach(function(b) {
            const deviceName = extractDeviceName(b.name);
            if (deviceName) devices[deviceName] = true;
        });
        deviceCount.textContent = Object.keys(devices).length;
    }
}

function extractDeviceName(fileName) {
    const match = fileName.match(/^(.+?)_\d{4}-\d{2}-\d{2}/);
    return match ? match[1] : fileName.replace(/\.[^.]+$/, '');
}

// ==================== 渲染函数 ====================

function renderBackupList() {
    const container = document.getElementById('backup-list');
    if (!container) return;
    
    let backups = backupState.backups.slice();
    
    if (backupState.searchKeyword) {
        backups = backups.filter(function(b) {
            return b.name.toLowerCase().includes(backupState.searchKeyword);
        });
    }
    
    backups.sort(function(a, b) {
        switch (backupState.sortBy) {
            case 'time-asc':
                return new Date(a.created) - new Date(b.created);
            case 'name-asc':
                return a.name.localeCompare(b.name);
            case 'size-desc':
                return (b.size || 0) - (a.size || 0);
            default:
                return new Date(b.created) - new Date(a.created);
        }
    });
    
    if (backups.length === 0) {
        container.innerHTML = '<div class="backup-empty">' +
            '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">' +
                '<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>' +
            '</svg>' +
            '<h3>' + (backupState.searchKeyword ? '未找到匹配的备份' : '暂无备份文件') + '</h3>' +
            '<p>点击"一键备份"开始备份设备配置</p>' +
        '</div>';
        return;
    }
    
    let html = '';
    backups.forEach(function(backup) {
        html += renderBackupItem(backup);
    });
    
    container.innerHTML = html;
    
    container.querySelectorAll('.backup-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            if (e.target.type === 'checkbox' || e.target.closest('.backup-item-actions')) return;
            previewBackup(this.dataset.name);
        });
    });
    
    container.querySelectorAll('.backup-checkbox').forEach(function(cb) {
        cb.addEventListener('change', updateSelectedBackups);
    });
}

function renderBackupItem(backup) {
    const isSelected = backupState.selectedBackups.includes(backup.name);
    const isPreview = backupState.selectedPreview === backup.name;
    
    return '<div class="backup-item' + (isPreview ? ' selected' : '') + '" data-name="' + escapeHtml(backup.name) + '">' +
        '<input type="checkbox" class="backup-checkbox" value="' + escapeHtml(backup.name) + '"' + (isSelected ? ' checked' : '') + ' onclick="event.stopPropagation()">' +
        '<div class="backup-item-icon">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' +
                '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' +
            '</svg>' +
        '</div>' +
        '<div class="backup-item-info">' +
            '<div class="backup-item-name">' + escapeHtml(backup.name) + '</div>' +
            '<div class="backup-item-meta">' +
                '<span>' + formatSize(backup.size) + '</span>' +
                '<span>' + formatRelativeTime(backup.created) + '</span>' +
            '</div>' +
        '</div>' +
        '<div class="backup-item-actions">' +
            '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); downloadBackup(\'' + escapeHtml(backup.name) + '\')">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>' +
            '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteBackup(\'' + escapeHtml(backup.name) + '\')">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
            '</button>' +
        '</div>' +
    '</div>';
}

function resetBackupPreview() {
    const panel = document.getElementById('backup-preview-panel');
    if (!panel) return;
    
    panel.innerHTML = '<div class="backup-preview-placeholder">' +
        '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">' +
            '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' +
        '</svg>' +
        '<h3>选择备份查看内容</h3>' +
        '<p>点击左侧列表中的备份文件预览配置内容</p>' +
    '</div>';
}

// ==================== 单个操作 ====================

async function downloadBackup(fileName) {
    try {
        const result = await window.api.backup.download(fileName);
        if (result && result.success) {
            showToast('备份已下载', 'success');
        }
    } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
    }
}

async function deleteBackup(fileName) {
    const confirmed = await showConfirm({
        title: '删除备份',
        message: '确定要删除备份文件「' + fileName + '」吗？',
        type: 'danger'
    });
    
    if (confirmed) {
        try {
            await window.api.backup.delete(fileName);
            showToast('备份已删除', 'success');
            if (backupState.selectedPreview === fileName) {
                backupState.selectedPreview = null;
                resetBackupPreview();
            }
            loadBackups();
        } catch (error) {
            showToast('删除失败: ' + error.message, 'error');
        }
    }
}

// ==================== 暴露到全局 ====================

window.downloadBackup = downloadBackup;
window.deleteBackup = deleteBackup;
