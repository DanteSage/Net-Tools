/**
 * 自定义标题栏 - 窗口控制（最小化、最大化/还原、关闭）
 * @module titlebar
 */

// ==================== 私有函数 ====================

/**
 * 更新最大化/还原按钮图标状态
 * @private
 */
function _setMaximizedState(isMax) {
    const bar = document.getElementById('app-titlebar');
    const btn = document.getElementById('win-max');
    if (!bar || !btn) return;
    bar.classList.toggle('is-maximized', !!isMax);
    btn.title = isMax ? '还原' : '最大化';
    btn.setAttribute('aria-label', isMax ? '还原' : '最大化');
}

// ==================== 初始化函数 ====================

/**
 * 初始化标题栏窗口控制
 */
function initTitlebar() {
    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');

    if (!minBtn || !maxBtn || !closeBtn || !window.api || !window.api.window) {
        return;
    }

    minBtn.addEventListener('click', () => {
        window.api.window.minimize();
    });

    maxBtn.addEventListener('click', async () => {
        const isMax = await window.api.window.toggleMaximize();
        _setMaximizedState(isMax);
    });

    closeBtn.addEventListener('click', () => {
        // 走主进程已有的关闭确认流程（app:close-request）
        window.api.window.close();
    });

    // 监听主进程的最大化状态变化
    window.api.window.onMaximizedChange((isMax) => {
        _setMaximizedState(isMax);
    });

    // 双击拖动区切换最大化
    const dragArea = document.querySelector('.titlebar-drag');
    if (dragArea) {
        dragArea.addEventListener('dblclick', async () => {
            const isMax = await window.api.window.toggleMaximize();
            _setMaximizedState(isMax);
        });
    }

    // 初始同步状态
    window.api.window.isMaximized().then(_setMaximizedState).catch(() => {});
}

window.initTitlebar = initTitlebar;
