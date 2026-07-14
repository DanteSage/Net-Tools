/**
 * 操作日志模块 - 搜索功能
 * @module oplogs/search
 */

// ==================== 搜索功能 ====================

// 内容搜索防抖定时器
let contentSearchTimer = null;

// 虚拟滚动搜索防抖定时器
let oplogSearchTimer = null;

/**
 * 内容搜索高亮（带防抖）
 */
function searchInOplogContent(event) {
    const keyword = event.target.value.trim();
    
    // 防抖：300ms 内不重复执行
    if (contentSearchTimer) {
        clearTimeout(contentSearchTimer);
    }
    
    contentSearchTimer = setTimeout(() => {
        _doContentSearch(keyword);
    }, 300);
}

/**
 * 执行内容搜索（保持行号排版）
 */
function _doContentSearch(keyword) {
    const contentEl = document.getElementById('oplog-content-display');
    const countEl = document.getElementById('oplog-search-count');
    const currentContent = getCurrentOplogContent();
    
    if (!contentEl || !currentContent) return;
    
    const lines = currentContent.split('\n');
    
    if (!keyword) {
        contentEl.innerHTML = renderOplogLinesSimple(lines);
        if (countEl) countEl.textContent = '';
        return;
    }
    
    // 查找匹配的行索引
    const regex = new RegExp(escapeRegExp(keyword), 'gi');
    const matchLineIndices = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
            matchLineIndices.push(i);
        }
        regex.lastIndex = 0;
    }
    
    const count = matchLineIndices.length;
    
    if (countEl) {
        countEl.textContent = count > 0 ? `${count} 个匹配` : '无匹配';
        countEl.style.color = count > 0 ? '' : 'var(--danger-color)';
    }
    
    // 大文件限制搜索高亮
    if (currentContent.length > LARGE_FILE_THRESHOLD) {
        return;
    }
    
    // 渲染带行号和搜索高亮的内容
    let html = '';
    
    for (let i = 0; i < lines.length; i++) {
        let lineContent = highlightLogLine(escapeHtml(lines[i]));
        const hasMatch = matchLineIndices.indexOf(i) !== -1;
        
        // 添加搜索高亮
        if (hasMatch) {
            const escapedKeyword = escapeHtml(keyword);
            const highlightRegex = new RegExp('(' + escapeRegExp(escapedKeyword) + ')', 'gi');
            lineContent = lineContent.replace(highlightRegex, '<mark class="search-highlight">$1</mark>');
        }
        
        html += `<div class="oplog-line${hasMatch ? ' search-match' : ''}" data-line="${i}">
            <span class="line-number">${i + 1}</span>
            <span class="line-content">${lineContent}</span>
        </div>`;
    }
    
    contentEl.innerHTML = html;
    
    // 跳转到第一个匹配行
    if (matchLineIndices.length > 0) {
        scrollToOplogLineSimple(matchLineIndices[0]);
    }
}

/**
 * 虚拟滚动模式搜索（带防抖）
 */
function searchInOplogContentVirtual(keyword) {
    if (oplogSearchTimer) clearTimeout(oplogSearchTimer);
    oplogSearchTimer = setTimeout(() => {
        _doOplogVirtualSearch(keyword);
    }, 300);
}

function _doOplogVirtualSearch(keyword) {
    const countEl = document.getElementById('oplog-search-count');
    
    if (!keyword) {
        oplogVirtualState.searchMatches = [];
        oplogVirtualState.searchKeyword = '';
        if (countEl) countEl.textContent = '';
        renderOplogVirtualContent();
        return;
    }
    
    // 使用 Worker 搜索
    if (oplogVirtualState.worker && oplogVirtualState.allLines.length > 0) {
        oplogVirtualState.worker.postMessage({
            type: 'searchLog',
            data: { lines: oplogVirtualState.allLines, keyword: keyword }
        });
    } else {
        // 降级：主线程搜索
        const matches = [];
        const lowerKeyword = keyword.toLowerCase();
        for (let i = 0; i < oplogVirtualState.allLines.length; i++) {
            const line = oplogVirtualState.allLines[i];
            if (line.raw && line.raw.toLowerCase().indexOf(lowerKeyword) !== -1) {
                matches.push(i);
            }
        }
        oplogVirtualState.searchMatches = matches;
        oplogVirtualState.searchKeyword = keyword;
        if (countEl) countEl.textContent = matches.length > 0 ? matches.length + ' 个匹配' : '无匹配';
        renderOplogVirtualContent();
        if (matches.length > 0) scrollToOplogLine(matches[0]);
    }
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 暴露到全局
window.searchInOplogContentVirtual = searchInOplogContentVirtual;
