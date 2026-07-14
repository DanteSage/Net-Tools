/**
 * 批量执行状态管理
 * @module batch/state
 */

// ==================== 状态定义 ====================

const batchState = {
    currentStep: 1,
    targetMode: 'devices',
    selectedTargets: [],
    isRunning: false,
    isPaused: false,
    results: [],
    stats: { total: 0, success: 0, failed: 0, pending: 0 },
    previewData: null
};

/**
 * 重置批量执行状态
 */
function resetBatchState() {
    batchState.currentStep = 1;
    batchState.targetMode = 'devices';
    batchState.selectedTargets = [];
    batchState.isRunning = false;
    batchState.isPaused = false;
    batchState.results = [];
    batchState.stats = { total: 0, success: 0, failed: 0, pending: 0 };
    batchState.previewData = null;
}
