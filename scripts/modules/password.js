/**
 * 启动密码设置模块
 */

// 密码可见性切换
function togglePasswordVisibility(inputId, btn) {
    // 兼容处理：如果只传入一个参数且为对象（HTML元素），则作为传统的单参数（基于容器）密码显示隐藏逻辑
    if (arguments.length === 1 || (btn === undefined && typeof inputId === 'object')) {
        const targetBtn = inputId;
        const wrapper = targetBtn.closest('.password-input-wrapper');
        const input = wrapper?.querySelector('input');
        const iconEye = targetBtn.querySelector('.icon-eye');
        const iconEyeOff = targetBtn.querySelector('.icon-eye-off');
        
        if (!input) return;
        
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        
        if (iconEye) iconEye.style.display = isPassword ? 'none' : '';
        if (iconEyeOff) iconEyeOff.style.display = isPassword ? '' : 'none';
        return;
    }

    // 原有 password.js 中基于 ID 的切换逻辑
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    
    // 更新图标
    const svg = btn.querySelector('svg');
    if (svg) {
        svg.innerHTML = isPassword 
            ? '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>'
            : '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
    }
}

// 打开密码设置模态框
async function openPasswordSettings() {
    const modal = document.getElementById('password-modal');
    if (!modal) return;
    
    // 获取密码状态
    try {
        const status = await window.api.password.getStatus();
        updatePasswordUI(status.enabled);
    } catch (e) {
        console.error('获取密码状态失败:', e);
        updatePasswordUI(false);
    }
    
    // 清空输入框
    clearPasswordInputs();
    
    modal.classList.add('active');
}

// 关闭密码设置模态框
function closePasswordSettings() {
    const modal = document.getElementById('password-modal');
    if (modal) {
        modal.classList.remove('active');
        clearPasswordInputs();
    }
}

// 清空所有密码输入框
function clearPasswordInputs() {
    const inputs = [
        'new-password', 'confirm-password',
        'current-password', 'change-new-password', 'change-confirm-password'
    ];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.value = '';
            input.type = 'password';
        }
    });
}

// 更新密码设置界面
function updatePasswordUI(enabled) {
    const statusDiv = document.getElementById('password-status');
    const statusIcon = document.getElementById('password-status-icon');
    const statusText = document.getElementById('password-status-text');
    const statusDesc = document.getElementById('password-status-desc');
    const setForm = document.getElementById('password-set-form');
    const changeForm = document.getElementById('password-change-form');
    const passwordBtn = document.getElementById('btn-password-settings');
    
    if (enabled) {
        statusDiv.classList.add('enabled');
        statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
        </svg>`;
        statusText.textContent = '密码保护已启用';
        statusDesc.textContent = '每次启动应用都需要输入密码';
        setForm.style.display = 'none';
        changeForm.style.display = 'block';
        if (passwordBtn) passwordBtn.classList.add('enabled');
    } else {
        statusDiv.classList.remove('enabled');
        statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
        </svg>`;
        statusText.textContent = '密码保护未启用';
        statusDesc.textContent = '启用后，每次启动应用都需要输入密码';
        setForm.style.display = 'block';
        changeForm.style.display = 'none';
        if (passwordBtn) passwordBtn.classList.remove('enabled');
    }
}

// 设置新密码
async function setPassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!newPassword) {
        showToast('请输入密码', 'error');
        return;
    }
    
    if (newPassword.length < 4) {
        showToast('密码长度至少4位', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('两次输入的密码不一致', 'error');
        return;
    }
    
    try {
        const result = await window.api.password.set(newPassword);
        if (result.success) {
            showToast('密码保护已启用', 'success');
            updatePasswordUI(true);
            clearPasswordInputs();
        } else {
            showToast(result.error || '设置失败', 'error');
        }
    } catch (e) {
        showToast('设置失败: ' + e.message, 'error');
    }
}

// 修改密码
async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('change-new-password').value;
    const confirmPassword = document.getElementById('change-confirm-password').value;
    
    if (!currentPassword) {
        showToast('请输入当前密码', 'error');
        return;
    }
    
    if (!newPassword) {
        showToast('请输入新密码', 'error');
        return;
    }
    
    if (newPassword.length < 4) {
        showToast('密码长度至少4位', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('两次输入的密码不一致', 'error');
        return;
    }
    
    try {
        const result = await window.api.password.change(currentPassword, newPassword);
        if (result.success) {
            showToast('密码修改成功', 'success');
            clearPasswordInputs();
        } else {
            showToast(result.error || '修改失败', 'error');
        }
    } catch (e) {
        showToast('修改失败: ' + e.message, 'error');
    }
}

// 禁用密码保护
async function disablePassword() {
    const currentPassword = document.getElementById('current-password').value;
    
    if (!currentPassword) {
        showToast('请输入当前密码', 'error');
        return;
    }
    
    try {
        const result = await window.api.password.disable(currentPassword);
        if (result.success) {
            showToast('密码保护已禁用', 'success');
            updatePasswordUI(false);
            clearPasswordInputs();
        } else {
            showToast(result.error || '禁用失败', 'error');
        }
    } catch (e) {
        showToast('禁用失败: ' + e.message, 'error');
    }
}

// 初始化密码设置模块
async function initPasswordSettings() {
    // 绑定关闭按钮
    const closeBtn = document.getElementById('password-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closePasswordSettings);
    }
    
    // 点击模态框外部关闭
    const modal = document.getElementById('password-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closePasswordSettings();
            }
        });
    }
    
    // 检查并更新密码按钮状态
    try {
        const status = await window.api.password.getStatus();
        const passwordBtn = document.getElementById('btn-password-settings');
        if (passwordBtn && status.enabled) {
            passwordBtn.classList.add('enabled');
        }
    } catch (e) {
        console.error('初始化密码状态失败:', e);
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPasswordSettings);
