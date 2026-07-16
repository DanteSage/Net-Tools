const { test, expect } = require('@playwright/test');
const {
    buildPingInvocation,
    normalizePingHost,
    pingHost
} = require('../main/tools/ping');

test.describe('Ping command security', () => {
    test('accepts supported IP and hostname forms', () => {
        expect(normalizePingHost(' 192.0.2.1 ')).toBe('192.0.2.1');
        expect(normalizePingHost('2001:db8::1')).toBe('2001:db8::1');
        expect(normalizePingHost('fe80::1%12')).toBe('fe80::1%12');
        expect(normalizePingHost('Example.COM.')).toBe('example.com');
        expect(normalizePingHost('例子.测试')).toBe('xn--fsqu00a.xn--0zwm56d');
    });

    test('rejects shell and argument injection payloads', () => {
        const payloads = [
            '127.0.0.1 & calc',
            '127.0.0.1 | whoami',
            '127.0.0.1 && echo injected',
            '$(whoami)',
            '-n 100 127.0.0.1',
            'example.com\r\nwhoami'
        ];

        for (const payload of payloads) {
            expect(() => normalizePingHost(payload)).toThrow('目标主机格式无效');
        }
    });

    test('passes the validated host as one execFile argument', () => {
        const invocation = buildPingInvocation('example.com', 1500, 'win32');

        expect(invocation).toEqual({
            file: 'ping.exe',
            args: ['-n', '1', '-w', '1500', 'example.com']
        });
    });

    test('does not execute a rejected payload', async () => {
        let executed = false;
        const result = await pingHost('127.0.0.1 & calc', 1000, () => {
            executed = true;
        });

        expect(executed).toBe(false);
        expect(result).toMatchObject({
            success: false,
            time: 0,
            error: '目标主机格式无效'
        });
    });
});
