const fs = require('fs');
const os = require('os');
const path = require('path');
const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');
const { getToolScope, hasCapability, isChannelAllowed } = require('./tool-ipc-scopes');

const TOOL_ARG_PREFIX = '--net-tools-tool-id=';
const toolArg = process.argv.find(arg => arg.startsWith(TOOL_ARG_PREFIX));
const toolId = toolArg ? toolArg.slice(TOOL_ARG_PREFIX.length) : '';

if (!getToolScope(toolId)) {
    throw new Error(`Unknown or missing tool window id: ${toolId || '(empty)'}`);
}

const listenerWrappers = new WeakMap();

function assertChannel(action, channel) {
    if (!isChannelAllowed(toolId, action, channel)) {
        throw new Error(`IPC channel is not allowed for ${toolId}: ${channel}`);
    }
}

function rememberListener(callback, channel, wrapped) {
    let byChannel = listenerWrappers.get(callback);
    if (!byChannel) {
        byChannel = new Map();
        listenerWrappers.set(callback, byChannel);
    }
    byChannel.set(channel, wrapped);
}

const ipcFacade = Object.freeze({
    invoke(channel, ...args) {
        assertChannel('invoke', channel);
        return ipcRenderer.invoke(channel, ...args);
    },
    send(channel, ...args) {
        assertChannel('send', channel);
        ipcRenderer.send(channel, ...args);
    },
    on(channel, callback) {
        assertChannel('receive', channel);
        if (typeof callback !== 'function') throw new TypeError('IPC listener must be a function');
        const wrapped = (event, ...args) => callback({ senderId: event.senderId }, ...args);
        rememberListener(callback, channel, wrapped);
        ipcRenderer.on(channel, wrapped);
    },
    once(channel, callback) {
        assertChannel('receive', channel);
        if (typeof callback !== 'function') throw new TypeError('IPC listener must be a function');
        const wrapped = (event, ...args) => callback({ senderId: event.senderId }, ...args);
        rememberListener(callback, channel, wrapped);
        ipcRenderer.once(channel, wrapped);
    },
    removeListener(channel, callback) {
        assertChannel('receive', channel);
        const wrapped = listenerWrappers.get(callback)?.get(channel);
        if (wrapped) {
            ipcRenderer.removeListener(channel, wrapped);
            listenerWrappers.get(callback).delete(channel);
        }
    },
    removeAllListeners(channel) {
        assertChannel('receive', channel);
        ipcRenderer.removeAllListeners(channel);
    }
});

const bridge = { ipcRenderer: ipcFacade };

if (hasCapability(toolId, 'system')) {
    bridge.os = Object.freeze({
        homedir: () => os.homedir(),
        networkInterfaces: () => os.networkInterfaces()
    });
}

if (hasCapability(toolId, 'exists') || hasCapability(toolId, 'filesystem')) {
    bridge.fs = { existsSync: filePath => fs.existsSync(filePath) };
}

if (hasCapability(toolId, 'filesystem')) {
    Object.assign(bridge.fs, {
        readdirSync: directoryPath => fs.readdirSync(directoryPath),
        statSync: filePath => {
            const stat = fs.statSync(filePath);
            return { isDirectory: stat.isDirectory(), size: stat.size };
        },
        rmSync: (filePath, options) => fs.rmSync(filePath, options),
        unlinkSync: filePath => fs.unlinkSync(filePath)
    });
}

if (hasCapability(toolId, 'path')) {
    bridge.path = Object.freeze({
        dirname: filePath => path.dirname(filePath),
        join: (...parts) => path.join(...parts)
    });
}

if (hasCapability(toolId, 'external-links')) {
    bridge.shell = Object.freeze({
        openExternal: rawUrl => {
            const url = new URL(rawUrl);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error(`External URL protocol is not allowed: ${url.protocol}`);
            }
            return shell.openExternal(url.toString());
        }
    });
}

if (hasCapability(toolId, 'clipboard')) {
    bridge.clipboard = Object.freeze({
        writeText: text => clipboard.writeText(String(text))
    });
}

contextBridge.exposeInMainWorld('toolApi', Object.freeze(bridge));

if (toolId === 'packet-capture') {
    contextBridge.exposeInMainWorld('api', Object.freeze({
        startCapture: filter => ipcFacade.invoke('start-capture', filter),
        stopCapture: () => ipcFacade.invoke('stop-capture'),
        clearPackets: () => ipcFacade.invoke('clear-packets'),
        exportPackets: () => ipcFacade.invoke('export-packets'),
        importPackets: () => ipcFacade.invoke('import-packets'),
        checkAdmin: () => ipcFacade.invoke('check-admin'),
        checkService: () => ipcFacade.invoke('check-service'),
        startService: () => ipcFacade.invoke('start-service'),
        getInterfaces: () => ipcFacade.invoke('get-interfaces'),
        getStatistics: () => ipcFacade.invoke('get-statistics'),
        minimize: () => ipcFacade.invoke('window-minimize'),
        maximize: () => ipcFacade.invoke('window-maximize'),
        close: () => ipcFacade.invoke('window-close'),
        onPacketReceived: callback => ipcFacade.on('packet-received', (_, packet) => callback(packet)),
        onCaptureError: callback => ipcFacade.on('capture-error', (_, error) => callback(error)),
        onCaptureStopped: callback => ipcFacade.on('capture-stopped', callback),
        removeAllListeners: channel => ipcFacade.removeAllListeners(channel)
    }));
}
