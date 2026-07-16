const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const executablePath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Net Tools.exe');

async function waitForMainWindow(electronApp, timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        for (const page of electronApp.windows()) {
            if (page.url().includes('index.html')) return page;
        }

        const remaining = timeout - (Date.now() - start);
        const page = await electronApp.waitForEvent('window', {
            timeout: Math.max(500, remaining)
        }).catch(() => null);
        if (page?.url().includes('index.html')) return page;
    }
    throw new Error('Packaged main window not found within timeout');
}

test('packaged Electron app launches with its preload bridge', async ({}, testInfo) => {
    test.skip(!fs.existsSync(executablePath), 'Run npm run build before packaged smoke tests');
    test.setTimeout(120000);

    let electronApp;
    try {
        electronApp = await electron.launch({
            executablePath,
            args: [`--user-data-dir=${testInfo.outputPath('user-data')}`],
            env: { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
        });

        expect(await electronApp.evaluate(() => process.versions.electron)).toBe('43.1.1');

        const mainWindow = await waitForMainWindow(electronApp);
        await mainWindow.waitForLoadState('domcontentloaded', { timeout: 20000 });
        await expect(mainWindow.locator('.nav-menu')).toBeVisible();

        const packagedApiAvailable = await mainWindow.evaluate(() => (
            typeof window.api?.serial?.list === 'function'
            && typeof window.api?.fs?.getPathForFile === 'function'
            && typeof window.api?.copilot?.approveResponse === 'function'
        ));
        expect(packagedApiAvailable).toBe(true);
    } finally {
        if (electronApp) await electronApp.close().catch(() => {});
    }
});
