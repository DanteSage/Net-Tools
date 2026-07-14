const { test, expect } = require('@playwright/test');
const { createSSHConfig } = require('../main/connections/algorithms');

test.describe('SSH connection config', () => {
    test('enables bounded keepalive defaults', () => {
        const config = createSSHConfig({
            host: '192.0.2.1',
            username: 'admin',
            password: 'secret'
        });

        expect(config.keepaliveInterval).toBe(15000);
        expect(config.keepaliveCountMax).toBe(3);
        expect(config.readyTimeout).toBe(10000);
    });

    test('allows keepalive tuning and explicit disable', () => {
        const tuned = createSSHConfig({
            host: '192.0.2.1',
            username: 'admin',
            keepaliveInterval: 30000,
            keepaliveCountMax: 5
        });
        const disabled = createSSHConfig({
            host: '192.0.2.1',
            username: 'admin',
            keepaliveInterval: 0
        });

        expect(tuned.keepaliveInterval).toBe(30000);
        expect(tuned.keepaliveCountMax).toBe(5);
        expect(disabled.keepaliveInterval).toBe(0);
    });
});
