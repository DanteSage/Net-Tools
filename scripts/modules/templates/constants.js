/**
 * 命令模板模块 - 常量定义
 * @module templates/constants
 */

// ==================== CSV 模板定义 ====================

// CSV 表头定义
const TEMPLATE_CSV_HEADERS = ['name', 'category', 'deviceType', 'commands', 'description'];
const TEMPLATE_CSV_HEADERS_CN = ['模板名称', '分类', '适用设备', '命令内容', '描述'];

// 分类映射
const TEMPLATE_CATEGORIES = {
    'info': '信息收集',
    'config': '配置管理',
    'backup': '备份恢复',
    'troubleshoot': '故障排查',
    'security': '安全审计',
    'other': '其他'
};

// 设备类型映射
const TEMPLATE_DEVICE_TYPES = {
    'all': '通用',
    'h3c': 'H3C',
    'h3c-ap': 'H3C-AP',
    'huawei': 'Huawei',
    'cisco': 'Cisco',
    'ruijie': 'Ruijie',
    'juniper': 'Juniper',
    'linux': 'Linux',
    'other': '其他'
};

/**
 * 获取分类名称
 */
function getCategoryName(category) {
    return TEMPLATE_CATEGORIES[category] || category || '其他';
}

/**
 * 获取设备类型名称
 */
function getDeviceTypeName(deviceType) {
    return TEMPLATE_DEVICE_TYPES[deviceType] || deviceType || '通用';
}

/**
 * 获取分类图标
 */
function getCategoryIcon(category) {
    const icons = {
        info: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
        config: '<path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>',
        backup: '<path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>',
        troubleshoot: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
        security: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
        other: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>'
    };
    return icons[category] || icons.other;
}

/**
 * 格式化时间
 */
function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
