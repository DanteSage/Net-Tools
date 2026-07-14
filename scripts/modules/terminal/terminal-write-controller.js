/**
 * Bounded xterm write scheduler with foreground/background watermarks.
 */
(function initTerminalWriteController(globalScope) {
    function getDataLength(data) {
        if (data === undefined || data === null) return 0;
        if (typeof data === 'string') return data.length;
        if (typeof data.byteLength === 'number') return data.byteLength;
        if (typeof data.length === 'number') return data.length;
        return String(data).length;
    }

    function createTerminalWriteController(rawWrite, options = {}) {
        if (typeof rawWrite !== 'function') {
            throw new TypeError('rawWrite must be a function');
        }

        const checkpointSize = Math.max(1, Number(options.checkpointSize) || 128 * 1024);
        const highWatermark = Math.max(1, Number(options.highWatermark) || 10);
        const lowWatermark = Math.max(0, Math.min(
            highWatermark - 1,
            Number.isFinite(options.lowWatermark) ? Number(options.lowWatermark) : 5
        ));
        const inactiveHighWatermark = Math.max(1, Math.min(
            highWatermark,
            Number(options.inactiveHighWatermark) || 3
        ));
        const inactiveLowWatermark = Math.max(0, Math.min(
            inactiveHighWatermark - 1,
            Number.isFinite(options.inactiveLowWatermark) ? Number(options.inactiveLowWatermark) : 1
        ));
        const onFlowControl = typeof options.onFlowControl === 'function'
            ? options.onFlowControl
            : () => {};
        const onError = typeof options.onError === 'function'
            ? options.onError
            : (error) => console.error('Terminal write failed:', error);

        let queue = [];
        let queueIndex = 0;
        let queuedLength = 0;
        let checkpointLength = 0;
        let pendingCheckpoints = 0;
        let paused = false;
        let active = options.active !== false;
        let disposed = false;
        let draining = false;
        let drainScheduled = false;

        function getWatermarks() {
            return active
                ? { high: highWatermark, low: lowWatermark }
                : { high: inactiveHighWatermark, low: inactiveLowWatermark };
        }

        function notifyFlowControl(nextPaused) {
            paused = Boolean(nextPaused);
            try {
                onFlowControl(paused);
            } catch (error) {
                onError(error);
            }
        }

        function reconcileFlowControl() {
            const watermarks = getWatermarks();
            if (pendingCheckpoints >= watermarks.high) {
                notifyFlowControl(true);
            } else if (paused && pendingCheckpoints <= watermarks.low) {
                notifyFlowControl(false);
            }
        }

        function scheduleDrain() {
            if (drainScheduled || disposed) return;
            drainScheduled = true;
            const schedule = typeof queueMicrotask === 'function'
                ? queueMicrotask
                : (callback) => Promise.resolve().then(callback);
            schedule(() => {
                drainScheduled = false;
                drain();
            });
        }

        function compactQueue() {
            if (queueIndex === 0) return;
            if (queueIndex >= queue.length) {
                queue = [];
                queueIndex = 0;
            } else if (queueIndex >= 64 && queueIndex >= queue.length / 2) {
                queue = queue.slice(queueIndex);
                queueIndex = 0;
            }
        }

        function completeCheckpoint(callback) {
            pendingCheckpoints = Math.max(0, pendingCheckpoints - 1);
            if (typeof callback === 'function') {
                try {
                    callback();
                } catch (error) {
                    onError(error);
                }
            }
            reconcileFlowControl();
            scheduleDrain();
        }

        function drain() {
            if (disposed || draining) return;
            draining = true;

            try {
                const watermarks = getWatermarks();
                while (queueIndex < queue.length && pendingCheckpoints < watermarks.high) {
                    const item = queue[queueIndex++];
                    queuedLength = Math.max(0, queuedLength - item.length);
                    checkpointLength += item.length;

                    const createCheckpoint = checkpointLength >= checkpointSize;
                    if (createCheckpoint) {
                        checkpointLength = 0;
                        pendingCheckpoints++;
                    }

                    const callback = createCheckpoint
                        ? () => completeCheckpoint(item.callback)
                        : item.callback;

                    try {
                        rawWrite(item.data, callback);
                    } catch (error) {
                        if (createCheckpoint) {
                            pendingCheckpoints = Math.max(0, pendingCheckpoints - 1);
                        }
                        onError(error);
                    }
                }

                compactQueue();
                reconcileFlowControl();
            } finally {
                draining = false;
            }
        }

        function write(data, callback) {
            if (disposed || data === undefined || data === null || data === '') return;
            const length = getDataLength(data);
            queue.push({ data, callback, length });
            queuedLength += length;
            notifyFlowControl(paused);
            drain();
        }

        function setActive(nextActive) {
            if (disposed) return;
            const normalized = Boolean(nextActive);
            if (active === normalized) return;
            active = normalized;
            reconcileFlowControl();
            scheduleDrain();
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            queue = [];
            queueIndex = 0;
            queuedLength = 0;
            notifyFlowControl(false);
        }

        return {
            write,
            setActive,
            dispose,
            refreshFlowControl: () => notifyFlowControl(paused),
            getStats: () => ({
                queuedLength,
                pendingCheckpoints,
                paused,
                active,
                disposed,
                watermarks: getWatermarks()
            })
        };
    }

    function installTerminalWriteController(session, terminal, options = {}) {
        if (!session || !terminal || typeof terminal.write !== 'function') return null;
        if (session.terminalWriteController) return session.terminalWriteController;

        const rawWrite = terminal.write.bind(terminal);
        let lastConnectionId = null;
        let lastPaused = false;

        const controller = createTerminalWriteController(rawWrite, {
            ...options,
            onFlowControl: (paused) => {
                const api = globalScope.api && globalScope.api.connection;
                const connectionId = session.connectionId || null;

                if (lastConnectionId && lastConnectionId !== connectionId && lastPaused && api) {
                    api.setTerminalOutputPaused(lastConnectionId, false);
                }
                if (connectionId && api && (connectionId !== lastConnectionId || paused !== lastPaused)) {
                    api.setTerminalOutputPaused(connectionId, paused);
                }

                lastConnectionId = connectionId;
                lastPaused = paused;
            }
        });

        terminal.write = (data, callback) => controller.write(data, callback);
        session.terminalWriteController = controller;
        return controller;
    }

    globalScope.createTerminalWriteController = createTerminalWriteController;
    globalScope.installTerminalWriteController = installTerminalWriteController;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            createTerminalWriteController
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
