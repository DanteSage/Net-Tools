/**
 * 页面导航模块
 * @module navigation
 */

/**
 * 初始化导航
 */
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageName = item.dataset.page;
            
            // 更新导航状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 切换页面
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            document.getElementById(`page-${pageName}`).classList.add('active');
            
            // 加载页面数据
            loadPageData(pageName);
        });
    });
}

/**
 * 加载页面数据
 */
async function loadPageData(pageName) {
    switch (pageName) {
        case 'devices':
            await loadDevices();
            break;
        case 'terminal':
            await updateTerminalDeviceSelect();
            break;
        case 'batch':
            await loadBatchDevices();
            break;
        case 'functions':
            await loadVariables();
            break;
        case 'templates':
            await loadTemplates();
            break;
        case 'backup':
            await loadBackups();
            break;
        case 'logs':
            // 运行日志页面不需要加载数据，日志在内存中
            break;
        case 'oplog':
            await loadOplogList();
            break;
        case 'aicopilot':
            if (typeof refreshCopilotPage === 'function') {
                await refreshCopilotPage();
            }
            break;
        case 'nettools':
            // 网络工具页面不需要加载数据
            break;
        case 'reconnaissance':
            if (typeof initReconnaissancePage === 'function') {
                await initReconnaissancePage();
            }
            break;
        case 'settings':
            if (typeof loadSettingsPage === 'function') {
                await loadSettingsPage();
            }
            break;
    }
}
