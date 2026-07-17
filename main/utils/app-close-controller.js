const CLOSE_CONFIRMATION_CHANNEL = 'app:close-confirmed';
const CLOSE_REQUEST_CHANNEL = 'app:close-request';
const controllerRegistrations = new WeakMap();

function isLiveWindow(window) {
    return !!window
        && typeof window.close === 'function'
        && typeof window.on === 'function'
        && typeof window.once === 'function'
        && !(typeof window.isDestroyed === 'function' && window.isDestroyed());
}

function hasUsableWebContents(window) {
    return isLiveWindow(window)
        && !!window.webContents
        && !(typeof window.webContents.isDestroyed === 'function'
            && window.webContents.isDestroyed());
}

function createAppCloseController(options) {
    const { ipcMain, getIsQuitting } = options;
    const schedule = typeof options.schedule === 'function' ? options.schedule : setImmediate;

    if (!ipcMain || typeof ipcMain.on !== 'function') {
        throw new TypeError('ipcMain is required');
    }
    if (typeof getIsQuitting !== 'function') {
        throw new TypeError('getIsQuitting is required');
    }

    let pendingRequest = null;
    let nextRequestId = 1;
    const attachedWindows = new WeakSet();
    const approvedWindows = new WeakSet();
    const scheduledWindows = new WeakSet();
    const unavailableRendererWindows = new WeakSet();

    function hasAvailableRenderer(window) {
        return hasUsableWebContents(window) && !unavailableRendererWindows.has(window);
    }

    function isMainFrameLoading(window) {
        return hasUsableWebContents(window)
            && typeof window.webContents.isLoadingMainFrame === 'function'
            && window.webContents.isLoadingMainFrame();
    }

    function canRequestConfirmation(window) {
        return hasAvailableRenderer(window) && !isMainFrameLoading(window);
    }

    function clearPendingWindow(window) {
        if (!pendingRequest || (window && pendingRequest.window !== window)) {
            return false;
        }
        pendingRequest = null;
        return true;
    }

    function closeApproved(window) {
        if (!isLiveWindow(window)) {
            return false;
        }

        approvedWindows.add(window);
        try {
            window.close();
            return true;
        } catch (_) {
            return false;
        } finally {
            approvedWindows.delete(window);
        }
    }

    function scheduleApprovedClose(window) {
        if (!isLiveWindow(window) || scheduledWindows.has(window)) {
            return false;
        }

        scheduledWindows.add(window);
        schedule(() => {
            scheduledWindows.delete(window);
            clearPendingWindow(window);
            closeApproved(window);
        });
        return true;
    }

    function handleRendererUnavailable(window) {
        unavailableRendererWindows.add(window);
        if (clearPendingWindow(window)) {
            scheduleApprovedClose(window);
        }
    }

    function handleConfirmation(event, response) {
        if (!response || typeof response !== 'object' || Array.isArray(response)) {
            return false;
        }

        const { confirmed, requestId } = response;
        if (confirmed !== true && confirmed !== false) {
            return false;
        }
        if (!Number.isSafeInteger(requestId) || requestId <= 0) {
            return false;
        }

        const request = pendingRequest;
        if (!request || !isLiveWindow(request.window)) {
            pendingRequest = null;
            return false;
        }
        if (!hasAvailableRenderer(request.window)) {
            pendingRequest = null;
            scheduleApprovedClose(request.window);
            return false;
        }
        if (isMainFrameLoading(request.window)) {
            pendingRequest = null;
            return false;
        }
        if (!event
            || event.sender !== request.window.webContents
            || requestId !== request.requestId) {
            return false;
        }

        pendingRequest = null;
        if (confirmed === false) {
            return true;
        }

        return closeApproved(request.window);
    }

    ipcMain.on(CLOSE_CONFIRMATION_CHANNEL, handleConfirmation);

    function attachWindow(window) {
        if (!hasUsableWebContents(window) || attachedWindows.has(window)) {
            return false;
        }
        attachedWindows.add(window);

        window.on('close', event => {
            if (getIsQuitting()
                || approvedWindows.has(window)
                || scheduledWindows.has(window)) {
                return;
            }

            if (!canRequestConfirmation(window)) {
                clearPendingWindow(window);
                return;
            }

            event.preventDefault();
            if (pendingRequest && pendingRequest.window === window) {
                return;
            }
            if (pendingRequest && canRequestConfirmation(pendingRequest.window)) {
                return;
            }

            pendingRequest = null;
            const requestId = nextRequestId;
            nextRequestId = nextRequestId === Number.MAX_SAFE_INTEGER
                ? 1
                : nextRequestId + 1;
            pendingRequest = { window, requestId };
            try {
                window.webContents.send(CLOSE_REQUEST_CHANNEL, requestId);
            } catch (_) {
                unavailableRendererWindows.add(window);
                clearPendingWindow(window);
                scheduleApprovedClose(window);
            }
        });

        if (typeof window.webContents.once === 'function') {
            window.webContents.once('destroyed', () => {
                handleRendererUnavailable(window);
            });
        }
        if (typeof window.webContents.on === 'function') {
            window.webContents.on('render-process-gone', () => {
                handleRendererUnavailable(window);
            });
            window.webContents.on('did-start-navigation', (
                _event,
                _url,
                isInPlace,
                isMainFrame
            ) => {
                if (isMainFrame && !isInPlace) {
                    clearPendingWindow(window);
                }
            });
            window.webContents.on('did-finish-load', () => {
                unavailableRendererWindows.delete(window);
            });
        }

        window.once('closed', () => {
            clearPendingWindow(window);
            approvedWindows.delete(window);
            scheduledWindows.delete(window);
            unavailableRendererWindows.delete(window);
        });
        return true;
    }

    return {
        attachWindow,
        clearPendingWindow,
        getPendingWindow: () => pendingRequest && pendingRequest.window,
        handleConfirmation
    };
}

function registerAppCloseController(options) {
    const ipc = options.ipcMain;
    const existingController = controllerRegistrations.get(ipc);
    if (existingController) {
        return existingController;
    }

    const controller = createAppCloseController(options);
    controllerRegistrations.set(ipc, controller);
    return controller;
}

module.exports = {
    CLOSE_CONFIRMATION_CHANNEL,
    CLOSE_REQUEST_CHANNEL,
    createAppCloseController,
    registerAppCloseController
};
