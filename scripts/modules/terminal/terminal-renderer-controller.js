/**
 * Manages xterm WebGL lifecycle with bounded recovery attempts.
 */
(function initTerminalRendererController(globalScope) {
    function createTerminalRendererController(terminal, options = {}) {
        if (!terminal || typeof terminal.loadAddon !== 'function') {
            throw new TypeError('terminal with loadAddon() is required');
        }

        const createAddon = typeof options.createAddon === 'function'
            ? options.createAddon
            : () => new globalScope.WebglAddon.WebglAddon();
        const schedule = typeof options.schedule === 'function'
            ? options.schedule
            : (callback, delay) => setTimeout(callback, delay);
        const cancelSchedule = typeof options.cancelSchedule === 'function'
            ? options.cancelSchedule
            : (timer) => clearTimeout(timer);
        const onError = typeof options.onError === 'function'
            ? options.onError
            : (error) => console.warn('WebGL renderer unavailable, using canvas renderer', error);
        const maxRecoveryAttempts = Math.max(0, Number.isFinite(options.maxRecoveryAttempts)
            ? Math.floor(options.maxRecoveryAttempts)
            : 2);
        const recoveryDelayMs = Math.max(0, Number.isFinite(options.recoveryDelayMs)
            ? options.recoveryDelayMs
            : 250);

        let addon = null;
        let recoveryTimer = null;
        let recoveryAttempts = 0;
        let contextLosses = 0;
        let mode = 'canvas';
        let disposed = false;

        function disposeAddon(target) {
            if (!target || typeof target.dispose !== 'function') return;
            try {
                target.dispose();
            } catch (error) {
                onError(error);
            }
        }

        function loadWebgl() {
            if (disposed) return false;
            let candidate = null;
            try {
                candidate = createAddon();
                if (!candidate || typeof candidate.onContextLoss !== 'function') {
                    throw new TypeError('WebGL addon does not expose onContextLoss()');
                }
                candidate.onContextLoss(() => handleContextLoss(candidate));
                addon = candidate;
                terminal.loadAddon(candidate);
                mode = 'webgl';
                return true;
            } catch (error) {
                disposeAddon(candidate);
                addon = null;
                mode = 'canvas';
                onError(error);
                return false;
            }
        }

        function scheduleRecovery() {
            if (disposed || recoveryTimer || recoveryAttempts >= maxRecoveryAttempts) return;
            const attempt = ++recoveryAttempts;
            const delay = recoveryDelayMs * Math.pow(2, attempt - 1);
            recoveryTimer = schedule(() => {
                recoveryTimer = null;
                if (!loadWebgl()) scheduleRecovery();
            }, delay);
        }

        function handleContextLoss(lostAddon) {
            if (disposed || addon !== lostAddon) return;
            contextLosses++;
            addon = null;
            mode = 'canvas';
            disposeAddon(lostAddon);
            scheduleRecovery();
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (recoveryTimer) {
                cancelSchedule(recoveryTimer);
                recoveryTimer = null;
            }
            disposeAddon(addon);
            addon = null;
            mode = 'disposed';
        }

        loadWebgl();

        return {
            dispose,
            retry: () => {
                if (disposed || addon) return false;
                recoveryAttempts = 0;
                return loadWebgl();
            },
            getStats: () => ({
                mode,
                recoveryAttempts,
                contextLosses,
                recoveryScheduled: Boolean(recoveryTimer),
                disposed
            })
        };
    }

    function installTerminalRendererController(session, terminal, options = {}) {
        if (!session || !terminal) return null;
        if (session.terminalRendererController) return session.terminalRendererController;
        const controller = createTerminalRendererController(terminal, options);
        session.terminalRendererController = controller;
        return controller;
    }

    globalScope.createTerminalRendererController = createTerminalRendererController;
    globalScope.installTerminalRendererController = installTerminalRendererController;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            createTerminalRendererController
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
