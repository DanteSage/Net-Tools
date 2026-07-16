const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('events');
const {
    clientConnect,
    cleanupNetcat
} = require('../main/tools/netcat');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.connecting = true;
        this.destroyed = false;
        this.destroyCalls = 0;
        this.timeout = 0;
    }

    setTimeout(timeout) {
        this.timeout = timeout;
    }

    connect() {}

    destroy() {
        this.destroyCalls += 1;
        this.destroyed = true;
    }
}

test.describe('Netcat client lifecycle', () => {
    test.afterEach(() => {
        cleanupNetcat();
    });

    test('error followed by close settles the connection attempt once', async () => {
        const socket = new FakeSocket();
        const resultPromise = clientConnect('127.0.0.1', 1, 1000, {
            createSocket: () => socket
        });

        socket.connecting = false;
        socket.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1'));
        socket.emit('close', true);

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'connect ECONNREFUSED 127.0.0.1:1'
        });
        expect(socket.destroyCalls).toBe(1);
    });

    test('timeout settles before destroy and later close cannot overwrite it', async () => {
        const socket = new FakeSocket();
        const resultPromise = clientConnect('192.0.2.1', 23, 1000, {
            createSocket: () => socket
        });

        socket.connecting = false;
        socket.emit('timeout');
        socket.emit('close', false);

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: '连接超时'
        });
        expect(socket.destroyCalls).toBe(1);
    });

    test('cleanup cancels a pending connection Promise', async () => {
        const socket = new FakeSocket();
        const resultPromise = clientConnect('192.0.2.2', 443, 1000, {
            createSocket: () => socket
        });

        cleanupNetcat();

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: '窗口已关闭'
        });
        expect(socket.destroyCalls).toBe(1);
    });

    test('late events from a replaced socket cannot overwrite the new connection', async () => {
        const firstSocket = new FakeSocket();
        const secondSocket = new FakeSocket();
        const first = clientConnect('192.0.2.3', 22, 1000, {
            createSocket: () => firstSocket
        });
        const second = clientConnect('192.0.2.4', 22, 1000, {
            createSocket: () => secondSocket
        });

        firstSocket.emit('error', new Error('late old error'));
        firstSocket.emit('close', true);
        secondSocket.connecting = false;
        secondSocket.emit('connect');

        await expect(first).resolves.toEqual({
            success: false,
            error: '连接已被新的请求替换'
        });
        await expect(second).resolves.toEqual({ success: true });
        expect(secondSocket.destroyed).toBe(false);
    });

    test('runtime socket error after connection success still destroys the active socket', async () => {
        const socket = new FakeSocket();
        const connection = clientConnect('192.0.2.5', 22, 1000, {
            createSocket: () => socket
        });
        socket.connecting = false;
        socket.emit('connect');
        await expect(connection).resolves.toEqual({ success: true });

        socket.emit('error', new Error('runtime reset'));
        expect(socket.destroyCalls).toBe(1);
    });
});
