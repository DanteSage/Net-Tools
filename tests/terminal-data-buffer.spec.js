const { test, expect } = require('@playwright/test');
const { createTerminalDataBuffer } = require('../main/connections/terminal-data-buffer');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('terminal data buffer', () => {
    test('coalesces small chunks within the flush window', async () => {
        const sent = [];
        const buffer = createTerminalDataBuffer((data) => sent.push(data), {
            flushDelayMs: 10,
            maxBatchChars: 1024
        });

        try {
            buffer.push('hello');
            buffer.push(' ');
            buffer.push('world');

            expect(sent).toEqual([]);
            await delay(30);
            expect(sent).toEqual(['hello world']);
        } finally {
            buffer.dispose(false);
        }
    });

    test('flushes immediately when the batch threshold is reached', () => {
        const sent = [];
        const buffer = createTerminalDataBuffer((data) => sent.push(data), {
            flushDelayMs: 1000,
            maxBatchChars: 5
        });

        buffer.push('ab');
        buffer.push('cde');

        expect(sent).toEqual(['abcde']);
        expect(buffer.pendingLength).toBe(0);
        buffer.dispose(false);
    });

    test('flushes pending output before disposal and ignores later pushes', () => {
        const sent = [];
        const buffer = createTerminalDataBuffer((data) => sent.push(data), {
            flushDelayMs: 1000
        });

        buffer.push('tail');
        buffer.dispose(true);
        buffer.push('ignored');

        expect(sent).toEqual(['tail']);
        expect(buffer.pendingLength).toBe(0);
    });

    test('preserves output order across explicit flushes', () => {
        const sent = [];
        const buffer = createTerminalDataBuffer((data) => sent.push(data), {
            flushDelayMs: 1000
        });

        buffer.push('first');
        buffer.flush();
        buffer.push('-second');
        buffer.dispose(true);

        expect(sent).toEqual(['first', '-second']);
    });
});
