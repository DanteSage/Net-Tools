const { EventEmitter, once } = require('events');
const http = require('http');
const net = require('net');
const { test, expect } = require('@playwright/test');
const {
    attachSpeedTestRequestLifecycle,
    sendRandomData,
    handleEmptyRequest,
    createSpeedTestApp,
    listenSpeedTestApp,
    startSpeedTestServer,
    stopSpeedTestServer,
    registerSpeedTestHandlers
} = require('../main/tools/speedtest');

class FakeRequest extends EventEmitter {
    constructor(method = 'GET') {
        super();
        this.method = method;
        this.aborted = false;
        this.destroyed = false;
        this.complete = method === 'GET';
    }
}

class FakeResponse extends EventEmitter {
    constructor(writeResults = []) {
        super();
        this.locals = {};
        this.destroyed = false;
        this.writableEnded = false;
        this.writeResults = [...writeResults];
        this.writeCalls = 0;
        this.endCalls = 0;
        this.destroyCalls = 0;
        this.statusCode = null;
    }

    write() {
        this.writeCalls += 1;
        return this.writeResults.length ? this.writeResults.shift() : true;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    end() {
        this.endCalls += 1;
        this.writableEnded = true;
    }

    destroy() {
        this.destroyCalls += 1;
        this.destroyed = true;
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

test.describe('Speed test HTTP error handling', () => {
    test('consumes request and response errors without throwing', () => {
        const request = new FakeRequest('POST');
        const response = new FakeResponse();
        const errors = [];
        const lifecycle = attachSpeedTestRequestLifecycle(request, response, (scope, error) => {
            errors.push(`${scope}: ${error.message}`);
        });

        expect(request.listenerCount('error')).toBeGreaterThan(0);
        expect(response.listenerCount('error')).toBeGreaterThan(0);
        expect(() => request.emit('error', new Error('request reset'))).not.toThrow();
        expect(() => response.emit('error', new Error('write EPIPE'))).not.toThrow();
        expect(lifecycle.isClosed()).toBe(true);
        expect(errors).toEqual([
            '请求错误: request reset',
            '响应错误: write EPIPE'
        ]);
    });

    test('stops a backpressured download after response close or error', () => {
        for (const termination of ['close', 'error']) {
            const request = new FakeRequest();
            const response = new FakeResponse([false, true]);
            sendRandomData(request, response, 2, {
                chunkSize: 1,
                randomBytes: size => Buffer.alloc(size),
                onError: () => {}
            });

            expect(response.writeCalls, termination).toBe(1);
            expect(response.listenerCount('drain'), termination).toBe(1);

            if (termination === 'close') {
                response.destroyed = true;
                response.emit('close');
            } else {
                expect(() => response.emit('error', new Error('write EPIPE'))).not.toThrow();
            }
            response.emit('drain');

            expect(response.writeCalls, termination).toBe(1);
            expect(response.endCalls, termination).toBe(0);
            expect(response.listenerCount('drain'), termination).toBe(0);
        }
    });

    test('continues after drain and ends a healthy download once', () => {
        const request = new FakeRequest();
        const response = new FakeResponse([false, true]);
        sendRandomData(request, response, 2, {
            chunkSize: 1,
            randomBytes: size => Buffer.alloc(size)
        });

        response.emit('drain');
        response.emit('drain');

        expect(response.writeCalls).toBe(2);
        expect(response.endCalls).toBe(1);
    });

    test('destroys the response when generation or write throws', () => {
        for (const failure of ['generation', 'write']) {
            const request = new FakeRequest();
            const response = new FakeResponse();
            const errors = [];
            if (failure === 'write') {
                response.write = () => {
                    throw new Error('response write failed');
                };
            }

            sendRandomData(request, response, 1, {
                chunkSize: 1,
                randomBytes: () => {
                    if (failure === 'generation') throw new Error('random source failed');
                    return Buffer.alloc(1);
                },
                onError: (scope, error) => errors.push(`${scope}: ${error.message}`)
            });

            response.emit('drain');
            expect(response.destroyCalls, failure).toBe(1);
            expect(response.endCalls, failure).toBe(0);
            expect(errors, failure).toEqual([
                `下载响应写入错误: ${failure === 'generation' ? 'random source failed' : 'response write failed'}`
            ]);
        }
    });

    test('does not answer an upload after request abort or error', () => {
        for (const eventName of ['aborted', 'error']) {
            const request = new FakeRequest('POST');
            const response = new FakeResponse();
            handleEmptyRequest(request, response, () => {});

            if (eventName === 'aborted') {
                request.aborted = true;
                request.emit('aborted');
            } else {
                request.emit('error', new Error('upload failed'));
            }
            request.complete = true;
            request.emit('end');

            expect(response.endCalls, eventName).toBe(0);
        }
    });

    test('consumes listener errors and reports synchronous listen failures', () => {
        const server = new EventEmitter();
        server.listening = false;
        const errors = [];
        const listening = [];
        const app = { listen: () => server };

        expect(listenSpeedTestApp(app, {
            port: 8888,
            onError: error => errors.push(error.code || error.message),
            onListening: () => listening.push(true)
        })).toBe(server);
        expect(server.listenerCount('error')).toBeGreaterThan(0);
        expect(() => server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' })))
            .not.toThrow();
        server.listening = true;
        server.emit('listening');
        expect(errors).toEqual(['EADDRINUSE']);
        expect(listening).toEqual([true]);

        const syncErrors = [];
        const failed = listenSpeedTestApp({
            listen: () => {
                throw new Error('listen failed synchronously');
            }
        }, { onError: error => syncErrors.push(error.message) });
        expect(failed).toBeNull();
        expect(syncErrors).toEqual(['listen failed synchronously']);
    });

    test('consumes a real EADDRINUSE listener error', async () => {
        const blocker = net.createServer();
        blocker.listen(0, '127.0.0.1');
        await once(blocker, 'listening');

        const errors = [];
        const app = createSpeedTestApp({ onError: () => {} });
        const failedServer = listenSpeedTestApp(app, {
            port: blocker.address().port,
            host: '127.0.0.1',
            onError: error => errors.push(error.code)
        });

        try {
            await once(failedServer, 'error');
            expect(errors).toEqual(['EADDRINUSE']);
            expect(failedServer.listening).toBe(false);
        } finally {
            await new Promise(resolve => blocker.close(resolve));
        }
    });

    test('keeps a normal download intact when the request close event is normal', async () => {
        const app = createSpeedTestApp({ onError: () => {} });
        const server = listenSpeedTestApp(app, {
            port: 0,
            host: '127.0.0.1'
        });
        await once(server, 'listening');

        try {
            const receivedBytes = await new Promise((resolve, reject) => {
                http.get({
                    host: '127.0.0.1',
                    port: server.address().port,
                    path: '/backend/garbage.php?ckSize=1'
                }, response => {
                    let size = 0;
                    response.on('data', chunk => {
                        size += chunk.length;
                    });
                    response.on('end', () => resolve(size));
                    response.on('error', reject);
                }).on('error', reject);
            });

            expect(receivedBytes).toBe(1024 * 1024);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('answers JSON, empty and binary upload requests', async () => {
        const app = createSpeedTestApp({ onError: () => {} });
        const server = listenSpeedTestApp(app, {
            port: 0,
            host: '127.0.0.1'
        });
        await once(server, 'listening');

        const post = (body, contentType) => new Promise((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1',
                port: server.address().port,
                path: '/backend/empty.php',
                method: 'POST',
                headers: {
                    'Content-Length': body.length,
                    ...(contentType ? { 'Content-Type': contentType } : {})
                }
            }, response => {
                response.resume();
                response.on('end', () => resolve(response.statusCode));
                response.on('error', reject);
            });
            request.on('error', reject);
            request.end(body);
        });

        try {
            await expect(post(Buffer.from('{}'), 'application/json')).resolves.toBe(200);
            await expect(post(Buffer.alloc(0))).resolves.toBe(200);
            await expect(post(Buffer.alloc(1024), 'application/octet-stream')).resolves.toBe(200);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('waits for the listener and does not create a window after startup failure', async () => {
        const ipcMain = new FakeIpcMain();
        let createCalls = 0;
        registerSpeedTestHandlers({}, {
            ipcMain,
            startSpeedTestServer: async () => {
                throw new Error('listen EADDRINUSE');
            },
            stopSpeedTestServer: async () => {},
            createSpeedTestWindow: () => {
                createCalls += 1;
            }
        });

        await expect(ipcMain.handlers.get('speedtest:open')()).rejects.toThrow('listen EADDRINUSE');
        expect(createCalls).toBe(0);
    });

    test('stops the server when tool window creation fails', async () => {
        const ipcMain = new FakeIpcMain();
        let stopCalls = 0;
        registerSpeedTestHandlers({}, {
            ipcMain,
            startSpeedTestServer: async () => {},
            stopSpeedTestServer: async () => {
                stopCalls += 1;
            },
            createSpeedTestWindow: () => {
                throw new Error('window creation failed');
            }
        });

        await expect(ipcMain.handlers.get('speedtest:open')()).rejects.toThrow('window creation failed');
        expect(stopCalls).toBe(1);
    });

    test('restarts after stop is requested during startup', async () => {
        const firstStart = startSpeedTestServer({ port: 0, host: '127.0.0.1' });
        const firstOutcome = firstStart.then(
            () => 'started',
            error => `rejected: ${error.message}`
        );
        const stopping = stopSpeedTestServer();
        const restart = startSpeedTestServer({ port: 0, host: '127.0.0.1' });

        try {
            await expect(firstOutcome).resolves.toContain('启动已取消');
            await expect(stopping).resolves.toBeUndefined();
            const restartedServer = await restart;
            expect(restartedServer.listening).toBe(true);
            expect(restartedServer.address().port).toBeGreaterThan(0);
        } finally {
            await stopSpeedTestServer();
        }
    });

    test('coalesces concurrent open requests into one window', async () => {
        const ipcMain = new FakeIpcMain();
        let releaseStart;
        const startGate = new Promise(resolve => {
            releaseStart = resolve;
        });
        let createCalls = 0;
        const createdWindows = [];
        registerSpeedTestHandlers({}, {
            ipcMain,
            startSpeedTestServer: () => startGate,
            stopSpeedTestServer: async () => {},
            createSpeedTestWindow: () => {
                createCalls += 1;
                const win = new EventEmitter();
                win.isDestroyed = () => false;
                win.focus = () => {};
                win.webContents = new EventEmitter();
                win.webContents.send = () => {};
                createdWindows.push(win);
                return { win };
            }
        });

        const handler = ipcMain.handlers.get('speedtest:open');
        const firstOpen = handler();
        const secondOpen = handler();
        releaseStart();

        await expect(firstOpen).resolves.toEqual({ success: true });
        await expect(secondOpen).resolves.toEqual({ success: true });
        expect(createCalls).toBe(1);

        createdWindows[0].emit('closed');
    });

    test('rechecks an existing window after an awaited restart', async () => {
        const ipcMain = new FakeIpcMain();
        const createdWindows = [];
        let startCalls = 0;
        let releaseRestart;
        const restartGate = new Promise(resolve => {
            releaseRestart = resolve;
        });
        let stopCalls = 0;

        registerSpeedTestHandlers({}, {
            ipcMain,
            startSpeedTestServer: () => {
                startCalls += 1;
                return startCalls === 2 ? restartGate : Promise.resolve();
            },
            stopSpeedTestServer: async () => {
                stopCalls += 1;
            },
            createSpeedTestWindow: () => {
                const win = new EventEmitter();
                win.destroyed = false;
                win.isDestroyed = () => win.destroyed;
                win.focus = () => {};
                win.webContents = new EventEmitter();
                win.webContents.send = () => {};
                createdWindows.push(win);
                return { win };
            }
        });

        const handler = ipcMain.handlers.get('speedtest:open');
        await handler();
        const reopen = handler();
        createdWindows[0].destroyed = true;
        createdWindows[0].emit('closed');
        releaseRestart();

        await expect(reopen).resolves.toEqual({ success: true });
        expect(createdWindows).toHaveLength(2);
        expect(startCalls).toBe(3);
        expect(stopCalls).toBe(1);

        createdWindows[0].emit('closed');
        expect(stopCalls).toBe(1);
        createdWindows[1].destroyed = true;
        createdWindows[1].emit('closed');
    });
});
