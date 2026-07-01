import { test, expect } from '@playwright/test';

test.describe('Electron Demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[Browser ${msg.type()}]`, msg.text()));
    page.on('pageerror', (error) => console.error('[Page Error]', error.message));
  });

  test('renders a BrowserWindow and completes an IPC round-trip', async ({ page }) => {
    await page.goto('/examples/electron-demo.html');

    // The app seeds, registers the host, starts the renderer dev server, runs main.
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'running', {
      timeout: 45000,
    });

    // A BrowserWindow renders as an iframe appended by the demo host.
    await expect(page.locator('iframe[data-electron-window]')).toBeVisible({
      timeout: 45000,
    });

    const frame = page.frameLocator('iframe[data-electron-window]');

    // ipcRenderer.invoke('ping') -> ipcMain.handle('ping') -> reply.
    await expect(frame.locator('#ipc')).toHaveAttribute('data-ready', '1', {
      timeout: 45000,
    });
    await expect(frame.locator('#ipc')).toHaveText('pong:hello');

    // main -> renderer: webContents.send('tick') reaches ipcRenderer.on.
    await expect(frame.locator('.tick').first()).toBeVisible({ timeout: 45000 });
  });
});
