/**
 * 文件解析 Web Worker
 * 用于在后台线程处理大型配置文件和日志，避免阻塞主线程
 */

// 处理消息
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'parse':
            parseContent(data.content, data.fileName);
            break;
        case 'parseLog':
            parseLogContent(data.content, data.id, data.enableHighlight);
            break;
        case 'search':
            searchContent(data.lines, data.keyword);
            break;
        case 'searchLog':
            searchLogContent(data.lines, data.keyword);
            break;
    }
};

/**
 * 解析文件内容
 * @param {string} content - 文件内容
 * @param {string} fileName - 文件名
 */
function parseContent(content, fileName) {
    try {
        const lines = content.split('\n');
        const totalLines = lines.length;
        const chunkSize = 500; // 每块500行
        const chunks = [];
        
        // 分块处理
        for (let i = 0; i < totalLines; i += chunkSize) {
            const chunk = [];
            const end = Math.min(i + chunkSize, totalLines);
            
            for (let j = i; j < end; j++) {
                chunk.push({
                    lineNumber: j + 1,
                    content: escapeHtml(lines[j])
                });
            }
            
            chunks.push({
                startIndex: i,
                endIndex: end - 1,
                lines: chunk
            });
        }
        
        // 发送解析完成消息
        self.postMessage({
            type: 'parsed',
            data: {
                fileName: fileName,
                totalLines: totalLines,
                chunks: chunks,
                lineHeight: 20 // 预估行高
            }
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { message: error.message }
        });
    }
}

/**
 * 搜索内容
 * @param {Array} lines - 所有行数据
 * @param {string} keyword - 搜索关键词
 */
function searchContent(lines, keyword) {
    if (!keyword) {
        self.postMessage({
            type: 'searchResult',
            data: { matches: [], keyword: '' }
        });
        return;
    }
    
    const lowerKeyword = keyword.toLowerCase();
    const matches = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].content.toLowerCase().includes(lowerKeyword)) {
            matches.push(i);
        }
    }
    
    self.postMessage({
        type: 'searchResult',
        data: { matches: matches, keyword: keyword }
    });
}

/**
 * 解析日志内容（操作日志）
 * @param {string} content - 日志内容
 * @param {string} id - 日志ID
 * @param {boolean} enableHighlight - 是否启用语法高亮
 */
function parseLogContent(content, id, enableHighlight) {
    try {
        const lines = content.split('\n');
        const totalLines = lines.length;
        const chunkSize = 500;
        const chunks = [];
        
        for (let i = 0; i < totalLines; i += chunkSize) {
            const chunk = [];
            const end = Math.min(i + chunkSize, totalLines);
            
            for (let j = i; j < end; j++) {
                let lineContent = escapeHtml(lines[j]);
                
                // 语法高亮（如果启用）
                if (enableHighlight) {
                    lineContent = highlightLine(lineContent);
                }
                
                chunk.push({
                    lineNumber: j + 1,
                    content: lineContent,
                    raw: lines[j]
                });
            }
            
            chunks.push({
                startIndex: i,
                endIndex: end - 1,
                lines: chunk
            });
        }
        
        self.postMessage({
            type: 'logParsed',
            data: {
                id: id,
                totalLines: totalLines,
                chunks: chunks,
                lineHeight: 20
            }
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { message: error.message }
        });
    }
}

/**
 * 日志行语法高亮
 */
function highlightLine(line) {
    return line
        // 命令提示符高亮
        .replace(/^(.+[>#\$]\s*)$/g, '<span class="log-prompt">$1</span>')
        // 时间戳高亮
        .replace(/(\d{4}[-\/]\d{2}[-\/]\d{2}\s+\d{2}:\d{2}:\d{2})/g, '<span class="log-timestamp">$1</span>')
        // IP地址高亮
        .replace(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g, '<span class="log-ip">$1</span>')
        // 成功关键词
        .replace(/\b(success|successful|ok|up|enabled|active)\b/gi, '<span class="log-success">$1</span>')
        // 失败关键词
        .replace(/\b(fail|failed|error|down|disabled|inactive)\b/gi, '<span class="log-error">$1</span>')
        // 警告关键词
        .replace(/\b(warning|warn|caution)\b/gi, '<span class="log-warning">$1</span>')
        // 分隔线
        .replace(/^(={3,}|─{3,}|-{3,})$/g, '<span class="log-separator">$1</span>')
        // 标题行
        .replace(/^(===\s*.+\s*===)$/g, '<span class="log-title">$1</span>');
}

/**
 * 搜索日志内容
 */
function searchLogContent(lines, keyword) {
    if (!keyword) {
        self.postMessage({
            type: 'logSearchResult',
            data: { matches: [], keyword: '' }
        });
        return;
    }
    
    const lowerKeyword = keyword.toLowerCase();
    const matches = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].raw && lines[i].raw.toLowerCase().includes(lowerKeyword)) {
            matches.push(i);
        }
    }
    
    self.postMessage({
        type: 'logSearchResult',
        data: { matches: matches, keyword: keyword }
    });
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
