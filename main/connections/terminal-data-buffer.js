/**
 * Coalesces small terminal output chunks before they cross Electron IPC.
 * The short delay keeps interactive output responsive while avoiding an IPC
 * message and xterm write for every tiny network packet.
 */
function createTerminalDataBuffer(send, options = {}) {
    if (typeof send !== 'function') {
        throw new TypeError('send must be a function');
    }

    const flushDelayMs = Number.isFinite(options.flushDelayMs)
        ? Math.max(0, options.flushDelayMs)
        : 8;
    const maxBatchChars = Number.isFinite(options.maxBatchChars)
        ? Math.max(1, options.maxBatchChars)
        : 32 * 1024;

    let chunks = [];
    let pendingLength = 0;
    let flushTimer = null;
    let disposed = false;

    function clearFlushTimer() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    }

    function flush() {
        clearFlushTimer();
        if (disposed || pendingLength === 0) return false;

        const data = chunks.length === 1 ? chunks[0] : chunks.join('');
        chunks = [];
        pendingLength = 0;
        send(data);
        return true;
    }

    function scheduleFlush() {
        if (flushTimer || disposed) return;
        flushTimer = setTimeout(flush, flushDelayMs);
    }

    function push(data) {
        if (disposed || data === undefined || data === null || data === '') return;

        const text = typeof data === 'string' ? data : String(data);
        chunks.push(text);
        pendingLength += text.length;

        if (pendingLength >= maxBatchChars) {
            flush();
        } else {
            scheduleFlush();
        }
    }

    function dispose(flushPending = true) {
        if (disposed) return;
        if (flushPending) flush();
        clearFlushTimer();
        chunks = [];
        pendingLength = 0;
        disposed = true;
    }

    return {
        push,
        flush,
        dispose,
        get pendingLength() {
            return pendingLength;
        }
    };
}

module.exports = {
    createTerminalDataBuffer
};
