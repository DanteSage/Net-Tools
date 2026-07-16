const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    MAX_EXTERNAL_URL_LENGTH,
    normalizeExternalUrl,
    normalizeOpenPath
} = require('../main/utils/shell-validation');

test.describe('Dialog shell security', () => {
    test('allows only normalized web and email URLs', () => {
        expect(normalizeExternalUrl(' HTTPS://Example.COM/path?q=1 '))
            .toBe('https://example.com/path?q=1');
        expect(normalizeExternalUrl('http://example.com'))
            .toBe('http://example.com/');
        expect(normalizeExternalUrl('mailto:support@example.com?subject=Help'))
            .toBe('mailto:support@example.com?subject=Help');
    });

    test('rejects dangerous, malformed and oversized external URLs', () => {
        const rejectedUrls = [
            'file:///C:/Windows/System32/calc.exe',
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'ftp://example.com/file',
            'smb://server/share',
            'ms-settings:privacy',
            'ms-msdt:/id PCWDiagnostic',
            'search-ms:query=test',
            'shell:AppsFolder',
            'vscode://file/C:/test',
            '//example.com/path',
            'not a URL',
            'https://example.com/\r\nX-Test: injected',
            `https://example.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`,
            '',
            null,
            { toString: () => 'https://example.com' }
        ];

        for (const url of rejectedUrls) {
            expect(() => normalizeExternalUrl(url)).toThrow();
        }
    });

    test('allows only existing configured directories', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-shell-'));
        const configDir = path.join(tempDir, 'Config Directory');
        const backupDir = path.join(tempDir, 'Backup Directory');
        const oplogDir = path.join(tempDir, 'Oplog Directory');
        fs.mkdirSync(configDir);
        fs.mkdirSync(backupDir);
        fs.mkdirSync(oplogDir);

        try {
            const allowedDirectories = [configDir, backupDir, oplogDir];
            expect(normalizeOpenPath(`${configDir}${path.sep}`, allowedDirectories))
                .toBe(fs.realpathSync.native(configDir));
            expect(normalizeOpenPath(backupDir, allowedDirectories))
                .toBe(fs.realpathSync.native(backupDir));
            expect(normalizeOpenPath(oplogDir, allowedDirectories))
                .toBe(fs.realpathSync.native(oplogDir));

            if (process.platform === 'win32') {
                expect(normalizeOpenPath(configDir.toUpperCase(), allowedDirectories))
                    .toBe(fs.realpathSync.native(configDir));
            }
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects files, unapproved directories and path tricks', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-shell-'));
        const allowedDir = path.join(tempDir, 'allowed');
        const prefixCollisionDir = path.join(tempDir, 'allowed-evil');
        const nestedDir = path.join(allowedDir, 'nested');
        const executablePath = path.join(allowedDir, 'payload.exe');
        const missingPath = path.join(allowedDir, 'missing');
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.mkdirSync(prefixCollisionDir);
        fs.writeFileSync(executablePath, 'not executable');

        try {
            const rejectedPaths = [
                executablePath,
                nestedDir,
                prefixCollisionDir,
                tempDir,
                missingPath,
                path.relative(process.cwd(), allowedDir),
                `file:///${allowedDir.replace(/\\/g, '/')}`
            ];

            if (process.platform === 'win32') {
                rejectedPaths.push('\\\\server\\share');
                rejectedPaths.push('\\\\?\\C:\\Windows');
                rejectedPaths.push('\\Windows');
            }

            for (const candidate of rejectedPaths) {
                expect(() => normalizeOpenPath(candidate, [allowedDir])).toThrow();
            }
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects configured paths polluted with a file target', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-shell-'));
        const executablePath = path.join(tempDir, 'calc.exe');
        fs.writeFileSync(executablePath, 'not executable');

        try {
            expect(() => normalizeOpenPath(executablePath, [executablePath]))
                .toThrow('仅允许打开目录');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('routes every Electron shell call through validation', () => {
        const dialogSource = fs.readFileSync(
            path.join(__dirname, '..', 'main', 'handlers', 'dialog.js'),
            'utf8'
        );
        const oplogSource = fs.readFileSync(
            path.join(__dirname, '..', 'main', 'handlers', 'oplog.js'),
            'utf8'
        );

        expect(dialogSource).toContain('normalizeOpenPath(filePath, getAllowedOpenDirectories())');
        expect(dialogSource).toContain('shell.openPath(safePath)');
        expect(dialogSource).toContain('normalizeExternalUrl(url)');
        expect(dialogSource).toContain('shell.openExternal(safeUrl)');
        expect(dialogSource).not.toContain('shell.openPath(filePath)');
        expect(dialogSource).not.toContain('shell.openExternal(url)');
        expect(oplogSource).toContain('normalizeOpenPath(oplogDir, [oplogDir])');
        expect(oplogSource).toContain('shell.openPath(safePath)');
        expect(oplogSource).not.toContain('shell.openPath(getOplogDir())');
    });
});
