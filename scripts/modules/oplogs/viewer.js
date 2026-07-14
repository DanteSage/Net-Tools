/**
 * 操作日志模块 - 查看器（含虚拟滚动）
 * @module oplogs/viewer
 */

// ==================== 查看器 ====================

/**
 * 查看操作记录
 */
async function viewOplog(id) {
    // 立即更新列表选中状态
    oplogState.currentOplogId = id;
    document.querySelectorAll('.oplog-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === id);
    });
    
    const viewer = document.getElementById('oplog-viewer');
    
    // 重置虚拟滚动状态
    oplogVirtualState.allLines = [];
    oplogVirtualState.searchMatches = [];
    oplogVirtualState.searchKeyword = '';
    oplogVirtualState.isLoading = true;
    
    // 先显示加载状态
    viewer.innerHTML = `
        <div class="oplog-loading">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        </div>
    `;
    
    // 异步加载内容
    const oplog = await window.api.oplog.get(id);
    if (!oplog || oplogState.currentOplogId !== id) return;
    
    // 缓存当前日志内容
    setCurrentOplogContent(oplog.content);
    
    const deviceType = oplog.deviceType || 'default';
    const iconPath = getOplogDeviceIcon(deviceType);
    const connType = oplog.connectionType || 'ssh';
    const connLabel = connType === 'serial' ? 'Console' : (connType === 'telnet' ? 'Telnet' : 'SSH');
    const contentSize = oplog.contentSize || (oplog.content ? oplog.content.length : 0);
    
    // 根据文件大小决定渲染方式
    if (contentSize > OPLOG_LARGE_FILE_THRESHOLD) {
        // 大文件：使用虚拟滚动
        renderOplogViewerHeader(viewer, oplog, deviceType, iconPath, connType, connLabel, contentSize, true);
        initOplogWorker();
        if (oplogVirtualState.worker) {
            oplogVirtualState.enableHighlight = contentSize < LARGE_FILE_THRESHOLD;
            oplogVirtualState.worker.postMessage({
                type: 'parseLog',
                data: { 
                    content: oplog.content, 
                    id: id,
                    enableHighlight: oplogVirtualState.enableHighlight
                }
            });
        } else {
            // Worker 不可用，降级
            renderOplogSimple(viewer, oplog, deviceType, iconPath, connType, connLabel, contentSize);
        }
    } else {
        // 小文件：直接渲染
        renderOplogSimple(viewer, oplog, deviceType, iconPath, connType, connLabel, contentSize);
    }
}

/**
 * 初始化 Oplog Worker
 */
function initOplogWorker() {
    if (oplogVirtualState.worker) return;
    
    try {
        oplogVirtualState.worker = new Worker('scripts/workers/backup-parser.js');
        oplogVirtualState.worker.onmessage = handleOplogWorkerMessage;
        oplogVirtualState.worker.onerror = function(e) {
            console.error('[远程记录] Worker 错误:', e);
        };
    } catch (e) {
        console.error('[远程记录] Worker 初始化失败:', e);
    }
}

/**
 * 处理 Worker 消息
 */
function handleOplogWorkerMessage(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'logParsed':
            onOplogParsed(data);
            break;
        case 'logSearchResult':
            onOplogSearchResult(data);
            break;
        case 'error':
            console.error('[远程记录] 解析错误:', data.message);
            oplogVirtualState.isLoading = false;
            break;
    }
}

/**
 * 日志解析完成回调
 */
function onOplogParsed(data) {
    if (data.id !== oplogState.currentOplogId) return;
    
    // 合并所有分块
    oplogVirtualState.allLines = [];
    for (let i = 0; i < data.chunks.length; i++) {
        oplogVirtualState.allLines = oplogVirtualState.allLines.concat(data.chunks[i].lines);
    }
    oplogVirtualState.totalLines = data.totalLines;
    oplogVirtualState.lineHeight = data.lineHeight;
    oplogVirtualState.isLoading = false;
    
    // 更新行数显示
    const lineCountEl = document.getElementById('oplog-line-count');
    if (lineCountEl) {
        lineCountEl.textContent = data.totalLines + ' 行';
    }
    
    renderOplogVirtualContent();
}

/**
 * 搜索结果回调
 */
function onOplogSearchResult(data) {
    oplogVirtualState.searchMatches = data.matches;
    oplogVirtualState.searchKeyword = data.keyword;
    
    const countEl = document.getElementById('oplog-search-count');
    if (countEl) {
        countEl.textContent = data.matches.length > 0 ? data.matches.length + ' 个匹配' : '无匹配';
    }
    
    renderOplogVirtualContent();
    
    if (data.matches.length > 0) {
        scrollToOplogLine(data.matches[0]);
    }
}

/**
 * 渲染虚拟滚动头部
 */
function renderOplogViewerHeader(viewer, oplog, deviceType, iconPath, connType, connLabel, contentSize, isVirtual) {
    viewer.innerHTML = `
        <div class="oplog-viewer-header">
            <div class="oplog-viewer-info">
                <div class="oplog-viewer-icon ${deviceType}">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${iconPath}</svg>
                </div>
                <div class="oplog-viewer-meta">
                    <span class="oplog-viewer-title">${escapeHtml(oplog.deviceName)}</span>
                    <div class="oplog-viewer-details">
                        <span class="oplog-conn-type ${connType}">${connLabel}</span>
                        <span>${formatDate(oplog.startTime)}</span>
                        <span>·</span>
                        <span>${formatDuration(oplog.startTime, oplog.endTime)}</span>
                        <span>·</span>
                        <span>${formatSize(contentSize)}</span>
                        <span>·</span>
                        <span id="oplog-line-count">加载中...</span>
                    </div>
                </div>
            </div>
            <div class="oplog-viewer-actions">
                <div class="oplog-viewer-search">
                    <input type="text" id="oplog-content-search" placeholder="搜索内容..." onkeyup="searchInOplogContentVirtual(this.value)">
                    <span id="oplog-search-count"></span>
                </div>
                <button class="btn btn-sm btn-ghost" onclick="copyOplogContent('${oplog.id}')" title="复制内容">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-ghost" onclick="exportOplog('${oplog.id}')" title="导出">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-ghost btn-danger-text" onclick="deleteOplog('${oplog.id}')" title="删除">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="oplog-content oplog-virtual-container" id="oplog-virtual-container">
            <div class="oplog-virtual-spacer" id="oplog-virtual-spacer"></div>
            <div class="oplog-virtual-content" id="oplog-virtual-content"></div>
        </div>
    `;
    
    // 绑定滚动事件
    const container = document.getElementById('oplog-virtual-container');
    if (container) {
        container.addEventListener('scroll', onOplogScroll);
    }
}

/**
 * 简单渲染（小文件）
 */
function renderOplogSimple(viewer, oplog, deviceType, iconPath, connType, connLabel, contentSize) {
    const lines = oplog.content.split('\n');
    
    viewer.innerHTML = `
        <div class="oplog-viewer-header">
            <div class="oplog-viewer-info">
                <div class="oplog-viewer-icon ${deviceType}">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${iconPath}</svg>
                </div>
                <div class="oplog-viewer-meta">
                    <span class="oplog-viewer-title">${escapeHtml(oplog.deviceName)}</span>
                    <div class="oplog-viewer-details">
                        <span class="oplog-conn-type ${connType}">${connLabel}</span>
                        <span>${formatDate(oplog.startTime)}</span>
                        <span>·</span>
                        <span>${formatDuration(oplog.startTime, oplog.endTime)}</span>
                        <span>·</span>
                        <span>${formatSize(contentSize)}</span>
                        <span>·</span>
                        <span>${lines.length} 行</span>
                    </div>
                </div>
            </div>
            <div class="oplog-viewer-actions">
                <div class="oplog-viewer-search">
                    <input type="text" id="oplog-content-search" placeholder="搜索内容..." onkeyup="searchInOplogContent(event)">
                    <span id="oplog-search-count"></span>
                </div>
                <button class="btn btn-sm btn-ghost" onclick="copyOplogContent('${oplog.id}')" title="复制内容">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-ghost" onclick="exportOplog('${oplog.id}')" title="导出">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </button>
                <button class="btn btn-sm btn-ghost btn-danger-text" onclick="deleteOplog('${oplog.id}')" title="删除">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="oplog-content oplog-simple-content" id="oplog-content-display"></div>
    `;
    
    // 渲染带行号的内容
    requestAnimationFrame(() => {
        if (oplogState.currentOplogId !== oplog.id) return;
        const contentEl = document.getElementById('oplog-content-display');
        if (contentEl) {
            contentEl.innerHTML = renderOplogLinesSimple(lines);
        }
    });
    
    oplogVirtualState.isLoading = false;
}

/**
 * 渲染简单模式的行（带行号）
 */
function renderOplogLinesSimple(lines) {
    let html = '';
    for (let i = 0; i < lines.length; i++) {
        const lineContent = highlightLogLine(escapeHtml(lines[i]));
        html += `<div class="oplog-line">
            <span class="line-number">${i + 1}</span>
            <span class="line-content">${lineContent}</span>
        </div>`;
    }
    return html;
}

/**
 * 单行语法高亮
 */
function highlightLogLine(line) {
    return line
        .replace(/^(.+[>#\$]\s*)$/g, '<span class="log-prompt">$1</span>')
        .replace(/(\d{4}[-\/]\d{2}[-\/]\d{2}\s+\d{2}:\d{2}:\d{2})/g, '<span class="log-timestamp">$1</span>')
        .replace(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g, '<span class="log-ip">$1</span>')
        .replace(/\b(success|successful|ok|up|enabled|active)\b/gi, '<span class="log-success">$1</span>')
        .replace(/\b(fail|failed|error|down|disabled|inactive)\b/gi, '<span class="log-error">$1</span>')
        .replace(/\b(warning|warn|caution)\b/gi, '<span class="log-warning">$1</span>');
}

/**
 * 渲染虚拟滚动内容
 */
function renderOplogVirtualContent() {
    const container = document.getElementById('oplog-virtual-container');
    const spacer = document.getElementById('oplog-virtual-spacer');
    const content = document.getElementById('oplog-virtual-content');
    
    if (!container || !spacer || !content) return;
    
    const totalLines = oplogVirtualState.totalLines;
    const lineHeight = oplogVirtualState.lineHeight;
    const totalHeight = totalLines * lineHeight;
    
    spacer.style.height = totalHeight + 'px';
    
    // 计算可见范围
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const buffer = 10;
    
    const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
    const endLine = Math.min(totalLines, Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer);
    
    oplogVirtualState.visibleStart = startLine;
    oplogVirtualState.visibleEnd = endLine;
    
    // 渲染可见行
    let html = '';
    const searchKeyword = oplogVirtualState.searchKeyword;
    const searchMatches = oplogVirtualState.searchMatches;
    
    for (let i = startLine; i < endLine && i < oplogVirtualState.allLines.length; i++) {
        const line = oplogVirtualState.allLines[i];
        let lineContent = line.content;
        const isMatch = searchMatches.indexOf(i) !== -1;
        
        // 高亮搜索结果
        if (searchKeyword && isMatch) {
            const regex = new RegExp('(' + searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            lineContent = lineContent.replace(regex, '<mark>$1</mark>');
        }
        
        html += `<div class="oplog-line${isMatch ? ' highlight' : ''}" style="top:${i * lineHeight}px">
            <span class="line-number">${line.lineNumber}</span>
            <span class="line-content">${lineContent}</span>
        </div>`;
    }
    
    content.innerHTML = html;
    content.style.height = totalHeight + 'px';
}

/**
 * 滚动事件处理
 */
function onOplogScroll() {
    requestAnimationFrame(renderOplogVirtualContent);
}

/**
 * 滚动到指定行
 */
function scrollToOplogLine(lineIndex) {
    const container = document.getElementById('oplog-virtual-container');
    if (!container) return;
    
    const lineHeight = oplogVirtualState.lineHeight;
    container.scrollTop = lineIndex * lineHeight - container.clientHeight / 2;
}

/**
 * 滚动到指定行（简单模式）
 */
function scrollToOplogLineSimple(lineIndex) {
    const contentEl = document.getElementById('oplog-content-display');
    if (!contentEl) return;
    
    const lineEl = contentEl.querySelector(`[data-line="${lineIndex}"]`);
    if (lineEl) {
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * 语法高亮处理
 * @param {string} content - 日志内容
 * @param {boolean} forceHighlight - 强制高亮（忽略大小限制）
 */
function highlightLogContent(content, forceHighlight = false) {
    if (!content) return '';
    
    // 大文件跳过语法高亮，避免卡顿
    if (!forceHighlight && content.length > LARGE_FILE_THRESHOLD) {
        return escapeHtml(content);
    }
    
    return escapeHtml(content)
        // 命令提示符高亮 (以 > # $ 结尾的行)
        .replace(/^(.+[>#\$]\s*)$/gm, '<span class="log-prompt">$1</span>')
        // 时间戳高亮
        .replace(/(\d{4}[-\/]\d{2}[-\/]\d{2}\s+\d{2}:\d{2}:\d{2})/g, '<span class="log-timestamp">$1</span>')
        // IP地址高亮
        .replace(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g, '<span class="log-ip">$1</span>')
        // 成功/失败关键词
        .replace(/\b(success|successful|ok|up|enabled|active)\b/gi, '<span class="log-success">$1</span>')
        .replace(/\b(fail|failed|error|down|disabled|inactive)\b/gi, '<span class="log-error">$1</span>')
        // 警告关键词
        .replace(/\b(warning|warn|caution)\b/gi, '<span class="log-warning">$1</span>')
        // 分隔线
        .replace(/^(={3,}|─{3,}|-{3,})$/gm, '<span class="log-separator">$1</span>')
        // 标题行
        .replace(/^(===\s*.+\s*===)$/gm, '<span class="log-title">$1</span>');
}
