const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startCapture: (filter) => ipcRenderer.invoke('start-capture', filter),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),
  clearPackets: () => ipcRenderer.invoke('clear-packets'),
  exportPackets: () => ipcRenderer.invoke('export-packets'),
  importPackets: () => ipcRenderer.invoke('import-packets'),
  checkAdmin: () => ipcRenderer.invoke('check-admin'),
  checkService: () => ipcRenderer.invoke('check-service'),
  startService: () => ipcRenderer.invoke('start-service'),
  getInterfaces: () => ipcRenderer.invoke('get-interfaces'),
  getStatistics: () => ipcRenderer.invoke('get-statistics'),
  
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  
  // 事件监听
  onPacketReceived: (callback) => ipcRenderer.on('packet-received', (_, packet) => callback(packet)),
  onCaptureError: (callback) => ipcRenderer.on('capture-error', (_, error) => callback(error)),
  onCaptureStopped: (callback) => ipcRenderer.on('capture-stopped', () => callback()),
  
  // 移除监听
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
