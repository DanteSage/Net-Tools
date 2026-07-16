const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('events');
const { PassThrough, Writable } = require('stream');
const { FtpClient, registerFTPHandlers } = require('../main/connections/ftp');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

class FakeControlSocket extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.writable = true;
        this.writes = [];
        this.destroyCalls = 0;
    }

    setEncoding() {}

    write(data) {
        this.writes.push(data);
        return true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.destroyCalls += 1;
    }
}

class DelayedFinalWritable extends Writable {
    constructor() {
        super();
        this.received = [];
        this.releaseFinal = null;
    }

    _write(chunk, encoding, callback) {
        this.received.push(Buffer.from(chunk));
        callback();
    }

    _final(callback) {
        this.releaseFinal = callback;
    }
}

function waitFor(predicate, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (predicate()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - startedAt >= timeout) {
                clearInterval(timer);
                reject(new Error('等待 FTP 测试条件超时'));
            }
        }, 5);
    });
}

function createClient() {
    const client = new FtpClient();
    client.socket = {
        writes: [],
        write(data) {
            this.writes.push(data);
        }
    };
    return client;
}

test.describe('FTP control response handling', () => {
    test('handles preliminary and completion responses from the same TCP chunk', async () => {
        const client = createClient();
        const response = client.sendTransferCmd('RETR /config.txt');

        client.buffer = '150 Opening data connection\r\n226 Transfer complete\r\n';
        client.parseResponses();

        await expect(response).resolves.toEqual({
            code: 226,
            text: 'Transfer complete'
        });
        expect(client.cmdQueue).toHaveLength(0);
        expect(client.socket.writes).toEqual(['RETR /config.txt\r\n']);
    });

    test('returns an immediate transfer failure without waiting for a second response', async () => {
        const client = createClient();
        const response = client.sendTransferCmd('RETR /missing.txt');

        client.buffer = '550 File unavailable\r\n';
        client.parseResponses();

        await expect(response).resolves.toEqual({
            code: 550,
            text: 'File unavailable'
        });
        expect(client.cmdQueue).toHaveLength(0);
    });

    test('rejects the pending greeting when the control connection closes', async () => {
        const socket = new FakeControlSocket();
        const client = new FtpClient({
            net: { connect: () => socket },
            commandTimeout: 1000
        });
        let closeCalls = 0;
        client.onClose = () => { closeCalls += 1; };

        const connection = client.connect({ host: '192.0.2.1', port: 21 });
        socket.emit('close');

        await expect(connection).rejects.toThrow('FTP 控制连接已关闭');
        expect(client.cmdQueue).toHaveLength(0);
        expect(client.socket).toBeNull();
        expect(closeCalls).toBe(1);
    });

    test('command timeout rejects every queued command and destroys the control socket', async () => {
        const socket = new FakeControlSocket();
        const client = new FtpClient({ commandTimeout: 20 });
        client.socket = socket;
        let closeCalls = 0;
        client.onClose = () => { closeCalls += 1; };

        const first = client.sendCmd('PWD');
        const second = client.sendCmd('NOOP');

        await expect(first).rejects.toThrow('响应超时');
        await expect(second).rejects.toThrow('响应超时');
        expect(client.cmdQueue).toHaveLength(0);
        expect(socket.destroyCalls).toBe(1);
        expect(closeCalls).toBe(1);
    });

    test('download waits for both 226 and the local file finish event', async () => {
        const dataSocket = new PassThrough();
        dataSocket.setTimeout = () => {};
        const fileStream = new DelayedFinalWritable();
        const client = new FtpClient({
            net: {
                connect: () => {
                    queueMicrotask(() => dataSocket.emit('connect'));
                    return dataSocket;
                }
            },
            fs: { createWriteStream: () => fileStream },
            transferTimeout: 1000
        });
        client.socket = new FakeControlSocket();
        client.size = async () => 3;
        client.passive = async () => ({ host: '127.0.0.1', port: 2020 });

        let completeControl;
        client.sendTransferCmd = () => new Promise((resolve) => { completeControl = resolve; });
        let completed = false;
        const download = client.download('/config.txt', 'config.txt').then(() => {
            completed = true;
        });

        await waitFor(() => typeof completeControl === 'function');
        dataSocket.end(Buffer.from('abc'));
        completeControl({ code: 226, text: 'Transfer complete' });
        await waitFor(() => typeof fileStream.releaseFinal === 'function');
        await new Promise((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);

        fileStream.releaseFinal();
        await download;
        expect(completed).toBe(true);
        expect(Buffer.concat(fileStream.received).toString()).toBe('abc');
    });

    test('data connection timeout destroys only the unopened data socket', async () => {
        const dataSocket = new PassThrough();
        dataSocket.setTimeout = () => {};
        const controlSocket = new FakeControlSocket();
        const client = new FtpClient({
            net: { connect: () => dataSocket },
            transferTimeout: 25,
            dataIdleTimeout: 1000
        });
        client.socket = controlSocket;
        client.passive = async () => ({ host: '127.0.0.1', port: 2021 });

        await expect(client.list('/')).rejects.toThrow('无进度超时');
        expect(dataSocket.destroyed).toBe(true);
        expect(controlSocket.destroyed).toBe(false);
        expect(client.socket).toBe(controlSocket);
        expect(client.cmdQueue).toHaveLength(0);
    });

    test('standard transfer failure keeps the synchronized control connection usable', async () => {
        const dataSocket = new PassThrough();
        dataSocket.setTimeout = () => {};
        const controlSocket = new FakeControlSocket();
        const client = new FtpClient({
            net: {
                connect: () => {
                    queueMicrotask(() => dataSocket.emit('connect'));
                    return dataSocket;
                }
            },
            transferTimeout: 1000
        });
        client.socket = controlSocket;
        client.passive = async () => ({ host: '127.0.0.1', port: 2022 });
        client.sendTransferCmd = async () => ({ code: 550, text: 'Permission denied' });

        await expect(client.list('/private')).rejects.toThrow('Permission denied');
        expect(dataSocket.destroyed).toBe(true);
        expect(controlSocket.destroyed).toBe(false);
        expect(client.socket).toBe(controlSocket);
    });

    test('synchronous file stream creation failure does not leak a rejected control waiter', async () => {
        const dataSocket = new PassThrough();
        dataSocket.setTimeout = () => {};
        const controlSocket = new FakeControlSocket();
        const client = new FtpClient({
            net: {
                connect: () => {
                    queueMicrotask(() => dataSocket.emit('connect'));
                    return dataSocket;
                }
            },
            fs: {
                createWriteStream: () => {
                    throw new Error('cannot create local file');
                }
            },
            transferTimeout: 1000
        });
        client.socket = controlSocket;
        client.size = async () => 10;
        client.passive = async () => ({ host: '127.0.0.1', port: 2023 });

        await expect(client.download('/config.txt', 'invalid/path')).rejects.toThrow('cannot create local file');
        await new Promise((resolve) => setImmediate(resolve));
        expect(client.cmdQueue).toHaveLength(0);
        expect(controlSocket.destroyed).toBe(true);
    });

    test('serializes high-level operations on one FTP control connection', async () => {
        const client = new FtpClient();
        const firstResponse = {};
        firstResponse.promise = new Promise((resolve) => { firstResponse.resolve = resolve; });
        const commands = [];
        client.sendCmd = (command) => {
            commands.push(command);
            if (commands.length === 1) return firstResponse.promise;
            return Promise.resolve({ code: 250, text: 'OK' });
        };

        const first = client.mkdir('/one');
        const second = client.rmdir('/two');
        await new Promise((resolve) => setImmediate(resolve));
        expect(commands).toEqual(['MKD /one']);

        firstResponse.resolve({ code: 257, text: 'Created' });
        await first;
        await second;
        expect(commands).toEqual(['MKD /one', 'RMD /two']);
    });

    test('unexpected control close removes the dead client from active connections', async () => {
        const ipcMain = new FakeIpcMain();
        const activeConnections = new Map();
        const client = {
            onLog: null,
            onClose: null,
            connect: async () => {},
            disconnect: () => {}
        };
        registerFTPHandlers({ activeConnections, getMainWindow: () => null }, {
            ipcMain,
            createClient: () => client
        });
        const sent = [];
        const sender = {
            isDestroyed: () => false,
            send: (channel, payload) => sent.push({ channel, payload })
        };

        const result = await ipcMain.handlers.get('ftp:connect')({ sender }, {
            host: '192.0.2.30',
            port: 21
        });
        expect(result.success).toBe(true);
        expect(activeConnections.get(result.connectionId)).toBe(client);

        client.onClose(new Error('server closed'));
        expect(activeConnections.has(result.connectionId)).toBe(false);
        expect(sent).toContainEqual({
            channel: 'ftp:disconnected',
            payload: {
                connectionId: result.connectionId,
                error: 'server closed'
            }
        });
    });
});
