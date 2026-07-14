/**
 * 配置备份模块 - 对比功能
 * @module backup/compare
 */

// ==================== 对比功能（虚拟滚动） ====================

function initCompareModal() {
    const modal = document.getElementById('backup-compare-modal');
    const closeBtn = document.getElementById('backup-compare-modal-close');
    const closeBtn2 = document.getElementById('btn-close-compare');
    const exportDiffBtn = document.getElementById('btn-export-diff');
    const leftSelect = document.getElementById('compare-left-select');
    const rightSelect = document.getElementById('compare-right-select');
    const leftContent = document.getElementById('compare-left-content');
    const rightContent = document.getElementById('compare-right-content');
    
    if (!modal) return;
    
    // 初始化 Worker
    initCompareWorker();
    
    if (closeBtn) closeBtn.addEventListener('click', closeCompareModal);
    if (closeBtn2) closeBtn2.addEventListener('click', closeCompareModal);
    if (exportDiffBtn) exportDiffBtn.addEventListener('click', exportDiff);
    
    if (leftSelect) {
        leftSelect.addEventListener('change', function() {
            loadCompareContentVirtual('left', this.value);
        });
    }
    
    if (rightSelect) {
        rightSelect.addEventListener('change', function() {
            loadCompareContentVirtual('right', this.value);
        });
    }
    
    // 虚拟滚动事件
    if (leftContent) {
        leftContent.addEventListener('scroll', function() {
            handleCompareScroll('left', this.scrollTop);
        });
    }
    if (rightContent) {
        rightContent.addEventListener('scroll', function() {
            handleCompareScroll('right', this.scrollTop);
        });
    }
}

function initCompareWorker() {
    if (compareVirtualState.worker) {
        compareVirtualState.worker.terminate();
    }
    
    compareVirtualState.worker = new Worker('scripts/workers/compare-worker.js');
    compareVirtualState.worker.onmessage = handleCompareWorkerMessage;
    compareVirtualState.worker.onerror = function(e) {
        console.error('Compare Worker error:', e);
    };
}

function handleCompareWorkerMessage(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'parsed':
            handleCompareParsed(data);
            break;
        case 'compared':
            handleCompareResult(data);
            break;
        case 'error':
            console.error('Compare Worker error:', data.message);
            break;
    }
}

function handleCompareParsed(data) {
    const { side, totalLines, allLines } = data;
    const state = compareVirtualState[side];
    
    state.allLines = allLines;
    state.totalLines = totalLines;
    state.visibleStart = 0;
    state.visibleEnd = 0;
    state.scrollTop = 0;
    
    const infoEl = document.getElementById('compare-' + side + '-info');
    if (infoEl) infoEl.textContent = totalLines + ' 行';
    
    // 初始渲染
    renderCompareVirtual(side);
    
    // 尝试进行对比
    tryCompare();
}

function tryCompare() {
    const leftLines = compareVirtualState.left.allLines;
    const rightLines = compareVirtualState.right.allLines;
    
    if (leftLines.length > 0 && rightLines.length > 0 && !compareVirtualState.isComparing) {
        compareVirtualState.isComparing = true;
        compareVirtualState.worker.postMessage({
            type: 'compare',
            data: { leftLines, rightLines }
        });
    }
}

function handleCompareResult(data) {
    compareVirtualState.isComparing = false;
    compareVirtualState.left.allLines = data.leftLines;
    compareVirtualState.right.allLines = data.rightLines;
    compareVirtualState.stats = data.stats;
    
    // 更新统计
    const statsEl = document.getElementById('compare-stats');
    document.getElementById('compare-added-count').textContent = data.stats.added;
    document.getElementById('compare-removed-count').textContent = data.stats.removed;
    document.getElementById('compare-modified-count').textContent = '0';
    statsEl.style.display = 'flex';
    
    // 重新渲染
    renderCompareVirtual('left');
    renderCompareVirtual('right');
}

async function openCompareModal() {
    const modal = document.getElementById('backup-compare-modal');
    if (!modal) return;
    
    // 选择超过2个文件时提示
    if (backupState.selectedBackups.length > 2) {
        const confirmed = await showConfirm({
            title: '提示',
            message: '对比功能仅支持选择2个文件',
            detail: '将使用前2个选中的文件进行对比',
            confirmText: '知道了',
            cancelText: '取消',
            type: 'info'
        });
        if (!confirmed) return;
    }
    
    // 重置状态
    resetCompareState();
    
    const leftSelect = document.getElementById('compare-left-select');
    const rightSelect = document.getElementById('compare-right-select');
    
    let options = '<option value="">选择文件...</option>';
    for (let i = 0; i < backupState.backups.length; i++) {
        const b = backupState.backups[i];
        options += '<option value="' + escapeHtml(b.name) + '">' + escapeHtml(b.name) + '</option>';
    }
    
    if (leftSelect) leftSelect.innerHTML = options;
    if (rightSelect) rightSelect.innerHTML = options;
    
    if (backupState.compareFiles.length >= 1) {
        leftSelect.value = backupState.compareFiles[0];
        loadCompareContentVirtual('left', backupState.compareFiles[0]);
    }
    if (backupState.compareFiles.length >= 2) {
        rightSelect.value = backupState.compareFiles[1];
        loadCompareContentVirtual('right', backupState.compareFiles[1]);
    }
    
    modal.classList.add('active');
    
    // 延迟获取容器高度
    setTimeout(function() {
        const container = document.getElementById('compare-left-content');
        if (container) {
            compareVirtualState.containerHeight = container.clientHeight;
        }
    }, 100);
}

function closeCompareModal() {
    const modal = document.getElementById('backup-compare-modal');
    if (modal) modal.classList.remove('active');
    resetCompareState();
}

function resetCompareState() {
    compareVirtualState.left.allLines = [];
    compareVirtualState.left.totalLines = 0;
    compareVirtualState.right.allLines = [];
    compareVirtualState.right.totalLines = 0;
    compareVirtualState.stats = { added: 0, removed: 0, unchanged: 0 };
    compareVirtualState.isComparing = false;
    
    const leftContent = document.getElementById('compare-left-content');
    const rightContent = document.getElementById('compare-right-content');
    const statsEl = document.getElementById('compare-stats');
    
    if (leftContent) leftContent.innerHTML = '<div class="compare-placeholder">选择文件查看内容</div>';
    if (rightContent) rightContent.innerHTML = '<div class="compare-placeholder">选择文件查看内容</div>';
    if (statsEl) statsEl.style.display = 'none';
}

async function loadCompareContentVirtual(side, fileName) {
    const contentEl = document.getElementById('compare-' + side + '-content');
    const infoEl = document.getElementById('compare-' + side + '-info');
    
    if (!fileName) {
        contentEl.innerHTML = '<div class="compare-placeholder">选择文件查看内容</div>';
        if (infoEl) infoEl.textContent = '';
        compareVirtualState[side].allLines = [];
        compareVirtualState[side].totalLines = 0;
        return;
    }
    
    contentEl.innerHTML = '<div class="compare-loading">加载中...</div>';
    
    try {
        const content = await window.api.backup.read(fileName);
        if (content) {
            // 发送到 Worker 解析
            compareVirtualState.worker.postMessage({
                type: 'parse',
                data: { content, side }
            });
        }
    } catch (error) {
        contentEl.innerHTML = '<div class="compare-placeholder">加载失败</div>';
    }
}

function handleCompareScroll(side, scrollTop) {
    const state = compareVirtualState[side];
    state.scrollTop = scrollTop;
    renderCompareVirtual(side);
}

function renderCompareVirtual(side) {
    const contentEl = document.getElementById('compare-' + side + '-content');
    const state = compareVirtualState[side];
    
    if (!contentEl || state.allLines.length === 0) return;
    
    const { lineHeight, containerHeight } = compareVirtualState;
    const scrollTop = state.scrollTop;
    const totalHeight = state.totalLines * lineHeight;
    
    // 计算可见范围
    const buffer = 10;
    const startIndex = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
    const visibleCount = Math.ceil(containerHeight / lineHeight) + buffer * 2;
    const endIndex = Math.min(state.totalLines, startIndex + visibleCount);
    
    state.visibleStart = startIndex;
    state.visibleEnd = endIndex;
    
    // 渲染可见行
    let html = '<div class="compare-virtual-spacer" style="height:' + (startIndex * lineHeight) + 'px"></div>';
    
    for (let i = startIndex; i < endIndex; i++) {
        const line = state.allLines[i];
        if (line) {
            const statusClass = line.status !== 'normal' ? ' ' + line.status : '';
            html += '<div class="compare-line' + statusClass + '" style="height:' + lineHeight + 'px">' +
                    '<span class="line-num">' + line.lineNumber + '</span>' +
                    '<span class="line-content">' + line.content + '</span></div>';
        }
    }
    
    html += '<div class="compare-virtual-spacer" style="height:' + ((state.totalLines - endIndex) * lineHeight) + 'px"></div>';
    
    contentEl.innerHTML = html;
    contentEl.scrollTop = scrollTop;
}

async function exportDiff() {
    const leftLines = compareVirtualState.left.allLines;
    const rightLines = compareVirtualState.right.allLines;
    
    if (leftLines.length === 0 || rightLines.length === 0) {
        showToast('请先加载对比文件', 'warning');
        return;
    }
    
    let diffContent = '=== 差异对比报告 ===\n';
    diffContent += '新增: ' + compareVirtualState.stats.added + ' 行\n';
    diffContent += '删除: ' + compareVirtualState.stats.removed + ' 行\n\n';
    
    diffContent += '--- 左侧删除的行 ---\n';
    leftLines.filter(l => l.status === 'removed').forEach(l => {
        diffContent += '- [' + l.lineNumber + '] ' + l.raw + '\n';
    });
    
    diffContent += '\n+++ 右侧新增的行 +++\n';
    rightLines.filter(l => l.status === 'added').forEach(l => {
        diffContent += '+ [' + l.lineNumber + '] ' + l.raw + '\n';
    });
    
    try {
        await navigator.clipboard.writeText(diffContent);
        showToast('差异内容已复制到剪贴板', 'success');
    } catch (e) {
        showToast('复制失败', 'error');
    }
}
