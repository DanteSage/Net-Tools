const path = require('path');

const MAX_BACKUP_NAME_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function truncateFileStem(value) {
    let result = '';
    for (const character of value) {
        if (result.length + character.length > MAX_BACKUP_NAME_LENGTH) break;
        result += character;
    }
    return result;
}

function sanitizeBackupFileStem(value, fallback = 'unknown-target') {
    let stem;
    try {
        stem = String(value ?? '').normalize('NFKC');
    } catch (_) {
        stem = '';
    }

    stem = stem
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
        .replace(/\.{2,}/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. _]+|[. _]+$/g, '')
        .replace(/_+/g, '_');

    if (!stem) stem = fallback;
    if (WINDOWS_RESERVED_NAME.test(stem)) stem = `_${stem}`;

    stem = truncateFileStem(stem)
        .replace(/[. ]+$/g, '');
    return stem || fallback;
}

function createBackupFileName(targetName, timestamp, collisionIndex = 0) {
    const safeName = sanitizeBackupFileStem(targetName);
    const safeTimestamp = String(timestamp || Date.now())
        .replace(/[^0-9A-Za-z_-]/g, '-')
        .slice(0, 40);
    const collisionSuffix = collisionIndex > 0 ? `_${collisionIndex + 1}` : '';
    return `${safeName}_${safeTimestamp}${collisionSuffix}.txt`;
}

function resolveBackupFilePath(backupDir, fileName) {
    if (typeof backupDir !== 'string' || !backupDir.trim()) {
        throw new Error('Invalid backup directory');
    }
    if (typeof fileName !== 'string' || !fileName || /[\u0000/\\]/.test(fileName)) {
        throw new Error('Invalid backup file name');
    }

    const resolvedDir = path.resolve(backupDir);
    const filePath = path.resolve(resolvedDir, fileName);
    const relativePath = path.relative(resolvedDir, filePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativePath)) {
        throw new Error('Backup file path escapes the backup directory');
    }
    return filePath;
}

async function writeUniqueBackupFile(options) {
    const {
        backupDir,
        targetName,
        timestamp,
        content,
        writeFile,
        usedFileNames = new Set()
    } = options;
    if (typeof writeFile !== 'function') {
        throw new TypeError('writeFile must be a function');
    }

    for (let collisionIndex = 0; collisionIndex < 10000; collisionIndex += 1) {
        const fileName = createBackupFileName(targetName, timestamp, collisionIndex);
        const normalizedFileName = fileName.toLowerCase();
        if (usedFileNames.has(normalizedFileName)) continue;

        const filePath = resolveBackupFilePath(backupDir, fileName);
        try {
            await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
            usedFileNames.add(normalizedFileName);
            return { fileName, filePath };
        } catch (error) {
            if (error && error.code === 'EEXIST') {
                usedFileNames.add(normalizedFileName);
                continue;
            }
            throw error;
        }
    }

    throw new Error('Unable to allocate a unique backup file name');
}

module.exports = {
    MAX_BACKUP_NAME_LENGTH,
    sanitizeBackupFileStem,
    createBackupFileName,
    resolveBackupFilePath,
    writeUniqueBackupFile
};
