const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

test.describe('Route tracking UI', () => {
  test('renders and switches all redesigned modes', async () => {
    let browser;
    const pageErrors = [];
    try {
      browser = await chromium.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addInitScript(() => {
        const handlers = new Map();
        const add = (channel, listener, once = false) => {
          const entries = handlers.get(channel) || [];
          entries.push({ listener, once });
          handlers.set(channel, entries);
        };
        const emit = (channel, ...args) => {
          const entries = [...(handlers.get(channel) || [])];
          handlers.set(channel, entries.filter(entry => !entry.once));
          entries.forEach(entry => entry.listener(...args));
        };
        window.__emitIpc = emit;
        window.require = moduleName => {
          if (moduleName !== 'electron') throw new Error(`Unexpected module: ${moduleName}`);
          return {
            ipcRenderer: {
              invoke: async (channel, payload) => {
                if (channel === 'theme:get') return { mode: 'light', key: 'light' };
                if (channel === 'traceroute:reverseDns') return payload === '223.5.5.5' ? 'public1.alidns.com' : null;
                if (channel === 'traceroute:lookup-geoip') return { ip: payload, countryCode: 'CN', asn: '37963', org: 'Alibaba' };
                if (channel === 'traceroute:start') {
                  setTimeout(() => {
                    emit('traceroute:hop', {}, { hop: 1, ip: '192.168.1.1', times: [1, 2, 1], timeout: false });
                    emit('traceroute:hop', {}, { hop: 2, ip: payload.host, times: [20, 22, 21], timeout: false });
                    emit('traceroute:complete', {}, { reached: true, code: 0 });
                  }, 30);
                }
                return { success: true };
              },
              on: (channel, listener) => add(channel, listener),
              once: (channel, listener) => add(channel, listener, true),
              removeListener: (channel, listener) => {
                handlers.set(channel, (handlers.get(channel) || []).filter(entry => entry.listener !== listener));
              }
            }
          };
        };
      });

      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      const url = pathToFileURL(path.join(process.cwd(), 'Route Tracking', 'index.html'));
      url.search = 'mode=light&theme=light';
      await page.goto(url.href);

      await expect(page.locator('.main-tab')).toHaveCount(3);
      await expect(page.locator('.main-tab.active')).toContainText('路由追踪');
      await expect(page.locator('#panel-trace > .card:first-child .card-title')).toHaveText('追踪配置');
      await expect(page.locator('#panel-trace .preset-btn')).toHaveCount(7);

      await page.locator('#traceBtn').click();
      await expect(page.locator('#totalHops')).toHaveText('2');
      await expect(page.locator('#resultsSection')).toHaveClass(/show/);
      await expect(page.locator('.hop-item')).toHaveCount(2);
      await page.screenshot({ path: path.join('test-results', 'route-tracking-trace.png'), fullPage: true });

      await page.locator('.main-tab[data-tab="mtr"]').click();
      await expect(page.locator('#panel-mtr')).toHaveClass(/active/);
      await expect(page.locator('#mtrInterval')).toHaveValue('1');
      await expect(page.locator('#mtrTimeout')).toHaveValue('3000');
      await expect(page.locator('#mtrExportBtn')).toBeDisabled();
      await page.locator('#mtrRounds').fill('3');
      await page.locator('#mtrInterval').fill('0.2');
      await page.locator('#mtrBtn').click();
      await expect(page.locator('#mtrExportBtn')).toBeEnabled({ timeout: 5000 });
      await expect(page.locator('#mtrTableBody tr')).toHaveCount(2);
      const mtrCanvasHasPixels = await page.locator('#mtrLatencyChart').evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return data.some(value => value !== 0);
      });
      expect(mtrCanvasHasPixels).toBeTruthy();
      await page.screenshot({ path: path.join('test-results', 'route-tracking-mtr.png'), fullPage: true });

      await page.locator('.main-tab[data-tab="trippy"]').click();
      await page.locator('#trippyStartBtn').click();
      await page.evaluate(() => {
        window.__emitIpc('traceroute:trippy-state', {}, { state: 'probing', host: '223.5.5.5', hopCount: 3 });
        window.__emitIpc('traceroute:trippy-update', {}, {
          updates: [
            { hop: 1, ip: '192.168.1.1', sent: 10, recv: 10, loss: 0, last: 1.2, avg: 1.4, min: 0.8, max: 2.1, stdev: 0.3, history: [1, 2, 1, 1] },
            { hop: 2, ip: '10.10.10.1', sent: 10, recv: 9, loss: 10, last: 8, avg: 9.5, min: 7, max: 14, stdev: 2.1, history: [8, 9, 14, 7] },
            { hop: 3, ip: '223.5.5.5', sent: 10, recv: 10, loss: 0, last: 21, avg: 21.4, min: 19, max: 25, stdev: 1.8, history: [20, 22, 25, 19] }
          ]
        });
      });
      await expect(page.locator('#panel-trippy')).toHaveClass(/active/);
      await expect(page.locator('#trippyTableBody tr')).toHaveCount(3);
      await expect(page.locator('#trippyChartEmpty')).toHaveClass(/hidden/);
      await expect(page.locator('.log-row')).toHaveCount(3);
      const canvasHasPixels = await page.locator('#trippyLatencyChart').evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return data.some(value => value !== 0);
      });
      expect(canvasHasPixels).toBeTruthy();
      await page.screenshot({ path: path.join('test-results', 'route-tracking-trippy.png'), fullPage: true });

      await page.setViewportSize({ width: 700, height: 760 });
      const fitsCompact = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.main-tabs, .card, .form-group, .btn')].every(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= viewportWidth + 1;
        });
      });
      expect(fitsCompact).toBeTruthy();
      await page.screenshot({ path: path.join('test-results', 'route-tracking-compact.png'), fullPage: true });
      expect(pageErrors).toEqual([]);
    } finally {
      if (browser) await browser.close();
    }
  });
});
