/**
 * 配置备份模块 - 预览功能
 * @module backup/preview
 */

// ==================== Web Worker 初始化 ====================

function initBackupWorker() {
    if (previewLoadingState.worker) return;
    
    try {
        previewLoadingState.worker = new Worker('scripts/workers/backup-parser.js');
        previewLoadingState.worker.onmessage = handleWorkerMessage;
        previewLoadingState.worker.onerror = function(e) {
            console.error('[备份] Worker 错误:', e);
        };
    } catch (e) {
        console.error('[备份] Worker 初始化失败:', e);
    }
}

function handleWorkerMessage(e) {
    const type = e.data.type;
    const data = e.data.data;
    
    switch (type) {
        case 'parsed':
            onBackupParsed(data);
            break;
        case 'searchResult':
            onBackupSearchResult(data);
            break;
        case 'error':
            console.error('[备份] 解析错误:', data.message);
            previewLoadingState.isLoading = false;
            break;
    }
}

function onBackupParsed(data) {
    if (data.fileName !== previewLoadingState.currentFile) return;
    
    // 合并所有分块的行数据
    previewLoadingState.allLines = [];
    for (let i = 0; i < data.chunks.length; i++) {
        previewLoadingState.allLines = previewLoadingState.allLines.concat(data.chunks[i].lines);
    }
    previewLoadingState.totalLines = data.totalLines;
    previewLoadingState.lineHeight = data.lineHeight;
    previewLoadingState.isLoading = false;
    
    // 渲染虚拟滚动内容
    renderVirtualContent();
}

function onBackupSearchResult(data) {
    previewLoadingState.searchMatches = data.matches;
    previewLoadingState.searchKeyword = data.keyword;
    renderVirtualContent();
    
    // 跳转到第一个匹配
    if (data.matches.length > 0) {
        scrollToLine(data.matches[0]);
    }
}

// ==================== 预览功能 ====================

async function previewBackup(fileName) {
    if (previewLoadingState.isLoading && previewLoadingState.currentFile === fileName) {
        return;
    }
    
    if (backupState.selectedPreview === fileName && !previewLoadingState.isLoading) {
        return;
    }
    
    backupState.selectedPreview = fileName;
    previewLoadingState.isLoading = true;
    previewLoadingState.currentFile = fileName;
    previewLoadingState.allLines = [];
    previewLoadingState.searchMatches = [];
    previewLoadingState.searchKeyword = '';
    renderBackupList();
    
    const panel = document.getElementById('backup-preview-panel');
    if (!panel) {
        previewLoadingState.isLoading = false;
        return;
    }
    
    panel.innerHTML = '<div class="backup-preview-loading">' +
        '<div class="loading-spinner"></div>' +
        '<h3>正在加载...</h3>' +
        '<p>' + escapeHtml(fileName) + '</p>' +
    '</div>';
    
    try {
        const content = await window.api.backup.read(fileName);
        
        if (previewLoadingState.currentFile !== fileName) {
            return;
        }
        
        if (content) {
            // 直接显示文件内容（保存时已经清理过控制字符）
            const backup = backupState.backups.find(function(b) { return b.name === fileName; });
            const contentSize = content.length;
            
            // 根据文件大小决定渲染方式
            if (contentSize > BACKUP_LARGE_FILE_THRESHOLD) {
                // 大文件：使用 Worker + 虚拟滚动
                renderPreviewHeader(fileName, backup);
                initBackupWorker();
                if (previewLoadingState.worker) {
                    previewLoadingState.worker.postMessage({
                        type: 'parse',
                        data: { content: content, fileName: fileName }
                    });
                } else {
                    // Worker 不可用，降级为简单渲染
                    renderSimplePreview(fileName, content, backup);
                }
            } else {
                // 小文件：直接渲染
                renderSimplePreview(fileName, content, backup);
            }
        }
    } catch (error) {
        if (previewLoadingState.currentFile !== fileName) {
            return;
        }
        
        panel.innerHTML = '<div class="backup-preview-placeholder">' +
            '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>' +
            '<h3>加载失败</h3>' +
            '<p>' + error.message + '</p>' +
        '</div>';
        previewLoadingState.isLoading = false;
    }
}

function renderPreviewHeader(fileName, backup) {
    const panel = document.getElementById('backup-preview-panel');
    if (!panel) return;
    
    panel.innerHTML = '<div class="backup-preview-header">' +
        '<div class="backup-preview-title">' +
            '<h3>' + escapeHtml(fileName) + '</h3>' +
            '<span class="backup-preview-meta" id="backup-line-count">加载中...</span>' +
        '</div>' +
        '<div class="backup-preview-actions">' +
            '<div class="backup-preview-search">' +
                '<input type="text" id="backup-content-search" placeholder="搜索内容..." onkeyup="searchBackupContentDebounced(this.value)">' +
                '<span id="backup-search-count"></span>' +
            '</div>' +
            '<button class="btn btn-sm btn-secondary" onclick="downloadBackup(\'' + escapeHtml(fileName) + '\')">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> 下载' +
            '</button>' +
        '</div>' +
    '</div>' +
    '<div class="backup-preview-content" id="backup-virtual-container">' +
        '<div class="backup-virtual-spacer" id="backup-virtual-spacer"></div>' +
        '<pre class="backup-virtual-content" id="backup-virtual-content"></pre>' +
    '</div>';
    
    // 绑定滚动事件
    const container = document.getElementById('backup-virtual-container');
    if (container) {
        container.addEventListener('scroll', onBackupScroll);
        previewLoadingState.containerHeight = container.clientHeight;
    }
}

function renderSimplePreview(fileName, content, backup) {
    const panel = document.getElementById('backup-preview-panel');
    if (!panel) return;
    
    const lines = content.split('\n');
    
    panel.innerHTML = '<div class="backup-preview-header">' +
        '<div class="backup-preview-title">' +
            '<h3>' + escapeHtml(fileName) + '</h3>' +
            '<span class="backup-preview-meta">' + lines.length + ' 行 · ' + formatSize(backup ? backup.size : 0) + '</span>' +
        '</div>' +
        '<div class="backup-preview-actions">' +
            '<div class="backup-preview-search">' +
                '<input type="text" id="backup-content-search" placeholder="搜索内容..." onkeyup="searchBackupContentDebounced(this.value)">' +
                '<span id="backup-search-count"></span>' +
            '</div>' +
            '<button class="btn btn-sm btn-secondary" onclick="downloadBackup(\'' + escapeHtml(fileName) + '\')">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> 下载' +
            '</button>' +
        '</div>' +
    '</div>' +
    '<div class="backup-preview-content">' +
        '<pre class="backup-preview-code">' + escapeHtml(content) + '</pre>' +
    '</div>';
    
    // 重置搜索状态
    simpleSearchState = { matches: [], currentIndex: -1, keyword: '' };
    previewLoadingState.isLoading = false;
}

// ==================== 虚拟滚动 ====================

function renderVirtualContent() {
    const container = document.getElementById('backup-virtual-container');
    const spacer = document.getElementById('backup-virtual-spacer');
    const content = document.getElementById('backup-virtual-content');
    const lineCountEl = document.getElementById('backup-line-count');
    
    if (!container || !spacer || !content) return;
    
    const totalLines = previewLoadingState.totalLines;
    const lineHeight = previewLoadingState.lineHeight;
    const totalHeight = totalLines * lineHeight;
    
    // 更新行数显示
    if (lineCountEl) {
        const backup = backupState.backups.find(function(b) { return b.name === previewLoadingState.currentFile; });
        lineCountEl.textContent = totalLines + ' 行 · ' + formatSize(backup ? backup.size : 0);
    }
    
    // 设置总高度
    spacer.style.height = totalHeight + 'px';
    
    // 计算可见范围
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const buffer = 10; // 缓冲行数
    
    const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
    const endLine = Math.min(totalLines, Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer);
    
    previewLoadingState.visibleStart = startLine;
    previewLoadingState.visibleEnd = endLine;
    
    // 渲染可见行
    let html = '';
    const searchKeyword = previewLoadingState.searchKeyword;
    const searchMatches = previewLoadingState.searchMatches;
    
    for (let i = startLine; i < endLine && i < previewLoadingState.allLines.length; i++) {
        const line = previewLoadingState.allLines[i];
        let lineContent = line.content;
        const isMatch = searchMatches.indexOf(i) !== -1;
        
        // 高亮搜索结果
        if (searchKeyword && isMatch) {
            const regex = new RegExp('(' + searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            lineContent = lineContent.replace(regex, '<mark>$1</mark>');
        }
        
        html += '<div class="backup-line' + (isMatch ? ' highlight' : '') + '" style="top:' + (i * lineHeight) + 'px">' +
            '<span class="line-number">' + line.lineNumber + '</span>' +
            '<span class="line-content">' + lineContent + '</span>' +
        '</div>';
    }
    
    content.innerHTML = html;
    content.style.height = totalHeight + 'px';
}

function onBackupScroll() {
    requestAnimationFrame(renderVirtualContent);
}

function scrollToLine(lineIndex) {
    const container = document.getElementById('backup-virtual-container');
    if (!container) return;
    
    const lineHeight = previewLoadingState.lineHeight;
    container.scrollTop = lineIndex * lineHeight - container.clientHeight / 2;
}

// ==================== 搜索功能 ====================

let searchBackupTimer = null;

function searchBackupContentDebounced(keyword) {
    if (searchBackupTimer) clearTimeout(searchBackupTimer);
    searchBackupTimer = setTimeout(function() {
        // 根据当前渲染模式选择搜索方式
        const virtualContainer = document.getElementById('backup-virtual-container');
        if (virtualContainer) {
            searchBackupContentVirtual(keyword);
        } else {
            searchBackupContent(keyword);
        }
    }, 300);
}

function searchBackupContentVirtual(keyword) {
    const searchCountEl = document.getElementById('backup-search-count');
    
    if (!keyword) {
        previewLoadingState.searchMatches = [];
        previewLoadingState.searchKeyword = '';
        if (searchCountEl) searchCountEl.textContent = '';
        renderVirtualContent();
        return;
    }
    
    // 使用 Worker 搜索
    if (previewLoadingState.worker && previewLoadingState.allLines.length > 0) {
        previewLoadingState.worker.postMessage({
            type: 'search',
            data: { lines: previewLoadingState.allLines, keyword: keyword }
        });
    } else {
        // 降级：主线程搜索
        const matches = [];
        const lowerKeyword = keyword.toLowerCase();
        for (let i = 0; i < previewLoadingState.allLines.length; i++) {
            if (previewLoadingState.allLines[i].content.toLowerCase().indexOf(lowerKeyword) !== -1) {
                matches.push(i);
            }
        }
        previewLoadingState.searchMatches = matches;
        previewLoadingState.searchKeyword = keyword;
        if (searchCountEl) searchCountEl.textContent = matches.length + ' 个匹配';
        renderVirtualContent();
        if (matches.length > 0) scrollToLine(matches[0]);
    }
}

function searchBackupContent(keyword) {
    // 简单搜索实现（小文件用）
    const contentEl = document.querySelector('.backup-preview-code');
    const searchCountEl = document.getElementById('backup-search-count');
    if (!contentEl) return;
    
    // 重置搜索状态
    simpleSearchState.matches = [];
    simpleSearchState.currentIndex = -1;
    simpleSearchState.keyword = keyword || '';
    
    // 获取纯文本内容
    const text = contentEl.textContent;
    
    if (!keyword) {
        contentEl.innerHTML = escapeHtml(text);
        if (searchCountEl) searchCountEl.textContent = '';
        return;
    }
    
    // 查找所有匹配位置
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerKeyword, pos)) !== -1) {
        simpleSearchState.matches.push(pos);
        pos += keyword.length;
    }
    
    // 高亮所有匹配项
    const regex = new RegExp('(' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    contentEl.innerHTML = escapeHtml(text).replace(regex, '<mark class="search-match">$1</mark>');
    
    // 更新匹配数量显示
    const matchCount = simpleSearchState.matches.length;
    if (searchCountEl) {
        searchCountEl.textContent = matchCount > 0 ? matchCount + ' 个匹配' : '无匹配';
    }
    
    // 自动定位到第一个匹配项
    if (matchCount > 0) {
        simpleSearchState.currentIndex = 0;
        scrollToSimpleMatch(0);
    }
}

/**
 * 滚动到指定的匹配项（小文件模式）
 */
function scrollToSimpleMatch(index) {
    const marks = document.querySelectorAll('.backup-preview-code mark.search-match');
    if (marks.length === 0 || index < 0 || index >= marks.length) return;
    
    // 移除之前的当前高亮
    marks.forEach(function(m) { m.classList.remove('current'); });
    
    // 标记当前匹配项
    const currentMark = marks[index];
    currentMark.classList.add('current');
    
    // 滚动到可见位置
    currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * 跳转到下一个匹配项
 */
function searchNext() {
    if (simpleSearchState.matches.length === 0) return;
    
    simpleSearchState.currentIndex = (simpleSearchState.currentIndex + 1) % simpleSearchState.matches.length;
    scrollToSimpleMatch(simpleSearchState.currentIndex);
}

/**
 * 跳转到上一个匹配项
 */
function searchPrev() {
    if (simpleSearchState.matches.length === 0) return;
    
    simpleSearchState.currentIndex = (simpleSearchState.currentIndex - 1 + simpleSearchState.matches.length) % simpleSearchState.matches.length;
    scrollToSimpleMatch(simpleSearchState.currentIndex);
}

// ==================== 暴露到全局 ====================

window.searchBackupContent = searchBackupContent;
window.searchBackupContentDebounced = searchBackupContentDebounced;
window.searchNext = searchNext;
window.searchPrev = searchPrev;
