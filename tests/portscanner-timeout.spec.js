const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    DEFAULT_SCAN_TIMEOUT_MS,
    MIN_SCAN_TIMEOUT_MS,
    MAX_SCAN_TIMEOUT_MS,
    normalizeScanTimeout
} = require('../main/utils/scan-options');
const {
    scanTcpPort,
    registerPortScannerHandlers
} = require('../main/tools/portscanner');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.timeout = null;
        this.destroyCalls = 0;
        this.connectArgs = null;
    }

    setTimeout(timeout) {
        this.timeout = timeout;
    }

    connect(port, host) {
        this.connectArgs = { port, host };
    }

    destroy() {
        this.destroyCalls += 1;
        this.emit('close');
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

function registerHandlers(scanPort) {
    const ipcMain = new FakeIpcMain();
    registerPortScannerHandlers({}, { ipcMain, scanTcpPort: scanPort });
    return ipcMain.handlers;
}

test.describe('Port scanner timeout validation', () => {
    test('normalizes every timeout to a bounded positive integer', () => {
        expect(normalizeScanTimeout(undefined)).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(null)).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout('')).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout('invalid')).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(NaN)).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(Infinity)).toBe(DEFAULT_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(0)).toBe(MIN_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(-10)).toBe(MIN_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(0.9)).toBe(MIN_SCAN_TIMEOUT_MS);
        expect(normalizeScanTimeout(1500.9)).toBe(1500);
        expect(normalizeScanTimeout('2500')).toBe(2500);
        expect(normalizeScanTimeout(999999)).toBe(MAX_SCAN_TIMEOUT_MS);
    });

    for (const [input, expected] of [
        [0, MIN_SCAN_TIMEOUT_MS],
        [-1, MIN_SCAN_TIMEOUT_MS],
        [NaN, DEFAULT_SCAN_TIMEOUT_MS],
        [1500, 1500]
    ]) {
        test(`scanTcpPort passes ${String(input)} as ${expected}ms to the socket`, async () => {
            const socket = new FakeSocket();
            const run = scanTcpPort('192.0.2.10', 443, input, {
                createSocket: () => socket
            });

            expect(socket.timeout).toBe(expected);
            expect(socket.connectArgs).toEqual({ port: 443, host: '192.0.2.10' });
            socket.emit('timeout');

            await expect(run).resolves.toEqual({
                port: 443,
                status: 'closed',
                protocol: 'TCP'
            });
            expect(socket.destroyCalls).toBe(1);
        });
    }

    test('batch and quick-test IPC handlers normalize timeout before scanning', async () => {
        const calls = [];
        const handlers = registerHandlers(async (host, port, timeout) => {
            calls.push({ host, port, timeout });
            return { port, status: 'closed', protocol: 'TCP' };
        });

        await handlers.get('scan-ports')({}, {
            host: '127.0.0.1',
            ports: '80,443',
            protocol: 'TCP',
            timeout: 0,
            concurrency: 2
        });
        await handlers.get('quick-test')({}, {
            host: '127.0.0.1',
            port: 22,
            protocol: 'TCP',
            timeout: Infinity
        });

        expect(calls).toEqual([
            { host: '127.0.0.1', port: 80, timeout: MIN_SCAN_TIMEOUT_MS },
            { host: '127.0.0.1', port: 443, timeout: MIN_SCAN_TIMEOUT_MS },
            { host: '127.0.0.1', port: 22, timeout: DEFAULT_SCAN_TIMEOUT_MS }
        ]);
    });

    test('integrated and standalone scanners share timeout validation', () => {
        const root = path.join(__dirname, '..');
        const sources = [
            fs.readFileSync(path.join(root, 'main', 'tools', 'portscanner.js'), 'utf8'),
            fs.readFileSync(path.join(root, 'port test', 'main.js'), 'utf8')
        ];

        for (const source of sources) {
            expect(source).toContain('normalizeScanTimeout');
            expect(source).toContain('normalizeScanTimeout(timeout)');
            expect(source).not.toContain('socket.setTimeout(timeout)');
        }
    });
});
