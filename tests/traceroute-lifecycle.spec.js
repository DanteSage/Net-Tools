const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    CLASSIC_TRACE_MIN_WATCHDOG_MS,
    CLASSIC_TRACE_MAX_WATCHDOG_MS,
    calculateClassicTraceWatchdogMs,
    createClassicTraceController,
    registerTracerouteHandlers
} = require('../main/tools/traceroute');

class FakeChildProcess extends EventEmitter {
    constructor(pid = 1000) {
        super();
        this.pid = pid;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.killCalls = 0;
    }

    kill() {
        this.killCalls += 1;
    }
}

class FakeSender extends EventEmitter {
    constructor() {
        super();
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

    closeWindow() {
        this.destroyed = true;
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

class FakeRendererIpc extends EventEmitter {
    constructor(invokeHandler) {
        super();
        this.invokeHandler = invokeHandler;
    }

    invoke(channel, payload) {
        return this.invokeHandler(channel, payload);
    }
}

function createFakeTimers() {
    const timers = [];
    return {
        timers,
        setTimeoutFn(callback, delay) {
            const timer = {
                callback,
                delay,
                cleared: false,
                unrefCalls: 0,
                unref() {
                    this.unrefCalls += 1;
                }
            };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) {
            timer.cleared = true;
        }
    };
}

function traceParams(overrides = {}) {
    return {
        host: '203.0.113.10',
        maxHops: 30,
        timeout: 3000,
        protocol: 'icmp',
        requestId: 'trace-default',
        ...overrides
    };
}

function loadDoMtrTrace(source, ipcRenderer, requestId = 'mtr-current') {
    const match = source.match(
        /        async function doMtrTrace\(host\) \{([\s\S]*?)\r?\n        \}\r?\n\r?\n        function updateMtrData/
    );
    if (!match) throw new Error('Unable to locate doMtrTrace in renderer source');
    const functionSource = `async function doMtrTrace(host) {${match[1]}\n}`;
    return new Function(
        'ipcRenderer',
        'nextTraceRequestId',
        `${functionSource}; return doMtrTrace;`
    )(ipcRenderer, () => requestId);
}

test.describe('Classic traceroute lifecycle', () => {
    test('calculates a bounded overall watchdog from validated probe limits', () => {
        expect(calculateClassicTraceWatchdogMs(1, 500)).toBe(CLASSIC_TRACE_MIN_WATCHDOG_MS);
        expect(calculateClassicTraceWatchdogMs(30, 500)).toBe(105000);
        expect(calculateClassicTraceWatchdogMs(30, 3000)).toBe(285000);
        expect(calculateClassicTraceWatchdogMs(9999, 999999)).toBe(CLASSIC_TRACE_MAX_WATCHDOG_MS);
    });

    test('rejects a concurrent start without replacing the active process', async () => {
        const child = new FakeChildProcess();
        let spawnCalls = 0;
        const controller = createClassicTraceController({
            spawnProcess: () => {
                spawnCalls += 1;
                return child;
            },
            watchdogMs: 5000
        });

        const firstRun = controller.start(traceParams());
        await expect(controller.start(traceParams({
            host: '198.51.100.20',
            requestId: 'trace-busy'
        }))).resolves.toMatchObject({
            success: false,
            busy: true,
            requestId: 'trace-busy'
        });
        expect(spawnCalls).toBe(1);
        expect(controller.isRunning()).toBe(true);

        child.emit('close', 0, null);
        await expect(firstRun).resolves.toMatchObject({ success: true });
    });

    test('normal completion clears the watchdog and reports parsed hops once', async () => {
        const child = new FakeChildProcess();
        const fakeTimers = createFakeTimers();
        const hops = [];
        const completions = [];
        const controller = createClassicTraceController({
            spawnProcess: () => child,
            setTimeoutFn: fakeTimers.setTimeoutFn,
            clearTimeoutFn: fakeTimers.clearTimeoutFn
        });

        const run = controller.start(traceParams({
            host: '203.0.113.10',
            onHop: hop => hops.push(hop),
            onComplete: result => completions.push(result)
        }));
        child.stdout.emit('data', '  1    1 ms    2 ms    3 ms  192.0.2.1\r\n');
        child.stdout.emit('data', '  2    4 ms    5 ms    6 ms  203.0.113.10\r\n');
        child.emit('close', 0, null);

        const result = await run;
        expect(result).toMatchObject({ success: true, reached: true, code: 0 });
        expect(hops).toHaveLength(2);
        expect(hops.every(hop => hop.requestId === 'trace-default')).toBe(true);
        expect(completions).toHaveLength(1);
        expect(completions[0].requestId).toBe('trace-default');
        expect(fakeTimers.timers).toHaveLength(1);
        expect(fakeTimers.timers[0]).toMatchObject({ cleared: true, unrefCalls: 1 });

        fakeTimers.timers[0].callback();
        expect(child.killCalls).toBe(0);
    });

    test('watchdog terminates and settles once while late process events are ignored', async () => {
        const child = new FakeChildProcess();
        const fakeTimers = createFakeTimers();
        const completions = [];
        const controller = createClassicTraceController({
            spawnProcess: () => child,
            killProcess: proc => proc.kill(),
            setTimeoutFn: fakeTimers.setTimeoutFn,
            clearTimeoutFn: fakeTimers.clearTimeoutFn,
            watchdogMs: 1000
        });

        const run = controller.start(traceParams({ onComplete: result => completions.push(result) }));
        expect(fakeTimers.timers[0].delay).toBe(1000);
        fakeTimers.timers[0].callback();

        await expect(run).resolves.toMatchObject({
            success: false,
            timedOut: true
        });
        expect(child.killCalls).toBe(1);
        expect(completions).toHaveLength(1);

        child.stdout.emit('data', '  1    1 ms    1 ms    1 ms  192.0.2.1\r\n');
        child.emit('error', new Error('late error'));
        child.emit('close', 1, null);
        expect(child.killCalls).toBe(1);
        expect(completions).toHaveLength(1);
    });

    test('stop settles immediately and old close cannot clear a newly started trace', async () => {
        const firstChild = new FakeChildProcess(1001);
        const secondChild = new FakeChildProcess(1002);
        const children = [firstChild, secondChild];
        const firstHops = [];
        const secondHops = [];
        const controller = createClassicTraceController({
            spawnProcess: () => children.shift(),
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        const firstRun = controller.start(traceParams({
            requestId: 'trace-a',
            onHop: hop => firstHops.push(hop)
        }));
        expect(controller.stop()).toBe(true);
        const secondRun = controller.start(traceParams({
            host: '198.51.100.20',
            requestId: 'trace-b',
            onHop: hop => secondHops.push(hop)
        }));

        await expect(firstRun).resolves.toMatchObject({ success: false, cancelled: true });
        expect(firstChild.killCalls).toBe(1);

        firstChild.stdout.emit('data', '  1    1 ms    1 ms    1 ms  192.0.2.9\r\n');
        firstChild.emit('close', 0, null);
        expect(controller.isRunning()).toBe(true);
        expect(firstHops).toHaveLength(0);

        secondChild.stdout.emit('data', '  1    2 ms    2 ms    2 ms  198.51.100.20\r\n');
        secondChild.emit('close', 0, null);
        await expect(secondRun).resolves.toMatchObject({ success: true, reached: true });
        expect(secondHops).toHaveLength(1);
        expect(secondHops[0].requestId).toBe('trace-b');
    });

    test('stdout stream error terminates the active process and settles once', async () => {
        const child = new FakeChildProcess();
        const completions = [];
        const controller = createClassicTraceController({
            spawnProcess: () => child,
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        const run = controller.start(traceParams({ onComplete: result => completions.push(result) }));
        child.stdout.emit('error', new Error('stdout failed'));
        child.emit('close', 1, null);

        await expect(run).resolves.toMatchObject({
            success: false,
            error: '路由追踪输出流错误: stdout failed'
        });
        expect(child.killCalls).toBe(1);
        expect(completions).toHaveLength(1);
    });

    test('spawn error followed by close is consumed and completes only once', async () => {
        const child = new FakeChildProcess();
        const completions = [];
        const controller = createClassicTraceController({
            spawnProcess: () => child,
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        const run = controller.start(traceParams({ onComplete: result => completions.push(result) }));
        child.emit('error', new Error('spawn ENOENT'));
        child.emit('close', -1, null);

        await expect(run).resolves.toMatchObject({ success: false, error: 'spawn ENOENT' });
        expect(child.killCalls).toBe(1);
        expect(completions).toHaveLength(1);
        expect(controller.isRunning()).toBe(false);
    });

    test('destroying the owner cancels the process without sending a completion event', async () => {
        const child = new FakeChildProcess();
        const owner = new FakeSender();
        const completions = [];
        const controller = createClassicTraceController({
            spawnProcess: () => child,
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        const run = controller.start(traceParams({
            owner,
            onComplete: result => completions.push(result)
        }));
        owner.destroySender();

        await expect(run).resolves.toMatchObject({ success: false, cancelled: true });
        expect(child.killCalls).toBe(1);
        expect(completions).toHaveLength(0);
    });

    test('closing the tool window stops the tracked IPC task', async () => {
        const child = new FakeChildProcess();
        const sender = new FakeSender();
        const window = new FakeWindow(sender);
        const ipcMain = new FakeIpcMain();
        registerTracerouteHandlers({}, {
            ipcMain,
            createToolWindow: () => ({ win: window }),
            spawnProcess: () => child,
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        await ipcMain.handlers.get('traceroute:open')();
        const run = ipcMain.handlers.get('traceroute:start')({ sender }, traceParams());
        window.closeWindow();

        await expect(run).resolves.toMatchObject({ success: false, cancelled: true });
        expect(child.killCalls).toBe(1);
        expect(sender.messages).toEqual([]);
    });

    test('IPC events preserve request identity across stop and immediate restart', async () => {
        const firstChild = new FakeChildProcess(2001);
        const secondChild = new FakeChildProcess(2002);
        const children = [firstChild, secondChild];
        const sender = new FakeSender();
        const ipcMain = new FakeIpcMain();
        registerTracerouteHandlers({}, {
            ipcMain,
            spawnProcess: () => children.shift(),
            killProcess: proc => proc.kill(),
            watchdogMs: 5000
        });

        const firstRun = ipcMain.handlers.get('traceroute:start')(
            { sender },
            traceParams({ requestId: 'trace-a' })
        );
        firstChild.stdout.emit('data', '  1    1 ms    1 ms    1 ms  192.0.2.1\r\n');
        await ipcMain.handlers.get('traceroute:stop')();

        const secondRun = ipcMain.handlers.get('traceroute:start')(
            { sender },
            traceParams({ host: '198.51.100.20', requestId: 'trace-b' })
        );
        firstChild.stdout.emit('data', '  2    2 ms    2 ms    2 ms  192.0.2.2\r\n');
        firstChild.emit('close', 0, null);
        secondChild.stdout.emit('data', '  1    3 ms    3 ms    3 ms  198.51.100.20\r\n');
        secondChild.emit('close', 0, null);

        await expect(firstRun).resolves.toMatchObject({ cancelled: true, requestId: 'trace-a' });
        await expect(secondRun).resolves.toMatchObject({ success: true, requestId: 'trace-b' });
        expect(sender.messages.map(message => ({
            channel: message.channel,
            requestId: message.payload.requestId
        }))).toEqual([
            { channel: 'traceroute:hop', requestId: 'trace-a' },
            { channel: 'traceroute:complete', requestId: 'trace-a' },
            { channel: 'traceroute:hop', requestId: 'trace-b' },
            { channel: 'traceroute:complete', requestId: 'trace-b' }
        ]);
    });

    test('MTR ignores stale events and settles from the matching completion', async () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'Route Tracking', 'index.html'),
            'utf8'
        );
        const ipcRenderer = new FakeRendererIpc(() => new Promise(() => {}));
        const doMtrTrace = loadDoMtrTrace(source, ipcRenderer);
        const run = doMtrTrace('203.0.113.10');
        let settled = false;
        run.then(() => { settled = true; }, () => { settled = true; });

        ipcRenderer.emit('traceroute:hop', {}, { requestId: 'mtr-old', hop: 1 });
        ipcRenderer.emit('traceroute:complete', {}, { requestId: 'mtr-old', success: true });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(ipcRenderer.listenerCount('traceroute:complete')).toBe(1);

        ipcRenderer.emit('traceroute:hop', {}, { requestId: 'mtr-current', hop: 2 });
        ipcRenderer.emit('traceroute:complete', {}, {
            requestId: 'mtr-current',
            success: true
        });
        await expect(run).resolves.toEqual([{ requestId: 'mtr-current', hop: 2 }]);
        expect(ipcRenderer.listenerCount('traceroute:hop')).toBe(0);
        expect(ipcRenderer.listenerCount('traceroute:complete')).toBe(0);
    });

    test('MTR invoke success or failure settles and removes event listeners', async () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'Route Tracking', 'index.html'),
            'utf8'
        );
        const successIpc = new FakeRendererIpc(async () => ({
            requestId: 'mtr-success',
            success: true
        }));
        const successfulTrace = loadDoMtrTrace(source, successIpc, 'mtr-success');
        await expect(successfulTrace('203.0.113.10')).resolves.toEqual([]);
        expect(successIpc.listenerCount('traceroute:hop')).toBe(0);
        expect(successIpc.listenerCount('traceroute:complete')).toBe(0);

        const failureIpc = new FakeRendererIpc(async () => ({
            requestId: 'mtr-failure',
            success: false,
            error: '已有正在运行的路由追踪任务'
        }));
        const failedTrace = loadDoMtrTrace(source, failureIpc, 'mtr-failure');
        await expect(failedTrace('203.0.113.10')).rejects.toThrow('已有正在运行的路由追踪任务');
        expect(failureIpc.listenerCount('traceroute:hop')).toBe(0);
        expect(failureIpc.listenerCount('traceroute:complete')).toBe(0);
    });

    test('renderer guards stale basic traces and always cleans MTR listeners', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'Route Tracking', 'index.html'),
            'utf8'
        );
        expect(source).toContain('traceRunId = 0');
        expect(source).toContain('if (isTracing) return;');
        expect(source).toContain('if (runId === traceRunId)');
        expect(source).toContain('result.requestId === activeTraceRequestId');
        expect(source).toContain('data.requestId === activeTraceRequestId');
        expect(source).toContain("const requestId = nextTraceRequestId('mtr')");
        expect(source).toContain("ipcRenderer.on('traceroute:complete', completeHandler)");
        expect(source).toContain("ipcRenderer.removeListener('traceroute:complete', completeHandler)");
        expect(source).toContain('.catch(finish)');
    });
});
