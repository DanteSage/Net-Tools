const { test, expect } = require('@playwright/test');
const {
    getTerminalSource,
    setTerminalSourcePaused
} = require('../main/connections/terminal-flow-control');

test.describe('terminal source flow control', () => {
    test('finds SSH shells before other connection types', () => {
        const ssh = {};
        const telnet = {};
        const context = {
            activeConnections: new Map([['conn_shell', ssh]]),
            activeTelnetConnections: new Map([['conn', telnet]]),
            activeSerialPorts: new Map()
        };

        expect(getTerminalSource(context, 'conn')).toBe(ssh);
    });

    test('pauses and resumes idempotently', () => {
        let pauses = 0;
        let resumes = 0;
        const source = {
            pause: () => pauses++,
            resume: () => resumes++
        };

        expect(setTerminalSourcePaused(source, true)).toBe(true);
        expect(setTerminalSourcePaused(source, true)).toBe(true);
        expect(setTerminalSourcePaused(source, false)).toBe(true);
        expect(pauses).toBe(1);
        expect(resumes).toBe(1);
    });
});
