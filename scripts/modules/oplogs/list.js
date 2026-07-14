/**
 * 操作日志模块 - 列表渲染
 * @module oplogs/list
 */

// ==================== 操作记录页面 ====================

/**
 * 加载操作记录列表
 */
async function loadOplogList() {
    const oplogs = await window.api.oplog.getAll();
    state.oplogs = oplogs;
    oplogState.selectedIds.clear();
    
    updateStats();
    updateBatchButtons();
    renderOplogList();
}

/**
 * 获取过滤和排序后的操作记录
 */
function getFilteredAndSortedOplogs() {
    let filtered = [...(state.oplogs || [])];
    
    // 日期筛选
    if (oplogState.dateFilter !== 'all') {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        filtered = filtered.filter(o => {
            const date = new Date(o.startTime);
            switch (oplogState.dateFilter) {
                case 'today':
                    return date >= today;
                case 'week':
                    return date >= new Date(today - 7 * 24 * 60 * 60 * 1000);
                case 'month':
                    return date >= new Date(today - 30 * 24 * 60 * 60 * 1000);
                default:
                    return true;
            }
        });
    }
    
    // 关键词搜索（只搜索元数据，避免大文件卡顿）
    if (oplogState.filterKeyword) {
        const keyword = oplogState.filterKeyword.toLowerCase();
        filtered = filtered.filter(o => 
            o.deviceName.toLowerCase().includes(keyword) ||
            (o.connectionType && o.connectionType.toLowerCase().includes(keyword))
        );
    }
    
    // 排序
    filtered.sort((a, b) => {
        switch (oplogState.sortBy) {
            case 'time-asc':
                return new Date(a.startTime) - new Date(b.startTime);
            case 'name-asc':
                return a.deviceName.localeCompare(b.deviceName);
            case 'name-desc':
                return b.deviceName.localeCompare(a.deviceName);
            case 'size-desc':
                return (b.contentSize || 0) - (a.contentSize || 0);
            case 'time-desc':
            default:
                return new Date(b.startTime) - new Date(a.startTime);
        }
    });
    
    return filtered;
}

/**
 * 渲染操作记录列表
 */
function renderOplogList() {
    const container = document.getElementById('oplog-list');
    const filtered = getFilteredAndSortedOplogs();
    
    // 更新统计
    updateStats(filtered.length);
    
    if (filtered.length === 0) {
        const hasFilter = oplogState.filterKeyword || oplogState.dateFilter !== 'all';
        container.innerHTML = `
            <div class="oplog-empty">
                <div class="oplog-empty-icon">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                        <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                    </svg>
                </div>
                <p class="oplog-empty-text">${hasFilter ? '未找到匹配的记录' : '暂无操作记录'}</p>
                <p class="oplog-empty-hint">${hasFilter ? '尝试调整筛选条件' : '在远程终端中开启"记录日志"后，操作将被记录到这里'}</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filtered.map(oplog => {
        // 使用预计算的 contentSize，避免重复计算
        const contentSize = oplog.contentSize || 0;
        const isSelected = oplogState.selectedIds.has(oplog.id);
        const deviceType = oplog.deviceType || 'default';
        const iconPath = getOplogDeviceIcon(deviceType);
        const connType = oplog.connectionType || 'ssh';
        const connLabel = connType === 'serial' ? 'Console' : (connType === 'telnet' ? 'Telnet' : 'SSH');
        
        const isPreview = oplogState.currentOplogId === oplog.id;
        
        return `
            <div class="oplog-item${isPreview ? ' selected' : ''}" 
                 data-id="${oplog.id}" tabindex="0" onclick="viewOplog('${oplog.id}')">
                <div class="oplog-checkbox" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleOplogSelect('${oplog.id}')">
                </div>
                <div class="oplog-item-icon ${deviceType}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${iconPath}</svg>
                </div>
                <div class="oplog-item-content">
                    <div class="oplog-item-header">
                        <span class="oplog-device-name">${escapeHtml(oplog.deviceName)}</span>
                        <span class="oplog-conn-type ${connType}">${connLabel}</span>
                    </div>
                    <div class="oplog-item-meta">
                        <span class="oplog-time" title="${formatDate(oplog.startTime)}">${formatRelativeTime(oplog.startTime)}</span>
                        <span class="oplog-separator">·</span>
                        <span class="oplog-duration">${formatDuration(oplog.startTime, oplog.endTime)}</span>
                        <span class="oplog-separator">·</span>
                        <span class="oplog-size">${formatSize(contentSize)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 更新统计信息
 */
function updateStats(filteredCount) {
    const statsEl = document.getElementById('oplog-stats');
    if (!statsEl) return;
    
    const total = state.oplogs ? state.oplogs.length : 0;
    const selected = oplogState.selectedIds.size;
    const filtered = filteredCount !== undefined ? filteredCount : total;
    
    const totalSpan = statsEl.querySelector('.oplog-stats-total strong');
    const selectedSpan = statsEl.querySelector('.oplog-stats-selected');
    const filteredSpan = statsEl.querySelector('.oplog-stats-filtered');
    
    if (totalSpan) totalSpan.textContent = total;
    
    if (selectedSpan) {
        if (selected > 0) {
            selectedSpan.style.display = 'inline';
            selectedSpan.querySelector('strong').textContent = selected;
        } else {
            selectedSpan.style.display = 'none';
        }
    }
    
    // 显示筛选结果数
    if (filteredSpan) {
        if (filtered !== total) {
            filteredSpan.style.display = 'inline';
            filteredSpan.querySelector('strong').textContent = filtered;
        } else {
            filteredSpan.style.display = 'none';
        }
    }
}

/**
 * 格式化持续时间
 */
function formatDuration(startStr, endStr) {
    if (!endStr) return '进行中';
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diff = Math.floor((end - start) / 1000);
    if (diff < 60) return `${diff}秒`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟`;
    return `${Math.floor(diff / 3600)}小时${Math.floor((diff % 3600) / 60)}分钟`;
}

/**
 * 搜索过滤
 */
function filterOplogs(keyword) {
    oplogState.filterKeyword = keyword;
    renderOplogList();
}

/**
 * 日期筛选
 */
function filterOplogsByDate(dateFilter) {
    oplogState.dateFilter = dateFilter;
    renderOplogList();
}

/**
 * 排序
 */
function sortOplogs(sortBy) {
    oplogState.sortBy = sortBy;
    renderOplogList();
}

/**
 * 复制操作记录内容
 */
async function copyOplogContent(id) {
    const oplog = await window.api.oplog.get(id);
    if (!oplog) return;
    
    try {
        await navigator.clipboard.writeText(oplog.content);
        showToast('已复制到剪贴板', 'success');
    } catch (error) {
        showToast('复制失败', 'error');
    }
}

/**
 * 导出操作记录
 */
async function exportOplog(id) {
    const oplog = await window.api.oplog.get(id);
    if (!oplog) return;
    
    downloadOplog(oplog);
    showToast('日志已导出', 'success');
}

/**
 * 下载单个日志文件
 */
function downloadOplog(oplog) {
    const blob = new Blob([oplog.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oplog_${oplog.deviceName}_${new Date(oplog.startTime).toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 删除操作记录
 */
async function deleteOplog(id) {
    const oplog = state.oplogs.find(o => o.id === id);
    if (!oplog) return;
    
    const confirmed = await showConfirm({
        title: '删除记录',
        message: `确定要删除「${oplog.deviceName}」的操作记录吗？此操作无法撤销。`,
        confirmText: '删除',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    await window.api.oplog.delete(id);
    oplogState.currentOplogId = null;
    loadOplogList();
    resetOplogViewer();
    showToast('操作记录已删除', 'success');
}

/**
 * 清空所有操作记录
 */
async function clearAllOplogs() {
    const total = state.oplogs ? state.oplogs.length : 0;
    if (total === 0) {
        showToast('暂无操作记录', 'warning');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '清空全部',
        message: `确定要清空全部 ${total} 条操作记录吗？此操作无法撤销。`,
        confirmText: '清空',
        type: 'danger'
    });
    
    if (!confirmed) return;
    
    await window.api.oplog.clearAll();
    oplogState.currentOplogId = null;
    loadOplogList();
    resetOplogViewer();
    showToast('所有操作记录已清空', 'success');
}

/**
 * 重置查看器为空状态
 */
function resetOplogViewer() {
    document.getElementById('oplog-viewer').innerHTML = `
        <div class="viewer-placeholder">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style="opacity: 0.3;">
                <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            <p>选择一条操作记录查看详情</p>
        </div>
    `;
}
