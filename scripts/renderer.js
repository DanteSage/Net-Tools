/**
 * Net Tools - 主入口文件
 * 所有模块已拆分到 scripts/modules/ 目录
 */

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    const initSteps = [
        { name: 'Titlebar', fn: initTitlebar },
        { name: 'Theme', fn: initTheme },
        { name: 'Navigation', fn: initNavigation },
        { name: 'DeviceModal', fn: initDeviceModal },
        { name: 'SerialPorts', fn: initSerialPorts },
        { name: 'GroupModal', fn: initGroupModal },
        { name: 'DeviceToolbar', fn: initDeviceToolbar },
        { name: 'Terminal', fn: initTerminal },
        { name: 'DeviceDropdown', fn: initDeviceDropdown },
        { name: 'HistoryDropdown', fn: initHistoryDropdown },
        { name: 'BatchExecution', fn: initBatchExecution },
        { name: 'Templates', fn: initTemplatesModule },
        { name: 'Variables', fn: initVariablesModule },
        { name: 'BackupModule', fn: initBackupModule },
        { name: 'LogsPage', fn: initLogsPage },
        { name: 'OplogPage', fn: initOplogPage },
        { name: 'Settings', fn: initSettings },
        { name: 'Copilot', fn: initCopilot },
        { name: 'SupportModal', fn: initSupportModal }
    ];

    for (const step of initSteps) {
        try {
            step.fn();
        } catch (error) {
            console.error(`${step.name} 初始化失败:`, error);
        }
    }

    try {
        await loadDevices();
    } catch (error) {
        console.error('设备数据加载失败:', error);
    }

    // 监听应用关闭请求
    window.api.app.onCloseRequest(async () => {
        const confirmed = await showConfirm({
            title: '退出确认',
            message: '确定要退出 Net Tools 吗？',
            detail: '所有未保存的连接将会断开。',
            type: 'warning'
        });
        window.api.app.confirmClose(confirmed);
    });
});

// ==================== 全局函数暴露 ====================
// 供 HTML 内联事件调用

window.editDevice = editDevice;
window.deleteDevice = deleteDevice;
window.connectToDevice = connectToDevice;
window.disconnectDevice = disconnectDevice;
window.switchTab = switchTab;
window.closeTab = closeTab;
window.useTemplate = useTemplate;
window.editTemplate = editTemplate;
window.deleteTemplate = deleteTemplate;
window.viewOplog = viewOplog;
window.exportOplog = exportOplog;
window.deleteOplog = deleteOplog;
window.copyOplogContent = copyOplogContent;
window.toggleOplogSelect = toggleOplogSelect;
window.searchInOplogContent = searchInOplogContent;
window.openSpeedTest = openSpeedTest;
window.openPortScanner = openPortScanner;
window.openPingTest = openPingTest;
window.openSubnetting = openSubnetting;
window.openIpv6Subnetting = openIpv6Subnetting;
window.openTraceroute = openTraceroute;
window.openPacketCapture = openPacketCapture;
window.openNetcat = openNetcat;
window.openDnsLookup = openDnsLookup;
window.openTsharkAnalyzer = openTsharkAnalyzer;
window.openBroadcastDetector = openBroadcastDetector;
window.openFtpClient = openFtpClient;
window.openFtpServer = openFtpServer;

// ==================== 支持作者模态框 ====================

function initSupportModal() {
    // 支持按钮
    document.getElementById('btn-support')?.addEventListener('click', () => {
        document.getElementById('support-modal').classList.add('active');
    });

    // 版本号点击查看更新日志
    document.getElementById('version-info')?.addEventListener('click', () => {
        document.getElementById('changelog-modal').classList.add('active');
    });

    // 点击遮罩关闭模态框
    ['support-modal', 'changelog-modal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            if (e.target.id === id) {
                e.target.classList.remove('active');
            }
        });
    });

    // 外部链接用默认浏览器打开
    document.querySelectorAll('.feedback-link[target="_blank"]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            window.api.shell.openExternal(link.href);
        });
    });
}
