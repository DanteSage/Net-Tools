/**
 * 工具函数模块
 * @module utils
 */

/**
 * Toast 图标 SVG
 */
const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
};

const TOAST_MAX_COUNT = 5;
const TOAST_DURATION = 3000;

/**
 * 显示Toast通知
 * @param {string} message - 消息内容
 * @param {string} type - 类型 ('info' | 'success' | 'warning' | 'error')
 * @param {number} duration - 显示时长(ms)，默认3000
 */
function showToast(message, type = 'info', duration = TOAST_DURATION) {
    const container = document.getElementById('toast-container');
    
    // 限制最大数量，移除最早的
    while (container.children.length >= TOAST_MAX_COUNT) {
        container.firstChild.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        </button>
        <div class="toast-progress"></div>
    `;
    
    container.appendChild(toast);
    
    // 关闭按钮
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));
    
    // 进度条动画
    const progress = toast.querySelector('.toast-progress');
    progress.style.animationDuration = duration + 'ms';
    
    // 悬停暂停
    let timeoutId;
    let remainingTime = duration;
    let startTime = Date.now();
    
    const startTimer = () => {
        startTime = Date.now();
        timeoutId = setTimeout(() => removeToast(toast), remainingTime);
        progress.style.animationPlayState = 'running';
    };
    
    const pauseTimer = () => {
        clearTimeout(timeoutId);
        remainingTime -= Date.now() - startTime;
        progress.style.animationPlayState = 'paused';
    };
    
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', startTimer);
    
    startTimer();
}

/**
 * 移除 Toast
 */
function removeToast(toast) {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
}

/**
 * 生成唯一ID
 * @returns {string} 唯一ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 格式化日期
 * @param {Date|string} date - 日期对象或字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * HTML转义
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间(ms)
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 显示确认模态框
 * @param {Object} options - 配置选项
 * @param {string} options.title - 标题
 * @param {string} options.message - 消息内容
 * @param {string} options.confirmText - 确认按钮文字
 * @param {string} options.type - 类型 ('danger' | 'warning' | 'info')
 * @returns {Promise<boolean>} 用户选择结果
 */
function showConfirm({ title = '确认', message = '确定要执行此操作吗？', detail = '', confirmText = '确定', type = 'danger' } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const detailEl = document.getElementById('confirm-detail');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        const icon = modal.querySelector('.confirm-icon');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        okBtn.textContent = confirmText;
        
        // 设置详情
        if (detail) {
            detailEl.textContent = detail;
            detailEl.style.display = 'block';
        } else {
            detailEl.textContent = '';
            detailEl.style.display = 'none';
        }
        
        // 设置图标颜色
        if (type === 'danger') {
            icon.style.color = 'var(--danger-color)';
            okBtn.className = 'btn btn-danger';
        } else if (type === 'warning') {
            icon.style.color = 'var(--warning-color)';
            okBtn.className = 'btn btn-warning';
        } else {
            icon.style.color = 'var(--primary-color)';
            okBtn.className = 'btn btn-primary';
        }
        
        modal.classList.add('active');
        
        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };
        
        const handleOk = () => {
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

/**
 * 格式化相对时间
 * @param {Date|string} date - 日期对象或字符串
 * @returns {string} 相对时间描述
 */
function formatRelativeTime(date) {
    if (!date) return '-';
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now - d) / 1000);
    
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
    return d.toLocaleDateString('zh-CN');
}

/**
 * 切换密码输入框的显示/隐藏状态
 * @param {HTMLElement} btn - 切换按钮元素
 */
function togglePasswordVisibility(btn) {
    const wrapper = btn.closest('.password-input-wrapper');
    const input = wrapper?.querySelector('input');
    const iconEye = btn.querySelector('.icon-eye');
    const iconEyeOff = btn.querySelector('.icon-eye-off');
    
    if (!input) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        if (iconEye) iconEye.style.display = 'none';
        if (iconEyeOff) iconEyeOff.style.display = '';
    } else {
        input.type = 'password';
        if (iconEye) iconEye.style.display = '';
        if (iconEyeOff) iconEyeOff.style.display = 'none';
    }
}
