const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    DEFAULT_SCAN_CONCURRENCY,
    MAX_SCAN_CONCURRENCY,
    normalizeScanConcurrency
} = require('../main/utils/scan-options');
const { registerPortScannerHandlers } = require('../main/tools/portscanner');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

function registerScanHandler(scanTcpPort) {
    const ipcMain = new FakeIpcMain();
    registerPortScannerHandlers({}, { ipcMain, scanTcpPort });
    return ipcMain.handlers.get('scan-ports');
}

test.describe('Port scanner concurrency validation', () => {
    test('normalizes every input to a bounded positive integer', () => {
        expect(normalizeScanConcurrency(undefined)).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency(null)).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency('')).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency('invalid')).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency(NaN)).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency(Infinity)).toBe(DEFAULT_SCAN_CONCURRENCY);
        expect(normalizeScanConcurrency(0)).toBe(1);
        expect(normalizeScanConcurrency(-10)).toBe(1);
        expect(normalizeScanConcurrency(3.9)).toBe(3);
        expect(normalizeScanConcurrency('25')).toBe(25);
        expect(normalizeScanConcurrency(9999)).toBe(MAX_SCAN_CONCURRENCY);
    });

    test('concurrency zero completes instead of entering an infinite loop', async () => {
        const scannedPorts = [];
        const scan = registerScanHandler(async (host, port) => {
            scannedPorts.push(port);
            return { port, status: 'closed', protocol: 'TCP' };
        });

        const results = await scan({}, {
            host: '127.0.0.1',
            ports: '1-5',
            protocol: 'TCP',
            timeout: 100,
            concurrency: 0
        });

        expect(scannedPorts).toEqual([1, 2, 3, 4, 5]);
        expect(results).toHaveLength(5);
    });

    test('caps maliciously large concurrency at the configured maximum', async () => {
        let active = 0;
        let maxActive = 0;
        const scan = registerScanHandler(async (host, port) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setImmediate(resolve));
            active -= 1;
            return { port, status: 'closed', protocol: 'TCP' };
        });

        const results = await scan({}, {
            host: '127.0.0.1',
            ports: '1-250',
            protocol: 'TCP',
            timeout: 100,
            concurrency: 1000000
        });

        expect(results).toHaveLength(250);
        expect(maxActive).toBe(MAX_SCAN_CONCURRENCY);
    });

    test('uses the same validation in integrated and standalone scanners', () => {
        const root = path.join(__dirname, '..');
        const integratedSource = fs.readFileSync(
            path.join(root, 'main', 'tools', 'portscanner.js'),
            'utf8'
        );
        const standaloneSource = fs.readFileSync(
            path.join(root, 'port test', 'main.js'),
            'utf8'
        );

        for (const source of [integratedSource, standaloneSource]) {
            expect(source).toContain('normalizeScanConcurrency(concurrency)');
            expect(source).not.toMatch(/i\s*\+=\s*concurrency/);
        }
    });
});
