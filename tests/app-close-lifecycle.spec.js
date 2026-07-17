const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    CLOSE_CONFIRMATION_CHANNEL,
    CLOSE_REQUEST_CHANNEL,
    registerAppCloseController
} = require('../main/utils/app-close-controller');
const { registerWindowHandlers } = require('../main/handlers/window');

class FakeWebContents extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.destroyed = false;
        this.messages = [];
        this.sendError = null;
        this.loading = false;
    }

    isDestroyed() {
        return this.destroyed;
    }

    isLoadingMainFrame() {
        return this.loading;
    }

    send(channel, payload) {
        if (this.sendError) throw this.sendError;
        this.messages.push({ channel, payload });
    }
}

class FakeWindow extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.webContents = new FakeWebContents(id);
        this.destroyed = false;
        this.closeCalls = 0;
    }

    isDestroyed() {
        return this.destroyed;
    }

    close() {
        this.closeCalls += 1;
        const event = {
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        };
        this.emit('close', event);
        if (!event.defaultPrevented && !this.destroyed) {
            this.destroyed = true;
            this.webContents.destroyed = true;
            this.emit('closed');
        }
        return !event.defaultPrevented;
    }

    forceDestroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.webContents.destroyed = true;
        this.emit('closed');
    }
}

function createHarness() {
    const ipcMain = new EventEmitter();
    const state = { isQuitting: false };
    const controller = registerAppCloseController({
        ipcMain,
        getIsQuitting: () => state.isQuitting
    });
    return { controller, ipcMain, state };
}

function getLastRequestId(window) {
    return window.webContents.messages.at(-1)?.payload;
}

function emitConfirmation(harness, window, confirmed, requestId = getLastRequestId(window)) {
    harness.ipcMain.emit(CLOSE_CONFIRMATION_CHANNEL, {
        sender: window.webContents
    }, {
        requestId,
        confirmed
    });
}

function waitForScheduledClose() {
    return new Promise(resolve => setImmediate(resolve));
}

test.describe('App close confirmation lifecycle', () => {
    test('registers one process-level listener and attaches each window once', () => {
        const harness = createHarness();
        const duplicate = registerAppCloseController({
            ipcMain: harness.ipcMain,
            getIsQuitting: () => harness.state.isQuitting
        });
        const firstWindow = new FakeWindow(1);
        const secondWindow = new FakeWindow(2);

        expect(duplicate).toBe(harness.controller);
        expect(harness.ipcMain.listenerCount(CLOSE_CONFIRMATION_CHANNEL)).toBe(1);
        expect(harness.controller.attachWindow(firstWindow)).toBe(true);
        expect(harness.controller.attachWindow(firstWindow)).toBe(false);
        expect(harness.controller.attachWindow(secondWindow)).toBe(true);
        expect(firstWindow.listenerCount('close')).toBe(1);
        expect(secondWindow.listenerCount('close')).toBe(1);
        expect(harness.ipcMain.listenerCount(CLOSE_CONFIRMATION_CHANNEL)).toBe(1);
    });

    test('accepts confirmation only from the pending window and only once', () => {
        const harness = createHarness();
        const firstWindow = new FakeWindow(1);
        const secondWindow = new FakeWindow(2);
        harness.controller.attachWindow(firstWindow);
        harness.controller.attachWindow(secondWindow);

        expect(firstWindow.close()).toBe(false);
        expect(firstWindow.webContents.messages).toEqual([
            { channel: CLOSE_REQUEST_CHANNEL, payload: expect.any(Number) }
        ]);
        expect(secondWindow.webContents.messages).toEqual([]);
        const firstRequestId = getLastRequestId(firstWindow);

        expect(firstWindow.close()).toBe(false);
        expect(firstWindow.webContents.messages).toHaveLength(1);

        emitConfirmation(harness, secondWindow, true, firstRequestId);
        harness.ipcMain.emit(CLOSE_CONFIRMATION_CHANNEL, {
            sender: firstWindow.webContents
        }, {
            requestId: firstRequestId,
            confirmed: 'true'
        });
        expect(firstWindow.destroyed).toBe(false);
        expect(secondWindow.destroyed).toBe(false);
        expect(harness.state.isQuitting).toBe(false);

        emitConfirmation(harness, firstWindow, false, firstRequestId);
        expect(harness.controller.getPendingWindow()).toBeNull();
        expect(harness.state.isQuitting).toBe(false);

        expect(firstWindow.close()).toBe(false);
        expect(firstWindow.webContents.messages).toHaveLength(2);
        const secondRequestId = getLastRequestId(firstWindow);
        emitConfirmation(harness, firstWindow, true, secondRequestId);

        expect(harness.state.isQuitting).toBe(false);
        expect(firstWindow.destroyed).toBe(true);
        expect(secondWindow.destroyed).toBe(false);
        expect(firstWindow.closeCalls).toBe(4);

        emitConfirmation(harness, firstWindow, true, secondRequestId);
        expect(firstWindow.closeCalls).toBe(4);
    });

    test('ignores an old approval after the user cancels and starts a new request', () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        harness.controller.attachWindow(window);

        expect(window.close()).toBe(false);
        const canceledRequestId = getLastRequestId(window);
        emitConfirmation(harness, window, false, canceledRequestId);
        expect(harness.controller.getPendingWindow()).toBeNull();

        emitConfirmation(harness, window, true, canceledRequestId);
        expect(window.destroyed).toBe(false);
        expect(window.closeCalls).toBe(1);

        expect(window.close()).toBe(false);
        const activeRequestId = getLastRequestId(window);
        expect(activeRequestId).not.toBe(canceledRequestId);

        emitConfirmation(harness, window, true, canceledRequestId);
        expect(window.destroyed).toBe(false);
        expect(harness.controller.getPendingWindow()).toBe(window);

        emitConfirmation(harness, window, true, activeRequestId);
        expect(window.destroyed).toBe(true);
        expect(window.closeCalls).toBe(3);
    });

    test('allows application shutdown without requesting confirmation', () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        harness.controller.attachWindow(window);
        harness.state.isQuitting = true;

        expect(window.close()).toBe(true);
        expect(window.destroyed).toBe(true);
        expect(window.webContents.messages).toEqual([]);
        expect(harness.controller.getPendingWindow()).toBeNull();
    });

    test('clears a destroyed pending window and ignores its late confirmation', () => {
        const harness = createHarness();
        const oldWindow = new FakeWindow(1);
        const newWindow = new FakeWindow(2);
        harness.controller.attachWindow(oldWindow);
        harness.controller.attachWindow(newWindow);

        oldWindow.close();
        const oldRequestId = getLastRequestId(oldWindow);
        expect(harness.controller.getPendingWindow()).toBe(oldWindow);
        oldWindow.forceDestroy();
        expect(harness.controller.getPendingWindow()).toBeNull();

        newWindow.close();
        const newRequestId = getLastRequestId(newWindow);
        expect(harness.controller.getPendingWindow()).toBe(newWindow);
        emitConfirmation(harness, oldWindow, true, oldRequestId);
        expect(newWindow.destroyed).toBe(false);
        expect(harness.state.isQuitting).toBe(false);

        emitConfirmation(harness, newWindow, true, newRequestId);
        expect(newWindow.destroyed).toBe(true);
        expect(harness.state.isQuitting).toBe(false);
    });

    test('attaching a new window preserves an older pending confirmation', () => {
        const harness = createHarness();
        const oldWindow = new FakeWindow(1);
        const newWindow = new FakeWindow(2);
        harness.controller.attachWindow(oldWindow);
        oldWindow.close();
        const oldRequestId = getLastRequestId(oldWindow);
        expect(harness.controller.getPendingWindow()).toBe(oldWindow);

        harness.controller.attachWindow(newWindow);
        emitConfirmation(harness, oldWindow, true, oldRequestId);
        expect(oldWindow.destroyed).toBe(true);
        expect(newWindow.destroyed).toBe(false);

        newWindow.close();
        emitConfirmation(harness, newWindow, true);
        expect(newWindow.destroyed).toBe(true);
    });

    test('send failure closes the requested window without throwing', async () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        window.webContents.sendError = new Error('renderer unavailable');
        harness.controller.attachWindow(window);

        expect(() => window.close()).not.toThrow();
        expect(window.destroyed).toBe(false);
        expect(harness.controller.getPendingWindow()).toBeNull();

        await waitForScheduledClose();
        expect(window.destroyed).toBe(true);
        expect(window.closeCalls).toBe(2);
    });

    test('renderer failure releases a pending close request', async () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        harness.controller.attachWindow(window);

        expect(window.close()).toBe(false);
        expect(harness.controller.getPendingWindow()).toBe(window);
        window.webContents.emit('render-process-gone');
        expect(harness.controller.getPendingWindow()).toBeNull();

        await waitForScheduledClose();
        expect(window.destroyed).toBe(true);
        expect(window.closeCalls).toBe(2);
    });

    test('a window with an already failed renderer closes without a request', () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        harness.controller.attachWindow(window);
        window.webContents.emit('render-process-gone');

        expect(window.close()).toBe(true);
        expect(window.destroyed).toBe(true);
        expect(window.webContents.messages).toEqual([]);
        expect(harness.controller.getPendingWindow()).toBeNull();
    });

    test('main-frame navigation invalidates an old close request', () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        harness.controller.attachWindow(window);

        expect(window.close()).toBe(false);
        const oldRequestId = getLastRequestId(window);
        window.webContents.loading = true;
        window.webContents.emit(
            'did-start-navigation',
            {},
            'file:///index.html',
            false,
            true
        );
        expect(harness.controller.getPendingWindow()).toBeNull();

        emitConfirmation(harness, window, true, oldRequestId);
        expect(window.destroyed).toBe(false);

        window.webContents.loading = false;
        window.webContents.emit('did-finish-load');
        expect(window.close()).toBe(false);
        const newRequestId = getLastRequestId(window);
        expect(newRequestId).not.toBe(oldRequestId);

        emitConfirmation(harness, window, true, oldRequestId);
        expect(window.destroyed).toBe(false);
        emitConfirmation(harness, window, true, newRequestId);
        expect(window.destroyed).toBe(true);
    });

    test('a close during main-frame loading is not left pending', () => {
        const harness = createHarness();
        const window = new FakeWindow(1);
        window.webContents.loading = true;
        harness.controller.attachWindow(window);

        expect(window.close()).toBe(true);
        expect(window.destroyed).toBe(true);
        expect(window.webContents.messages).toEqual([]);
        expect(harness.controller.getPendingWindow()).toBeNull();
    });

    test('preload buffers an early close request until the renderer registers', async () => {
        const rootDir = path.join(__dirname, '..');
        const preloadSource = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
        const ipcRenderer = new EventEmitter();
        const sentMessages = [];
        let exposedApi = null;
        ipcRenderer.send = (channel, payload) => {
            sentMessages.push({ channel, payload });
        };
        ipcRenderer.invoke = () => Promise.resolve();

        vm.runInNewContext(preloadSource, {
            require(moduleName) {
                if (moduleName !== 'electron') throw new Error(`Unexpected module: ${moduleName}`);
                return {
                    contextBridge: {
                        exposeInMainWorld(_name, api) {
                            exposedApi = api;
                        }
                    },
                    ipcRenderer,
                    webUtils: {}
                };
            },
            console: { error() {} },
            Number,
            Promise
        }, { filename: 'preload.js' });

        ipcRenderer.emit(CLOSE_REQUEST_CHANNEL, {}, 41);
        let receivedRequestId = null;
        exposedApi.app.onCloseRequest((requestId) => {
            receivedRequestId = requestId;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(receivedRequestId).toBe(41);

        exposedApi.app.onCloseRequest(() => Promise.reject(new Error('dialog failed')));
        ipcRenderer.emit(CLOSE_REQUEST_CHANNEL, {}, 42);
        await waitForScheduledClose();
        expect(sentMessages).toContainEqual({
            channel: CLOSE_CONFIRMATION_CHANNEL,
            payload: { requestId: 42, confirmed: false }
        });
    });

    test('window control IPC targets the sender window before the latest main window', async () => {
        const handlers = new Map();
        const oldWindow = new FakeWindow(1);
        const latestWindow = new FakeWindow(2);
        const ipcMain = {
            handle(channel, handler) {
                handlers.set(channel, handler);
            }
        };
        registerWindowHandlers({
            getMainWindow: () => latestWindow
        }, {
            ipcMain,
            BrowserWindow: {
                fromWebContents(sender) {
                    if (sender === oldWindow.webContents) return oldWindow;
                    if (sender === latestWindow.webContents) return latestWindow;
                    return null;
                }
            }
        });

        await handlers.get('window:close')({ sender: oldWindow.webContents });
        expect(oldWindow.closeCalls).toBe(1);
        expect(latestWindow.closeCalls).toBe(0);
    });

    test('window control IPC fails closed for unknown or destroyed senders', async () => {
        const handlers = new Map();
        const destroyedWindow = new FakeWindow(1);
        const latestWindow = new FakeWindow(2);
        const unknownSender = new FakeWebContents(3);
        destroyedWindow.forceDestroy();
        const ipcMain = {
            handle(channel, handler) {
                handlers.set(channel, handler);
            }
        };
        registerWindowHandlers({
            getMainWindow: () => latestWindow
        }, {
            ipcMain,
            BrowserWindow: {
                fromWebContents(sender) {
                    if (sender === destroyedWindow.webContents) return destroyedWindow;
                    return null;
                }
            }
        });

        await handlers.get('window:close')({ sender: unknownSender });
        await handlers.get('window:close')({ sender: destroyedWindow.webContents });
        expect(latestWindow.closeCalls).toBe(0);
        expect(destroyedWindow.closeCalls).toBe(0);
    });

    test('createMainWindow uses local window callbacks and never registers the IPC listener', () => {
        const rootDir = path.join(__dirname, '..');
        const appSource = fs.readFileSync(path.join(rootDir, 'main', 'app.js'), 'utf8');
        const indexSource = fs.readFileSync(path.join(rootDir, 'main', 'index.js'), 'utf8');
        const preloadSource = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
        const rendererSource = fs.readFileSync(path.join(rootDir, 'scripts', 'renderer.js'), 'utf8');

        expect(appSource).toContain('const window = new BrowserWindow({');
        expect(appSource).toContain('appCloseController.attachWindow(window)');
        expect(appSource).toContain('if (mainWindow === window)');
        expect(appSource).not.toContain('appCloseController.clearPendingWindow()');
        expect(appSource).not.toContain('\n    isQuitting = false;');
        expect(appSource).not.toContain("ipcMain.on('app:close-confirmed'");
        expect(appSource).not.toContain("mainWindow.on('close'");
        expect(preloadSource.indexOf('ipcRenderer.on(APP_CLOSE_REQUEST_CHANNEL'))
            .toBeLessThan(preloadSource.indexOf("contextBridge.exposeInMainWorld('api'"));
        expect(rendererSource.indexOf('window.api.app.onCloseRequest'))
            .toBeLessThan(rendererSource.indexOf('await loadDevices()'));

        const windowAllClosedBlock = indexSource.slice(
            indexSource.indexOf("app.on('window-all-closed'"),
            indexSource.indexOf("app.on('window-all-closed'") + 600
        );
        expect(windowAllClosedBlock).toContain("if (process.platform !== 'darwin') {");
        expect(windowAllClosedBlock).toContain('setQuitting(true);');
        expect(windowAllClosedBlock.indexOf('setQuitting(true);'))
            .toBeGreaterThan(windowAllClosedBlock.indexOf("if (process.platform !== 'darwin') {"));
    });
});
