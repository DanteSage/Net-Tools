const { test, expect } = require('@playwright/test');
const { EventEmitter } = require('events');
const FtpServerBackend = require('../main/tools/ftp-server-backend');

function createSession(overrides = {}) {
    return {
        passiveServer: null,
        passivePort: null,
        activeAddr: null,
        activePort: null,
        dataSocket: null,
        dataSocketError: null,
        ...overrides
    };
}

function createControlSocket(remoteAddress, localAddress = '203.0.113.5') {
    const replies = [];
    return {
        socket: {
            remoteAddress,
            localAddress,
            write(message) {
                replies.push(message);
            }
        },
        replies
    };
}

function expectRejectedPort(replies, session) {
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/^501 /);
    expect(replies[0]).not.toMatch(/^200 /);
    expect(session.activeAddr).toBeNull();
    expect(session.activePort).toBeNull();
}

class FakePassiveServer extends EventEmitter {
    constructor(connectionListener) {
        super();
        this.connectionListener = connectionListener;
        this.listenCallback = null;
        this.closeCalls = 0;
    }

    listen(port, host, callback) {
        this.listenCallback = callback;
    }

    address() {
        return { port: 41000 };
    }

    close(callback) {
        this.closeCalls += 1;
        callback?.();
    }

    accept(socket) {
        this.connectionListener(socket);
    }
}

test.describe('FTP PORT bounce protection', () => {
    test('accepts only the control connection remote IPv4 address', () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const accepted = createControlSocket('192.0.2.10', '203.0.113.5');
        const acceptedSession = createSession();
        backend.handlePort(accepted.socket, acceptedSession, '192,0,2,10,195,80');

        expect(accepted.replies).toEqual(['200 PORT command successful.\r\n']);
        expect(acceptedSession.activeAddr).toBe('192.0.2.10');
        expect(acceptedSession.activePort).toBe(50000);

        const rejected = createControlSocket('192.0.2.10', '203.0.113.5');
        const rejectedSession = createSession();
        backend.handlePort(rejected.socket, rejectedSession, '203,0,113,5,195,80');
        expectRejectedPort(rejected.replies, rejectedSession);
    });

    for (const remoteAddress of [
        '::ffff:192.0.2.10',
        '::FFFF:C000:020A',
        '0:0:0:0:0:ffff:c000:020a'
    ]) {
        test(`accepts IPv4-mapped control address ${remoteAddress}`, () => {
            const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
            const { socket, replies } = createControlSocket(remoteAddress);
            const session = createSession();

            backend.handlePort(socket, session, '192,0,2,10,195,80');

            expect(replies).toEqual(['200 PORT command successful.\r\n']);
            expect(session.activeAddr).toBe('192.0.2.10');
            expect(session.activePort).toBe(50000);
        });
    }

    test('rejects third-party, loopback and native IPv6 destinations', () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const cases = [
            ['198.51.100.7', '192,0,2,10,195,80'],
            ['198.51.100.7', '127,0,0,1,195,80'],
            ['2001:db8::7', '192,0,2,10,195,80'],
            ['::1', '127,0,0,1,195,80'],
            [null, '192,0,2,10,195,80']
        ];

        for (const [remoteAddress, portArgument] of cases) {
            const { socket, replies } = createControlSocket(remoteAddress);
            const session = createSession();
            backend.handlePort(socket, session, portArgument);
            expectRejectedPort(replies, session);
        }
    });

    test('strictly validates PORT fields and rejects privileged or zero ports', () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const invalidArguments = [
            '192,0,2,10,195',
            '192,0,2,10,195,80,1',
            '192,0,2,,195,80',
            '192,0,host,10,195,80',
            '192,0,-2,10,195,80',
            '192,0,2.5,10,195,80',
            '192,0,2e1,10,195,80',
            '192,0,2,10x,195,80',
            '192,0,256,10,195,80',
            '192,0,2,10,0,0',
            '192,0,2,10,3,255',
            '192,0,2,10,256,0',
            '192,0,2,10,1,256'
        ];

        for (const argument of invalidArguments) {
            const { socket, replies } = createControlSocket('192.0.2.10');
            const session = createSession({ activeAddr: '192.0.2.10', activePort: 50000 });
            backend.handlePort(socket, session, argument);
            expectRejectedPort(replies, session);
        }

        const boundary = createControlSocket('192.0.2.10');
        const boundarySession = createSession();
        backend.handlePort(boundary.socket, boundarySession, '192,0,2,10,4,0');
        expect(boundary.replies).toEqual(['200 PORT command successful.\r\n']);
        expect(boundarySession.activePort).toBe(1024);
    });

    test('a rejected PORT clears the previous active endpoint', async () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const { socket, replies } = createControlSocket('192.0.2.10');
        const session = createSession({ activeAddr: '192.0.2.10', activePort: 50000 });

        backend.handlePort(socket, session, '198,51,100,20,195,80');

        expectRejectedPort(replies, session);
        await expect(backend.getDataConnection(session)).rejects.toThrow('未就绪');
    });

    test('a rejected PORT preserves an existing passive mode endpoint', () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const passiveServer = {
            closeCalls: 0,
            close() {
                this.closeCalls += 1;
            }
        };
        const dataSocket = {
            destroyed: false,
            destroyCalls: 0,
            destroy() {
                this.destroyCalls += 1;
            }
        };
        const passiveError = new Error('pending passive error');
        const session = createSession({
            activeAddr: '192.0.2.10',
            activePort: 50000,
            passiveServer,
            passivePort: 41000,
            dataSocket,
            dataSocketError: passiveError
        });
        const { socket, replies } = createControlSocket('192.0.2.10');

        backend.handlePort(socket, session, '198,51,100,20,195,80');

        expectRejectedPort(replies, session);
        expect(session.passiveServer).toBe(passiveServer);
        expect(session.passivePort).toBe(41000);
        expect(session.dataSocket).toBe(dataSocket);
        expect(session.dataSocketError).toBe(passiveError);
        expect(passiveServer.closeCalls).toBe(0);
        expect(dataSocket.destroyCalls).toBe(0);
    });

    test('switching to PORT closes passive resources', () => {
        const backend = new FtpServerBackend({ rootDirectory: process.cwd() });
        const passiveServer = {
            closeCalls: 0,
            close() {
                this.closeCalls += 1;
            }
        };
        const dataSocket = {
            destroyed: false,
            destroyCalls: 0,
            destroy() {
                this.destroyCalls += 1;
                this.destroyed = true;
            }
        };
        const session = createSession({
            passiveServer,
            passivePort: 40000,
            dataSocket,
            dataSocketError: new Error('old passive error')
        });
        const { socket, replies } = createControlSocket('192.0.2.10');

        backend.handlePort(socket, session, '192,0,2,10,195,80');

        expect(replies).toEqual(['200 PORT command successful.\r\n']);
        expect(passiveServer.closeCalls).toBe(1);
        expect(dataSocket.destroyCalls).toBe(1);
        expect(session.passiveServer).toBeNull();
        expect(session.passivePort).toBeNull();
        expect(session.dataSocket).toBeNull();
        expect(session.dataSocketError).toBeNull();
    });

    test('late callbacks from a closed PASV generation cannot revive passive mode', () => {
        let passiveServer;
        const backend = new FtpServerBackend({
            rootDirectory: process.cwd(),
            createPassiveServer(connectionListener) {
                passiveServer = new FakePassiveServer(connectionListener);
                return passiveServer;
            }
        });
        const session = createSession();
        const { socket, replies } = createControlSocket('192.0.2.10');

        backend.handlePasv(socket, session);
        backend.handlePort(socket, session, '192,0,2,10,195,80');
        expect(replies).toEqual(['200 PORT command successful.\r\n']);

        passiveServer.listenCallback();
        expect(session.passivePort).toBeNull();
        expect(replies).toEqual(['200 PORT command successful.\r\n']);

        const staleDataSocket = {
            destroyed: false,
            destroyCalls: 0,
            destroy() {
                this.destroyCalls += 1;
                this.destroyed = true;
            }
        };
        passiveServer.accept(staleDataSocket);
        expect(staleDataSocket.destroyCalls).toBe(1);
        expect(session.dataSocket).toBeNull();

        expect(() => passiveServer.emit('error', new Error('late listen error'))).not.toThrow();
        expect(replies).toEqual(['200 PORT command successful.\r\n']);
    });

    test('switching to PASV immediately clears the active endpoint', async () => {
        const backend = new FtpServerBackend({
            host: '127.0.0.1',
            rootDirectory: process.cwd()
        });
        const session = createSession({ activeAddr: '192.0.2.10', activePort: 50000 });
        const { socket } = createControlSocket('192.0.2.10', '127.0.0.1');

        backend.handlePasv(socket, session);

        const passiveServer = session.passiveServer;
        await new Promise((resolve, reject) => {
            if (passiveServer.listening) {
                resolve();
                return;
            }
            passiveServer.once('listening', resolve);
            passiveServer.once('error', reject);
        });
        try {
            expect(session.activeAddr).toBeNull();
            expect(session.activePort).toBeNull();
        } finally {
            await new Promise(resolve => passiveServer.close(resolve));
        }
    });
});
