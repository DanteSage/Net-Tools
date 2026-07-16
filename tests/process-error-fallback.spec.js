const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { test, expect } = require('@playwright/test');
const {
    buildProcessErrorLogLine,
    createProcessErrorReporter,
    registerProcessErrorHandlers
} = require('../main/utils/process-error-handler');

class FakeProcess extends EventEmitter {
    constructor(stderrOutput) {
        super();
        this.stderr = {
            write: message => stderrOutput.push(String(message))
        };
    }
}

test.describe('Main process error fallback', () => {
    test('formats errors and circular rejection values as one log line', () => {
        const circular = { operation: 'scan' };
        circular.self = circular;
        const fixedNow = () => new Date('2026-07-16T08:00:00.000Z');

        const errorLine = buildProcessErrorLogLine(
            'uncaughtException',
            new Error('socket exploded'),
            { origin: 'uncaughtException' },
            fixedNow
        );
        const rejectionLine = buildProcessErrorLogLine(
            'unhandledRejection',
            circular,
            {},
            fixedNow
        );

        expect(errorLine).toContain('[主进程未捕获异常]');
        expect(errorLine).toContain('socket exploded');
        expect(errorLine).toContain('origin=uncaughtException');
        expect(errorLine).not.toMatch(/[\r\n]/);
        expect(rejectionLine).toContain('[主进程未处理拒绝]');
        expect(rejectionLine).toContain('Circular');
        expect(rejectionLine).not.toMatch(/[\r\n]/);
    });

    test('redacts credentials from nested errors and rejection values', () => {
        const reason = {
            authorization: 'Bearer top-secret-token',
            apiKey: 'sk-sensitive-key',
            nested: {
                password: 'device-password',
                endpoint: 'https://example.com?access_token=query-secret'
            }
        };
        const line = buildProcessErrorLogLine('unhandledRejection', reason);
        const errorLine = buildProcessErrorLogLine(
            'uncaughtException',
            new Error('request failed: Authorization=Bearer another-secret')
        );

        for (const secret of [
            'top-secret-token',
            'sk-sensitive-key',
            'device-password',
            'query-secret',
            'another-secret'
        ]) {
            expect(line + errorLine).not.toContain(secret);
        }
        expect(line).toContain('[REDACTED]');
        expect(errorLine).toContain('[REDACTED]');
    });

    test('contains hostile getters and proxies during formatting', () => {
        const hostileError = new Error('hidden');
        Object.defineProperty(hostileError, 'stack', {
            get: () => {
                throw new Error('stack getter failed');
            }
        });
        Object.defineProperty(hostileError, 'name', {
            get: () => {
                throw new Error('name getter failed');
            }
        });
        const hostileProxy = new Proxy({}, {
            getPrototypeOf: () => {
                throw new Error('prototype trap failed');
            },
            get: () => {
                throw new Error('property trap failed');
            }
        });

        expect(() => buildProcessErrorLogLine('uncaughtException', hostileError)).not.toThrow();
        expect(() => buildProcessErrorLogLine('unhandledRejection', hostileProxy)).not.toThrow();
    });

    test('registers once and persists both process-level events', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-errors-'));
        const logFile = path.join(tempDir, 'logs', 'main-process-errors.log');
        const stderrOutput = [];
        const consoleOutput = [];
        const processRef = new FakeProcess(stderrOutput);

        try {
            const registration = registerProcessErrorHandlers({
                processRef,
                logFile,
                stderr: processRef.stderr,
                consoleRef: {
                    error: (...args) => consoleOutput.push(args)
                },
                now: () => new Date('2026-07-16T08:00:00.000Z')
            });
            const duplicate = registerProcessErrorHandlers({ processRef, logFile });

            expect(duplicate).toBe(registration);
            expect(processRef.listenerCount('uncaughtException')).toBe(1);
            expect(processRef.listenerCount('unhandledRejection')).toBe(1);
            expect(() => processRef.emit(
                'uncaughtException',
                new Error('uncaught test error'),
                'uncaughtException'
            )).not.toThrow();
            expect(() => processRef.emit(
                'unhandledRejection',
                { reason: 'rejected test operation' },
                Promise.resolve()
            )).not.toThrow();

            const content = fs.readFileSync(logFile, 'utf8');
            expect(content).toContain('uncaught test error');
            expect(content).toContain('rejected test operation');
            expect(content.trim().split('\n')).toHaveLength(2);
            expect(consoleOutput).toHaveLength(2);
            expect(stderrOutput).toEqual([]);

            registration.dispose();
            expect(processRef.listenerCount('uncaughtException')).toBe(0);
            expect(processRef.listenerCount('unhandledRejection')).toBe(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('never throws when console or disk logging fails', () => {
        const stderrOutput = [];
        const reporter = createProcessErrorReporter({
            logFile: 'C:\\unwritable\\main-process-errors.log',
            fsImpl: {
                mkdirSync: () => {},
                appendFileSync: () => {
                    throw new Error('disk unavailable');
                }
            },
            consoleRef: {
                error: () => {
                    throw new Error('console unavailable');
                }
            },
            stderr: {
                write: message => stderrOutput.push(String(message))
            }
        });

        expect(() => reporter('uncaughtException', new Error('original failure'))).not.toThrow();
        expect(stderrOutput.join('')).toContain('控制台输出失败');
        expect(stderrOutput.join('')).toContain('错误日志写入失败');
        expect(stderrOutput.join('')).toContain('original failure');
    });

    test('contains a throwing custom reporter instead of creating another uncaught error', () => {
        const stderrOutput = [];
        const processRef = new FakeProcess(stderrOutput);
        const registration = registerProcessErrorHandlers({
            processRef,
            logFile: null,
            stderr: processRef.stderr,
            reporter: () => {
                throw new Error('reporter failed');
            }
        });

        try {
            expect(() => processRef.emit('uncaughtException', new Error('original'))).not.toThrow();
            expect(stderrOutput.join('')).toContain('兜底回调失败');
            expect(stderrOutput.join('')).toContain('reporter failed');
        } finally {
            registration.dispose();
        }
    });

    test('registers before loading the modular main process', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
        const registrationIndex = source.indexOf('registerProcessErrorHandlers();');
        const mainIndexLoad = source.indexOf("require('./main/index');");

        expect(registrationIndex).toBeGreaterThan(-1);
        expect(mainIndexLoad).toBeGreaterThan(registrationIndex);
    });
});
