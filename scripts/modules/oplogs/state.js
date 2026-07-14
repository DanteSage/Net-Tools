/**
 * 操作日志模块 - 状态管理
 * @module oplogs/state
 */

// ==================== 状态管理 ====================

const oplogState = {
    selectedIds: new Set(),
    filterKeyword: '',
    dateFilter: 'all',
    sortBy: 'time-desc',
    currentOplogId: null
};

// 虚拟滚动状态
const oplogVirtualState = {
    worker: null,
    allLines: [],
    totalLines: 0,
    lineHeight: 20,
    visibleStart: 0,
    visibleEnd: 0,
    searchMatches: [],
    searchKeyword: '',
    isLoading: false,
    enableHighlight: true
};

// 大文件阈值（超过此大小使用虚拟滚动）
const OPLOG_LARGE_FILE_THRESHOLD = 50000;

// 大文件阈值（超过此大小禁用语法高亮）
const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB

// 缓存当前查看的日志内容
let currentOplogContent = null;

/**
 * 获取当前日志内容
 */
function getCurrentOplogContent() {
    return currentOplogContent;
}

/**
 * 设置当前日志内容
 */
function setCurrentOplogContent(content) {
    currentOplogContent = content;
}
