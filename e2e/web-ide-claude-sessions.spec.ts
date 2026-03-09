import { expect, test } from '@playwright/test';

async function dragResizeHandle(page: import('@playwright/test').Page, selector: string, deltaX: number, deltaY: number) {
  const handle = page.locator(selector);
  const bounds = await handle.boundingBox();

  if (!bounds) {
    throw new Error(`Missing resize handle: ${selector}`);
  }

  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

test.describe('web-ide Claude sessions', () => {
  test('supports resizing the explorer, Claude pane, and terminal', async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('__webIdeLayoutCleared')) {
        window.localStorage.removeItem('almostnode.webIde.layout');
        window.sessionStorage.setItem('__webIdeLayoutCleared', '1');
      }
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/examples/web-ide-demo.html');
    await page.waitForFunction(() => Boolean((window as any).__webIdeDemo));

    await expect(page.locator('#explorerResizeHandle')).toBeVisible();
    await expect(page.locator('#claudeResizeHandle')).toBeVisible();
    await expect(page.locator('#terminalResizeHandle')).toBeVisible();

    const initialLayout = await page.evaluate(() => (window as any).__webIdeDemo.getLayoutState());

    await dragResizeHandle(page, '#explorerResizeHandle', 96, 0);
    await page.waitForFunction(
      (previousWidth) => (window as any).__webIdeDemo.getLayoutState().panelColumnWidth > previousWidth,
      initialLayout.panelColumnWidth,
    );

    const afterExplorerResize = await page.evaluate(() => (window as any).__webIdeDemo.getLayoutState());
    expect(afterExplorerResize.panelColumnWidth).toBeGreaterThan(initialLayout.panelColumnWidth);

    await dragResizeHandle(page, '#claudeResizeHandle', -84, 0);
    await page.waitForFunction(
      (previousWidth) => (window as any).__webIdeDemo.getLayoutState().sidePaneWidth > previousWidth,
      afterExplorerResize.sidePaneWidth,
    );

    const afterClaudeResize = await page.evaluate(() => (window as any).__webIdeDemo.getLayoutState());
    expect(afterClaudeResize.sidePaneWidth).toBeGreaterThan(afterExplorerResize.sidePaneWidth);

    await page.evaluate(() => {
      (document.getElementById('terminalResizeHandle') as HTMLElement | null)?.focus();
    });
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForFunction(
      (previousHeight) => (window as any).__webIdeDemo.getLayoutState().terminalPaneHeight > previousHeight,
      afterClaudeResize.terminalPaneHeight,
    );

    const afterTerminalResize = await page.evaluate(() => (window as any).__webIdeDemo.getLayoutState());
    expect(afterTerminalResize.terminalPaneHeight).toBeGreaterThan(afterClaudeResize.terminalPaneHeight);

    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__webIdeDemo));

    const persistedLayout = await page.evaluate(() => (window as any).__webIdeDemo.getLayoutState());
    expect(persistedLayout).toEqual(afterTerminalResize);
  });

  test('keeps the workspace terminal and auto-queues Claude tabs from the plus button', async ({ page }) => {
    await page.goto('/examples/web-ide-demo.html');
    await page.waitForFunction(() => Boolean((window as any).__webIdeDemo));

    await expect(page.locator('.terminal-head').getByText('Workspace Terminal', { exact: true })).toBeVisible();

    await page.evaluate(() => {
      const demo = (window as any).__webIdeDemo;
      demo.container.vfs.writeFileSync(
        '/project/claude-session-smoke.js',
        "setTimeout(() => { console.log('claude-session-ready'); }, 1200);\n",
      );
      demo.setClaudeLaunchCommand('node /project/claude-session-smoke.js');
    });

    await expect(page.locator('#claudeSessionTabs .side-tab')).toHaveCount(1);

    await page.evaluate(() => {
      const button = document.getElementById('newClaudeSessionBtn');
      button?.click();
      button?.click();
    });
    await page.waitForFunction(() => {
      const sessions = (window as any).__webIdeDemo.getClaudeSessions();
      return sessions.length === 3
        && sessions.some((session) => session.label === 'Claude 3' && session.pendingLaunch === true);
    });

    await page.waitForFunction(() => {
      const sessions = (window as any).__webIdeDemo.getClaudeSessions();
      return sessions.length === 3
        && sessions.some((session) => session.label === 'Claude 3' && session.output.includes('claude-session-ready'));
    });

    await page.locator('#claudeSessionTabs .side-tab').nth(1).click();

    const sessions = await page.evaluate(() => (window as any).__webIdeDemo.getClaudeSessions());
    expect(sessions).toHaveLength(3);
    expect(sessions.map((session) => session.label)).toEqual(['Claude 1', 'Claude 2', 'Claude 3']);
    expect(sessions.find((session) => session.label === 'Claude 2')?.active).toBe(true);
    expect(sessions.find((session) => session.label === 'Claude 2')?.launchCount).toBe(1);
    expect(sessions.find((session) => session.label === 'Claude 3')?.output).toContain('claude-session-ready');
    expect(sessions.find((session) => session.label === 'Claude 3')?.pendingLaunch).toBe(false);
  });
});
