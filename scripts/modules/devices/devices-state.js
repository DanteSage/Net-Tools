/**
 * 设备管理状态
 * @module devices/state
 */

// ==================== 设备管理状态 ====================

const deviceState = {
    viewMode: 'grid',
    compactMode: false,
    searchKeyword: '',
    filterType: '',
    filterStatus: '',
    filterGroup: '',
    selectedDevices: new Set(),
    groups: ['默认分组'], // 设备分组列表，包含默认分组
    currentGroup: null, // 当前查看的分组（null表示根视图）
    defaultGroup: '默认分组' // 默认分组名称
};
