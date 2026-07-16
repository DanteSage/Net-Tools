const fs = require('fs');
const path = require('path');
const { inspect } = require('util');

const REGISTRATION_KEY = Symbol.for('net-tools.process-error-handlers');
const MAX_MESSAGE_LENGTH = 2000;
const MAX_DETAILS_LENGTH = 32768;
const SENSITIVE_KEY_PATTERN = '(?:authorization|api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token|credential)';

function redactSensitiveText(value) {
    return String(value)
        .replace(/\bBearer\s+[^\s,;}"]+/gi, 'Bearer [REDACTED]')
        .replace(new RegExp(`(${SENSITIVE_KEY_PATTERN}\\s*[:=]\\s*)(['\"\x60])([\\s\\S]*?)\\2`, 'gi'), '$1$2[REDACTED]$2')
        .replace(new RegExp(`(${SENSITIVE_KEY_PATTERN}\\s*[:=]\\s*)[^\\s,;}"]+`, 'gi'), '$1[REDACTED]')
        .replace(/([?&](?:api[-_]?key|access[-_]?token|password)=)[^&#\s]+/gi, '$1[REDACTED]');
}

function describeError(value) {
    try {
        if (value instanceof Error) {
            return redactSensitiveText(value.stack || `${value.name}: ${value.message}`);
        }
        if (typeof value === 'string') return redactSensitiveText(value);

        return redactSensitiveText(inspect(value, {
            depth: 6,
            maxArrayLength: 100,
            breakLength: Infinity,
            compact: true,
            customInspect: false,
            getters: false
        }));
    } catch (_) {
        try {
            return redactSensitiveText(String(value));
        } catch (_) {
            return '[无法格式化的异常值]';
        }
    }
}

function sanitizeLogField(value, maxLength) {
    return String(value)
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '?')
        .replace(/\|\|\|/g, '| | |')
        .slice(0, maxLength);
}

function buildProcessErrorLogLine(type, value, metadata = {}, now = () => new Date()) {
    const description = describeError(value);
    const firstLine = description.split(/\r?\n/, 1)[0] || '未知错误';
    const title = type === 'unhandledRejection' ? '主进程未处理拒绝' : '主进程未捕获异常';
    const origin = metadata.origin ? `origin=${metadata.origin}; ` : '';
    const message = sanitizeLogField(`${type}: ${firstLine}`, MAX_MESSAGE_LENGTH);
    const details = sanitizeLogField(`${origin}${description}`, MAX_DETAILS_LENGTH);
    return `[${now().toISOString()}] [ERROR] [${title}] ${message} ||| ${details}`;
}

function safeWriteStderr(stderr, message) {
    try {
        stderr?.write(message);
    } catch (_) {}
}

function createProcessErrorReporter(options = {}) {
    const fsImpl = options.fsImpl || fs;
    const logFile = options.logFile || null;
    const consoleRef = options.consoleRef || console;
    const stderr = options.stderr || process.stderr;
    const now = options.now || (() => new Date());
    let reporting = false;

    return function reportProcessError(type, value, metadata = {}) {
        let line;
        try {
            line = buildProcessErrorLogLine(type, value, metadata, now);
        } catch (_) {
            line = `[${new Date().toISOString()}] [ERROR] [主进程异常] ${type}: 日志格式化失败`;
        }

        if (reporting) {
            safeWriteStderr(stderr, `[主进程兜底重入] ${line}\n`);
            return line;
        }

        reporting = true;
        try {
            try {
                consoleRef.error(line);
            } catch (consoleError) {
                safeWriteStderr(stderr, `[主进程控制台输出失败] ${describeError(consoleError)}\n`);
            }

            if (logFile) {
                try {
                    fsImpl.mkdirSync(path.dirname(logFile), { recursive: true });
                    fsImpl.appendFileSync(logFile, `${line}\n`, 'utf8');
                } catch (writeError) {
                    safeWriteStderr(stderr, `[主进程错误日志写入失败] ${describeError(writeError)}\n${line}\n`);
                }
            } else {
                safeWriteStderr(stderr, `${line}\n`);
            }
        } catch (handlerError) {
            safeWriteStderr(stderr, `[主进程兜底处理失败] ${describeError(handlerError)}\n`);
        } finally {
            reporting = false;
        }

        return line;
    };
}

function resolveDefaultLogFile() {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'logs', 'main-process-errors.log');
}

function registerProcessErrorHandlers(options = {}) {
    const processRef = options.processRef || process;
    if (processRef[REGISTRATION_KEY]) return processRef[REGISTRATION_KEY];

    const stderr = options.stderr || processRef.stderr;
    let logFile = options.logFile;
    if (logFile === undefined) {
        try {
            logFile = resolveDefaultLogFile();
        } catch (error) {
            logFile = null;
            safeWriteStderr(stderr, `[主进程错误日志路径解析失败] ${describeError(error)}\n`);
        }
    }

    const reporter = options.reporter || createProcessErrorReporter({
        fsImpl: options.fsImpl,
        logFile,
        consoleRef: options.consoleRef,
        stderr,
        now: options.now
    });
    const safeReport = (type, value, metadata) => {
        try {
            reporter(type, value, metadata);
        } catch (error) {
            safeWriteStderr(stderr, `[主进程兜底回调失败] ${describeError(error)}\n`);
        }
    };

    const onUncaughtException = (error, origin) => {
        safeReport('uncaughtException', error, { origin });
    };
    const onUnhandledRejection = reason => {
        safeReport('unhandledRejection', reason);
    };

    processRef.on('uncaughtException', onUncaughtException);
    processRef.on('unhandledRejection', onUnhandledRejection);

    const registration = {
        onUncaughtException,
        onUnhandledRejection,
        dispose() {
            processRef.removeListener('uncaughtException', onUncaughtException);
            processRef.removeListener('unhandledRejection', onUnhandledRejection);
            if (processRef[REGISTRATION_KEY] === registration) {
                delete processRef[REGISTRATION_KEY];
            }
        }
    };

    Object.defineProperty(processRef, REGISTRATION_KEY, {
        value: registration,
        configurable: true
    });
    return registration;
}

module.exports = {
    buildProcessErrorLogLine,
    createProcessErrorReporter,
    registerProcessErrorHandlers
};
