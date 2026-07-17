const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    createTsharkImportController,
    killTsharkProcess,
    registerTsharkAnalyzerHandlers
} = require('../main/tools/tshark-analyzer');

class FakeChildProcess extends EventEmitter {
    constructor(pid = 1000, autoSpawn = true) {
        super();
        this.pid = pid;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.killCalls = 0;
        this.autoSpawn = autoSpawn;
    }

    kill() {
        this.killCalls += 1;
    }
}

function scheduleChildSpawn(child) {
    if (child.autoSpawn) queueMicrotask(() => child.emit('spawn'));
    return child;
}

class FakeSender extends EventEmitter {
    constructor(id = 1) {
        super();
        this.id = id;
        this.destroyed = false;
        this.messages = [];
    }

    send(channel, payload) {
        if (this.destroyed) throw new Error('sender destroyed');
        this.messages.push({ channel, payload });
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroySender() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('destroyed');
    }
}

class FakeWindow extends EventEmitter {
    constructor(sender) {
        super();
        this.webContents = sender;
        this.destroyed = false;
        this.focusCalls = 0;
    }

    focus() {
        this.focusCalls += 1;
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroyWindow() {
        this.destroyed = true;
        this.webContents.destroySender();
        this.emit('closed');
    }
}

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

function createTimerHarness() {
    const timers = [];
    const cleared = [];
    return {
        timers,
        cleared,
        setTimeoutFn(callback, timeoutMs) {
            const timer = {
                callback,
                timeoutMs,
                unrefCalls: 0,
                unref() {
                    this.unrefCalls += 1;
                }
            };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) {
            cleared.push(timer);
        }
    };
}

function createPacketLine() {
    return JSON.stringify({
        _source: {
            layers: {
                frame_time_epoch: ['1.25'],
                frame_len: ['64'],
                ip_src: ['192.0.2.10'],
                ip_dst: ['198.51.100.20'],
                _ws_col_Protocol: ['TCP'],
                _ws_col_Info: ['test packet']
            }
        }
    });
}

function flushTasks() {
    return new Promise(resolve => setImmediate(resolve));
}

function createControllerHarness(child = new FakeChildProcess()) {
    const timers = createTimerHarness();
    const killed = [];
    let spawnCalls = 0;
    const controller = createTsharkImportController({
        spawnProcess: () => {
            spawnCalls += 1;
            return child;
        },
        killProcess: proc => killed.push(proc),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        timeoutMs: 5000
    });
    return { child, controller, killed, timers, getSpawnCalls: () => spawnCalls };
}

test.describe.serial('Tshark import lifecycle', () => {
    test('Windows termination waits for taskkill tree cleanup before direct fallback', () => {
        const processToKill = new FakeChildProcess(4321);
        let taskkillCall;
        killTsharkProcess(processToKill, {
            platform: 'win32',
            execFile(file, args, options, callback) {
                taskkillCall = { file, args, options, callback };
            }
        });

        expect(taskkillCall.file).toBe('taskkill.exe');
        expect(taskkillCall.args).toEqual(['/F', '/T', '/PID', '4321']);
        expect(taskkillCall.options).toEqual({ windowsHide: true, shell: false, timeout: 5000 });
        expect(processToKill.killCalls).toBe(0);

        taskkillCall.callback(null);
        expect(processToKill.killCalls).toBe(0);

        const fallbackProcess = new FakeChildProcess(4322);
        killTsharkProcess(fallbackProcess, {
            platform: 'win32',
            execFile(file, args, options, callback) {
                callback(new Error('taskkill failed'));
            }
        });
        expect(fallbackProcess.killCalls).toBe(1);
    });

    test('successful import drains output, clears timeout and ignores a late timer', async () => {
        const harness = createControllerHarness();
        const packetBatches = [];
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'C:\\captures\\sample.pcap',
            args: ['-r', 'sample.pcap'],
            onPackets: packets => packetBatches.push(packets)
        });

        expect(harness.child.stderr.listenerCount('data')).toBe(1);
        harness.child.stdout.emit('data', Buffer.from(createPacketLine() + '\n'));
        harness.child.emit('close', 0, null);

        await expect(run).resolves.toEqual({
            success: true,
            fileName: 'sample.pcap',
            packetCount: 1
        });
        expect(packetBatches).toHaveLength(1);
        expect(packetBatches[0]).toHaveLength(1);
        expect(harness.timers.timers[0].unrefCalls).toBe(1);
        expect(harness.timers.cleared).toEqual([harness.timers.timers[0]]);
        expect(harness.killed).toEqual([]);
        expect(harness.controller.isRunning()).toBe(false);

        harness.timers.timers[0].callback();
        expect(harness.killed).toEqual([]);
    });

    test('manual stop settles immediately and blocks late process events', async () => {
        const harness = createControllerHarness();
        const owner = new FakeSender(2);
        const packetBatches = [];
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'manual-stop.pcap',
            args: ['-r', 'manual-stop.pcap'],
            owner,
            onPackets: packets => packetBatches.push(packets)
        });

        expect(owner.listenerCount('destroyed')).toBe(1);
        expect(harness.controller.stop('导入已停止')).toBe(true);
        await expect(run).resolves.toEqual({
            success: false,
            error: '导入已停止',
            cancelled: true
        });
        expect(harness.killed).toEqual([harness.child]);
        expect(harness.timers.cleared).toEqual([harness.timers.timers[0]]);
        expect(owner.listenerCount('destroyed')).toBe(0);
        expect(harness.controller.stop('再次停止')).toBe(false);

        harness.child.stdout.emit('data', Buffer.from(createPacketLine() + '\n'));
        harness.child.emit('close', 0, null);
        expect(packetBatches).toEqual([]);
        expect(harness.killed).toHaveLength(1);
    });

    test('overall timeout kills the process once and returns a timeout result', async () => {
        const harness = createControllerHarness();
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'timeout.pcap',
            args: ['-r', 'timeout.pcap']
        });

        harness.timers.timers[0].callback();
        await expect(run).resolves.toEqual({
            success: false,
            error: 'Tshark 文件解析超时，进程已终止',
            timedOut: true
        });
        expect(harness.killed).toEqual([harness.child]);
        expect(harness.timers.cleared).toEqual([harness.timers.timers[0]]);

        harness.child.emit('close', 0, null);
        expect(harness.killed).toHaveLength(1);
    });

    test('error followed by close settles only once', async () => {
        const harness = createControllerHarness();
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'broken.pcap',
            args: ['-r', 'broken.pcap']
        });

        harness.child.emit('error', new Error('spawn failed'));
        harness.child.emit('close', -1, null);

        await expect(run).resolves.toEqual({ success: false, error: 'spawn failed' });
        expect(harness.killed).toEqual([harness.child]);
        expect(harness.timers.cleared).toEqual([harness.timers.timers[0]]);
    });

    test('stdout stream error terminates import and later close is ignored', async () => {
        const harness = createControllerHarness();
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'stream-error.pcap',
            args: ['-r', 'stream-error.pcap']
        });

        harness.child.stdout.emit('error', new Error('read pipe failed'));
        harness.child.emit('close', 0, null);

        await expect(run).resolves.toEqual({
            success: false,
            error: 'Tshark 输出流错误: read pipe failed'
        });
        expect(harness.killed).toEqual([harness.child]);
        expect(harness.timers.cleared).toEqual([harness.timers.timers[0]]);
    });

    test('non-zero exit includes drained stderr and is not reported as success', async () => {
        const harness = createControllerHarness();
        const run = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'invalid.pcap',
            args: ['-r', 'invalid.pcap']
        });

        harness.child.stderr.emit('data', Buffer.from('invalid capture format'));
        harness.child.emit('close', 2, null);

        const result = await run;
        expect(result.success).toBe(false);
        expect(result.error).toContain('退出码 2');
        expect(result.error).toContain('invalid capture format');
        expect(harness.killed).toEqual([]);
    });

    test('controller rejects a concurrent import without spawning another process', async () => {
        const harness = createControllerHarness();
        const first = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'first.pcap',
            args: ['-r', 'first.pcap']
        });
        const second = harness.controller.start({
            tsharkPath: 'tshark.exe',
            filePath: 'second.pcap',
            args: ['-r', 'second.pcap']
        });

        await expect(second).resolves.toEqual({
            success: false,
            error: '已有 Tshark 文件导入任务正在运行'
        });
        expect(harness.getSpawnCalls()).toBe(1);
        harness.controller.stop('测试结束');
        await first;
    });

    test('IPC stop terminates import and enforces capture/import mutual exclusion', async () => {
        const ipcMain = new FakeIpcMain();
        const child = new FakeChildProcess(2000);
        const sender = new FakeSender(3);
        const timers = createTimerHarness();
        const killed = [];
        let dialogCalls = 0;

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            dialog: {
                showOpenDialog: async () => {
                    dialogCalls += 1;
                    return { canceled: false, filePaths: ['C:\\captures\\handler.pcap'] };
                }
            },
            findTshark: async () => 'tshark.exe',
            spawn: () => child,
            killProcess: proc => killed.push(proc),
            setTimeout: timers.setTimeoutFn,
            clearTimeout: timers.clearTimeoutFn,
            importTimeoutMs: 5000
        });

        const importRun = ipcMain.handlers.get('tshark:importFile')({ sender });
        await flushTasks();
        expect(sender.messages).toContainEqual({ channel: 'tshark:importStart', payload: undefined });

        await expect(ipcMain.handlers.get('tshark:importFile')({ sender })).resolves.toEqual({
            success: false,
            error: '已有 Tshark 文件导入任务正在运行'
        });
        await expect(ipcMain.handlers.get('tshark:start')({ sender }, {})).resolves.toEqual({
            success: false,
            error: '正在导入抓包文件，请先停止导入任务'
        });
        expect(dialogCalls).toBe(1);

        await expect(ipcMain.handlers.get('tshark:stop')()).resolves.toEqual({
            success: true,
            stoppedCapture: false,
            stoppedImport: true
        });
        await expect(importRun).resolves.toEqual({
            success: false,
            error: '导入已停止',
            cancelled: true
        });
        expect(killed).toEqual([child]);

        child.stdout.emit('data', Buffer.from(createPacketLine() + '\n'));
        child.emit('close', 0, null);
        expect(sender.messages.filter(item => item.channel === 'tshark:packets')).toEqual([]);
    });

    test('late close from a stopped capture cannot clear a newer capture', async () => {
        const ipcMain = new FakeIpcMain();
        const firstChild = new FakeChildProcess(2500);
        const secondChild = new FakeChildProcess(2501);
        const sender = new FakeSender(5);
        const children = [firstChild, secondChild];
        const killed = [];

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            findTshark: async () => 'tshark.exe',
            spawn: () => scheduleChildSpawn(children.shift()),
            killProcess: proc => killed.push(proc)
        });

        await expect(ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 })).resolves.toEqual({ success: true });
        firstChild.stdout.emit('data', Buffer.from(createPacketLine() + '\n'));
        await expect(ipcMain.handlers.get('tshark:stop')()).resolves.toEqual({
            success: true,
            stoppedCapture: true,
            stoppedImport: false
        });
        await expect(ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 })).resolves.toEqual({ success: true });

        firstChild.emit('close', 0, null);
        firstChild.stdout.emit('data', Buffer.from(createPacketLine() + '\n'));
        firstChild.stderr.emit('data', Buffer.from('late stderr'));
        await expect(ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 })).resolves.toEqual({
            success: false,
            error: '已有抓包任务正在运行'
        });
        expect(sender.messages.filter(item => item.channel === 'tshark:packets')).toEqual([]);
        expect(sender.messages.filter(item => item.channel === 'tshark:error')).toEqual([]);

        await ipcMain.handlers.get('tshark:stop')();
        secondChild.emit('close', 0, null);
        expect(killed).toEqual([firstChild, secondChild]);
    });

    test('destroying the owner while resolving Tshark path prevents capture spawn', async () => {
        const ipcMain = new FakeIpcMain();
        const sender = new FakeSender(6);
        let resolveTsharkPath;
        let spawnCalls = 0;
        const tsharkPath = new Promise(resolve => {
            resolveTsharkPath = resolve;
        });

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            findTshark: () => tsharkPath,
            spawn: () => {
                spawnCalls += 1;
                return new FakeChildProcess(2600);
            }
        });

        const startRun = ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 });
        await flushTasks();
        sender.destroySender();
        resolveTsharkPath('tshark.exe');

        await expect(startRun).resolves.toEqual({
            success: false,
            error: '分析窗口已关闭',
            cancelled: true
        });
        expect(spawnCalls).toBe(0);
    });

    test('capture stream error terminates the active job once', async () => {
        const ipcMain = new FakeIpcMain();
        const sender = new FakeSender(7);
        const child = new FakeChildProcess(2700);
        const killed = [];

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            findTshark: async () => 'tshark.exe',
            spawn: () => scheduleChildSpawn(child),
            killProcess: proc => killed.push(proc)
        });

        await ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 });
        child.stderr.emit('error', new Error('stderr pipe failed'));
        child.emit('close', 0, null);

        expect(killed).toEqual([child]);
        expect(sender.messages.filter(item => item.channel === 'tshark:error')).toEqual([
            { channel: 'tshark:error', payload: '抓包错误流异常: stderr pipe failed' }
        ]);
        expect(sender.messages.filter(item => item.channel === 'tshark:stopped')).toEqual([
            { channel: 'tshark:stopped', payload: { code: -1, stopped: false } }
        ]);
    });

    test('capture start waits for spawn failure instead of returning false success', async () => {
        const ipcMain = new FakeIpcMain();
        const sender = new FakeSender(8);
        const child = new FakeChildProcess(2800, false);

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            findTshark: async () => 'missing-tshark.exe',
            spawn: () => {
                queueMicrotask(() => child.emit('error', new Error('ENOENT')));
                return child;
            }
        });

        await expect(ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 })).resolves.toEqual({
            success: false,
            error: '无法启动 Tshark: ENOENT'
        });
        expect(sender.messages.filter(item => item.channel === 'tshark:stopped')).toEqual([]);
        await expect(ipcMain.handlers.get('tshark:stop')()).resolves.toEqual({
            success: true,
            stoppedCapture: false,
            stoppedImport: false
        });
    });

    test('stop settles a capture that is still waiting for the spawn event', async () => {
        const ipcMain = new FakeIpcMain();
        const sender = new FakeSender(9);
        const child = new FakeChildProcess(2900, false);
        const killed = [];

        registerTsharkAnalyzerHandlers({ getMainWindow: () => null }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            findTshark: async () => 'tshark.exe',
            spawn: () => child,
            killProcess: proc => killed.push(proc)
        });

        const startRun = ipcMain.handlers.get('tshark:start')({ sender }, { interfaceIndex: 1 });
        await flushTasks();
        await expect(ipcMain.handlers.get('tshark:stop')()).resolves.toEqual({
            success: true,
            stoppedCapture: true,
            stoppedImport: false
        });
        await expect(startRun).resolves.toEqual({
            success: false,
            error: '抓包已停止',
            cancelled: true
        });
        expect(killed).toEqual([child]);
        expect(sender.messages.filter(item => item.channel === 'tshark:stopped')).toEqual([]);
    });

    test('closing the analyzer window terminates the tracked import', async () => {
        const ipcMain = new FakeIpcMain();
        const child = new FakeChildProcess(3000);
        const sender = new FakeSender(4);
        const window = new FakeWindow(sender);
        const timers = createTimerHarness();
        const killed = [];

        registerTsharkAnalyzerHandlers({ getMainWindow: () => window }, {
            ipcMain,
            app: { isPackaged: false, getPath: () => 'C:\\temp' },
            createToolWindow: () => ({ win: window }),
            dialog: {
                showOpenDialog: async () => ({
                    canceled: false,
                    filePaths: ['C:\\captures\\window-close.pcap']
                })
            },
            findTshark: async () => 'tshark.exe',
            spawn: () => child,
            killProcess: proc => killed.push(proc),
            setTimeout: timers.setTimeoutFn,
            clearTimeout: timers.clearTimeoutFn,
            importTimeoutMs: 5000
        });

        await expect(ipcMain.handlers.get('tshark:open')()).resolves.toEqual({ success: true });
        const importRun = ipcMain.handlers.get('tshark:importFile')({ sender });
        await flushTasks();
        window.destroyWindow();

        const result = await importRun;
        expect(result).toEqual({ success: false, error: '分析窗口已关闭', cancelled: true });
        expect(killed).toEqual([child]);
        expect(timers.cleared).toEqual([timers.timers[0]]);
    });

    test('renderer exposes import busy state through the existing stop button', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'TsharkAnalyzer', 'renderer.js'),
            'utf8'
        );
        expect(source).toContain('isImporting: false');
        expect(source).toContain('tsharkAvailable: false');
        expect(source).toContain("ipcRenderer.invoke('tshark:stop')");
        expect(source).toContain("$('btn-stop').disabled = !active");
        expect(source).toContain("$('btn-import').disabled = busy || !state.tsharkAvailable");
        expect(source).toContain("$('tshark-status').textContent = '✗ 未找到 tshark'");
    });
});
