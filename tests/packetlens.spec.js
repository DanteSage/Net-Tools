const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

async function findWindow(electronApp, predicate, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const page of electronApp.windows()) {
            if (await predicate(page)) return page;
        }
        await electronApp.waitForEvent('window', { timeout: 1000 }).catch(() => null);
    }
    throw new Error('Expected Electron window was not opened');
}

test('opens PacketLens with local assets and analyzes the demo capture', async () => {
    let electronApp;
    try {
        electronApp = await electron.launch({
            args: [
                '.',
                `--user-data-dir=${path.join(process.cwd(), 'test-results', 'appdata-packetlens')}`
            ],
            env: {
                APPDATA: path.join(process.cwd(), 'test-results', 'appdata-packetlens'),
                ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
            }
        });

        const mainWindow = await findWindow(electronApp, async (page) => {
            return page.url().includes('index.html')
                || (await page.title().catch(() => '')) === 'Net Tools';
        });
        await mainWindow.waitForSelector('.nav-menu', { timeout: 20000 });
        await mainWindow.locator('.nav-item[data-page="nettools"]').click();
        await expect(mainWindow.locator('#tool-packetlens')).toBeVisible();

        await mainWindow.locator('#tool-packetlens').click();
        const packetLens = await findWindow(electronApp, async (page) => {
            return (await page.title().catch(() => '')).startsWith('PacketLens');
        });
        await packetLens.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await expect(packetLens.locator('#bootTitle')).toBeVisible();

        const integration = await packetLens.evaluate(async () => {
            const [country, asn] = await Promise.all([
                fetch('GeoLite2-Country.mmdb.gz', { method: 'HEAD' }),
                fetch('GeoLite2-ASN.mmdb.gz', { method: 'HEAD' })
            ]);
            return {
                country: country.status,
                asn: asn.status,
                nodeAvailable: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
                hostBridge: typeof window.packetLensHost?.onThemeChanged === 'function',
                embedded: document.documentElement.classList.contains('nettools-host'),
                bodyPaddingTop: getComputedStyle(document.body).paddingTop
            };
        });
        expect(integration).toMatchObject({
            country: 200,
            asn: 200,
            nodeAvailable: false,
            hostBridge: true,
            embedded: true,
            bodyPaddingTop: '32px'
        });

        await packetLens.locator('#demo').click();
        await expect(packetLens.locator('#app')).not.toHaveClass(/hide/, { timeout: 30000 });
        await expect(packetLens.locator('#nav a').first()).toBeVisible();
        await expect(packetLens.locator('section[data-v="overview"]')).toHaveClass(/on/);
    } finally {
        if (electronApp) await electronApp.close();
    }
});
