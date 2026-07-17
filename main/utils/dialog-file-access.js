const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_WRITE_BYTES = 128 * 1024 * 1024;
const MAX_DIALOG_FILTERS = 16;
const MAX_FILTER_EXTENSIONS = 16;
const DEFAULT_FILE_FILTERS = Object.freeze([
    { name: '所有文件', extensions: ['*'] }
]);

function normalizeDialogFilters(filters) {
    if (filters === undefined) {
        return DEFAULT_FILE_FILTERS.map(filter => ({
            name: filter.name,
            extensions: [...filter.extensions]
        }));
    }
    if (!Array.isArray(filters) || filters.length === 0 || filters.length > MAX_DIALOG_FILTERS) {
        throw new TypeError('文件类型筛选配置无效');
    }

    return filters.map(filter => {
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
            throw new TypeError('文件类型筛选配置无效');
        }
        if (typeof filter.name !== 'string'
            || filter.name.length === 0
            || filter.name.length > 128
            || /[\0-\x1F\x7F]/.test(filter.name)) {
            throw new TypeError('文件类型名称无效');
        }
        if (!Array.isArray(filter.extensions)
            || filter.extensions.length === 0
            || filter.extensions.length > MAX_FILTER_EXTENSIONS) {
            throw new TypeError('文件扩展名配置无效');
        }

        const extensions = filter.extensions.map(extension => {
            if (typeof extension !== 'string'
                || !/^(?:\*|[A-Za-z0-9][A-Za-z0-9_-]{0,31})$/.test(extension)) {
                throw new TypeError('文件扩展名配置无效');
            }
            return extension;
        });
        return { name: filter.name, extensions };
    });
}

function normalizeDefaultFileName(defaultPath) {
    if (defaultPath === undefined) {
        return undefined;
    }
    const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    if (typeof defaultPath !== 'string'
        || defaultPath.length === 0
        || defaultPath.length > 255
        || /[\0-\x1F\x7F]/.test(defaultPath)
        || /[\u202A-\u202E\u2066-\u2069]/.test(defaultPath)
        || defaultPath.trim() !== defaultPath
        || defaultPath === '.'
        || defaultPath === '..'
        || path.basename(defaultPath) !== defaultPath
        || defaultPath.includes('/')
        || defaultPath.includes('\\')
        || path.isAbsolute(defaultPath)
        || (process.platform === 'win32' && (
            /[<>:"|?*]/.test(defaultPath)
            || /[. ]$/.test(defaultPath)
            || windowsReservedName.test(defaultPath)
        ))) {
        throw new TypeError('默认文件名无效');
    }
    return defaultPath;
}

function buildOpenDialogOptions(options = {}) {
    return {
        properties: ['openFile'],
        filters: normalizeDialogFilters(options?.filters)
    };
}

function buildSaveDialogOptions(options = {}) {
    const normalized = {
        filters: normalizeDialogFilters(options?.filters)
    };
    const defaultPath = normalizeDefaultFileName(options?.defaultPath);
    if (defaultPath !== undefined) {
        normalized.defaultPath = defaultPath;
    }
    return normalized;
}

function isSameFrame(frame, mainFrame) {
    if (frame === mainFrame) {
        return true;
    }
    return !!frame
        && !!mainFrame
        && Number.isInteger(frame.processId)
        && Number.isInteger(frame.routingId)
        && Number.isInteger(mainFrame.processId)
        && Number.isInteger(mainFrame.routingId)
        && frame.processId === mainFrame.processId
        && frame.routingId === mainFrame.routingId;
}

function normalizePathForComparison(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertTrustedMainFrame(event, mainWindow, trustedEntryPath) {
    if (!mainWindow
        || (typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed())
        || !event
        || event.sender !== mainWindow.webContents) {
        throw new Error('不允许当前窗口执行文件操作');
    }

    const mainFrame = event.sender && event.sender.mainFrame;
    if (!event.senderFrame || !mainFrame || !isSameFrame(event.senderFrame, mainFrame)) {
        throw new Error('不允许子框架执行文件操作');
    }
    try {
        const frameUrl = new URL(mainFrame.url);
        if (frameUrl.protocol !== 'file:'
            || frameUrl.host
            || frameUrl.username
            || frameUrl.password
            || frameUrl.search
            || frameUrl.hash
            || typeof trustedEntryPath !== 'string'
            || normalizePathForComparison(fileURLToPath(frameUrl))
                !== normalizePathForComparison(trustedEntryPath)) {
            throw new Error('untrusted frame URL');
        }
    } catch (_) {
        throw new Error('不允许非应用页面执行文件操作');
    }
}

function validateSelectedPath(filePath) {
    if (typeof filePath !== 'string'
        || filePath.length === 0
        || filePath.length > 32767
        || /[\0-\x1F\x7F]/.test(filePath)
        || !path.isAbsolute(filePath)) {
        throw new TypeError('文件路径无效');
    }
    return path.resolve(filePath);
}

function realpathSyncNative(fsModule, filePath) {
    if (fsModule.realpathSync && typeof fsModule.realpathSync.native === 'function') {
        return fsModule.realpathSync.native(filePath);
    }
    return fsModule.realpathSync(filePath);
}

function normalizeSelectedReadPath(filePath, fsModule = fs) {
    return validateSelectedPath(filePath);
}

function normalizeSelectedWritePath(filePath, fsModule = fs) {
    return inspectSelectedWritePath(filePath, fsModule).filePath;
}

function inspectSelectedWritePath(filePath, fsModule = fs) {
    const resolvedPath = validateSelectedPath(filePath);
    const fileName = path.basename(resolvedPath);
    if (fileName.length === 0 || fileName === '.' || fileName === '..') {
        throw new TypeError('文件名无效');
    }

    const parentPath = realpathSyncNative(fsModule, path.dirname(resolvedPath));
    const parentStats = fsModule.lstatSync(parentPath, { bigint: true });
    if (!parentStats.isDirectory()) {
        throw new TypeError('保存目录无效');
    }
    return {
        filePath: path.join(parentPath, fileName),
        parentPath,
        parentStats
    };
}

function decodeTextBuffer(buffer) {
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return buffer.slice(3).toString('utf8');
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return buffer.slice(2).toString('utf16le');
    }
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
        const swapped = Buffer.alloc(buffer.length - 2);
        for (let i = 2; i < buffer.length - 1; i += 2) {
            swapped[i - 2] = buffer[i + 1];
            swapped[i - 1] = buffer[i];
        }
        return swapped.toString('utf16le');
    }

    const utf8Text = buffer.toString('utf8');
    if (utf8Text.includes('\uFFFD') || /[\x80-\xFF]/.test(utf8Text.slice(0, 100))) {
        try {
            const iconv = require('iconv-lite');
            const gbkText = iconv.decode(buffer, 'gbk');
            if (/[\u4e00-\u9fa5]/.test(gbkText)) {
                return gbkText;
            }
        } catch (_) {
            // iconv-lite 不可用时保留 UTF-8 解码结果。
        }
    }
    return utf8Text;
}

function sameFileIdentity(expected, actual) {
    return expected.dev === actual.dev && expected.ino === actual.ino;
}

function readBoundedFileDescriptor(fileDescriptor, fsModule = fs) {
    const chunks = [];
    let totalBytes = 0;

    while (totalBytes <= MAX_TEXT_FILE_BYTES) {
        const remaining = MAX_TEXT_FILE_BYTES + 1 - totalBytes;
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
        const bytesRead = fsModule.readSync(
            fileDescriptor,
            chunk,
            0,
            chunk.length,
            null
        );
        if (bytesRead === 0) {
            break;
        }
        chunks.push(chunk.subarray(0, bytesRead));
        totalBytes += bytesRead;
    }

    if (totalBytes > MAX_TEXT_FILE_BYTES) {
        throw new RangeError('文件过大');
    }
    return Buffer.concat(chunks, totalBytes);
}

function readSelectedTextFile(filePath, fsModule = fs) {
    const safePath = normalizeSelectedReadPath(filePath, fsModule);
    const expectedStats = fsModule.lstatSync(safePath, { bigint: true });
    if (expectedStats.isSymbolicLink() || !expectedStats.isFile()) {
        throw new TypeError('仅允许读取普通文件');
    }
    if (expectedStats.size > BigInt(MAX_TEXT_FILE_BYTES)) {
        throw new RangeError('文件过大');
    }
    const noFollowFlag = process.platform === 'win32'
        ? 0
        : (fsModule.constants.O_NOFOLLOW || 0);
    const fileDescriptor = fsModule.openSync(
        safePath,
        fsModule.constants.O_RDONLY | noFollowFlag
    );

    try {
        const openedStats = fsModule.fstatSync(fileDescriptor, { bigint: true });
        if (!openedStats.isFile() || !sameFileIdentity(expectedStats, openedStats)) {
            throw new Error('文件在读取前已被替换');
        }
        if (openedStats.size > BigInt(MAX_TEXT_FILE_BYTES)) {
            throw new RangeError('文件过大');
        }
        const buffer = readBoundedFileDescriptor(fileDescriptor, fsModule);
        return {
            filePath: safePath,
            content: decodeTextBuffer(buffer)
        };
    } finally {
        fsModule.closeSync(fileDescriptor);
    }
}

function validateTextContent(content) {
    if (typeof content !== 'string') {
        throw new TypeError('文件内容必须是文本');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_WRITE_BYTES) {
        throw new RangeError('文件内容过大');
    }
}

function assertSameDirectory(parentPath, expectedStats, fsModule) {
    const currentStats = fsModule.lstatSync(parentPath, { bigint: true });
    if (!currentStats.isDirectory() || !sameFileIdentity(expectedStats, currentStats)) {
        throw new Error('保存目录在写入前已被替换');
    }
}

function writeAllToDescriptor(fileDescriptor, content, fsModule) {
    const buffer = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < buffer.length) {
        const bytesWritten = fsModule.writeSync(
            fileDescriptor,
            buffer,
            offset,
            buffer.length - offset,
            null
        );
        if (bytesWritten <= 0) {
            throw new Error('写入文件失败');
        }
        offset += bytesWritten;
    }
}

function writeSelectedTextFile(filePath, content, dependencies = {}) {
    const fsModule = dependencies.fs || fs;
    const cryptoModule = dependencies.crypto || crypto;
    validateTextContent(content);
    const selectedPath = inspectSelectedWritePath(filePath, fsModule);
    const safePath = selectedPath.filePath;
    const temporaryPath = path.join(
        path.dirname(safePath),
        `.${path.basename(safePath)}.${process.pid}.${cryptoModule.randomBytes(8).toString('hex')}.tmp`
    );

    let fileDescriptor = null;
    try {
        fileDescriptor = fsModule.openSync(
            temporaryPath,
            fsModule.constants.O_WRONLY
                | fsModule.constants.O_CREAT
                | fsModule.constants.O_EXCL,
            0o600
        );
        assertSameDirectory(selectedPath.parentPath, selectedPath.parentStats, fsModule);
        writeAllToDescriptor(fileDescriptor, content, fsModule);
        assertSameDirectory(selectedPath.parentPath, selectedPath.parentStats, fsModule);
        fsModule.closeSync(fileDescriptor);
        fileDescriptor = null;
        assertSameDirectory(selectedPath.parentPath, selectedPath.parentStats, fsModule);
        fsModule.renameSync(temporaryPath, safePath);
        return safePath;
    } catch (error) {
        if (fileDescriptor !== null) {
            try {
                fsModule.closeSync(fileDescriptor);
            } catch (_) {
                // 文件描述符可能已关闭。
            }
        }
        try {
            fsModule.unlinkSync(temporaryPath);
        } catch (_) {
            // 临时文件可能没有创建成功或已经完成 rename。
        }
        throw error;
    }
}

function registerTextFileDialogHandlers(options) {
    const ipc = options.ipcMain;
    const dialogApi = options.dialog;
    const getMainWindow = options.getMainWindow;
    const fsModule = options.fs || fs;
    const cryptoModule = options.crypto || crypto;
    const trustedEntryPath = options.trustedEntryPath;

    ipc.handle('dialog:readTextFile', async (event, dialogOptions) => {
        try {
            const mainWindow = getMainWindow();
            assertTrustedMainFrame(event, mainWindow, trustedEntryPath);
            const result = await dialogApi.showOpenDialog(
                mainWindow,
                buildOpenDialogOptions(dialogOptions)
            );
            if (result.canceled || result.filePaths.length === 0) {
                return null;
            }
            assertTrustedMainFrame(event, getMainWindow(), trustedEntryPath);
            return readSelectedTextFile(result.filePaths[0], fsModule);
        } catch (error) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
    });

    ipc.handle('dialog:writeTextFile', async (event, dialogOptions, content) => {
        try {
            const mainWindow = getMainWindow();
            assertTrustedMainFrame(event, mainWindow, trustedEntryPath);
            validateTextContent(content);
            const result = await dialogApi.showSaveDialog(
                mainWindow,
                buildSaveDialogOptions(dialogOptions)
            );
            if (result.canceled || !result.filePath) {
                return null;
            }
            assertTrustedMainFrame(event, getMainWindow(), trustedEntryPath);
            const filePath = writeSelectedTextFile(result.filePath, content, {
                fs: fsModule,
                crypto: cryptoModule
            });
            return { success: true, filePath };
        } catch (error) {
            throw new Error(`写入文件失败: ${error.message}`);
        }
    });
}

module.exports = {
    MAX_TEXT_FILE_BYTES,
    MAX_TEXT_WRITE_BYTES,
    assertTrustedMainFrame,
    buildOpenDialogOptions,
    buildSaveDialogOptions,
    decodeTextBuffer,
    normalizeSelectedReadPath,
    normalizeSelectedWritePath,
    readSelectedTextFile,
    registerTextFileDialogHandlers,
    writeSelectedTextFile
};
