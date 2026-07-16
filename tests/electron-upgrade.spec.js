const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const packageFiles = [
    'package.json',
    'PacketCapture/package.json',
    'Speed test/package.json',
    'port test/package.json',
    'ping test/package.json',
    'Route Tracking/package.json',
    'Subnetting/package.json'
];
const lockFiles = [
    'package-lock.json',
    'PacketCapture/package-lock.json',
    'Speed test/package-lock.json',
    'port test/package-lock.json'
];

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
    return JSON.parse(read(relativePath));
}

test.describe('Electron runtime upgrade', () => {
    test('keeps every Electron project on a supported major', () => {
        for (const relativePath of packageFiles) {
            const packageJson = readJson(relativePath);
            const declaredVersion = packageJson.devDependencies?.electron
                || packageJson.dependencies?.electron;
            expect(declaredVersion, relativePath).toBeTruthy();
            expect(Number(declaredVersion.match(/\d+/)?.[0]), relativePath).toBeGreaterThanOrEqual(41);
        }

        expect(readJson('package.json').devDependencies.electron).toBe('^43.1.1');
        expect(readJson('package.json').engines.node).toBe('>=22.12.0');
    });

    test('locks every existing Electron dependency tree to a supported major', () => {
        for (const relativePath of lockFiles) {
            const lock = readJson(relativePath);
            const installedVersion = lock.packages?.['node_modules/electron']?.version;
            expect(installedVersion, relativePath).toBeTruthy();
            expect(Number(installedVersion.split('.')[0]), relativePath).toBeGreaterThanOrEqual(41);
        }

        expect(readJson('package-lock.json').packages['node_modules/electron'].version).toBe('43.1.1');
    });

    test('uses webUtils instead of the removed DOM File.path API', () => {
        const preload = read('preload.js');
        const sftpClient = read('scripts/modules/terminal/sftp-client.js');

        expect(preload).toContain('webUtils');
        expect(preload).toContain('getPathForFile: (file) => webUtils.getPathForFile(file)');
        expect(sftpClient).toContain('window.api.fs.getPathForFile(file)');
        expect(sftpClient).not.toMatch(/\bfile\.path\b/);
    });
});
