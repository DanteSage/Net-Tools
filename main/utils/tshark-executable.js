const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TSHARK_SEARCH_PATHS = [
    'tshark',
    'C:\\Program Files\\Wireshark\\tshark.exe',
    'C:\\Program Files (x86)\\Wireshark\\tshark.exe'
];

function runTshark(executablePath, args, options = {}, runExecFile = execFile) {
    return new Promise((resolve, reject) => {
        runExecFile(executablePath, args, {
            ...options,
            windowsHide: true,
            encoding: 'utf8',
            shell: false
        }, (error, stdout = '', stderr = '') => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function validateCustomTsharkPath(customPath) {
    if (typeof customPath !== 'string' || !customPath.trim()) {
        throw new Error('TShark 路径无效');
    }

    const normalizedPath = path.normalize(customPath.trim());
    if (!path.isAbsolute(normalizedPath)) {
        throw new Error('TShark 路径必须是绝对路径');
    }
    if (normalizedPath.startsWith('\\\\')) {
        throw new Error('TShark 路径不允许使用网络或设备路径');
    }
    let realPath;
    try {
        realPath = fs.realpathSync.native(normalizedPath);
    } catch (_) {
        throw new Error('TShark 可执行文件不存在');
    }
    if (realPath.startsWith('\\\\')) {
        throw new Error('TShark 路径不允许使用网络或设备路径');
    }
    if (path.basename(realPath).toLowerCase() !== 'tshark.exe') {
        throw new Error('请选择名为 tshark.exe 的可执行文件');
    }

    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
        throw new Error('TShark 路径不是普通文件');
    }

    return realPath;
}

async function checkTsharkVersion(targetPath, runExecFile = execFile) {
    try {
        const { stdout } = await runTshark(
            targetPath,
            ['--version'],
            { timeout: 4000 },
            runExecFile
        );
        const match = stdout.match(/TShark[^\d]*(\d+\.\d+\.\d+)/i);
        if (!match) {
            return {
                found: false,
                version: null,
                path: targetPath,
                error: '所选文件未返回有效的 TShark 版本信息'
            };
        }
        return { found: true, version: match[1], path: targetPath };
    } catch (error) {
        return { found: false, version: null, path: targetPath, error: error.message };
    }
}

async function findTshark() {
    for (const candidate of TSHARK_SEARCH_PATHS) {
        const result = await checkTsharkVersion(candidate);
        if (result.found) return candidate;
    }
    return null;
}

async function getTsharkInterfaces(targetPath, runExecFile = execFile) {
    let stdout = '';
    try {
        ({ stdout } = await runTshark(targetPath, ['-D'], { timeout: 5000 }, runExecFile));
    } catch (error) {
        stdout = error.stdout || '';
    }
    if (!stdout) return [];

    return stdout.split('\n').filter(line => line.trim()).map(line => {
        const match = line.match(/^(\d+)\.\s+(.+?)(?:\s+\((.+)\))?\s*$/);
        if (!match) return null;
        return {
            index: parseInt(match[1]),
            name: match[2].trim(),
            description: (match[3] || match[2]).trim()
        };
    }).filter(Boolean);
}

module.exports = {
    runTshark,
    validateCustomTsharkPath,
    checkTsharkVersion,
    findTshark,
    getTsharkInterfaces
};
