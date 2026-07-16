const { test, expect, _electron: electron } = require('@playwright/test');

async function waitForWindow(electronApp, predicate, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        for (const page of electronApp.windows()) {
            if (await predicate(page)) return page;
        }
        await electronApp.waitForEvent('window', { timeout: 1000 }).catch(() => null);
    }
    throw new Error('Expected Electron window was not opened');
}

test('FTP tool window is isolated and renders remote filenames as text', async ({}, testInfo) => {
    let electronApp;
    try {
        electronApp = await electron.launch({
            args: ['.', `--user-data-dir=${testInfo.outputPath('user-data')}`],
            env: { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
        });

        const mainWindow = await waitForWindow(electronApp, async page => {
            return (await page.title().catch(() => '')) === 'Net Tools';
        });
        await mainWindow.waitForLoadState('domcontentloaded');
        await mainWindow.evaluate(() => window.api.ftp.open());

        const ftpWindow = await waitForWindow(electronApp, async page => {
            return (await page.title().catch(() => '')) === 'FTP 客户端';
        });
        await ftpWindow.waitForLoadState('domcontentloaded');
        await ftpWindow.waitForSelector('#remote-tbody');

        const isolation = await ftpWindow.evaluate(() => ({
            requireType: typeof window.require,
            processType: typeof window.process,
            hasScopedIpc: typeof window.toolApi?.ipcRenderer?.invoke === 'function',
            hasFilesystemFacade: typeof window.toolApi?.fs?.readdirSync === 'function',
            hasChildProcess: !!window.toolApi?.childProcess
        }));
        expect(isolation).toEqual({
            requireType: 'undefined',
            processType: 'undefined',
            hasScopedIpc: true,
            hasFilesystemFacade: true,
            hasChildProcess: false
        });

        const crossToolCallBlocked = await ftpWindow.evaluate(async () => {
            try {
                await window.toolApi.ipcRenderer.invoke('broadcastDetector:checkVersion', 'payload');
                return false;
            } catch (error) {
                return String(error.message).includes('not allowed');
            }
        });
        expect(crossToolCallBlocked).toBe(true);

        const xssResult = await ftpWindow.evaluate(() => {
            window.__ftpFilenameExecuted = false;
            remoteFiles = [{
                name: '<img id="ftp-xss" src=x onerror="window.__ftpFilenameExecuted=true">',
                isDirectory: false,
                size: 1
            }];
            renderRemoteTable();
            return {
                executed: window.__ftpFilenameExecuted,
                injectedElement: !!document.getElementById('ftp-xss'),
                displayedText: document.querySelector('#remote-tbody td')?.textContent
            };
        });
        expect(xssResult.executed).toBe(false);
        expect(xssResult.injectedElement).toBe(false);
        expect(xssResult.displayedText).toContain('<img id="ftp-xss"');
    } finally {
        if (electronApp) await electronApp.close();
    }
});
