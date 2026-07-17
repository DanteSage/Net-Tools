const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const iconv = require('iconv-lite');
const { test, expect } = require('@playwright/test');
const {
    MAX_TEXT_FILE_BYTES,
    buildSaveDialogOptions,
    decodeTextBuffer,
    registerTextFileDialogHandlers
} = require('../main/utils/dialog-file-access');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

function createHarness(options = {}) {
    const ipcMain = new FakeIpcMain();
    const trustedEntryPath = path.join(process.cwd(), 'index.html');
    const mainFrame = {
        processId: 10,
        routingId: 20,
        url: pathToFileURL(trustedEntryPath).href
    };
    const sender = { mainFrame };
    const mainWindow = {
        webContents: sender,
        isDestroyed: () => false
    };
    const calls = { open: [], save: [] };
    const dialog = {
        async showOpenDialog(parent, dialogOptions) {
            calls.open.push({ parent, options: dialogOptions });
            if (typeof options.afterOpen === 'function') {
                await options.afterOpen({ mainWindow, sender });
            }
            return options.openResult || { canceled: true, filePaths: [] };
        },
        async showSaveDialog(parent, dialogOptions) {
            calls.save.push({ parent, options: dialogOptions });
            if (typeof options.afterSave === 'function') {
                await options.afterSave({ mainWindow, sender });
            }
            return options.saveResult || { canceled: true, filePath: null };
        }
    };

    registerTextFileDialogHandlers({
        ipcMain,
        dialog,
        getMainWindow: () => mainWindow,
        trustedEntryPath,
        fs: options.fs,
        crypto: options.crypto
    });

    return {
        calls,
        event: { sender, senderFrame: mainFrame },
        handlers: ipcMain.handlers,
        mainFrame,
        mainWindow,
        sender
    };
}

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dialog-file-access-'));
}

test.describe('Dialog file access security', () => {
    test('removes renderer-controlled path read and write IPC', () => {
        const rootDir = path.join(__dirname, '..');
        const dialogSource = fs.readFileSync(
            path.join(rootDir, 'main', 'handlers', 'dialog.js'),
            'utf8'
        );
        const preloadSource = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
        const rendererSources = [
            path.join(rootDir, 'scripts', 'modules', 'devices', 'devices-import-export.js'),
            path.join(rootDir, 'scripts', 'modules', 'templates', 'import-export.js'),
            path.join(rootDir, 'scripts', 'modules', 'batch', 'batch-execution.js')
        ].map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');

        expect(dialogSource).not.toContain("handle('fs:readFile'");
        expect(dialogSource).not.toContain("handle('fs:writeFile'");
        expect(preloadSource).not.toContain("ipcRenderer.invoke('fs:readFile'");
        expect(preloadSource).not.toContain("ipcRenderer.invoke('fs:writeFile'");
        expect(rendererSources).not.toMatch(/api\.fs\??\.(?:readFile|writeFile)/);
        expect(preloadSource).toContain("ipcRenderer.invoke('dialog:readTextFile', options)");
        expect(preloadSource).toContain("ipcRenderer.invoke('dialog:writeTextFile', options, content)");
    });

    test('reads only the path returned by the native open dialog', async () => {
        const tempDir = createTempDir();
        const selectedPath = path.join(tempDir, 'selected.csv');
        const secretPath = path.join(tempDir, 'secret.txt');
        fs.writeFileSync(selectedPath, Buffer.concat([
            Buffer.from([0xEF, 0xBB, 0xBF]),
            Buffer.from('selected-content', 'utf8')
        ]));
        fs.writeFileSync(secretPath, 'secret-content', 'utf8');
        const harness = createHarness({
            openResult: { canceled: false, filePaths: [selectedPath] }
        });

        try {
            const result = await harness.handlers.get('dialog:readTextFile')(
                harness.event,
                {
                    filePath: secretPath,
                    defaultPath: secretPath,
                    filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
                }
            );

            expect(result).toEqual({
                filePath: fs.realpathSync.native(selectedPath),
                content: 'selected-content'
            });
            expect(harness.calls.open).toHaveLength(1);
            expect(harness.calls.open[0].options).toEqual({
                properties: ['openFile'],
                filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
            });
            expect(harness.calls.open[0].options).not.toHaveProperty('filePath');
            expect(harness.calls.open[0].options).not.toHaveProperty('defaultPath');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('writes only the path returned by the native save dialog', async () => {
        const tempDir = createTempDir();
        const selectedPath = path.join(tempDir, 'selected.txt');
        const secretPath = path.join(tempDir, 'secret.txt');
        fs.writeFileSync(secretPath, 'unchanged', 'utf8');
        const harness = createHarness({
            saveResult: { canceled: false, filePath: selectedPath }
        });

        try {
            const result = await harness.handlers.get('dialog:writeTextFile')(
                harness.event,
                {
                    filePath: secretPath,
                    defaultPath: 'selected.txt',
                    filters: [{ name: '文本文件', extensions: ['txt'] }]
                },
                'exported-content'
            );

            expect(result).toEqual({
                success: true,
                filePath: path.join(fs.realpathSync.native(tempDir), 'selected.txt')
            });
            expect(fs.readFileSync(selectedPath, 'utf8')).toBe('exported-content');
            expect(fs.readFileSync(secretPath, 'utf8')).toBe('unchanged');
            expect(harness.calls.save[0].options).toEqual({
                defaultPath: 'selected.txt',
                filters: [{ name: '文本文件', extensions: ['txt'] }]
            });
            expect(harness.calls.save[0].options).not.toHaveProperty('filePath');
            expect(fs.readdirSync(tempDir).filter(name => name.endsWith('.tmp'))).toEqual([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects other senders and subframes before showing a dialog', async () => {
        const harness = createHarness();
        const readHandler = harness.handlers.get('dialog:readTextFile');
        const writeHandler = harness.handlers.get('dialog:writeTextFile');

        await expect(readHandler({
            sender: { mainFrame: harness.mainFrame },
            senderFrame: harness.mainFrame
        }, {})).rejects.toThrow('不允许当前窗口执行文件操作');
        await expect(writeHandler({
            sender: harness.sender,
            senderFrame: {
                processId: 10,
                routingId: 21,
                url: pathToFileURL(path.join(process.cwd(), 'index.html')).href
            }
        }, {}, 'content')).rejects.toThrow('不允许子框架执行文件操作');
        await expect(readHandler({ sender: harness.sender }, {}))
            .rejects.toThrow('不允许子框架执行文件操作');
        expect(harness.calls.open).toHaveLength(0);
        expect(harness.calls.save).toHaveLength(0);
    });

    test('rejects an unexpected local page and navigation while the dialog is open', async () => {
        const tempDir = createTempDir();
        const selectedPath = path.join(tempDir, 'selected.txt');
        fs.writeFileSync(selectedPath, 'selected-content', 'utf8');
        const untrustedHarness = createHarness();
        untrustedHarness.mainFrame.url = pathToFileURL(
            path.join(tempDir, 'index.html')
        ).href;
        const navigatedHarness = createHarness({
            openResult: { canceled: false, filePaths: [selectedPath] },
            afterOpen: ({ sender }) => {
                sender.mainFrame = {
                    processId: 10,
                    routingId: 99,
                    url: pathToFileURL(path.join(tempDir, 'index.html')).href
                };
            }
        });

        try {
            await expect(untrustedHarness.handlers.get('dialog:readTextFile')(
                untrustedHarness.event,
                {}
            )).rejects.toThrow('不允许非应用页面执行文件操作');
            await expect(navigatedHarness.handlers.get('dialog:readTextFile')(
                navigatedHarness.event,
                {}
            )).rejects.toThrow('不允许子框架执行文件操作');
            expect(fs.readFileSync(selectedPath, 'utf8')).toBe('selected-content');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('cancellation returns null without reading or writing', async () => {
        const failingFs = new Proxy(fs, {
            get(target, property) {
                if (property === 'readFileSync'
                    || property === 'writeFileSync'
                    || property === 'renameSync') {
                    return () => {
                        throw new Error('filesystem access should not occur');
                    };
                }
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const harness = createHarness({ fs: failingFs });

        await expect(harness.handlers.get('dialog:readTextFile')(harness.event, {}))
            .resolves.toBeNull();
        await expect(harness.handlers.get('dialog:writeTextFile')(
            harness.event,
            { defaultPath: 'cancel.txt' },
            'content'
        )).resolves.toBeNull();
    });

    test('preserves UTF-8 BOM, UTF-16 and GBK text decoding support', () => {
        const utf8Bom = Buffer.concat([
            Buffer.from([0xEF, 0xBB, 0xBF]),
            Buffer.from('UTF-8 文本', 'utf8')
        ]);
        const utf16Le = Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('UTF-16 文本', 'utf16le')
        ]);
        const utf16LeBody = Buffer.from('大端文本', 'utf16le');
        const utf16BeBody = Buffer.alloc(utf16LeBody.length);
        for (let i = 0; i < utf16LeBody.length; i += 2) {
            utf16BeBody[i] = utf16LeBody[i + 1];
            utf16BeBody[i + 1] = utf16LeBody[i];
        }
        const utf16Be = Buffer.concat([Buffer.from([0xFE, 0xFF]), utf16BeBody]);
        const gbk = iconv.encode('GBK 中文文本', 'gbk');

        expect(decodeTextBuffer(utf8Bom)).toBe('UTF-8 文本');
        expect(decodeTextBuffer(utf16Le)).toBe('UTF-16 文本');
        expect(decodeTextBuffer(utf16Be)).toBe('大端文本');
        expect(decodeTextBuffer(gbk)).toBe('GBK 中文文本');
    });

    test('rejects oversized or non-file reads before loading content', async () => {
        const tempDir = createTempDir();
        const oversizedPath = path.join(tempDir, 'oversized.txt');
        fs.writeFileSync(oversizedPath, 'x');
        fs.truncateSync(oversizedPath, MAX_TEXT_FILE_BYTES + 1);
        const oversizedHarness = createHarness({
            openResult: { canceled: false, filePaths: [oversizedPath] }
        });
        const directoryHarness = createHarness({
            openResult: { canceled: false, filePaths: [tempDir] }
        });

        try {
            await expect(oversizedHarness.handlers.get('dialog:readTextFile')(
                oversizedHarness.event,
                {}
            )).rejects.toThrow('文件过大');
            await expect(directoryHarness.handlers.get('dialog:readTextFile')(
                directoryHarness.event,
                {}
            )).rejects.toThrow('仅允许读取普通文件');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('uses atomic replacement so an existing hard link target is not modified', async () => {
        const tempDir = createTempDir();
        const secretPath = path.join(tempDir, 'secret.txt');
        const selectedPath = path.join(tempDir, 'selected.txt');
        fs.writeFileSync(secretPath, 'secret-content', 'utf8');
        fs.linkSync(secretPath, selectedPath);
        const harness = createHarness({
            saveResult: { canceled: false, filePath: selectedPath }
        });

        try {
            await expect(harness.handlers.get('dialog:writeTextFile')(
                harness.event,
                { defaultPath: 'selected.txt' },
                'replacement-content'
            )).resolves.toEqual({
                success: true,
                filePath: path.join(fs.realpathSync.native(tempDir), 'selected.txt')
            });
            expect(fs.readFileSync(selectedPath, 'utf8')).toBe('replacement-content');
            expect(fs.readFileSync(secretPath, 'utf8')).toBe('secret-content');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects a selected read path replaced between inspection and open', async () => {
        const tempDir = createTempDir();
        const selectedPath = path.join(tempDir, 'selected.txt');
        const originalPath = path.join(tempDir, 'original.txt');
        const secretPath = path.join(tempDir, 'secret.txt');
        fs.writeFileSync(selectedPath, 'selected-content', 'utf8');
        fs.writeFileSync(secretPath, 'secret-content', 'utf8');
        let replaced = false;
        const swappingFs = new Proxy(fs, {
            get(target, property) {
                if (property === 'openSync') {
                    return (filePath, ...args) => {
                        if (!replaced && path.resolve(filePath) === path.resolve(selectedPath)) {
                            replaced = true;
                            fs.renameSync(selectedPath, originalPath);
                            fs.linkSync(secretPath, selectedPath);
                        }
                        return fs.openSync(filePath, ...args);
                    };
                }
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const harness = createHarness({
            fs: swappingFs,
            openResult: { canceled: false, filePaths: [selectedPath] }
        });

        try {
            await expect(harness.handlers.get('dialog:readTextFile')(
                harness.event,
                {}
            )).rejects.toThrow('文件在读取前已被替换');
            expect(replaced).toBe(true);
            expect(fs.readFileSync(secretPath, 'utf8')).toBe('secret-content');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('detects a save directory replaced before any content is written', async () => {
        const tempDir = createTempDir();
        const selectedDir = path.join(tempDir, 'selected-dir');
        const movedDir = path.join(tempDir, 'moved-dir');
        const selectedPath = path.join(selectedDir, 'export.txt');
        fs.mkdirSync(selectedDir);
        let replaced = false;
        const swappingFs = new Proxy(fs, {
            get(target, property) {
                if (property === 'openSync') {
                    return (filePath, ...args) => {
                        if (!replaced && filePath.endsWith('.tmp')) {
                            replaced = true;
                            fs.renameSync(selectedDir, movedDir);
                            fs.mkdirSync(selectedDir);
                        }
                        return fs.openSync(filePath, ...args);
                    };
                }
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const harness = createHarness({
            fs: swappingFs,
            saveResult: { canceled: false, filePath: selectedPath }
        });

        try {
            await expect(harness.handlers.get('dialog:writeTextFile')(
                harness.event,
                { defaultPath: 'export.txt' },
                'sensitive-export'
            )).rejects.toThrow('保存目录在写入前已被替换');
            expect(replaced).toBe(true);
            expect(fs.readdirSync(selectedDir)).toEqual([]);
            expect(fs.readdirSync(movedDir)).toEqual([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('a failed atomic rename keeps the previous file and removes temporary output', async () => {
        const tempDir = createTempDir();
        const selectedPath = path.join(tempDir, 'selected.txt');
        fs.writeFileSync(selectedPath, 'previous-content', 'utf8');
        const failingFs = new Proxy(fs, {
            get(target, property) {
                if (property === 'renameSync') {
                    return () => {
                        throw new Error('simulated rename failure');
                    };
                }
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        const harness = createHarness({
            fs: failingFs,
            saveResult: { canceled: false, filePath: selectedPath }
        });

        try {
            await expect(harness.handlers.get('dialog:writeTextFile')(
                harness.event,
                { defaultPath: 'selected.txt' },
                'new-content'
            )).rejects.toThrow('simulated rename failure');
            expect(fs.readFileSync(selectedPath, 'utf8')).toBe('previous-content');
            expect(fs.readdirSync(tempDir)).toEqual(['selected.txt']);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects absolute default paths and malformed filters', () => {
        const absoluteDefault = path.join(createTempDir(), 'secret.txt');
        try {
            expect(() => buildSaveDialogOptions({ defaultPath: absoluteDefault }))
                .toThrow('默认文件名无效');
            expect(() => buildSaveDialogOptions({
                defaultPath: 'export.txt',
                filters: [{ name: '文本', extensions: ['../txt'] }]
            })).toThrow('文件扩展名配置无效');
            for (const invalidName of ['.', '..', ' export.txt', 'export.txt ', '\u202Etxt.exe']) {
                expect(() => buildSaveDialogOptions({ defaultPath: invalidName }))
                    .toThrow('默认文件名无效');
            }
            if (process.platform === 'win32') {
                for (const invalidName of ['CON', 'NUL.txt', 'C:secret.txt', 'report.txt.']) {
                    expect(() => buildSaveDialogOptions({ defaultPath: invalidName }))
                        .toThrow('默认文件名无效');
                }
            }
        } finally {
            fs.rmSync(path.dirname(absoluteDefault), { recursive: true, force: true });
        }
    });
});
