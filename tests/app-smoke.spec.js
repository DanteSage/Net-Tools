const { test, expect, _electron: electron } = require('@playwright/test');

async function waitForMainWindow(electronApp, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const page of electronApp.windows()) {
      const url = page.url();
      if (url.includes('index.html')) return page;
      const title = await page.title().catch(() => '');
      if (title === 'Net Tools') return page;
    }

    const remaining = timeout - (Date.now() - start);
    const nextWindow = await electronApp.waitForEvent('window', { timeout: Math.max(500, remaining) }).catch(() => null);
    if (nextWindow) {
      const url = nextWindow.url();
      if (url.includes('index.html')) return nextWindow;
      const title = await nextWindow.title().catch(() => '');
      if (title === 'Net Tools') return nextWindow;
    }
  }
  throw new Error('Main window not found within timeout');
}

test.describe('Net Tools app smoke', () => {
  test('launches main window and exposes core UI/API', async () => {
    let electronApp;
    try {
      electronApp = await electron.launch({
        args: ['.'],
        env: { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
      });

      const mainWindow = await waitForMainWindow(electronApp);
      await mainWindow.waitForLoadState('domcontentloaded', { timeout: 20000 });
      await mainWindow.waitForSelector('.nav-menu', { timeout: 20000 });

      const navPages = ['devices', 'terminal', 'oplog', 'nettools', 'batch', 'templates', 'functions', 'backup', 'logs'];
      for (const page of navPages) {
        await expect(mainWindow.locator(`.nav-item[data-page="${page}"]`)).toBeVisible();
      }

      const apiAvailable = await mainWindow.evaluate(() => {
        const api = window.api;
        return !!api
          && typeof api.devices?.getAll === 'function'
          && typeof api.ssh?.connect === 'function'
          && typeof api.ssh?.input === 'function'
          && typeof api.ssh?.resize === 'function'
          && typeof api.telnet?.input === 'function'
          && typeof api.telnet?.resize === 'function'
          && typeof api.serial?.input === 'function';
      });
      expect(apiAvailable).toBeTruthy();

      await expect(mainWindow.locator('#device-com-port option').first())
        .not.toHaveText('检测中...', { timeout: 10000 });

      await mainWindow.locator('#btn-add-device').click();
      await expect(mainWindow.locator('#device-protocol option')).toHaveText([
        '串口',
        'FTP',
        'SSH',
        'Telnet'
      ]);
      await expect(mainWindow.locator('#device-protocol')).toHaveValue('ssh');
      await mainWindow.locator('#device-protocol').selectOption('console');
      await expect(mainWindow.locator('#serial-config')).toBeVisible();
      await expect(mainWindow.locator('#device-baudrate')).toHaveValue('9600');
      await expect(mainWindow.locator('#device-baudrate option')).toHaveCount(14);

      const originalThemeState = await mainWindow.evaluate(() => ({
        name: document.documentElement.getAttribute('data-theme-name'),
        mode: document.documentElement.getAttribute('data-theme')
      }));
      const originalControlStyle = await mainWindow.evaluate(() => {
        const button = document.querySelector('#btn-refresh-ports');
        const checkbox = document.querySelector('#device-xonxoff');
        const buttonStyle = getComputedStyle(button);
        const checkboxStyle = getComputedStyle(checkbox);
        return {
          buttonBackground: buttonStyle.backgroundColor,
          buttonColor: buttonStyle.color,
          checkboxBackground: checkboxStyle.backgroundColor,
          checkboxBorder: checkboxStyle.borderColor
        };
      });
      try {
        await mainWindow.evaluate((currentMode) => {
          const html = document.documentElement;
          if (currentMode === 'light') {
            html.setAttribute('data-theme-name', 'dark');
            html.setAttribute('data-theme', '');
          } else {
            html.setAttribute('data-theme-name', 'light');
            html.setAttribute('data-theme', 'light');
          }
        }, originalThemeState.mode);
        await mainWindow.waitForTimeout(300);
        const alternateControlStyle = await mainWindow.evaluate(() => {
          const button = document.querySelector('#btn-refresh-ports');
          const checkbox = document.querySelector('#device-xonxoff');
          const buttonStyle = getComputedStyle(button);
          const checkboxStyle = getComputedStyle(checkbox);
          return {
            buttonBackground: buttonStyle.backgroundColor,
            buttonColor: buttonStyle.color,
            checkboxBackground: checkboxStyle.backgroundColor,
            checkboxBorder: checkboxStyle.borderColor
          };
        });
        expect(alternateControlStyle.buttonBackground).not.toBe(originalControlStyle.buttonBackground);
        expect(alternateControlStyle.buttonColor).not.toBe(originalControlStyle.buttonColor);
        expect(alternateControlStyle.checkboxBackground).not.toBe(originalControlStyle.checkboxBackground);
        expect(alternateControlStyle.checkboxBorder).not.toBe(originalControlStyle.checkboxBorder);
      } finally {
        await mainWindow.evaluate((themeState) => {
          const html = document.documentElement;
          if (themeState.name === null) html.removeAttribute('data-theme-name');
          else html.setAttribute('data-theme-name', themeState.name);
          if (themeState.mode === null) html.removeAttribute('data-theme');
          else html.setAttribute('data-theme', themeState.mode);
        }, originalThemeState);
      }

      for (const control of [
        'device-baudrate',
        'device-databits',
        'device-parity',
        'device-stopbits',
        'device-rtscts',
        'device-xonxoff'
      ]) {
        await expect(mainWindow.locator(`#${control}`)).toBeVisible();
      }

      const serialLayoutFits = await mainWindow.evaluate(() => {
        const modal = document.querySelector('#device-modal .modal-content');
        const serialConfig = document.querySelector('#serial-config');
        const portGroup = document.querySelector('#device-com-port')?.closest('.form-group');
        const baudGroup = document.querySelector('#device-baudrate')?.closest('.form-group');
        const flowTitle = document.querySelector('#serial-flow-label');
        const xonxoff = document.querySelector('#device-xonxoff')?.closest('label');
        const rtscts = document.querySelector('#device-rtscts')?.closest('label');
        const flowGroup = document.querySelector('.serial-flow-group');
        if (!modal || !serialConfig || !portGroup || !baudGroup || !flowTitle || !xonxoff || !rtscts || !flowGroup) return false;
        const modalRect = modal.getBoundingClientRect();
        const serialRect = serialConfig.getBoundingClientRect();
        const portRect = portGroup.getBoundingClientRect();
        const baudRect = baudGroup.getBoundingClientRect();
        const titleRect = flowTitle.getBoundingClientRect();
        const xonRect = xonxoff.getBoundingClientRect();
        const rtsRect = rtscts.getBoundingClientRect();
        const flowRect = flowGroup.getBoundingClientRect();
        return flowRect.left >= modalRect.left
          && flowRect.right <= modalRect.right
          && baudRect.top >= portRect.bottom
          && portRect.width >= serialRect.width * 0.95
          && baudRect.width >= serialRect.width * 0.95
          && titleRect.bottom <= xonRect.top
          && Math.abs(xonRect.top - rtsRect.top) < 1
          && xonRect.right <= rtsRect.left;
      });
      expect(serialLayoutFits).toBeTruthy();
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });
});
