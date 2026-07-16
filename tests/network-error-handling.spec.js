const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('events');
const net = require('net');
const { Writable } = require('stream');
const dhcp = require('dhcp');

const { registerSSHHandlers } = require('../main/connections/ssh');
const {
    encodeString,
    setConnectionEncoding
} = require('../main/connections/encoding-manager');
const { executeSSHTarget } = require('../main/batch/executor');
const FtpServerBackend = require('../main/tools/ftp-server-backend');
const {
    attachSnmpErrorHandler,
    createSnmpSession
} = require('../main/tools/reconnaissance');
const DhcpServerBackend = require('../main/tools/dhcp-server-backend');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
        this.listeners = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    on(channel, handler) {
        this.listeners.set(channel, handler);
    }
}

function createSSHHandlerHarness(connectionId, connection, dependencies = {}) {
    const ipcMain = new FakeIpcMain();
    const activeConnections = new Map();
    if (connectionId && connection) {
        activeConnections.set(connectionId, connection);
    }
    const messages = [];
    const mainWindow = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (channel, payload) => messages.push({ channel, payload })
        }
    };

    registerSSHHandlers({
        activeConnections,
        getMainWindow: () => mainWindow,
        isQuitting: () => false
    }, { ipcMain, ...dependencies });

    return { activeConnections, handlers: ipcMain.handlers, messages };
}

function waitFor(predicate, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - startedAt >= timeout) {
                clearInterval(timer);
                reject(new Error('等待测试条件超时'));
            }
        }, 10);
    });
}

test.describe('network error handling', () => {
    test('passive SSH disconnect clears the client, shell, SFTP and encoding once', async () => {
        const stream = new EventEmitter();
        stream.destroyed = false;
        stream.writable = true;
        stream.destroy = () => { stream.destroyed = true; };
        let client;

        class FakeClient extends EventEmitter {
            constructor() {
                super();
                this.endCalls = 0;
                client = this;
            }

            connect() {
                queueMicrotask(() => this.emit('ready'));
            }

            setNoDelay() {}

            shell(windowOptions, shellOptions, callback) {
                callback(null, stream);
            }

            end() {
                this.endCalls += 1;
            }
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const connected = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.20',
            username: 'admin'
        });
        const shell = await harness.handlers.get('ssh:shell')({}, {
            connectionId: connected.connectionId,
            cols: 120,
            rows: 40
        });
        harness.activeConnections.set(`${connected.connectionId}_sftp`, {});
        setConnectionEncoding(connected.connectionId, 'latin1');
        expect(encodeString(connected.connectionId, '\u00e9')).toEqual(Buffer.from([0xe9]));

        client.emit('error', new Error('socket reset'));
        client.emit('end');
        client.emit('close');
        stream.emit('close');

        expect(connected.success).toBe(true);
        expect(shell.success).toBe(true);
        expect(harness.activeConnections.has(connected.connectionId)).toBe(false);
        expect(harness.activeConnections.has(`${connected.connectionId}_shell`)).toBe(false);
        expect(harness.activeConnections.has(`${connected.connectionId}_sftp`)).toBe(false);
        expect(encodeString(connected.connectionId, '\u00e9')).toEqual(Buffer.from([0xc3, 0xa9]));
        expect(client.endCalls).toBe(1);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([
            {
                channel: 'ssh:close',
                payload: {
                    connectionId: connected.connectionId,
                    error: 'socket reset'
                }
            }
        ]);
    });

    test('SSH failure before ready does not create a connection or report a disconnect', async () => {
        class FakeClient extends EventEmitter {
            connect() {
                queueMicrotask(() => {
                    this.emit('error', new Error('authentication failed'));
                    this.emit('close');
                });
            }
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const result = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.21',
            username: 'admin'
        });

        expect(result).toEqual({ success: false, error: 'authentication failed' });
        expect(harness.activeConnections.size).toBe(0);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([]);
    });

    test('SSH close before ready settles even when no error event is emitted', async () => {
        class FakeClient extends EventEmitter {
            connect() {
                queueMicrotask(() => {
                    this.emit('end');
                    this.emit('close');
                });
            }
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const result = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.24',
            username: 'admin'
        });

        expect(result).toEqual({
            success: false,
            error: '连接在建立完成前已关闭'
        });
        expect(harness.activeConnections.size).toBe(0);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([]);
    });

    test('SSH client close without a prior error clears the live connection', async () => {
        let client;

        class FakeClient extends EventEmitter {
            constructor() {
                super();
                client = this;
            }

            connect() {
                queueMicrotask(() => this.emit('ready'));
            }

            setNoDelay() {}
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const connected = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.22',
            username: 'admin'
        });

        client.emit('close');

        expect(harness.activeConnections.has(connected.connectionId)).toBe(false);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([
            {
                channel: 'ssh:close',
                payload: { connectionId: connected.connectionId }
            }
        ]);
    });

    test('late SSH shell and SFTP callbacks cannot revive a closed connection', async () => {
        let client;
        let shellCallback;
        let sftpCallback;

        class FakeClient extends EventEmitter {
            constructor() {
                super();
                client = this;
            }

            connect() {
                queueMicrotask(() => this.emit('ready'));
            }

            setNoDelay() {}

            shell(windowOptions, shellOptions, callback) {
                shellCallback = callback;
            }

            sftp(callback) {
                sftpCallback = callback;
            }
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const connected = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.23',
            username: 'admin'
        });
        const shellResultPromise = harness.handlers.get('ssh:shell')({}, {
            connectionId: connected.connectionId,
            cols: 120,
            rows: 40
        });
        const sftpResultPromise = harness.handlers.get('sftp:list')({}, {
            connectionId: connected.connectionId,
            path: '/'
        });
        const lateShell = {
            destroyCalls: 0,
            destroy() { this.destroyCalls += 1; }
        };
        const lateSftp = {
            endCalls: 0,
            end() { this.endCalls += 1; }
        };

        client.emit('close');
        shellCallback(null, lateShell);
        sftpCallback(null, lateSftp);

        await expect(shellResultPromise).resolves.toEqual({
            success: false,
            error: '连接不存在或已断开'
        });
        await expect(sftpResultPromise).resolves.toEqual({
            success: false,
            error: 'SSH连接不存在或已断开'
        });
        expect(lateShell.destroyCalls).toBe(1);
        expect(lateSftp.endCalls).toBe(1);
        expect(harness.activeConnections.has(`${connected.connectionId}_shell`)).toBe(false);
        expect(harness.activeConnections.has(`${connected.connectionId}_sftp`)).toBe(false);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toHaveLength(1);
    });

    test('active SSH disconnect cleans up without reporting a passive close', async () => {
        const stream = new EventEmitter();
        stream.destroyed = false;
        stream.writable = true;
        let client;

        class FakeClient extends EventEmitter {
            constructor() {
                super();
                this.endCalls = 0;
                client = this;
            }

            connect() {
                queueMicrotask(() => this.emit('ready'));
            }

            setNoDelay() {}

            shell(windowOptions, shellOptions, callback) {
                callback(null, stream);
            }

            end() {
                this.endCalls += 1;
                this.emit('end');
                this.emit('close');
            }
        }

        const harness = createSSHHandlerHarness(null, null, {
            ssh2: { Client: FakeClient }
        });
        const connected = await harness.handlers.get('ssh:connect')({}, {
            host: '192.0.2.25',
            username: 'admin'
        });
        await harness.handlers.get('ssh:shell')({}, {
            connectionId: connected.connectionId,
            cols: 120,
            rows: 40
        });
        harness.activeConnections.set(`${connected.connectionId}_sftp`, {});

        const result = await harness.handlers.get('ssh:disconnect')({}, {
            connectionId: connected.connectionId
        });
        stream.emit('close');

        expect(result).toEqual({ success: true });
        expect(client.endCalls).toBe(1);
        expect(harness.activeConnections.has(connected.connectionId)).toBe(false);
        expect(harness.activeConnections.has(`${connected.connectionId}_shell`)).toBe(false);
        expect(harness.activeConnections.has(`${connected.connectionId}_sftp`)).toBe(false);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([]);
    });

    test('SSH exec stream error returns failure and later close cannot overwrite it', async () => {
        const stream = new EventEmitter();
        stream.stderr = new EventEmitter();
        const connection = {
            exec: (command, callback) => callback(null, stream)
        };
        const harness = createSSHHandlerHarness('ssh-1', connection);

        const resultPromise = harness.handlers.get('ssh:execute')({}, {
            connectionId: 'ssh-1',
            command: 'show version'
        });
        stream.emit('error', new Error('channel reset'));
        stream.emit('close', 0);

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'channel reset'
        });
    });

    test('interactive SSH shell error cleans up and notifies close exactly once', async () => {
        const stream = new EventEmitter();
        stream.destroyed = false;
        stream.writable = true;
        stream.end = () => {};
        let endCalls = 0;
        const connection = {
            end: () => { endCalls += 1; },
            shell: (windowOptions, shellOptions, callback) => callback(null, stream)
        };
        const harness = createSSHHandlerHarness('ssh-2', connection);

        const result = await harness.handlers.get('ssh:shell')({}, {
            connectionId: 'ssh-2',
            cols: 120,
            rows: 40
        });
        expect(result.success).toBe(true);
        expect(harness.activeConnections.get('ssh-2_shell')).toBe(stream);

        stream.emit('error', new Error('connection lost'));
        stream.emit('close');

        expect(harness.activeConnections.has('ssh-2_shell')).toBe(false);
        expect(harness.activeConnections.has('ssh-2')).toBe(false);
        expect(endCalls).toBe(1);
        expect(harness.messages.filter(item => item.channel === 'ssh:close')).toEqual([
            {
                channel: 'ssh:close',
                payload: {
                    connectionId: 'ssh-2',
                    shellId: result.shellId,
                    error: 'connection lost'
                }
            }
        ]);
    });

    test('batch SSH stream error rejects promptly and always closes the client', async () => {
        const stream = new EventEmitter();
        stream.end = () => {};
        stream.write = () => true;
        let clientInstance;

        class FakeClient extends EventEmitter {
            constructor() {
                super();
                this.endCalls = 0;
                clientInstance = this;
            }

            connect() {
                queueMicrotask(() => this.emit('ready'));
            }

            shell(options, callback) {
                callback(null, stream);
                queueMicrotask(() => stream.emit('error', new Error('batch channel reset')));
            }

            end() {
                this.endCalls += 1;
            }
        }

        const execution = executeSSHTarget(
            { host: '192.0.2.10', username: 'admin', password: 'secret', type: 'cisco' },
            ['show version'],
            { timeout: 1000, saveBackup: false, variables: {} },
            { shouldStop: false, paused: false },
            {},
            { ssh2: { Client: FakeClient } }
        );

        await expect(execution).rejects.toThrow('batch channel reset');
        expect(clientInstance.endCalls).toBe(1);
    });

    test('FTP PASV server and accepted data socket both consume error events', async () => {
        const backend = new FtpServerBackend({ host: '127.0.0.1', rootDirectory: process.cwd() });
        const replies = [];
        const controlSocket = {
            localAddress: '127.0.0.1',
            write: (message) => replies.push(message)
        };
        const session = {
            passiveServer: null,
            passivePort: null,
            dataSocket: null,
            dataSocketError: null,
            activeAddr: null,
            activePort: null
        };

        backend.handlePasv(controlSocket, session);
        await waitFor(() => Number.isInteger(session.passivePort));
        expect(session.passiveServer.listenerCount('error')).toBeGreaterThan(0);

        const client = net.connect(session.passivePort, '127.0.0.1');
        await new Promise((resolve, reject) => {
            client.once('connect', resolve);
            client.once('error', reject);
        });
        await waitFor(() => Boolean(session.dataSocket));
        const acceptedSocket = session.dataSocket;
        expect(acceptedSocket.listenerCount('error')).toBeGreaterThan(0);

        expect(() => acceptedSocket.emit('error', new Error('client reset'))).not.toThrow();
        await expect(backend.getDataConnection(session)).rejects.toThrow('client reset');

        client.destroy();
        acceptedSocket.destroy();
        expect(replies.some(reply => reply.startsWith('227 '))).toBe(true);
    });

    test('FTP PASV listener error is logged and returned as 425 instead of throwing', async () => {
        const replies = [];
        const backend = new FtpServerBackend({ host: '127.0.0.1', rootDirectory: process.cwd() });
        const session = { passiveServer: null, passivePort: null, dataSocket: null, dataSocketError: null };
        backend.handlePasv({
            localAddress: '127.0.0.1',
            write: (message) => replies.push(message)
        }, session);
        await waitFor(() => Number.isInteger(session.passivePort));
        const passiveServer = session.passiveServer;

        expect(() => passiveServer.emit('error', new Error('listen failed'))).not.toThrow();
        expect(replies.some(reply => reply.startsWith('425 '))).toBe(true);
        expect(session.passiveServer).toBeNull();
    });

    test('FTP transfer error produces 451 and never reports 226 success', async () => {
        const replies = [];
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const failingDataSocket = new Writable({
            write(chunk, encoding, callback) {
                callback(new Error('data socket reset'));
            }
        });
        backend.getDataConnection = async () => failingDataSocket;

        await backend.handleList({ write: (message) => replies.push(message) }, { currentDir: '/' });

        expect(replies.some(reply => reply.startsWith('451 '))).toBe(true);
        expect(replies.some(reply => reply.startsWith('226 '))).toBe(false);
    });

    test('SNMP v2c/v3 sessions always have an error listener', () => {
        const received = [];
        const v2Session = createSnmpSession('127.0.0.1', { version: '2c', community: 'public' }, {}, (error) => {
            received.push(error.message);
        });
        const v3Session = createSnmpSession('127.0.0.1', { version: '3', username: 'tester' }, {}, (error) => {
            received.push(error.message);
        });

        expect(v2Session.listenerCount('error')).toBeGreaterThan(0);
        expect(v3Session.listenerCount('error')).toBeGreaterThan(0);
        expect(() => v2Session.emit('error', new Error('v2 socket error'))).not.toThrow();
        expect(() => v3Session.emit('error', new Error('v3 socket error'))).not.toThrow();
        expect(received).toEqual(['v2 socket error', 'v3 socket error']);

        v2Session.close();
        v3Session.close();
    });

    test('SNMP helper consumes EventEmitter error with the supplied handler', () => {
        const session = new EventEmitter();
        let received;
        attachSnmpErrorHandler(session, (error) => {
            received = error.message;
        });

        expect(() => session.emit('error', new Error('udp failed'))).not.toThrow();
        expect(received).toBe('udp failed');
    });

    test('DHCP runtime socket error is forwarded as server-error without throwing', async () => {
        const originalCreateServer = dhcp.createServer;
        const fakeServer = new EventEmitter();
        fakeServer._state = {};
        fakeServer.sendOffer = () => {};
        fakeServer.sendAck = () => {};
        fakeServer.sendNak = () => {};
        fakeServer.listen = () => queueMicrotask(() => fakeServer.emit('listening'));
        fakeServer.close = (callback) => callback();
        dhcp.createServer = () => fakeServer;

        try {
            const backend = new DhcpServerBackend({
                interfaceIp: '127.0.0.1',
                startIp: '192.0.2.10',
                endIp: '192.0.2.20',
                subnetMask: '255.255.255.0'
            });
            const errors = [];
            backend.on('server-error', (error) => errors.push(error.message));
            await backend.start();

            expect(() => fakeServer.emit('error', new Error('UDP socket failed'))).not.toThrow();
            await waitFor(() => errors.length === 1);
            expect(errors).toEqual(['UDP socket failed']);
            await waitFor(() => backend.serverInstance === null);
        } finally {
            dhcp.createServer = originalCreateServer;
        }
    });
});
