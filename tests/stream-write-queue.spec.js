const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    createStreamWriteQueue
} = require('../main/connections/stream-write-queue');

function nextImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

class FakeWritable extends EventEmitter {
    constructor(results = []) {
        super();
        this.results = results;
        this.writes = [];
    }

    write(chunk, callback) {
        this.writes.push({ chunk: Buffer.from(chunk), callback });
        return this.results.length > 0 ? this.results.shift() : true;
    }
}

test.describe('stream write queue', () => {
    test('chunks data and waits for drain after write returns false', async () => {
        const stream = new FakeWritable([false, true, true]);
        const queue = createStreamWriteQueue(stream, {
            chunkSize: 4,
            maxChunksPerTick: 8
        });
        const completed = queue.enqueue(Buffer.from('abcdefghij'));

        expect(stream.writes.map((item) => item.chunk.toString())).toEqual(['abcd']);
        expect(queue.getStats().waitingDrain).toBe(true);

        stream.writes[0].callback();
        stream.emit('drain');
        await nextImmediate();

        expect(stream.writes.map((item) => item.chunk.toString())).toEqual([
            'abcd',
            'efgh',
            'ij'
        ]);
        stream.writes[1].callback();
        stream.writes[2].callback();
        await completed;
        expect(queue.getStats().pendingRequests).toBe(0);
    });

    test('preserves request order', async () => {
        const stream = new FakeWritable();
        const queue = createStreamWriteQueue(stream, { chunkSize: 3 });
        const first = queue.enqueue('abcdef');
        const second = queue.enqueue('XYZ');

        expect(stream.writes.map((item) => item.chunk.toString())).toEqual([
            'abc',
            'def',
            'XYZ'
        ]);
        for (const write of stream.writes) write.callback();
        await Promise.all([first, second]);
    });

    test('paces single-byte writes when a chunk delay is configured', async () => {
        const stream = new FakeWritable();
        const queue = createStreamWriteQueue(stream, {
            chunkSize: 1,
            maxChunksPerTick: 1,
            chunkDelayMs: 15
        });
        const completed = queue.enqueue('abc');

        expect(stream.writes.map((item) => item.chunk.toString())).toEqual(['a']);
        stream.writes[0].callback();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(stream.writes).toHaveLength(1);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stream.writes.map((item) => item.chunk.toString())).toEqual(['a', 'b']);
        stream.writes[1].callback();

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stream.writes.map((item) => item.chunk.toString())).toEqual(['a', 'b', 'c']);
        stream.writes[2].callback();
        await completed;
    });

    test('rejects pending input if the stream closes', async () => {
        const stream = new FakeWritable([false]);
        const queue = createStreamWriteQueue(stream, { chunkSize: 4 });
        const pending = queue.enqueue('abcdefgh');

        stream.emit('close');
        await expect(pending).rejects.toThrow('Stream closed');
        expect(queue.getStats().disposed).toBe(true);
    });
});
