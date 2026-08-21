/**
 * PacketLens - browser-based pcap analysis workspace.
 */
const fs = require('fs');
const path = require('path');
const { app, ipcMain, shell } = require('electron');
const { createToolWindow } = require('../utils/toolWindow');
const { getAllowedAssets: buildAllowedAssets, startServer } = require('./packetlens-server');

let packetLensWindow = null;
let packetLensServer = null;
let packetLensOrigin = null;

function getAssetRoot() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : path.join(__dirname, '..', '..');
}

function getAllowedAssets() {
    return buildAllowedAssets(getAssetRoot());
}

function startPacketLensServer() {
    if (packetLensOrigin) return Promise.resolve(packetLensOrigin);

    return startServer(getAssetRoot()).then(({ server, origin }) => {
        packetLensServer = server;
        packetLensOrigin = origin;
        server.unref();
        return origin;
    });
}

function stopPacketLensServer() {
    if (packetLensServer) packetLensServer.close();
    packetLensServer = null;
    packetLensOrigin = null;
}

function registerPacketLensHandlers() {
    ipcMain.handle('packetLens:open', async () => {
        if (packetLensWindow && !packetLensWindow.isDestroyed()) {
            packetLensWindow.focus();
            return { success: true };
        }

        try {
            const assets = getAllowedAssets();
            for (const requiredPath of ['/', '/GeoLite2-ASN.mmdb.gz', '/GeoLite2-Country.mmdb.gz']) {
                if (!fs.existsSync(assets.get(requiredPath))) {
                    return { success: false, error: `缺少 PacketLens 资源: ${path.basename(assets.get(requiredPath))}` };
                }
            }

            const origin = await startPacketLensServer();
            const { win, theme } = createToolWindow({
                width: 1440,
                height: 900,
                minWidth: 980,
                minHeight: 640,
                resizable: true,
                title: 'PacketLens - pcap 深度分析',
                webPreferences: {
                    preload: path.join(__dirname, 'packetlens-preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true
                }
            }, null);
            packetLensWindow = win;

            win.webContents.setWindowOpenHandler(({ url }) => {
                if (/^https?:\/\//i.test(url)) shell.openExternal(url);
                return { action: 'deny' };
            });
            win.webContents.on('will-navigate', (event, url) => {
                if (!url.startsWith(origin + '/')) event.preventDefault();
            });
            win.on('closed', () => {
                packetLensWindow = null;
            });

            const query = new URLSearchParams({
                embedded: '1',
                mode: theme.mode,
                theme: theme.key
            });
            await win.loadURL(`${origin}/index.html?${query}`);
            return { success: true };
        } catch (error) {
            if (packetLensWindow && !packetLensWindow.isDestroyed()) packetLensWindow.destroy();
            packetLensWindow = null;
            stopPacketLensServer();
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerPacketLensHandlers, stopPacketLensServer };
