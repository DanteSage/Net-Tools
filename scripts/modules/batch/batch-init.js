/**
 * 批量执行模块入口
 * @module batch/init
 */

// ==================== 步骤导航 ====================

/**
 * 初始化步骤导航
 */
function initBatchSteps() {
    document.getElementById('btn-to-step-2')?.addEventListener('click', () => goToStep(2));
    document.getElementById('btn-to-step-1')?.addEventListener('click', () => goToStep(1));
    document.getElementById('btn-to-step-3')?.addEventListener('click', () => goToStep(3));
    document.getElementById('btn-to-step-2-back')?.addEventListener('click', () => goToStep(2));
    document.getElementById('btn-new-batch')?.addEventListener('click', resetBatch);
    
    document.querySelectorAll('.batch-step').forEach(step => {
        step.addEventListener('click', () => {
            const stepNum = parseInt(step.dataset.step);
            if (canGoToStep(stepNum)) {
                goToStep(stepNum);
            }
        });
    });
}

/**
 * 切换到指定步骤
 */
function goToStep(stepNum) {
    batchState.currentStep = stepNum;
    
    document.querySelectorAll('.batch-step').forEach(step => {
        const num = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        if (num < stepNum) step.classList.add('completed');
        if (num === stepNum) step.classList.add('active');
    });
    
    document.querySelectorAll('.batch-step-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`batch-step-${stepNum}`)?.classList.add('active');
}

/**
 * 检查是否可以切换到指定步骤
 */
function canGoToStep(stepNum) {
    if (stepNum === 1) return true;
    if (stepNum === 2) return batchState.selectedTargets.length > 0;
    if (stepNum === 3) return batchState.selectedTargets.length > 0;
    return false;
}

// ==================== 重置 ====================

/**
 * 重置批量执行
 */
async function resetBatch() {
    // 如果有结果或已选目标，需要确认
    if (batchState.results.length > 0 || batchState.selectedTargets.length > 0) {
        const confirmed = await showConfirm({
            title: '新建任务',
            message: '确定要新建任务吗？当前的执行结果和已选目标将被清空。',
            confirmText: '新建',
            type: 'warning'
        });
        if (!confirmed) return;
    }
    
    resetBatchState();
    
    document.getElementById('batch-commands').value = '';
    document.querySelectorAll('#batch-device-list input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.closest('.batch-device-item')?.classList.remove('selected');
    });
    document.getElementById('batch-ip-range').value = '';
    document.getElementById('batch-manual-targets').value = '';
    document.getElementById('parsed-targets').innerHTML = '';
    
    const varsContainer = document.getElementById('batch-variables');
    if (varsContainer) {
        varsContainer.innerHTML = `
            <div class="variable-item">
                <input type="text" placeholder="变量名" class="var-name">
                <input type="text" placeholder="值" class="var-value">
                <button class="btn btn-sm btn-icon btn-remove-var">×</button>
            </div>
        `;
        varsContainer.querySelector('.btn-remove-var')?.addEventListener('click', (e) => {
            e.target.closest('.variable-item')?.remove();
        });
    }
    
    updateSelectedTargetsList();
    updateStats();
    clearResultsDisplay();
    goToStep(1);
}

// ==================== 模块初始化 ====================

/**
 * 初始化批量执行模块
 */
function initBatchExecution() {
    initBatchSteps();
    initTargetModes();
    initDeviceSelection();
    initGroupSelection();
    initRangeInput();
    initManualInput();
    initCommandEditor();
    initExecutionControls();
    initVariables();
    initResultsFilter();
}
