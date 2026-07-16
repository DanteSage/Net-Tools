const { test, expect } = require('@playwright/test');
const path = require('path');
const { registerBatchHandlers } = require('../main/batch');
const {
    MAX_BACKUP_NAME_LENGTH,
    sanitizeBackupFileStem,
    resolveBackupFilePath,
    writeUniqueBackupFile
} = require('../main/batch/backup-file');

class FakeIpcMain {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function successResult(target) {
    return {
        name: target.name || target.host,
        host: target.host,
        type: target.type,
        status: 'success',
        output: 'ok',
        error: null
    };
}

function createHarness(executeTarget, messages = [], dependencies = {}) {
    const ipcMain = new FakeIpcMain();
    const mainWindow = {
        isDestroyed: () => false,
        webContents: {
            send: (channel, payload) => messages.push({ channel, payload })
        }
    };
    registerBatchHandlers({
        getMainWindow: () => mainWindow,
        isQuitting: () => false
    }, { ...dependencies, ipcMain, executeTarget });
    return ipcMain.handlers;
}

test.describe('batch execution state', () => {
    test('rejects re-entry and pause/stop mutate the active execution state', async () => {
        const deferred = createDeferred();
        let calls = 0;
        let activeState;
        const handlers = createHarness(async (target, commands, options, state) => {
            calls += 1;
            activeState = state;
            if (calls === 1) return deferred.promise;
            return successResult(target);
        });
        const params = {
            targets: [{ host: '192.0.2.10', type: 'cisco' }],
            commands: ['show version'],
            options: { parallel: false }
        };

        const firstRun = handlers.get('batch:execute')({}, params);
        await new Promise((resolve) => setImmediate(resolve));
        const secondRun = await handlers.get('batch:execute')({}, params);
        expect(secondRun).toEqual({ success: false, error: '已有批量任务正在执行' });
        expect(calls).toBe(1);

        await handlers.get('batch:pause')({}, true);
        await handlers.get('batch:stop')();
        expect(activeState.paused).toBe(true);
        expect(activeState.shouldStop).toBe(true);

        deferred.resolve(successResult(params.targets[0]));
        await expect(firstRun).resolves.toMatchObject({ success: true });
        expect(activeState).toMatchObject({ running: false, paused: false, shouldStop: false });

        await expect(handlers.get('batch:execute')({}, params)).resolves.toMatchObject({ success: true });
        expect(calls).toBe(2);
    });

    test('waits for every parallel target and converts unexpected rejection to a failed result', async () => {
        const slowTarget = createDeferred();
        const completed = [];
        const messages = [];
        const handlers = createHarness(async (target) => {
            if (target.host === '192.0.2.20') {
                throw new Error('unexpected executor failure');
            }
            const result = await slowTarget.promise;
            completed.push(target.host);
            return result;
        }, messages);
        const params = {
            targets: [
                { host: '192.0.2.20', type: 'cisco' },
                { host: '192.0.2.21', type: 'cisco' }
            ],
            commands: ['show version'],
            options: { parallel: true, parallelCount: 2 }
        };

        let runCompleted = false;
        const run = handlers.get('batch:execute')({}, params).then((result) => {
            runCompleted = true;
            return result;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(runCompleted).toBe(false);
        await expect(handlers.get('batch:execute')({}, params)).resolves.toMatchObject({
            success: false,
            error: '已有批量任务正在执行'
        });

        slowTarget.resolve(successResult(params.targets[1]));
        const result = await run;
        expect(completed).toEqual(['192.0.2.21']);
        expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });
        expect(result.results.find(item => item.host === '192.0.2.20')).toMatchObject({
            status: 'failed',
            error: 'unexpected executor failure'
        });
        expect(messages.filter(item => item.channel === 'batch:progress')).toEqual([
            {
                channel: 'batch:progress',
                payload: expect.objectContaining({
                    host: '192.0.2.20',
                    status: 'failed',
                    error: 'unexpected executor failure'
                })
            }
        ]);
    });
});

test.describe('batch backup files', () => {
    test('sanitizes unsafe and Windows-reserved target names', () => {
        expect(sanitizeBackupFileStem('../../outside\\router')).toBe('outside_router');
        expect(sanitizeBackupFileStem('2001:db8::1')).toBe('2001_db8_1');
        expect(sanitizeBackupFileStem('CON')).toBe('_CON');
        expect(sanitizeBackupFileStem(' . . ')).toBe('unknown-target');
        expect(sanitizeBackupFileStem('设备 核心交换机')).toBe('设备 核心交换机');
        expect(sanitizeBackupFileStem('x'.repeat(500))).toHaveLength(MAX_BACKUP_NAME_LENGTH);
        const emojiName = sanitizeBackupFileStem('😀'.repeat(500));
        expect(emojiName.length).toBeLessThanOrEqual(MAX_BACKUP_NAME_LENGTH);
        expect(emojiName.endsWith('\ud83d')).toBe(false);
    });

    test('rejects any final backup path outside the configured directory', () => {
        const backupDir = path.resolve('test-backups');
        expect(resolveBackupFilePath(backupDir, 'router.txt'))
            .toBe(path.join(backupDir, 'router.txt'));
        expect(() => resolveBackupFilePath(backupDir, '../escape.txt')).toThrow();
        expect(() => resolveBackupFilePath(backupDir, '..\\escape.txt')).toThrow();
    });

    test('uses exclusive async writes and retries existing file names', async () => {
        const calls = [];
        const writeFile = async (filePath, content, options) => {
            calls.push({ filePath, content, options });
            if (calls.length === 1) {
                throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
            }
        };

        const result = await writeUniqueBackupFile({
            backupDir: path.resolve('test-backups'),
            targetName: 'router',
            timestamp: '2026-07-16T12-00-00-000Z',
            content: 'configuration',
            writeFile
        });

        expect(calls).toHaveLength(2);
        expect(calls[0].options).toEqual({ encoding: 'utf8', flag: 'wx' });
        expect(result.fileName).toMatch(/_2\.txt$/);
        expect(result.filePath).toBe(calls[1].filePath);
    });

    test('writes sanitized batch backups asynchronously without path collisions', async () => {
        const backupDir = path.resolve('test-backups');
        const writeStarted = createDeferred();
        const releaseWrite = createDeferred();
        const writes = [];
        const fsModule = {
            writeFileSync: () => {
                throw new Error('synchronous write must not be used');
            },
            promises: {
                writeFile: async (filePath, content, options) => {
                    writes.push({ filePath, content, options });
                    if (writes.length === 1) {
                        writeStarted.resolve();
                        await releaseWrite.promise;
                    }
                }
            }
        };
        const handlers = createHarness(async (target) => ({
            ...successResult(target),
            output: '\x1b[31mok\x1b[0m\r\n\r\n'
        }), [], {
            fs: fsModule,
            getBackupDir: () => backupDir
        });
        const targets = [
            { name: '../../outside\\router', host: '192.0.2.30', type: 'cisco' },
            { name: '../../outside/router', host: '192.0.2.31', type: 'cisco' },
            { host: '2001:db8::1', type: 'cisco' },
            { name: 'CON', host: '192.0.2.32', type: 'cisco' }
        ];
        let completed = false;
        const run = handlers.get('batch:execute')({}, {
            targets,
            commands: ['show running-config'],
            options: { parallel: false, saveBackup: true }
        }).then((result) => {
            completed = true;
            return result;
        });

        await writeStarted.promise;
        expect(completed).toBe(false);
        releaseWrite.resolve();
        await expect(run).resolves.toMatchObject({ success: true });

        expect(writes).toHaveLength(targets.length);
        const fileNames = writes.map(write => path.basename(write.filePath));
        expect(new Set(fileNames.map(fileName => fileName.toLowerCase())).size).toBe(targets.length);
        for (const write of writes) {
            expect(path.dirname(write.filePath)).toBe(backupDir);
            expect(path.basename(write.filePath)).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
            expect(path.basename(write.filePath)).not.toContain('..');
            expect(write.content).toBe('ok');
            expect(write.options).toEqual({ encoding: 'utf8', flag: 'wx' });
        }
    });

    test('continues saving later targets when one async backup write fails', async () => {
        const backupDir = path.resolve('test-backups');
        const attemptedFiles = [];
        const savedFiles = [];
        const originalConsoleError = console.error;
        console.error = () => {};

        try {
            const handlers = createHarness(async target => successResult(target), [], {
                getBackupDir: () => backupDir,
                writeFile: async (filePath) => {
                    attemptedFiles.push(filePath);
                    if (path.basename(filePath).startsWith('broken_')) {
                        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
                    }
                    savedFiles.push(filePath);
                }
            });

            await expect(handlers.get('batch:execute')({}, {
                targets: [
                    { name: 'broken', host: '192.0.2.40', type: 'cisco' },
                    { name: 'healthy', host: '192.0.2.41', type: 'cisco' }
                ],
                commands: ['show running-config'],
                options: { parallel: false, saveBackup: true }
            })).resolves.toMatchObject({
                success: true,
                summary: { total: 2, success: 2, failed: 0 }
            });

            expect(attemptedFiles).toHaveLength(2);
            expect(savedFiles).toHaveLength(1);
            expect(path.basename(savedFiles[0])).toMatch(/^healthy_/);
        } finally {
            console.error = originalConsoleError;
        }
    });
});
