/**
 * 配置备份模块 - 目录管理
 * @module backup/directory
 */

// ==================== 目录管理 ====================

async function loadBackupDir() {
    try {
        const dir = await window.api.backup.getDir();
        const display = document.getElementById('backup-path-display');
        if (display && dir) {
            display.textContent = dir;
            display.title = dir;
        }
    } catch (e) {
        console.error('加载备份目录失败:', e);
    }
}

async function changeBackupDir() {
    try {
        const result = await window.api.backup.selectDir();
        if (result && result.success) {
            document.getElementById('backup-path-display').textContent = result.path;
            document.getElementById('backup-path-display').title = result.path;
            showToast('备份目录已更改', 'success');
            loadBackups();
        }
    } catch (e) {
        showToast('修改目录失败: ' + e.message, 'error');
    }
}

async function openBackupDir() {
    try {
        const dir = await window.api.backup.getDir();
        if (dir) {
            await window.api.shell.openPath(dir);
        }
    } catch (e) {
        showToast('打开目录失败', 'error');
    }
}

async function resetBackupDir() {
    try {
        const result = await window.api.backup.setDir(null);
        if (result && result.success) {
            document.getElementById('backup-path-display').textContent = result.path;
            document.getElementById('backup-path-display').title = result.path;
            showToast('已恢复默认目录', 'success');
            loadBackups();
        }
    } catch (e) {
        showToast('重置目录失败: ' + e.message, 'error');
    }
}
