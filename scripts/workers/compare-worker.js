/**
 * 文件对比 Web Worker
 * 用于在后台线程处理文件对比，避免阻塞主线程
 */

// 处理消息
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'parse':
            parseForCompare(data.content, data.side);
            break;
        case 'compare':
            compareLines(data.leftLines, data.rightLines);
            break;
    }
};

/**
 * 解析文件内容用于对比
 * @param {string} content - 文件内容
 * @param {string} side - left 或 right
 */
function parseForCompare(content, side) {
    try {
        const rawLines = content.split('\n');
        const totalLines = rawLines.length;
        const chunkSize = 500;
        const chunks = [];
        const allLines = [];
        
        for (let i = 0; i < totalLines; i += chunkSize) {
            const chunk = [];
            const end = Math.min(i + chunkSize, totalLines);
            
            for (let j = i; j < end; j++) {
                const lineData = {
                    lineNumber: j + 1,
                    content: escapeHtml(rawLines[j]),
                    raw: rawLines[j],
                    status: 'normal'
                };
                chunk.push(lineData);
                allLines.push(lineData);
            }
            
            chunks.push({
                startIndex: i,
                endIndex: end - 1,
                lines: chunk
            });
        }
        
        self.postMessage({
            type: 'parsed',
            data: {
                side: side,
                totalLines: totalLines,
                chunks: chunks,
                allLines: allLines,
                lineHeight: 20
            }
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { message: error.message, side: side }
        });
    }
}

/**
 * 对比两个文件的行
 * @param {Array} leftLines - 左侧文件所有行
 * @param {Array} rightLines - 右侧文件所有行
 */
function compareLines(leftLines, rightLines) {
    try {
        const leftTexts = new Set(leftLines.map(l => l.raw));
        const rightTexts = new Set(rightLines.map(l => l.raw));
        
        let added = 0, removed = 0, unchanged = 0;
        
        // 标记左侧删除的行
        const leftResult = leftLines.map(line => {
            if (!rightTexts.has(line.raw)) {
                removed++;
                return { ...line, status: 'removed' };
            }
            unchanged++;
            return { ...line, status: 'normal' };
        });
        
        // 标记右侧新增的行
        const rightResult = rightLines.map(line => {
            if (!leftTexts.has(line.raw)) {
                added++;
                return { ...line, status: 'added' };
            }
            return { ...line, status: 'normal' };
        });
        
        // 分块重组
        const chunkSize = 500;
        const leftChunks = chunkLines(leftResult, chunkSize);
        const rightChunks = chunkLines(rightResult, chunkSize);
        
        self.postMessage({
            type: 'compared',
            data: {
                leftChunks: leftChunks,
                rightChunks: rightChunks,
                leftLines: leftResult,
                rightLines: rightResult,
                stats: {
                    added: added,
                    removed: removed,
                    unchanged: unchanged
                }
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
 * 将行数组分块
 */
function chunkLines(lines, chunkSize) {
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, lines.length);
        chunks.push({
            startIndex: i,
            endIndex: end - 1,
            lines: lines.slice(i, end)
        });
    }
    return chunks;
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
