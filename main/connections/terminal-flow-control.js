const { ipcMain } = require('electron');

function getTerminalSource(context, connectionId) {
    return context.activeConnections.get(connectionId + '_shell')
        || context.activeTelnetConnections.get(connectionId)
        || context.activeSerialPorts.get(connectionId)
        || null;
}

function setTerminalSourcePaused(source, paused) {
    if (!source || source.destroyed) return false;
    if (source._terminalOutputPaused === paused) return true;

    const method = paused ? 'pause' : 'resume';
    if (typeof source[method] !== 'function') return false;

    try {
        source[method]();
        source._terminalOutputPaused = paused;
        return true;
    } catch (error) {
        console.warn('Unable to ' + method + ' terminal source:', error.message);
        return false;
    }
}

function registerTerminalFlowControl(context) {
    ipcMain.on('terminal:flow-control', (event, payload = {}) => {
        const connectionId = typeof payload.connectionId === 'string'
            ? payload.connectionId
            : '';
        if (!connectionId) return;

        const source = getTerminalSource(context, connectionId);
        setTerminalSourcePaused(source, Boolean(payload.paused));
    });
}

module.exports = {
    getTerminalSource,
    setTerminalSourcePaused,
    registerTerminalFlowControl
};
