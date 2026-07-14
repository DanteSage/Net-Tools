/**
 * 操作日志模块 - 设置功能
 * @module oplogs/settings
 */

// ==================== 操作日志设置 ====================

/**
 * 打开操作日志设置弹窗
 */
async function openOplogSettings() {
    let settings;
    try {
        settings = await window.api.oplog.getSettings();
    } catch (err) {
        console.error('获取操作日志设置失败:', err);
        showToast('获取设置失败', 'error');
        return;
    }
    
    if (!settings) {
        settings = { dir: '', defaultDir: '', saveMd: false };
    }
    
    // 创建设置弹窗
    const modal = document.createElement('div');
    modal.id = 'oplog-settings-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content oplog-settings-modal">
            <div class="modal-header">
                <h2>操作日志设置</h2>
                <button class="modal-close" onclick="closeOplogSettings()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>存储目录</label>
                    <div class="oplog-dir-input">
                        <input type="text" id="oplog-dir-path" value="${escapeHtml(settings.dir)}" readonly>
                        <button class="btn btn-secondary" onclick="selectOplogDir()">选择目录</button>
                        <button class="btn btn-ghost" onclick="openOplogDir()" title="打开目录">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                            </svg>
                        </button>
                    </div>
                    <p class="form-hint">默认目录: ${escapeHtml(settings.defaultDir)}</p>
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="oplog-save-md" ${settings.saveMd ? 'checked' : ''}>
                        <span>保存为 Markdown (.md) 格式</span>
                    </label>
<p class="form-hint">默认启用 .md 格式</p>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="resetOplogDir()">恢复默认</button>
                <button class="btn btn-primary" onclick="closeOplogSettings()">完成</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击遮罩层关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeOplogSettings();
        }
    });
    
    // 绑定 Markdown 复选框事件
    const mdCheckbox = document.getElementById('oplog-save-md');
    mdCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            // 启用 MD 格式，直接保存
            const result = await window.api.oplog.setSaveMd(true);
            if (result.success) {
                showToast('已切换为 MD 格式', 'success');
            }
        } else {
            // 取消 MD 格式，弹窗确认
            e.target.checked = true; // 先恢复勾选状态
            const confirmed = await showConfirm({
                title: '切换保存格式',
                message: '确定要切换为 TXT 格式吗？',
                detail: 'Markdown (.md) 格式可以获得更好的阅读体验，支持标题、表格等富文本排版。',
                confirmText: '切换为 TXT',
                type: 'warning'
            });
            if (confirmed) {
                const result = await window.api.oplog.setSaveMd(false);
                if (result.success) {
                    mdCheckbox.checked = false;
                    showToast('已切换为 TXT 格式', 'info');
                }
            }
        }
    });
}

/**
 * 关闭操作日志设置弹窗
 */
function closeOplogSettings() {
    const modal = document.getElementById('oplog-settings-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * 选择操作日志目录
 */
async function selectOplogDir() {
    const result = await window.api.oplog.selectDir();
    if (result.success) {
        const pathInput = document.getElementById('oplog-dir-path');
        if (pathInput) {
            pathInput.value = result.path;
        }
        showToast('操作日志目录已更新', 'success');
    }
}

/**
 * 恢复默认操作日志目录
 */
async function resetOplogDir() {
    const result = await window.api.oplog.setDir(null);
    if (result.success) {
        const pathInput = document.getElementById('oplog-dir-path');
        if (pathInput) {
            pathInput.value = result.path;
        }
        showToast('已恢复默认目录', 'success');
    }
}

/**
 * 打开操作日志目录
 */
async function openOplogDir() {
    await window.api.oplog.openDir();
}

// ==================== 暴露到全局 ====================

window.openOplogSettings = openOplogSettings;
window.closeOplogSettings = closeOplogSettings;
window.selectOplogDir = selectOplogDir;
window.resetOplogDir = resetOplogDir;
window.openOplogDir = openOplogDir;
