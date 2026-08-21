const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('packetLensHost', {
    onThemeChanged(callback) {
        const listener = (_event, theme) => callback(theme);
        ipcRenderer.on('theme:changed', listener);
        return () => ipcRenderer.removeListener('theme:changed', listener);
    }
});
