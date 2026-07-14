/**
 * 密码验证窗口的 preload 脚本
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('passwordApi', {
    verify: (password) => ipcRenderer.invoke('password:verify', password),
    unlockSuccess: () => ipcRenderer.send('password:unlockSuccess')
});
