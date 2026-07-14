/**
 * 运行日志模块
 * @module runtime-logs
 */

// ==================== 常量定义 ====================

const LOG_LEVEL = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    SUCCESS: 'success'
};

// ==================== 状态管理 ====================

const runtimeLogsState = {
    logs: [],
    maxLogs: 1000,
    isPaused: false,
    filters: {
        info: true,
        warning: true,
        error: true,
        success: true
    },
    searchKeyword: ''
};

// 防抖保存定时器
let saveLogsTimer = null;

// ==================== 初始化 ====================

/**
 * 初始化运行日志模块
 */
function initLogsModule() {
    const pauseBtn = document.getElementById('btn-pause-logs');
    const exportBtn = document.getElementById('btn-export-logs');
    const clearBtn = document.getElementById('btn-clear-logs');
    const searchInput = document.getElementById('logs-search');
    
    if (pauseBtn) {
        pauseBtn.addEventListener('click', toggleLogsPause);
    }
    
    if (exportBtn) {
        exportBtn.addEventListener('click', exportRuntimeLogs);
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearRuntimeLogs);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            runtimeLogsState.searchKeyword = this.value.toLowerCase();
            renderRuntimeLogs();
        });
    }
    
    // 过滤器
    ['info', 'warning', 'error', 'success'].forEach(function(level) {
        const checkbox = document.getElementById('filter-' + level);
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                runtimeLogsState.filters[level] = this.checked;
                renderRuntimeLogs();
            });
        }
    });
    
    // 滚动按钮
    const scrollBtn = document.getElementById('logs-scroll-btn');
    const logsList = document.getElementById('runtime-logs-list');
    
    if (scrollBtn && logsList) {
        scrollBtn.addEventListener('click', function() {
            logsList.scrollTop = 0;
            scrollBtn.classList.remove('visible');
        });
        
        logsList.addEventListener('scroll', function() {
            if (logsList.scrollTop > 100) {
                scrollBtn.classList.add('visible');
            } else {
                scrollBtn.classList.remove('visible');
            }
        });
    }
    
    // 加载持久化的日志
    loadRuntimeLogs().then(function() {
        // 添加启动日志
        addRuntimeLog('info', '应用启动', '软件已成功启动');
    });
}

/**
 * 初始化日志页面
 */
function initLogsPage() {
    initLogsModule();
}

// ==================== 持久化 ====================

/**
 * 加载持久化的运行日志
 */
async function loadRuntimeLogs() {
    try {
        const logs = await window.api.logs.load();
        if (logs && logs.length > 0) {
            runtimeLogsState.logs = logs;
            updateLogsStats();
            renderRuntimeLogs();
        }
    } catch (error) {
        console.error('加载运行日志失败:', error);
    }
}

/**
 * 防抖保存日志
 */
function saveRuntimeLogsDebounced() {
    if (saveLogsTimer) clearTimeout(saveLogsTimer);
    saveLogsTimer = setTimeout(function() {
        window.api.logs.save(runtimeLogsState.logs);
    }, 1000);
}

// ==================== 日志操作 ====================

/**
 * 添加运行日志
 */
function addRuntimeLog(level, title, message, details) {
    if (runtimeLogsState.isPaused) return;
    
    const log = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        level: level,
        title: title,
        message: message,
        details: details || null,
        timestamp: new Date().toISOString()
    };
    
    // 添加到开头
    runtimeLogsState.logs.unshift(log);
    
    // 限制最大数量
    if (runtimeLogsState.logs.length > runtimeLogsState.maxLogs) {
        runtimeLogsState.logs = runtimeLogsState.logs.slice(0, runtimeLogsState.maxLogs);
    }
    
    updateLogsStats();
    renderRuntimeLogs();
    
    // 自动保存（防抖）
    saveRuntimeLogsDebounced();
    
    return log;
}

/**
 * 切换暂停状态
 */
function toggleLogsPause() {
    runtimeLogsState.isPaused = !runtimeLogsState.isPaused;
    
    const btn = document.getElementById('btn-pause-logs');
    const indicator = document.getElementById('logs-status-indicator');
    
    if (btn) {
        if (runtimeLogsState.isPaused) {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> 继续';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-secondary');
        } else {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> 暂停';
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    }
    
    // 更新状态指示器
    if (indicator) {
        const dot = indicator.querySelector('.status-dot');
        const text = indicator.querySelector('.status-text');
        if (dot) {
            dot.classList.toggle('recording', !runtimeLogsState.isPaused);
            dot.classList.toggle('paused', runtimeLogsState.isPaused);
        }
        if (text) {
            text.textContent = runtimeLogsState.isPaused ? '已暂停' : '记录中';
        }
    }
    
    showToast(runtimeLogsState.isPaused ? '日志记录已暂停' : '日志记录已恢复', 'info');
}

/**
 * 导出运行日志
 */
function exportRuntimeLogs() {
    if (runtimeLogsState.logs.length === 0) {
        showToast('没有日志可导出', 'info');
        return;
    }
    
    const content = runtimeLogsState.logs.map(function(log) {
        const time = new Date(log.timestamp).toLocaleString('zh-CN');
        return '[' + time + '] [' + log.level.toUpperCase() + '] ' + log.title + ': ' + log.message + (log.details ? '\n  ' + log.details : '');
    }).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'runtime-logs-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('日志已导出', 'success');
}

/**
 * 清空运行日志
 */
async function clearRuntimeLogs() {
    if (runtimeLogsState.logs.length === 0) {
        showToast('没有日志可清空', 'info');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '清空运行日志',
        message: '确定要清空所有 ' + runtimeLogsState.logs.length + ' 条运行日志吗？',
        type: 'warning'
    });
    
    if (confirmed) {
        runtimeLogsState.logs = [];
        updateLogsStats();
        renderRuntimeLogs();
        // 清空持久化文件
        await window.api.logs.clear();
        showToast('运行日志已清空', 'success');
    }
}

// ==================== 渲染函数 ====================

/**
 * 更新日志统计
 */
function updateLogsStats() {
    const logs = runtimeLogsState.logs;
    const counts = { info: 0, warning: 0, error: 0, success: 0 };
    
    logs.forEach(function(log) {
        if (counts[log.level] !== undefined) {
            counts[log.level]++;
        }
    });
    
    const infoCount = document.getElementById('logs-info-count');
    const warningCount = document.getElementById('logs-warning-count');
    const errorCount = document.getElementById('logs-error-count');
    const successCount = document.getElementById('logs-success-count');
    
    if (infoCount) infoCount.textContent = counts.info;
    if (warningCount) warningCount.textContent = counts.warning;
    if (errorCount) errorCount.textContent = counts.error;
    if (successCount) successCount.textContent = counts.success;
}

/**
 * 渲染运行日志列表
 */
function renderRuntimeLogs() {
    const container = document.getElementById('runtime-logs-list');
    if (!container) return;
    
    const logs = runtimeLogsState.logs.filter(function(log) {
        // 级别过滤
        if (!runtimeLogsState.filters[log.level]) return false;
        
        // 搜索过滤
        if (runtimeLogsState.searchKeyword) {
            const keyword = runtimeLogsState.searchKeyword;
            return log.title.toLowerCase().includes(keyword) ||
                   log.message.toLowerCase().includes(keyword) ||
                   (log.details && log.details.toLowerCase().includes(keyword));
        }
        
        return true;
    });
    
    if (logs.length === 0) {
        container.innerHTML = '<div class="logs-empty">' +
            '<svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">' +
                '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' +
            '</svg>' +
            '<p>' + (runtimeLogsState.searchKeyword ? '未找到匹配的日志' : '暂无运行日志') + '</p>' +
        '</div>';
        return;
    }
    
    let html = '';
    for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        html += renderRuntimeLogItem(log);
    }
    container.innerHTML = html;
}

/**
 * 渲染单条日志（表格式布局）
 */
function renderRuntimeLogItem(log) {
    const icons = {
        info: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
        warning: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
        error: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>',
        success: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>'
    };
    
    const time = new Date(log.timestamp);
    const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let html = '<div class="runtime-log-item table-row ' + log.level + '">' +
        '<span class="log-col log-col-time">' + timeStr + '</span>' +
        '<span class="log-col log-col-level">' +
            '<svg viewBox="0 0 24 24" fill="currentColor">' + icons[log.level] + '</svg>' +
        '</span>' +
        '<span class="log-col log-col-title" title="' + escapeHtml(log.title) + '">' + escapeHtml(log.title) + '</span>' +
        '<span class="log-col log-col-message" title="' + escapeHtml(log.message) + '">' + escapeHtml(log.message);
    
    if (log.details) {
        html += ' <span class="log-details-hint">(' + escapeHtml(log.details).substring(0, 50) + '...)</span>';
    }
    
    html += '</span></div>';
    
    return html;
}

// ==================== 暴露到全局 ====================

window.addRuntimeLog = addRuntimeLog;
window.LOG_LEVEL = LOG_LEVEL;
