const { test, expect } = require('@playwright/test');
const {
    createTerminalWriteController
} = require('../scripts/modules/terminal/terminal-write-controller');

function flushMicrotasks() {
    return Promise.resolve().then(() => Promise.resolve());
}

test.describe('terminal write controller', () => {
    test('pauses at the high watermark and resumes below the low watermark', async () => {
        const writes = [];
        const flowStates = [];
        const controller = createTerminalWriteController((data, callback) => {
            writes.push({ data, callback });
        }, {
            checkpointSize: 4,
            highWatermark: 2,
            lowWatermark: 1,
            onFlowControl: (paused) => flowStates.push(paused)
        });

        controller.write('aaaa');
        controller.write('bbbb');
        controller.write('cccc');

        expect(writes.map((item) => item.data)).toEqual(['aaaa', 'bbbb']);
        expect(controller.getStats()).toMatchObject({
            queuedLength: 4,
            pendingCheckpoints: 2,
            paused: true
        });

        writes[0].callback();
        await flushMicrotasks();

        expect(writes.map((item) => item.data)).toEqual(['aaaa', 'bbbb', 'cccc']);
        expect(controller.getStats().paused).toBe(true);

        writes[1].callback();
        await flushMicrotasks();

        expect(controller.getStats().paused).toBe(false);
        expect(flowStates).toContain(true);
        expect(flowStates.at(-1)).toBe(false);
    });

    test('preserves a caller callback on a checkpoint write', () => {
        let parserCallback;
        let callbackCount = 0;
        const controller = createTerminalWriteController((data, callback) => {
            parserCallback = callback;
        }, { checkpointSize: 1 });

        controller.write('x', () => callbackCount++);
        expect(callbackCount).toBe(0);
        parserCallback();
        expect(callbackCount).toBe(1);
    });

    test('drops queued data and releases flow control when disposed', () => {
        const writes = [];
        const flowStates = [];
        const controller = createTerminalWriteController((data, callback) => {
            writes.push({ data, callback });
        }, {
            checkpointSize: 1,
            highWatermark: 1,
            lowWatermark: 0,
            onFlowControl: (paused) => flowStates.push(paused)
        });

        controller.write('first');
        controller.write('queued');
        controller.dispose();

        expect(writes.map((item) => item.data)).toEqual(['first']);
        expect(controller.getStats()).toMatchObject({
            queuedLength: 0,
            paused: false,
            disposed: true
        });
        expect(flowStates.at(-1)).toBe(false);
    });

    test('uses a smaller parser window for inactive terminals', async () => {
        const writes = [];
        const controller = createTerminalWriteController((data, callback) => {
            writes.push({ data, callback });
        }, {
            checkpointSize: 1,
            highWatermark: 4,
            lowWatermark: 2,
            inactiveHighWatermark: 2,
            inactiveLowWatermark: 0,
            active: false
        });

        controller.write('a');
        controller.write('b');
        controller.write('c');

        expect(writes.map((item) => item.data)).toEqual(['a', 'b']);
        expect(controller.getStats()).toMatchObject({
            queuedLength: 1,
            pendingCheckpoints: 2,
            paused: true,
            active: false,
            watermarks: { high: 2, low: 0 }
        });

        controller.setActive(true);
        await flushMicrotasks();

        expect(writes.map((item) => item.data)).toEqual(['a', 'b', 'c']);
        expect(controller.getStats()).toMatchObject({
            paused: false,
            active: true,
            watermarks: { high: 4, low: 2 }
        });
    });

});
