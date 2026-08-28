const fs = require('fs');
const net = require('net');
const path = require('path');
const { domainToASCII } = require('url');

function validationError(message) {
    const error = new Error(message);
    error.code = 'ERR_INVALID_INPUT';
    return error;
}

function requirePlainObject(value, name = '请求参数') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw validationError(`${name}格式不正确`);
    }
    return value;
}

function requireString(value, name, { minLength = 1, maxLength = 253 } = {}) {
    if (typeof value !== 'string') {
        throw validationError(`${name}格式不正确`);
    }
    const result = value.trim();
    if (result.length < minLength || result.length > maxLength) {
        throw validationError(`${name}长度不正确`);
    }
    return result;
}

function requireInteger(value, name, min, max) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw validationError(`${name}必须是 ${min} 至 ${max} 之间的整数`);
    }
    return number;
}

function normalizeHost(value, name = '目标地址') {
    const host = requireString(value, name);
    if (/[\u0000-\u001f\u007f\s]/.test(host) || /[&|;`$<>"'()]/.test(host)) {
        throw validationError(`${name}格式不正确`);
    }
    if (net.isIP(host)) return host;

    const asciiHost = domainToASCII(host);
    if (!asciiHost || asciiHost.length > 253 || asciiHost.endsWith('.')) {
        throw validationError(`${name}格式不正确`);
    }
    const labels = asciiHost.split('.');
    const isHostname = labels.every(label => (
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ));
    if (!isHostname) {
        throw validationError(`${name}格式不正确`);
    }
    return asciiHost.toLowerCase();
}

function requireIPv4(value, name, { allowWildcard = false } = {}) {
    const ip = requireString(value, name, { maxLength: 15 });
    if (net.isIP(ip) !== 4 || (!allowWildcard && ip === '0.0.0.0')) {
        throw validationError(`${name}必须是有效的 IPv4 地址`);
    }
    return ip;
}

function requireDirectory(value, name = '目录') {
    const directory = requireString(value, name, { maxLength: 1024 });
    if (!path.isAbsolute(directory)) {
        throw validationError(`${name}必须是绝对路径`);
    }
    let stat;
    try {
        stat = fs.statSync(directory);
    } catch (_) {
        throw validationError(`${name}不存在或无法访问`);
    }
    if (!stat.isDirectory()) {
        throw validationError(`${name}必须指向文件夹`);
    }
    return path.resolve(directory);
}

function isPathInside(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveContainedFile(rootDirectory, fileName, allowedExtensions) {
    const root = path.resolve(requireString(rootDirectory, '操作日志目录', { maxLength: 1024 }));
    const name = requireString(fileName, '操作日志文件名', { maxLength: 255 });
    if (path.isAbsolute(name) || path.basename(name) !== name || name.includes('/') || name.includes('\\')) {
        throw validationError('操作日志文件名不合法');
    }
    const extension = path.extname(name).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
        throw validationError('操作日志文件类型不受支持');
    }

    const target = path.resolve(root, name);
    if (!isPathInside(root, target)) {
        throw validationError('操作日志路径超出允许目录');
    }

    if (fs.existsSync(target)) {
        const realRoot = fs.realpathSync(root);
        const realTarget = fs.realpathSync(target);
        if (!isPathInside(realRoot, realTarget)) {
            throw validationError('操作日志路径超出允许目录');
        }
    }
    return target;
}

function resolveContainedPath(rootDirectory, relativePath) {
    const root = path.resolve(requireString(rootDirectory, '根目录', { maxLength: 1024 }));
    const relative = requireString(relativePath, '相对路径', { maxLength: 1024 });
    const target = path.resolve(root, relative.replace(/^[/\\]+/, ''));
    if (!isPathInside(root, target)) {
        throw validationError('目标路径超出允许目录');
    }

    const realRoot = fs.realpathSync(root);
    let existingAncestor = target;
    while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) throw validationError('目标路径无法解析');
        existingAncestor = parent;
    }
    const realAncestor = fs.realpathSync(existingAncestor);
    if (!isPathInside(realRoot, realAncestor)) {
        throw validationError('目标路径超出允许目录');
    }
    if (fs.existsSync(target) && !isPathInside(realRoot, fs.realpathSync(target))) {
        throw validationError('目标路径超出允许目录');
    }
    return target;
}

function assertIpcSender(event, allowedWindows, channel) {
    const sender = event && event.sender;
    if (event && event.senderFrame && sender && event.senderFrame !== sender.mainFrame) {
        throw Object.assign(new Error(`拒绝子框架 IPC 调用: ${channel}`), { code: 'ERR_UNAUTHORIZED_IPC' });
    }
    const allowed = allowedWindows.some(getWindow => {
        const win = typeof getWindow === 'function' ? getWindow() : getWindow;
        return win && !win.isDestroyed() && sender === win.webContents;
    });
    if (!allowed) {
        const error = new Error(`拒绝未授权的 IPC 调用: ${channel}`);
        error.code = 'ERR_UNAUTHORIZED_IPC';
        throw error;
    }
}

function buildPingInvocation(host, timeout, platform = process.platform) {
    const safeHost = normalizeHost(host);
    const safeTimeout = requireInteger(timeout, '超时时间', 100, 60000);
    if (platform === 'win32') {
        return { command: 'ping', args: ['-n', '1', '-w', String(safeTimeout), safeHost] };
    }
    return {
        command: 'ping',
        args: ['-c', '1', '-W', String(Math.ceil(safeTimeout / 1000)), safeHost]
    };
}

module.exports = {
    assertIpcSender,
    buildPingInvocation,
    isPathInside,
    normalizeHost,
    requireDirectory,
    requireIPv4,
    requireInteger,
    requirePlainObject,
    requireString,
    resolveContainedFile,
    resolveContainedPath,
    validationError
};
