const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    assertIpcSender,
    buildPingInvocation,
    normalizeHost,
    resolveContainedFile,
    resolveContainedPath
} = require('../main/utils/security');
const {
    validateDhcpServerConfig,
    validateFtpServerConfig,
    validateNetcatListenConfig,
    validateTftpServerConfig
} = require('../main/tools/server-config');

test.describe('system command boundaries', () => {
    test('builds ping as a fixed executable with an argument array', () => {
        expect(buildPingInvocation('example.com', 3000, 'win32')).toEqual({
            command: 'ping',
            args: ['-n', '1', '-w', '3000', 'example.com']
        });
    });

    for (const maliciousHost of [
        'example.com & whoami',
        'example.com|whoami',
        'example.com\nwhoami',
        '"example.com"',
        '$(whoami)'
    ]) {
        test(`rejects command injection input: ${JSON.stringify(maliciousHost)}`, () => {
            expect(() => normalizeHost(maliciousHost)).toThrow(/格式不正确/);
        });
    }

    test('accepts IPv4, IPv6 and normalized international hostnames', () => {
        expect(normalizeHost('192.0.2.1')).toBe('192.0.2.1');
        expect(normalizeHost('2001:db8::1')).toBe('2001:db8::1');
        expect(normalizeHost('例子.测试')).toBe('xn--fsqu00a.xn--0zwm56d');
    });
});

test.describe('IPC sender boundaries', () => {
    test('accepts the expected window and rejects another sender', () => {
        const mainFrame = {};
        const expectedWebContents = { mainFrame };
        const expectedWindow = {
            isDestroyed: () => false,
            webContents: expectedWebContents
        };
        expect(() => assertIpcSender(
            { sender: expectedWebContents },
            [expectedWindow],
            'test:channel'
        )).not.toThrow();
        expect(() => assertIpcSender(
            { sender: {} },
            [expectedWindow],
            'test:channel'
        )).toThrow(/未授权的 IPC/);
        expect(() => assertIpcSender(
            { sender: expectedWebContents, senderFrame: {} },
            [expectedWindow],
            'test:channel'
        )).toThrow(/子框架 IPC/);
    });
});

test.describe('operation log path boundaries', () => {
    let root;

    test.beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'net-tools-oplog-'));
        fs.writeFileSync(path.join(root, 'valid.txt'), 'ok');
    });

    test.afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('resolves an allowed log file inside the configured directory', () => {
        expect(resolveContainedFile(root, 'valid.txt', ['.txt', '.md']))
            .toBe(path.join(root, 'valid.txt'));
    });

    for (const invalidName of ['../secret.txt', '..\\secret.txt', 'nested/log.txt', 'log.json']) {
        test(`rejects invalid log path: ${invalidName}`, () => {
            expect(() => resolveContainedFile(root, invalidName, ['.txt', '.md'])).toThrow();
        });
    }

    test('rejects absolute paths', () => {
        const absolutePath = path.resolve(root, '..', 'secret.txt');
        expect(() => resolveContainedFile(root, absolutePath, ['.txt', '.md'])).toThrow();
    });

    test('rejects a symbolic link that escapes the configured directory', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'net-tools-outside-'));
        const outsideFile = path.join(outside, 'secret.txt');
        const link = path.join(root, 'linked.txt');
        fs.writeFileSync(outsideFile, 'secret');
        try {
            fs.symlinkSync(outsideFile, link, 'file');
        } catch (error) {
            return;
        }
        try {
            expect(() => resolveContainedFile(root, 'linked.txt', ['.txt', '.md'])).toThrow(/超出允许目录/);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('rejects new files created below a symbolic link that escapes the root', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'net-tools-outside-dir-'));
        const link = path.join(root, 'linked-dir');
        try {
            fs.symlinkSync(outside, link, 'junction');
        } catch (error) {
            fs.rmSync(outside, { recursive: true, force: true });
            return;
        }
        try {
            expect(() => resolveContainedPath(root, path.join('linked-dir', 'new.txt')))
                .toThrow(/超出允许目录/);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});

test.describe('network service defaults and validation', () => {
    let root;

    test.beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'net-tools-service-'));
    });

    test.afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('defaults Netcat listening to loopback', () => {
        expect(validateNetcatListenConfig({ port: 9000 })).toEqual({
            host: '127.0.0.1',
            port: 9000
        });
    });

    test('requires explicit confirmation before listening on every interface', () => {
        expect(() => validateNetcatListenConfig({ host: '0.0.0.0', port: 9000 }))
            .toThrow(/显式确认/);
        expect(validateNetcatListenConfig({
            host: '0.0.0.0',
            port: 9000,
            exposeAllInterfaces: true
        }).host).toBe('0.0.0.0');
    });

    test('requires FTP credentials and an explicitly selected root directory', () => {
        expect(() => validateFtpServerConfig({
            port: 21,
            username: 'operator',
            password: '',
            rootDirectory: root,
            timeout: 300
        })).toThrow(/密码/);
        expect(validateFtpServerConfig({
            port: 21,
            username: 'operator',
            password: 'test-password',
            rootDirectory: root,
            timeout: 300
        }).host).toBe('127.0.0.1');
    });

    test('requires explicit confirmation for anonymous FTP', () => {
        const config = {
            port: 21,
            username: 'anonymous',
            password: 'test-password',
            rootDirectory: root,
            timeout: 300
        };
        expect(() => validateFtpServerConfig(config)).toThrow(/匿名访问需要显式确认/);
        expect(validateFtpServerConfig({ ...config, allowAnonymous: true }).username).toBe('anonymous');
    });

    test('keeps TFTP write access disabled unless explicitly enabled', () => {
        expect(validateTftpServerConfig({
            port: 69,
            rootDirectory: root,
            timeout: 3,
            retries: 5,
            maxBlockSize: 1468
        }).writable).toBe(false);
    });

    test('validates DHCP interface, pool ordering and subnet boundaries', () => {
        const config = {
            interfaceIp: '192.168.10.1',
            startIp: '192.168.10.100',
            endIp: '192.168.10.200',
            subnetMask: '255.255.255.0',
            gateway: '192.168.10.1',
            dnsList: ['1.1.1.1'],
            leaseTime: 3600
        };
        expect(validateDhcpServerConfig(config).interfaceIp).toBe('192.168.10.1');
        expect(() => validateDhcpServerConfig({ ...config, interfaceIp: '0.0.0.0' }))
            .toThrow(/有效的 IPv4/);
        expect(() => validateDhcpServerConfig({ ...config, endIp: '192.168.11.200' }))
            .toThrow(/同一网段/);
        expect(() => validateDhcpServerConfig({ ...config, gateway: '192.168.11.1' }))
            .toThrow(/默认网关必须.*同一网段/);
        expect(() => validateDhcpServerConfig({ ...config, startIp: '192.168.10.0' }))
            .toThrow(/网络地址或广播地址/);
        expect(() => validateDhcpServerConfig({ ...config, startIp: '192.168.10.1' }))
            .toThrow(/服务端网卡地址/);
        expect(() => validateDhcpServerConfig({
            ...config,
            startIp: '192.168.10.200',
            endIp: '192.168.10.100'
        })).toThrow(/起始地址不能大于结束地址/);
    });
});
