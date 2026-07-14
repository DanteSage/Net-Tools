/**
 * 配置备份模块 - 状态管理
 * @module backup/state
 */

// ==================== 状态管理 ====================

const backupState = {
    backups: [],
    searchKeyword: '',
    sortBy: 'time-desc',
    selectedBackups: [],
    selectedPreview: null,
    compareFiles: []
};

// 对比虚拟滚动状态
const compareVirtualState = {
    worker: null,
    left: {
        allLines: [],
        totalLines: 0,
        visibleStart: 0,
        visibleEnd: 0,
        scrollTop: 0
    },
    right: {
        allLines: [],
        totalLines: 0,
        visibleStart: 0,
        visibleEnd: 0,
        scrollTop: 0
    },
    lineHeight: 20,
    containerHeight: 300,
    stats: { added: 0, removed: 0, unchanged: 0 },
    isComparing: false
};

// 预览加载状态
const previewLoadingState = {
    isLoading: false,
    currentFile: null,
    worker: null,
    allLines: [],
    totalLines: 0,
    lineHeight: 20,
    visibleStart: 0,
    visibleEnd: 0,
    searchMatches: [],
    searchKeyword: '',
    containerHeight: 0,
    scrollTop: 0
};

// 大文件阈值（超过此大小使用虚拟滚动）
const BACKUP_LARGE_FILE_THRESHOLD = 50000;

// 小文件搜索状态
let simpleSearchState = {
    matches: [],
    currentIndex: -1,
    keyword: ''
};
