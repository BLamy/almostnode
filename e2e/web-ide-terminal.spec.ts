import { expect, test, type Page } from '@playwright/test';

async function loadWebIDE(page: Page) {
  await page.goto('/examples/web-ide-demo.html?marketplace=mock', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeWebIDE), {
    timeout: 20000,
  });
}

async function getHostTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__almostnodeWebIDE?.terminal;
    if (!term) return '';

    const buffer = term.buffer.active;
    const lastLine = buffer.baseY + buffer.cursorY;
    let text = '';

    for (let i = 0; i <= lastLine; i++) {
      const line = buffer.getLine(i);
      if (line) text += line.translateToString(true) + '\n';
    }

    return text;
  });
}

test.describe('web-ide host terminal', () => {
  test('keeps scroll affordances and selection highlight visible', async ({ page }) => {
    await loadWebIDE(page);

    await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      const source = Array.from({ length: 240 }, (_, index) => `console.log('line-${index + 1}')`).join('\n') + '\n';
      host.container.vfs.writeFileSync('/project/scroll-test.js', source);
      await host.executeHostCommand('node /project/scroll-test.js');
    });

    const readTerminalState = () =>
      page.evaluate(() => {
        const terminal = document.getElementById('webideTerminal');
        const slider = terminal?.querySelector('.scrollbar.vertical .slider');
        const rows = terminal?.querySelector('.xterm-rows');
        return {
          sliderTop: slider ? Math.round(parseFloat(getComputedStyle(slider).top || '0')) : 0,
          sliderBackground: slider ? getComputedStyle(slider).backgroundColor : '',
          firstRow: rows?.firstElementChild?.textContent?.trim() || '',
        };
      });

    const initial = await readTerminalState();
    expect(initial.sliderBackground).toContain('255, 122, 89');

    const terminalScreen = page.locator('#webideTerminal .xterm-screen');
    const bounds = await terminalScreen.boundingBox();
    if (!bounds) {
      throw new Error('Missing host terminal screen');
    }

    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, -700);

    await page.waitForFunction(
      (previousFirstRow) => {
        const rows = document.querySelector('#webideTerminal .xterm-rows');
        return (rows?.firstElementChild?.textContent?.trim() || '') !== previousFirstRow;
      },
      initial.firstRow,
    );

    const afterScroll = await readTerminalState();
    expect(afterScroll.sliderTop).not.toBe(initial.sliderTop);

    await page.evaluate(() => {
      (window as any).__almostnodeWebIDE.terminal.selectAll();
    });

    await page.waitForFunction(() => {
      return (document.querySelector('#webideTerminal .xterm-selection')?.childElementCount || 0) > 0;
    });

    const selectionBackground = await page.evaluate(() => {
      const firstSelectionSegment = document.querySelector('#webideTerminal .xterm-selection div');
      return firstSelectionSegment ? getComputedStyle(firstSelectionSegment).backgroundColor : '';
    });
    expect(selectionBackground).toContain('255, 122, 89');
  });

  test('keeps terminal tabs isolated and runs preview in a dedicated tab', async ({ page }) => {
    await loadWebIDE(page);

    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.almostnode-terminal-surface__tab'))
        .some((node) => node.textContent?.includes('Preview'));
    });

    const activeTabLabel = await page.locator('.almostnode-terminal-surface__tab.is-active').first().textContent();
    expect(activeTabLabel).toContain('Terminal 1');

    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.executeHostCommand('printf "tab-one\\n"');
    });
    await page.waitForFunction(() => {
      return (document.querySelector('#webideTerminal .xterm-rows')?.textContent || '').includes('tab-one');
    });

    await page.locator('.almostnode-terminal-surface__new-tab').click();
    await expect(page.locator('.almostnode-terminal-surface__tab', { hasText: 'Terminal 2' })).toHaveCount(1);

    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.executeHostCommand('printf "tab-two\\n"');
    });
    await page.waitForFunction(() => {
      return (document.querySelector('#webideTerminal .xterm-rows')?.textContent || '').includes('tab-two');
    });

    await page.locator('.almostnode-terminal-surface__tab', { hasText: 'Terminal 1' }).click();
    await page.waitForFunction(() => {
      return (document.querySelector('#webideTerminal .xterm-rows')?.textContent || '').includes('tab-one');
    });

    const firstTabText = await page.locator('#webideTerminal .xterm-rows').textContent();
    expect(firstTabText || '').toContain('tab-one');
    expect(firstTabText || '').not.toContain('tab-two');
  });

  test('runs Claude Code from the regular terminal without builtin module failures', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    await loadWebIDE(page);

    const consoleMessages: string[] = [];
    const moduleFailures: string[] = [];

    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 500 && response.url().includes('/__modules__/r/') && response.url().includes('claude-code')) {
        moduleFailures.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.executeHostCommand('npx @anthropic-ai/claude-code --version');
    });

    await expect(page.locator('#webideTerminalStatus')).toHaveText('Exited 0');

    const output = await getHostTerminalText(page);
    expect(output).toMatch(/(?:^|\n)v?\d+\.\d+\.\d+(?: \(Claude Code\))?(?:\n|$)/);
    expect(output).not.toContain(`npx: command "claude-code" exited with code`);
    expect(output).not.toContain(`Cannot find module 'node:stream/consumers'`);
    expect(output).not.toContain('does not provide an export named');
    expect(consoleMessages.join('\n')).not.toContain(`Cannot find module 'node:stream/consumers'`);
    expect(consoleMessages.join('\n')).not.toContain('does not provide an export named');
    expect(moduleFailures).toEqual([]);
  });
});
