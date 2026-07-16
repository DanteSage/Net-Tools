const { test, expect } = require('@playwright/test');
const { registerBatchHandlers } = require('../main/batch');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function successResult(target) {
    return {
        name: target.name || target.host,
        host: target.host,
        type: target.type,
        status: 'success',
        output: 'ok',
        error: null
    };
}

function createHarness(executeTarget, messages = []) {
    const ipcMain = new FakeIpcMain();
    const mainWindow = {
        isDestroyed: () => false,
        webContents: {
            send: (channel, payload) => messages.push({ channel, payload })
        }
    };
    registerBatchHandlers({
        getMainWindow: () => mainWindow,
        isQuitting: () => false
    }, { ipcMain, executeTarget });
    return ipcMain.handlers;
}

test.describe('batch execution state', () => {
    test('rejects re-entry and pause/stop mutate the active execution state', async () => {
        const deferred = createDeferred();
        let calls = 0;
        let activeState;
        const handlers = createHarness(async (target, commands, options, state) => {
            calls += 1;
            activeState = state;
            if (calls === 1) return deferred.promise;
            return successResult(target);
        });
        const params = {
            targets: [{ host: '192.0.2.10', type: 'cisco' }],
            commands: ['show version'],
            options: { parallel: false }
        };

        const firstRun = handlers.get('batch:execute')({}, params);
        await new Promise((resolve) => setImmediate(resolve));
        const secondRun = await handlers.get('batch:execute')({}, params);
        expect(secondRun).toEqual({ success: false, error: '已有批量任务正在执行' });
        expect(calls).toBe(1);

        await handlers.get('batch:pause')({}, true);
        await handlers.get('batch:stop')();
        expect(activeState.paused).toBe(true);
        expect(activeState.shouldStop).toBe(true);

        deferred.resolve(successResult(params.targets[0]));
        await expect(firstRun).resolves.toMatchObject({ success: true });
        expect(activeState).toMatchObject({ running: false, paused: false, shouldStop: false });

        await expect(handlers.get('batch:execute')({}, params)).resolves.toMatchObject({ success: true });
        expect(calls).toBe(2);
    });

    test('waits for every parallel target and converts unexpected rejection to a failed result', async () => {
        const slowTarget = createDeferred();
        const completed = [];
        const messages = [];
        const handlers = createHarness(async (target) => {
            if (target.host === '192.0.2.20') {
                throw new Error('unexpected executor failure');
            }
            const result = await slowTarget.promise;
            completed.push(target.host);
            return result;
        }, messages);
        const params = {
            targets: [
                { host: '192.0.2.20', type: 'cisco' },
                { host: '192.0.2.21', type: 'cisco' }
            ],
            commands: ['show version'],
            options: { parallel: true, parallelCount: 2 }
        };

        let runCompleted = false;
        const run = handlers.get('batch:execute')({}, params).then((result) => {
            runCompleted = true;
            return result;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(runCompleted).toBe(false);
        await expect(handlers.get('batch:execute')({}, params)).resolves.toMatchObject({
            success: false,
            error: '已有批量任务正在执行'
        });

        slowTarget.resolve(successResult(params.targets[1]));
        const result = await run;
        expect(completed).toEqual(['192.0.2.21']);
        expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });
        expect(result.results.find(item => item.host === '192.0.2.20')).toMatchObject({
            status: 'failed',
            error: 'unexpected executor failure'
        });
        expect(messages.filter(item => item.channel === 'batch:progress')).toEqual([
            {
                channel: 'batch:progress',
                payload: expect.objectContaining({
                    host: '192.0.2.20',
                    status: 'failed',
                    error: 'unexpected executor failure'
                })
            }
        ]);
    });
});
