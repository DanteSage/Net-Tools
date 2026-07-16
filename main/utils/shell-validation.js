const fs = require('fs');
const path = require('path');

const MAX_EXTERNAL_URL_LENGTH = 4096;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function normalizeExternalUrl(rawUrl) {
    if (typeof rawUrl !== 'string') {
        throw new Error('外部链接必须是字符串');
    }

    if (rawUrl.length > MAX_EXTERNAL_URL_LENGTH || CONTROL_CHARACTER_PATTERN.test(rawUrl)) {
        throw new Error('外部链接格式无效');
    }

    const value = rawUrl.trim();
    if (!value) {
        throw new Error('外部链接格式无效');
    }

    let url;
    try {
        url = new URL(value);
    } catch (_) {
        throw new Error('外部链接格式无效');
    }

    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
        throw new Error(`不允许打开 ${url.protocol || '未知'} 协议链接`);
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) {
        throw new Error('外部链接缺少有效主机名');
    }
    if (url.protocol === 'mailto:' && !url.pathname) {
        throw new Error('邮件链接缺少收件人');
    }

    return url.toString();
}

function isNetworkOrDevicePath(filePath) {
    if (process.platform !== 'win32') return false;

    const windowsPath = filePath.replace(/\//g, '\\');
    return windowsPath.startsWith('\\\\') ||
        windowsPath.startsWith('\\??\\') ||
        /^\\(?:device|globalroot)\\/i.test(windowsPath);
}

function isFullyQualifiedPath(filePath) {
    if (!path.isAbsolute(filePath)) return false;
    if (process.platform !== 'win32') return true;

    return /^[a-z]:[\\/]/i.test(filePath);
}

function resolveDirectory(directoryPath) {
    if (typeof directoryPath !== 'string' || !directoryPath || CONTROL_CHARACTER_PATTERN.test(directoryPath)) {
        return null;
    }

    const normalizedPath = path.normalize(directoryPath);
    if (!isFullyQualifiedPath(normalizedPath) || isNetworkOrDevicePath(normalizedPath)) {
        return null;
    }

    try {
        const realPath = fs.realpathSync.native(normalizedPath);
        if (isNetworkOrDevicePath(realPath) || !fs.statSync(realPath).isDirectory()) {
            return null;
        }
        return realPath;
    } catch (_) {
        return null;
    }
}

function pathKey(filePath) {
    const normalizedPath = path.normalize(filePath);
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function normalizeOpenPath(filePath, allowedDirectories) {
    if (typeof filePath !== 'string' || !filePath || CONTROL_CHARACTER_PATTERN.test(filePath)) {
        throw new Error('打开路径格式无效');
    }

    const normalizedPath = path.normalize(filePath);
    if (!isFullyQualifiedPath(normalizedPath)) {
        throw new Error('打开路径必须是绝对路径');
    }
    if (isNetworkOrDevicePath(normalizedPath)) {
        throw new Error('不允许打开网络或设备路径');
    }

    let realPath;
    try {
        realPath = fs.realpathSync.native(normalizedPath);
    } catch (_) {
        throw new Error('打开路径不存在或无法访问');
    }

    if (isNetworkOrDevicePath(realPath)) {
        throw new Error('不允许打开网络或设备路径');
    }
    if (!fs.statSync(realPath).isDirectory()) {
        throw new Error('仅允许打开目录');
    }

    const allowedPathKeys = new Set(
        (Array.isArray(allowedDirectories) ? allowedDirectories : [])
            .map(resolveDirectory)
            .filter(Boolean)
            .map(pathKey)
    );

    if (!allowedPathKeys.has(pathKey(realPath))) {
        throw new Error('该目录不在允许打开的范围内');
    }

    return realPath;
}

module.exports = {
    ALLOWED_EXTERNAL_PROTOCOLS,
    MAX_EXTERNAL_URL_LENGTH,
    normalizeExternalUrl,
    normalizeOpenPath
};
