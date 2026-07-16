const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    validateCustomTsharkPath,
    checkTsharkVersion,
    getTsharkInterfaces
} = require('../main/utils/tshark-executable');

test.describe('Broadcast detector command security', () => {
    test('accepts only an existing absolute exe file', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-detector-'));
        const executableDir = path.join(tempDir, 'Wireshark & Tools');
        const executablePath = path.join(executableDir, 'tshark.exe');
        const wrongNamePath = path.join(tempDir, 'calc.exe');
        const wrongExtensionPath = path.join(tempDir, 'tshark.cmd');
        const directoryPath = path.join(tempDir, 'directory', 'tshark.exe');
        fs.mkdirSync(executableDir);
        fs.mkdirSync(directoryPath, { recursive: true });
        fs.writeFileSync(executablePath, 'test');
        fs.writeFileSync(wrongNamePath, 'test');
        fs.writeFileSync(wrongExtensionPath, 'test');

        try {
            expect(validateCustomTsharkPath(`  ${executablePath}  `)).toBe(fs.realpathSync.native(executablePath));
            expect(() => validateCustomTsharkPath(path.join(tempDir, 'missing', 'tshark.exe')))
                .toThrow('TShark 可执行文件不存在');
            expect(() => validateCustomTsharkPath(wrongExtensionPath))
                .toThrow('请选择名为 tshark.exe 的可执行文件');
            expect(() => validateCustomTsharkPath(wrongNamePath))
                .toThrow('请选择名为 tshark.exe 的可执行文件');
            expect(() => validateCustomTsharkPath(directoryPath))
                .toThrow('TShark 路径不是普通文件');
            expect(() => validateCustomTsharkPath('tshark.exe" & calc & "'))
                .toThrow('TShark 路径必须是绝对路径');
            expect(() => validateCustomTsharkPath('\\\\server\\share\\tshark.exe'))
                .toThrow('TShark 路径不允许使用网络或设备路径');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('passes the executable and version flag separately without a shell', async () => {
        let invocation;
        const executablePath = 'C:\\Program Files\\Wireshark\\tshark.exe';
        const result = await checkTsharkVersion(executablePath, (file, args, options, callback) => {
            invocation = { file, args, options };
            callback(null, 'TShark (Wireshark) 4.4.7\n', '');
        });

        expect(invocation.file).toBe(executablePath);
        expect(invocation.args).toEqual(['--version']);
        expect(invocation.options.shell).toBe(false);
        expect(result).toEqual({ found: true, version: '4.4.7', path: executablePath });
    });

    test('rejects a successful executable that is not actually TShark', async () => {
        const executablePath = 'C:\\Tools\\tshark.exe';
        const result = await checkTsharkVersion(executablePath, (file, args, options, callback) => {
            callback(null, 'Unrelated utility 1.0.0\n', '');
        });

        expect(result).toEqual({
            found: false,
            version: null,
            path: executablePath,
            error: '所选文件未返回有效的 TShark 版本信息'
        });
    });

    test('passes interface enumeration arguments separately without a shell', async () => {
        let invocation;
        const executablePath = 'C:\\Wireshark & Tools\\tshark.exe';
        const interfaces = await getTsharkInterfaces(executablePath, (file, args, options, callback) => {
            invocation = { file, args, options };
            callback(null, '1. Ethernet (Intel Adapter)\n2. Loopback\n', '');
        });

        expect(invocation.file).toBe(executablePath);
        expect(invocation.args).toEqual(['-D']);
        expect(invocation.options.shell).toBe(false);
        expect(interfaces).toEqual([
            { index: 1, name: 'Ethernet', description: 'Intel Adapter' },
            { index: 2, name: 'Loopback', description: 'Loopback' }
        ]);
    });

    test('does not retain shell execution in either TShark tool', () => {
        const relativePaths = [
            'main/tools/broadcast-detector.js',
            'main/tools/tshark-analyzer.js',
            'main/utils/tshark-executable.js'
        ];

        for (const relativePath of relativePaths) {
            const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
            expect(source, relativePath).not.toMatch(/\bexec\s*\(/);
            expect(source, relativePath).not.toMatch(/shell\s*:\s*true/);
        }

        for (const relativePath of relativePaths.slice(0, 2)) {
            const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
            expect(source, relativePath).toContain('validateCustomTsharkPath(customPath)');
        }
    });
});
