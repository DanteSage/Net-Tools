/**
 * 批量执行控制
 * @module batch/execution
 */

// ==================== 计时器状态 ====================

let executionTimer = {
    startTime: null,
    intervalId: null
};

// ==================== 虚拟滚动状态 ====================

const batchResultVirtualState = {
    worker: null,
    currentHost: null,
    allLines: [],
    totalLines: 0,
    lineHeight: 18,
    visibleStart: 0,
    visibleEnd: 0,
    searchMatches: [],
    searchKeyword: ''
};

// 大文件阈值（超过此大小使用虚拟滚动）
const BATCH_LARGE_OUTPUT_THRESHOLD = 30000;

// ==================== 执行控制初始化 ====================

/**
 * 初始化执行控制
 */
function initExecutionControls() {
    document.getElementById('btn-start-batch')?.addEventListener('click', startBatchExecution);
    document.getElementById('btn-pause-batch')?.addEventListener('click', pauseBatchExecution);
    document.getElementById('btn-stop-batch')?.addEventListener('click', stopBatchExecution);
    document.getElementById('btn-export-results')?.addEventListener('click', exportResults);
    document.getElementById('btn-clear-results')?.addEventListener('click', clearResults);
    
    // 展开/收起全部
    document.getElementById('btn-expand-all')?.addEventListener('click', () => {
        document.querySelectorAll('#batch-results .result-item-v2').forEach(item => {
            item.classList.add('expanded');
        });
    });
    document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
        document.querySelectorAll('#batch-results .result-item-v2').forEach(item => {
            item.classList.remove('expanded');
        });
    });
    
    // 初始化筛选标签
    initResultsFilterV2();
    
    window.api.batch?.removeProgressListener?.();
    
    window.api.batch?.onProgress?.((data) => {
        updateExecutionProgress(data);
    });
}

// ==================== 执行控制 ====================

/**
 * 开始批量执行
 */
async function startBatchExecution() {
    if (batchState.selectedTargets.length === 0) {
        showToast('请先选择目标设备', 'warning');
        return;
    }
    
    const commands = document.getElementById('batch-commands')?.value.trim();
    if (!commands) {
        showToast('请输入要执行的命令', 'warning');
        return;
    }
    
    const customVars = getCustomVariables();
    const options = {
        parallel: document.getElementById('batch-opt-parallel')?.checked ?? true,
        parallelCount: parseInt(document.getElementById('batch-parallel-count')?.value) || 5,
        timeout: document.getElementById('batch-opt-timeout')?.checked 
            ? (parseInt(document.getElementById('batch-timeout')?.value) || 30) * 1000 
            : 0,
        cmdDelay: document.getElementById('batch-opt-cmd-delay')?.checked 
            ? (parseInt(document.getElementById('batch-cmd-delay')?.value) || 500) 
            : 0,
        retryCount: document.getElementById('batch-opt-retry')?.checked 
            ? (parseInt(document.getElementById('batch-retry-count')?.value) || 2) 
            : 0,
        stopOnError: document.getElementById('batch-opt-stop-on-error')?.checked ?? false,
        skipOffline: document.getElementById('batch-opt-skip-offline')?.checked ?? false,
        saveBackup: document.getElementById('batch-opt-save-backup')?.checked ?? false,
        variables: customVars
    };
    
    const commandList = commands.split('\n').filter(c => c.trim());
    
    const commandGroups = await expandCommandsWithVariablesAsync(commandList, customVars);
    const expansionInfo = await getVariableExpansionInfoAsync(commandList, customVars);
    
    let finalCommands = [];
    if (expansionInfo.hasDefinedVars) {
        commandGroups.forEach(group => {
            finalCommands = finalCommands.concat(group);
        });
    } else {
        finalCommands = commandGroups[0] || commandList;
    }
    
    // 显示执行预览确认
    const confirmed = await showExecutionPreview({
        targets: batchState.selectedTargets,
        commands: finalCommands,
        commandGroups: commandGroups,
        expansionInfo: expansionInfo,
        options: options
    });
    
    if (!confirmed) return;
    
    // 大规模执行警告
    const totalOperations = batchState.selectedTargets.length * finalCommands.length;
    if (totalOperations > 5000) {
        const largeConfirmed = await showConfirm({
            title: '大规模操作警告',
            message: `即将对 ${batchState.selectedTargets.length} 台设备执行 ${finalCommands.length} 条命令，共 ${totalOperations} 次操作。\n\n建议降低并发数或增加命令间隔以避免网络拥塞。`,
            confirmText: '继续执行',
            type: 'warning'
        });
        if (!largeConfirmed) return;
    }
    
    // 更新状态
    batchState.isRunning = true;
    batchState.isPaused = false;
    batchState.results = [];
    batchState.stats = {
        total: batchState.selectedTargets.length,
        success: 0,
        failed: 0,
        pending: batchState.selectedTargets.length
    };
    
    updateExecutionUI();
    updateStats();
    clearResultsDisplay();
    startExecutionTimer();
    
    showToast('开始批量执行', 'info');
    
    try {
        const result = await window.api.batch.execute({
            targets: batchState.selectedTargets,
            commands: finalCommands,
            options
        });
        
        if (result.success) {
            showToast(`执行完成，成功 ${batchState.stats.success}，失败 ${batchState.stats.failed}`, 
                batchState.stats.failed > 0 ? 'warning' : 'success');
        } else {
            showToast('执行失败: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('执行出错: ' + error.message, 'error');
    } finally {
        batchState.isRunning = false;
        stopExecutionTimer();
        updateExecutionUI();
    }
}

/**
 * 暂停批量执行
 */
function pauseBatchExecution() {
    batchState.isPaused = !batchState.isPaused;
    window.api.batch?.pause?.(batchState.isPaused);
    
    const btn = document.getElementById('btn-pause-batch');
    if (btn) {
        btn.innerHTML = batchState.isPaused 
            ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> 继续'
            : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> 暂停';
    }
}

/**
 * 停止批量执行
 */
async function stopBatchExecution() {
    const confirmed = await showConfirm({
        title: '停止执行',
        message: '确定要停止当前批量执行任务吗？已完成的操作不会回滚。',
        confirmText: '停止',
        type: 'warning'
    });
    
    if (confirmed) {
        window.api.batch?.stop?.();
        batchState.isRunning = false;
        stopExecutionTimer();
        updateExecutionUI();
        showToast('已停止执行', 'warning');
    }
}

// ==================== 计时器功能 ====================

/**
 * 启动执行计时器
 */
function startExecutionTimer() {
    executionTimer.startTime = Date.now();
    
    const timerEl = document.getElementById('execution-timer');
    const timerValue = document.getElementById('timer-value');
    
    if (timerEl) timerEl.classList.add('running');
    if (timerValue) timerValue.textContent = '00:00';
    
    // 清除之前的计时器
    if (executionTimer.intervalId) {
        clearInterval(executionTimer.intervalId);
    }
    
    // 每秒更新
    executionTimer.intervalId = setInterval(() => {
        updateTimerDisplay();
    }, 1000);
}

/**
 * 停止执行计时器
 */
function stopExecutionTimer() {
    if (executionTimer.intervalId) {
        clearInterval(executionTimer.intervalId);
        executionTimer.intervalId = null;
    }
    
    const timerEl = document.getElementById('execution-timer');
    if (timerEl) timerEl.classList.remove('running');
    
    // 最后更新一次显示
    updateTimerDisplay();
}

/**
 * 更新计时器显示
 */
function updateTimerDisplay() {
    if (!executionTimer.startTime) return;
    
    const elapsed = Date.now() - executionTimer.startTime;
    const timerValue = document.getElementById('timer-value');
    
    if (timerValue) {
        timerValue.textContent = formatDuration(elapsed);
    }
}

/**
 * 格式化时长
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的时长字符串
 */
function formatDuration(ms) {
    if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
        return '--';
    }
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// ==================== 进度更新 ====================

/**
 * 更新执行进度
 */
function updateExecutionProgress(data) {
    const existingIdx = batchState.results.findIndex(r => r.host === data.host);
    const existingStatus = existingIdx >= 0 ? batchState.results[existingIdx].status : null;
    
    if (existingIdx >= 0) {
        batchState.results[existingIdx] = data;
    } else {
        batchState.results.push(data);
    }
    
    const wasCompleted = existingStatus === 'success' || existingStatus === 'failed';
    const isCompleted = data.status === 'success' || data.status === 'failed';
    
    if (!wasCompleted && isCompleted) {
        if (data.status === 'success') {
            batchState.stats.success++;
        } else if (data.status === 'failed') {
            batchState.stats.failed++;
        }
        batchState.stats.pending = Math.max(0, batchState.stats.pending - 1);
    }
    
    updateStats();
    renderResultItem(data);
}

/**
 * 更新统计显示
 */
function updateStats() {
    document.getElementById('stat-total').textContent = batchState.stats.total;
    document.getElementById('stat-success').textContent = batchState.stats.success;
    document.getElementById('stat-failed').textContent = batchState.stats.failed;
    document.getElementById('stat-pending').textContent = batchState.stats.pending;
    
    const completed = batchState.stats.success + batchState.stats.failed;
    const percent = batchState.stats.total > 0 ? Math.round((completed / batchState.stats.total) * 100) : 0;
    
    // 更新进度环
    const ringFill = document.getElementById('progress-ring-fill');
    if (ringFill) {
        const circumference = 2 * Math.PI * 24; // r=24
        const offset = circumference - (percent / 100) * circumference;
        ringFill.style.strokeDashoffset = offset;
    }
    
    document.getElementById('progress-text').textContent = `${percent}%`;
    
    // 计算平均执行时间
    updateAverageTime();
    
    // 更新筛选标签计数
    updateFilterCounts();
}

/**
 * 更新平均执行时间
 */
function updateAverageTime() {
    const completedResults = batchState.results.filter(r => 
        (r.status === 'success' || r.status === 'failed') && r.duration
    );
    
    const avgEl = document.getElementById('stat-avg-time');
    if (!avgEl) return;
    
    if (completedResults.length === 0) {
        avgEl.textContent = '--';
        return;
    }
    
    const totalDuration = completedResults.reduce((sum, r) => sum + r.duration, 0);
    const avgDuration = Math.round(totalDuration / completedResults.length);
    
    avgEl.textContent = formatDuration(avgDuration);
}

/**
 * 更新执行UI状态
 */
function updateExecutionUI() {
    const startBtn = document.getElementById('btn-start-batch');
    const pauseBtn = document.getElementById('btn-pause-batch');
    const stopBtn = document.getElementById('btn-stop-batch');
    
    if (startBtn) {
        startBtn.disabled = batchState.isRunning;
        startBtn.classList.toggle('running', batchState.isRunning);
        if (batchState.isRunning) {
            startBtn.querySelector('.btn-text').textContent = '执行中...';
            startBtn.querySelector('.btn-icon').innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                    </path>
                </svg>
            `;
        } else {
            startBtn.querySelector('.btn-text').textContent = '开始执行';
            startBtn.querySelector('.btn-icon').innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
        }
    }
    if (pauseBtn) pauseBtn.disabled = !batchState.isRunning;
    if (stopBtn) stopBtn.disabled = !batchState.isRunning;
}

// ==================== 结果管理 ====================

/**
 * 渲染单个结果项
 */
function renderResultItem(data) {
    const container = document.getElementById('batch-results');
    if (!container) return;
    
    // 移除空状态
    const emptyState = container.querySelector('.results-empty-state');
    if (emptyState) emptyState.remove();
    
    const statusClass = data.status === 'success' ? 'success' : 
                        data.status === 'failed' ? 'failed' : 
                        data.status === 'running' ? 'running' : 'pending';
    const statusText = data.status === 'success' ? '成功' : 
                       data.status === 'failed' ? '失败' : 
                       data.status === 'running' ? '执行中' : '等待';
    
    let item = container.querySelector(`[data-host="${data.host}"]`);
    if (!item) {
        item = document.createElement('div');
        item.className = 'result-item-v2';
        item.dataset.host = data.host;
        container.appendChild(item);
    }
    
    const deviceType = data.type || 'unknown';
    const typeLabel = { h3c: 'H3C', huawei: 'Huawei', cisco: 'Cisco', ruijie: 'Ruijie', juniper: 'Juniper', linux: 'Linux' }[deviceType] || deviceType;
    const deviceIcon = getResultDeviceIcon(deviceType);
    
    const durationText = data.duration ? formatDuration(data.duration) : '--';
    const outputSize = data.output ? data.output.length : 0;
    const useVirtualScroll = outputSize > BATCH_LARGE_OUTPUT_THRESHOLD;
    
    // 渲染输出内容
    let outputHtml = '';
    if (data.output) {
        if (useVirtualScroll) {
            // 大输出：使用虚拟滚动
            const lines = data.output.split('\n');
            outputHtml = `
                <div class="result-output-header">
                    <span class="output-line-count">${lines.length} 行</span>
                    <span class="output-size">${formatOutputSize(outputSize)}</span>
                </div>
                <div class="result-output-virtual" data-host="${data.host}" data-lines="${lines.length}">
                    <div class="result-virtual-spacer"></div>
                    <div class="result-virtual-content"></div>
                </div>
            `;
        } else {
            // 小输出：直接渲染带行号
            outputHtml = renderResultOutputSimple(data.output);
        }
    } else {
        outputHtml = '<div class="result-output-empty">无输出</div>';
    }
    
    item.innerHTML = `
        <div class="result-header" onclick="toggleResultExpand(this, '${data.host}')">
            <span class="result-status-indicator ${statusClass}"></span>
            <div class="result-device-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">${deviceIcon}</svg>
            </div>
            <div class="result-device-info">
                <div class="result-device-name">${escapeHtml(data.name || data.host)}</div>
                <div class="result-device-meta">
                    <span class="result-device-ip">${escapeHtml(data.host)}</span>
                    <span class="result-device-type">${escapeHtml(typeLabel)}</span>
                </div>
            </div>
            <span class="result-duration" title="执行耗时">${durationText}</span>
            <span class="result-status-badge ${statusClass}">${statusText}</span>
            <span class="result-expand-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
            </span>
        </div>
        <div class="result-body">
            ${data.error ? `<div class="result-error">${escapeHtml(data.error)}</div>` : ''}
            ${outputHtml}
        </div>
    `;
    
    // 存储输出数据用于虚拟滚动
    if (useVirtualScroll && data.output) {
        item.dataset.output = data.output;
    }
    
    item.dataset.status = data.status;
    container.scrollTop = container.scrollHeight;
}

/**
 * 切换结果项展开状态
 */
function toggleResultExpand(header, host) {
    const item = header.parentElement;
    const wasExpanded = item.classList.contains('expanded');
    item.classList.toggle('expanded');
    
    // 如果展开且有虚拟滚动容器，初始化虚拟滚动
    if (!wasExpanded) {
        const virtualContainer = item.querySelector('.result-output-virtual');
        if (virtualContainer && item.dataset.output) {
            initResultVirtualScroll(virtualContainer, item.dataset.output, host);
        }
    }
}

/**
 * 初始化结果虚拟滚动
 */
function initResultVirtualScroll(container, output, host) {
    const lines = output.split('\n');
    const lineHeight = batchResultVirtualState.lineHeight;
    const totalHeight = lines.length * lineHeight;
    
    const spacer = container.querySelector('.result-virtual-spacer');
    const content = container.querySelector('.result-virtual-content');
    
    if (!spacer || !content) return;
    
    spacer.style.height = totalHeight + 'px';
    content.style.height = totalHeight + 'px';
    
    // 存储行数据
    container.dataset.linesData = JSON.stringify(lines.map((line, i) => ({
        lineNumber: i + 1,
        content: escapeHtml(line)
    })));
    
    // 绑定滚动事件
    container.addEventListener('scroll', function() {
        renderResultVirtualContent(this);
    });
    
    // 初始渲染
    renderResultVirtualContent(container);
}

/**
 * 渲染结果虚拟滚动内容
 */
function renderResultVirtualContent(container) {
    const content = container.querySelector('.result-virtual-content');
    if (!content || !container.dataset.linesData) return;
    
    const lines = JSON.parse(container.dataset.linesData);
    const lineHeight = batchResultVirtualState.lineHeight;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const buffer = 5;
    
    const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
    const endLine = Math.min(lines.length, Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer);
    
    let html = '';
    for (let i = startLine; i < endLine; i++) {
        const line = lines[i];
        html += `<div class="result-line" style="top:${i * lineHeight}px">
            <span class="line-number">${line.lineNumber}</span>
            <span class="line-content">${line.content}</span>
        </div>`;
    }
    
    content.innerHTML = html;
}

/**
 * 简单渲染输出（小文件，带行号）
 */
function renderResultOutputSimple(output) {
    const lines = output.split('\n');
    let html = '<div class="result-output-simple">';
    for (let i = 0; i < lines.length; i++) {
        html += `<div class="result-line">
            <span class="line-number">${i + 1}</span>
            <span class="line-content">${escapeHtml(lines[i])}</span>
        </div>`;
    }
    html += '</div>';
    return html;
}

/**
 * 格式化输出大小
 */
function formatOutputSize(size) {
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 获取结果设备图标
 */
function getResultDeviceIcon(type) {
    const icons = {
        h3c: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>',
        huawei: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>',
        cisco: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>',
        ruijie: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>',
        juniper: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>',
        linux: '<path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>',
        default: '<path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/>'
    };
    return icons[type] || icons.default;
}

/**
 * 清空结果显示
 */
function clearResultsDisplay() {
    const container = document.getElementById('batch-results');
    if (container) {
        container.innerHTML = `
            <div class="results-empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                    </svg>
                </div>
                <h4>准备就绪</h4>
                <p>点击"开始执行"运行批量任务</p>
            </div>
        `;
    }
    
    // 重置计时器显示
    resetTimerDisplay();
    
    updateFilterCounts();
}

/**
 * 重置计时器显示
 */
function resetTimerDisplay() {
    executionTimer.startTime = null;
    
    const timerEl = document.getElementById('execution-timer');
    const timerValue = document.getElementById('timer-value');
    const avgEl = document.getElementById('stat-avg-time');
    
    if (timerEl) timerEl.classList.remove('running');
    if (timerValue) timerValue.textContent = '00:00';
    if (avgEl) avgEl.textContent = '--';
    
    // 重置进度环
    const ringFill = document.getElementById('progress-ring-fill');
    if (ringFill) {
        ringFill.style.strokeDashoffset = 150.8; // 初始值
    }
    
    const progressText = document.getElementById('progress-text');
    if (progressText) progressText.textContent = '0%';
}

/**
 * 初始化结果筛选
 */
function initResultsFilter() {
    document.querySelectorAll('.results-filter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.results-filter .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterResults(btn.dataset.filter);
        });
    });
}

/**
 * 初始化结果筛选 V2
 */
function initResultsFilterV2() {
    document.querySelectorAll('.filter-tabs .filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-tabs .filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterResults(btn.dataset.filter);
        });
    });
}

/**
 * 更新筛选标签计数
 */
function updateFilterCounts() {
    const results = batchState.results || [];
    const counts = {
        all: results.length,
        success: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length,
        running: results.filter(r => r.status === 'running').length
    };
    
    const allEl = document.getElementById('filter-count-all');
    const successEl = document.getElementById('filter-count-success');
    const failedEl = document.getElementById('filter-count-failed');
    const runningEl = document.getElementById('filter-count-running');
    
    if (allEl) allEl.textContent = counts.all;
    if (successEl) successEl.textContent = counts.success;
    if (failedEl) failedEl.textContent = counts.failed;
    if (runningEl) runningEl.textContent = counts.running;
}

/**
 * 筛选结果
 */
function filterResults(filter) {
    document.querySelectorAll('#batch-results .result-item-v2').forEach(item => {
        item.style.display = (filter === 'all' || item.dataset.status === filter) ? '' : 'none';
    });
}

/**
 * 导出结果
 */
async function exportResults() {
    if (batchState.results.length === 0) {
        showToast('没有可导出的结果', 'warning');
        return;
    }
    
    const content = batchState.results.map(r => {
        return `=== ${r.host} (${r.status}) ===\n${r.output || r.error || '无输出'}\n`;
    }).join('\n');
    
    try {
        const result = await window.api.dialog?.writeTextFile?.({
            defaultPath: `batch_result_${new Date().toISOString().slice(0,10)}.txt`,
            filters: [{ name: '文本文件', extensions: ['txt'] }]
        }, content);

        if (result) {
            showToast('结果已导出', 'success');
        }
    } catch (error) {
        console.error('导出批量执行结果失败:', error);
        showToast('导出失败: ' + error.message, 'error');
    }
}

/**
 * 清空结果
 */
async function clearResults() {
    if (batchState.results.length === 0) {
        showToast('没有可清空的结果', 'info');
        return;
    }
    
    const confirmed = await showConfirm({
        title: '清空结果',
        message: `确定要清空全部 ${batchState.results.length} 条执行结果吗？`,
        confirmText: '清空',
        type: 'warning'
    });
    
    if (!confirmed) return;
    
    batchState.results = [];
    batchState.stats = { total: 0, success: 0, failed: 0, pending: 0 };
    updateStats();
    clearResultsDisplay();
    showToast('结果已清空', 'success');
}

// ==================== 暴露到全局 ====================

window.toggleResultExpand = toggleResultExpand;
