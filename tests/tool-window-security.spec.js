const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
    TOOL_IPC_SCOPES,
    hasCapability,
    isChannelAllowed
} = require('../main/utils/tool-ipc-scopes');

const root = path.join(__dirname, '..');
const rendererFiles = {
    ping: 'ping test/index.html',
    portscanner: 'port test/index.html',
    traceroute: 'Route Tracking/index.html',
    netcat: 'Netcat/renderer.js',
    'tshark-analyzer': 'TsharkAnalyzer/renderer.js',
    'broadcast-detector': 'BroadcastDetector/renderer.js',
    'ftp-client': 'FtpClient/index.html',
    'ftp-server': 'FtpServer/index.html',
    'tftp-server': 'TftpServer/index.html',
    'dhcp-server': 'DhcpServer/index.html',
    speedtest: 'Speed test/server-ui.html',
    'dns-lookup': 'DNS Lookup/renderer.js',
    subnetting: 'Subnetting/index.html',
    'ipv6-subnetting': 'IPv6Subnetting/index.html'
};

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test.describe('tool window isolation', () => {
    test('forces isolated renderers through the scoped preload', () => {
        const source = read('main/utils/toolWindow.js');

        expect(source).toContain('nodeIntegration: false');
        expect(source).toContain('contextIsolation: true');
        expect(source).toContain("preload: path.join(__dirname, 'tool-preload.js')");
        expect(source).not.toContain('nodeIntegration: true');
    });

    test('assigns every shared tool window a known security scope', () => {
        const toolFiles = fs.readdirSync(path.join(root, 'main', 'tools'))
            .filter(name => name.endsWith('.js'));
        const configuredIds = [];

        for (const name of toolFiles) {
            const source = read(path.join('main', 'tools', name));
            if (!source.includes('createToolWindow({')) continue;
            const matches = [...source.matchAll(/createToolWindow\(\{[\s\S]*?toolId:\s*'([^']+)'/g)];
            expect(matches.length, `${name} must declare toolId`).toBeGreaterThan(0);
            configuredIds.push(...matches.map(match => match[1]));
        }

        expect(new Set(configuredIds)).toEqual(new Set(Object.keys(TOOL_IPC_SCOPES)));
    });

    test('does not expose Node require to shared tool renderers', () => {
        for (const relativePath of Object.values(rendererFiles)) {
            expect(read(relativePath), relativePath).not.toMatch(/\brequire\s*\(/);
        }
    });

    test('keeps migrated inline scripts syntactically valid', () => {
        const htmlFiles = [
            ...Object.values(rendererFiles).filter(relativePath => relativePath.endsWith('.html')),
            'BroadcastDetector/index.html'
        ];
        for (const relativePath of htmlFiles) {
            const html = read(relativePath);
            const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
            for (const [, source] of scripts) {
                if (!source.trim()) continue;
                expect(() => new Function(source), relativePath).not.toThrow();
            }
        }
    });

    test('keeps IPC permissions separated by tool', () => {
        expect(isChannelAllowed('ftp-client', 'invoke', 'ftp:list')).toBe(true);
        expect(isChannelAllowed('ftp-client', 'receive', 'ftp:log:connection-1')).toBe(true);
        expect(isChannelAllowed('ftp-client', 'invoke', 'broadcastDetector:checkVersion')).toBe(false);
        expect(isChannelAllowed('broadcast-detector', 'invoke', 'ftp:download')).toBe(false);
        expect(isChannelAllowed('speedtest', 'invoke', 'shell:openExternal')).toBe(false);
        expect(hasCapability('speedtest', 'external-links')).toBe(true);
    });

    test('allows every literal renderer IPC call in its own scope', () => {
        const callPattern = /ipcRenderer\.(invoke|send|on|once|removeListener)\(\s*(['"])([^'"]+)\2/g;
        for (const [toolId, relativePath] of Object.entries(rendererFiles)) {
            const source = read(relativePath);
            for (const match of source.matchAll(callPattern)) {
                const action = match[1] === 'invoke'
                    ? 'invoke'
                    : match[1] === 'send'
                        ? 'send'
                        : 'receive';
                expect(
                    isChannelAllowed(toolId, action, match[3]),
                    `${relativePath}: ${match[1]} ${match[3]}`
                ).toBe(true);
            }
        }
    });

    test('renders FTP filenames as text instead of executable markup', () => {
        const source = read('FtpClient/index.html');

        expect(source).not.toContain('`${iconSvg}${file.name}`');
        expect(source.match(/createTextNode\(file\.name\)/g)).toHaveLength(2);
    });
});
