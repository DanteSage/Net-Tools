const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const TftpServerBackend = require('../main/tools/tftp-server-backend');

class FakeDgramSocket extends EventEmitter {
    constructor(port = 41000) {
        super();
        this.port = port;
        this.sends = [];
        this.sendCallbacks = [];
        this.closeCalls = 0;
    }

    bind(port, host, callback) {
        callback();
    }

    address() {
        return { address: '127.0.0.1', family: 'IPv4', port: this.port };
    }

    send(packet, port, address, callback) {
        this.sends.push({ packet: Buffer.from(packet), port, address });
        this.sendCallbacks.push(callback);
    }

    completeSend(index, error = null) {
        this.sendCallbacks[index]?.(error);
    }

    close(callback) {
        this.closeCalls += 1;
        callback?.();
    }
}

function createTimerHarness() {
    const timers = [];
    const cleared = [];
    return {
        timers,
        cleared,
        setTimeoutFn(callback, delay) {
            const timer = {
                callback,
                delay,
                cleared: false,
                unrefCalls: 0,
                unref() {
                    this.unrefCalls += 1;
                }
            };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn(timer) {
            timer.cleared = true;
            cleared.push(timer);
        }
    };
}

function createWrqPacket(filename, options = {}) {
    const parts = [Buffer.from([0, 2]), Buffer.from(`${filename}\0octet\0`)];
    for (const [name, value] of Object.entries(options)) {
        parts.push(Buffer.from(`${name}\0${value}\0`));
    }
    return Buffer.concat(parts);
}

function createDataPacket(blockNum, size) {
    const packet = Buffer.alloc(4 + size, 0x41);
    packet.writeUInt16BE(3, 0);
    packet.writeUInt16BE(blockNum, 2);
    return packet;
}

function packetInfo(send) {
    return {
        opcode: send.packet.readUInt16BE(0),
        block: send.packet.length >= 4 ? send.packet.readUInt16BE(2) : null
    };
}

function createHarness(options = {}) {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tftp-wrq-'));
    const sockets = options.sockets || [new FakeDgramSocket()];
    const timers = createTimerHarness();
    let socketIndex = 0;
    const backend = new TftpServerBackend({
        rootDirectory,
        timeout: 1,
        retries: options.retries ?? 2,
        createSocket: () => sockets[socketIndex++],
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
    });
    const rinfo = { address: '192.0.2.10', port: 50000 };

    return {
        backend,
        rootDirectory,
        sockets,
        timers,
        rinfo,
        start(filename = 'upload.bin', requestOptions = {}) {
            backend.handleInitialRequest(createWrqPacket(filename, requestOptions), rinfo);
            return backend.sessions.get(`${rinfo.address}:${rinfo.port}`);
        },
        cleanup() {
            for (const [key, session] of backend.sessions) {
                backend.cleanupSession(key, '测试清理', session);
            }
            fs.rmSync(rootDirectory, { recursive: true, force: true });
        }
    };
}

test.describe('TFTP WRQ initial ACK retransmission', () => {
    test('plain WRQ arms a timeout after ACK0 is sent', () => {
        const harness = createHarness();
        try {
            const session = harness.start();
            const socket = harness.sockets[0];

            expect(packetInfo(socket.sends[0])).toEqual({ opcode: 4, block: 0 });
            expect(session.lastPacket.equals(socket.sends[0].packet)).toBe(true);
            expect(session.timer).toBeNull();

            socket.completeSend(0);
            expect(harness.timers.timers).toHaveLength(1);
            expect(session.timer).toBe(harness.timers.timers[0]);
            expect(session.timer).toMatchObject({ delay: 1000, unrefCalls: 1 });
        } finally {
            harness.cleanup();
        }
    });

    test('ACK0 timeout retransmits the same packet and rearms the timer', () => {
        const harness = createHarness();
        try {
            const session = harness.start();
            const socket = harness.sockets[0];
            socket.completeSend(0);
            const firstTimer = session.timer;

            firstTimer.callback();
            expect(session.retransmitCount).toBe(1);
            expect(socket.sends).toHaveLength(2);
            expect(socket.sends[1].packet.equals(socket.sends[0].packet)).toBe(true);
            expect(session.timer).toBeNull();

            socket.completeSend(1);
            expect(session.timer).toBe(harness.timers.timers[1]);
            expect(session.timer.delay).toBe(1000);
        } finally {
            harness.cleanup();
        }
    });

    test('DATA1 clears the ACK0 timer and a cleared timer cannot retransmit', () => {
        const harness = createHarness();
        try {
            const session = harness.start();
            const socket = harness.sockets[0];
            socket.completeSend(0);
            const ack0Timer = session.timer;

            harness.backend.handleSessionMessage(session, createDataPacket(1, session.blksize));
            expect(ack0Timer.cleared).toBe(true);
            expect(packetInfo(socket.sends[1])).toEqual({ opcode: 4, block: 1 });
            expect(session.bytesTransferred).toBe(session.blksize);
            expect(session.timer).toBeNull();

            ack0Timer.callback();
            expect(socket.sends).toHaveLength(2);

            socket.completeSend(1);
            expect(session.timer).toBe(harness.timers.timers[1]);
            expect(fs.statSync(session.realPath).size).toBe(session.blksize);
        } finally {
            harness.cleanup();
        }
    });

    for (const [outcome, lateError] of [
        ['success', null],
        ['error', new Error('late ACK0 send error')]
    ]) {
        test(`a late ACK0 retransmit ${outcome} cannot disrupt the ACK1 state`, () => {
            const harness = createHarness();
            try {
                const session = harness.start();
                const socket = harness.sockets[0];
                socket.completeSend(0);
                session.timer.callback();
                expect(packetInfo(socket.sends[1])).toEqual({ opcode: 4, block: 0 });

                harness.backend.handleSessionMessage(session, createDataPacket(1, session.blksize));
                expect(packetInfo(socket.sends[2])).toEqual({ opcode: 4, block: 1 });
                socket.completeSend(2);
                const ack1Timer = session.timer;
                expect(ack1Timer).not.toBeNull();

                socket.completeSend(1, lateError);
                expect(session.timer).toBe(ack1Timer);
                expect(session.blockNum).toBe(1);
                expect(session.status).toBe('transferring');
                expect(harness.backend.sessions.get(session.id)).toBe(session);
            } finally {
                harness.cleanup();
            }
        });
    }

    test('retry exhaustion sends ERROR and removes the partial upload', () => {
        const harness = createHarness({ retries: 2 });
        try {
            const session = harness.start();
            const socket = harness.sockets[0];
            const filePath = session.realPath;
            socket.completeSend(0);

            for (let retry = 0; retry < 2; retry++) {
                const timer = session.timer;
                timer.callback();
                socket.completeSend(socket.sends.length - 1);
            }
            const finalTimer = session.timer;
            finalTimer.callback();

            expect(socket.sends.map(packetInfo)).toEqual([
                { opcode: 4, block: 0 },
                { opcode: 4, block: 0 },
                { opcode: 4, block: 0 },
                { opcode: 5, block: 0 }
            ]);
            expect(harness.backend.sessions.has(session.id)).toBe(false);
            expect(session.fd).toBeNull();
            expect(session.timer).toBeNull();
            expect(socket.closeCalls).toBe(1);
            expect(fs.existsSync(filePath)).toBe(false);

            finalTimer.callback();
            expect(socket.sends).toHaveLength(4);
        } finally {
            harness.cleanup();
        }
    });

    test('ACK0 send failure cleans the session without starting a timer', () => {
        const harness = createHarness();
        try {
            const session = harness.start();
            const socket = harness.sockets[0];
            const filePath = session.realPath;

            socket.completeSend(0, new Error('send failed'));

            expect(harness.timers.timers).toHaveLength(0);
            expect(harness.backend.sessions.has(session.id)).toBe(false);
            expect(socket.closeCalls).toBe(1);
            expect(fs.existsSync(filePath)).toBe(false);
        } finally {
            harness.cleanup();
        }
    });

    test('old retransmit callbacks cannot affect a replacement session', () => {
        const oldSocket = new FakeDgramSocket(41000);
        const newSocket = new FakeDgramSocket(41001);
        const harness = createHarness({ sockets: [oldSocket, newSocket] });
        try {
            const oldSession = harness.start('old.bin');
            oldSocket.completeSend(0);
            oldSession.timer.callback();
            expect(oldSocket.sends).toHaveLength(2);

            const newSession = harness.start('new.bin');
            expect(harness.backend.sessions.get(oldSession.id)).toBe(newSession);
            expect(oldSession.cleanupStarted).toBe(true);

            oldSocket.completeSend(1);
            expect(newSession.timer).toBeNull();
            expect(newSocket.sends).toHaveLength(1);
            expect(packetInfo(newSocket.sends[0])).toEqual({ opcode: 4, block: 0 });
            expect(harness.backend.sessions.get(newSession.id)).toBe(newSession);
        } finally {
            harness.cleanup();
        }
    });

    test('invalid WRQ packets do not reset the retry counter', () => {
        const harness = createHarness();
        try {
            const session = harness.start();
            session.retransmitCount = 2;
            const illegalAck = Buffer.from([0, 4, 0, 0]);

            harness.backend.handleSessionMessage(session, illegalAck);

            expect(session.retransmitCount).toBe(2);
            expect(packetInfo(harness.sockets[0].sends[1])).toEqual({ opcode: 5, block: 4 });
        } finally {
            harness.cleanup();
        }
    });
});
