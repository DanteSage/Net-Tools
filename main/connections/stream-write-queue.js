const streamQueues = new WeakMap();

function normalizeBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return Buffer.from(String(data));
}

function createStreamWriteQueue(stream, options = {}) {
    if (!stream || typeof stream.write !== 'function') {
        throw new TypeError('stream must be writable');
    }

    const chunkSize = Math.max(1, Number(options.chunkSize) || 16 * 1024);
    const maxChunksPerTick = Math.max(1, Number(options.maxChunksPerTick) || 16);
    const chunkDelayMs = Math.max(0, Number(options.chunkDelayMs) || 0);
    const onDispose = typeof options.onDispose === 'function' ? options.onDispose : () => {};

    let queue = [];
    let pendingRequests = new Set();
    let scheduled = false;
    let pumping = false;
    let waitingDrain = false;
    let disposed = false;
    let disposeError = null;

    function settleRequest(request, error) {
        if (request.settled) return;
        request.settled = true;
        pendingRequests.delete(request);
        if (error) request.reject(error);
        else request.resolve();
    }

    function maybeCompleteRequest(request) {
        if (request.fullyScheduled && request.pendingCallbacks === 0) {
            settleRequest(request, null);
        }
    }

    function handleWriteCallback(request, error) {
        request.pendingCallbacks = Math.max(0, request.pendingCallbacks - 1);
        if (error) {
            dispose(error);
            return;
        }
        maybeCompleteRequest(request);
    }

    function handleDrain() {
        waitingDrain = false;
        schedulePump(chunkDelayMs);
    }

    function handleClose() {
        dispose(new Error('Stream closed before queued terminal input was written'));
    }

    function handleError(error) {
        dispose(error instanceof Error ? error : new Error(String(error)));
    }

    function schedulePump(delayMs = 0) {
        if (scheduled || disposed || waitingDrain) return;
        scheduled = true;
        const schedule = delayMs > 0
            ? (callback) => setTimeout(callback, delayMs)
            : setImmediate;
        schedule(() => {
            scheduled = false;
            pump();
        });
    }

    function pump() {
        if (disposed || pumping || waitingDrain) return;
        pumping = true;
        let chunksWritten = 0;

        try {
            while (queue.length > 0 && !waitingDrain && chunksWritten < maxChunksPerTick) {
                const request = queue[0];
                if (request.offset >= request.buffer.length) {
                    queue.shift();
                    request.fullyScheduled = true;
                    maybeCompleteRequest(request);
                    continue;
                }

                const end = Math.min(request.buffer.length, request.offset + chunkSize);
                const chunk = request.buffer.subarray(request.offset, end);
                request.offset = end;
                request.pendingCallbacks++;

                let accepted;
                try {
                    accepted = stream.write(chunk, (error) => handleWriteCallback(request, error));
                } catch (error) {
                    request.pendingCallbacks = Math.max(0, request.pendingCallbacks - 1);
                    dispose(error);
                    break;
                }

                chunksWritten++;
                if (request.offset >= request.buffer.length) {
                    queue.shift();
                    request.fullyScheduled = true;
                    maybeCompleteRequest(request);
                }

                if (!accepted) {
                    waitingDrain = true;
                    stream.once('drain', handleDrain);
                }
            }
        } finally {
            pumping = false;
        }

        if (queue.length > 0 && !waitingDrain) schedulePump(chunkDelayMs);
    }

    function enqueue(data) {
        if (disposed) {
            return Promise.reject(disposeError || new Error('Stream write queue is disposed'));
        }

        const buffer = normalizeBuffer(data);
        if (buffer.length === 0) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const request = {
                buffer,
                offset: 0,
                pendingCallbacks: 0,
                fullyScheduled: false,
                settled: false,
                resolve,
                reject
            };
            queue.push(request);
            pendingRequests.add(request);
            pump();
        });
    }

    function dispose(error = new Error('Stream write queue disposed')) {
        if (disposed) return;
        disposed = true;
        disposeError = error;
        if (waitingDrain) stream.removeListener('drain', handleDrain);
        stream.removeListener('close', handleClose);
        stream.removeListener('error', handleError);
        queue = [];
        for (const request of pendingRequests) settleRequest(request, error);
        pendingRequests = new Set();
        onDispose();
    }

    stream.once('close', handleClose);
    stream.once('error', handleError);

    return {
        enqueue,
        dispose,
        getStats: () => ({
            queuedRequests: queue.length,
            pendingRequests: pendingRequests.size,
            waitingDrain,
            chunkDelayMs,
            disposed
        })
    };
}

function getStreamWriteQueue(stream, options = {}) {
    let queue = streamQueues.get(stream);
    if (!queue) {
        queue = createStreamWriteQueue(stream, {
            ...options,
            onDispose: () => streamQueues.delete(stream)
        });
        streamQueues.set(stream, queue);
    }
    return queue;
}

async function writeStreamWithBackpressure(stream, data, options = {}) {
    const queue = getStreamWriteQueue(stream, options);
    await queue.enqueue(data);
}

module.exports = {
    createStreamWriteQueue,
    getStreamWriteQueue,
    writeStreamWithBackpressure
};
