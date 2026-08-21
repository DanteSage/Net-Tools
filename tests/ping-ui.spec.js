const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

test.describe('Ping test UI', () => {
  test('uses the redesigned responsive configuration', async () => {
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true
      });
      const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
      await context.addInitScript(() => {
        window.require = moduleName => {
          if (moduleName !== 'electron') throw new Error(`Unexpected module: ${moduleName}`);
          return {
            ipcRenderer: {
              invoke: async channel => channel === 'theme:get' ? { mode: 'light', key: 'light' } : { success: true },
              on: () => {}
            }
          };
        };
      });
      const pingWindow = await context.newPage();
      const pageUrl = pathToFileURL(path.join(process.cwd(), 'ping test', 'index.html'));
      pageUrl.search = 'mode=light&theme=light';
      await pingWindow.goto(pageUrl.href);

      await expect(pingWindow.locator('#pingTitle')).toHaveText('Ping 测试');
      await expect(pingWindow.locator('.preset-btn')).toHaveCount(5);
      await expect(pingWindow.locator('.preset-btn.active')).toHaveAttribute('data-host', '223.5.5.5');

      await pingWindow.locator('.preset-btn[data-host="8.8.8.8"]').click();
      await expect(pingWindow.locator('#hostInput')).toHaveValue('8.8.8.8');
      await expect(pingWindow.locator('.preset-btn.active')).toHaveAttribute('data-host', '8.8.8.8');

      await pingWindow.locator('#continuousMode').check();
      await expect(pingWindow.locator('#countInput')).toBeDisabled();

      for (const size of [{ width: 1100, height: 820 }, { width: 640, height: 700 }]) {
        await pingWindow.setViewportSize(size);
        const fits = await pingWindow.evaluate(() => {
          const viewportWidth = document.documentElement.clientWidth;
          return [...document.querySelectorAll('.card, .preset-btn, .form-group, .btn')].every(element => {
            const rect = element.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= viewportWidth + 1;
          });
        });
        expect(fits).toBeTruthy();
        if (size.width === 640) {
          await pingWindow.screenshot({ path: path.join('test-results', 'ping-ui-compact.png'), fullPage: true });
        }
      }

      await pingWindow.setViewportSize({ width: 1100, height: 820 });
      await pingWindow.screenshot({ path: path.join('test-results', 'ping-ui.png'), fullPage: true });
    } finally {
      if (browser) await browser.close();
    }
  });
});
