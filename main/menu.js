/**
 * 菜单配置模块
 */
const { Menu, dialog } = require('electron');

/**
 * 创建应用菜单模板
 * @param {Function} createWindow - 创建窗口函数
 * @param {Function} getMainWindow - 获取主窗口函数
 */
function createMenuTemplate(createWindow, getMainWindow) {
    return [
        {
            label: '文件',
            submenu: [
                { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
                { type: 'separator' },
                { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
            ]
        },
        {
            label: '编辑',
            submenu: [
                { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
                { type: 'separator' },
                { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
                { type: 'separator' },
                { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
                { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
                { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
                { type: 'separator' },
                { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
                { type: 'separator' },
                { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
            ]
        },
        {
            label: '窗口',
            submenu: [
                { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
                { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' }
            ]
        },
        {
            label: '帮助',
            submenu: [
                { 
                    label: '关于', 
                    click: () => {
                        const mainWindow = getMainWindow();
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 Net Tools',
                            message: 'Net Tools',
                            detail: '版本: 1.1.5\n网络设备管理工具\n\n支持 SSH、Telnet、串口连接\n批量执行命令、模板管理等功能'
                        });
                    }
                }
            ]
        }
    ];
}

/**
 * 设置应用菜单
 */
function setupMenu(createWindow, getMainWindow) {
    const menuTemplate = createMenuTemplate(createWindow, getMainWindow);
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(null); // 隐藏菜单栏
}

module.exports = { createMenuTemplate, setupMenu };
