import { expect, test, type Page } from '@playwright/test';

async function loadWebIDE(page: Page, query = '?marketplace=mock') {
  await page.goto(`/examples/web-ide-demo.html${query}`, {
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

async function getOpenCodeTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__OPENCODE_BROWSER_TUI__?.term;
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

async function focusHostTerminal(page: Page): Promise<void> {
  await page.locator('#webideTerminal').click();
  await page.evaluate(() => {
    (window as any).__almostnodeWebIDE?.terminal?.focus?.();
  });
}

async function focusOpenCodeTerminal(page: Page): Promise<void> {
  await page.locator('.almostnode-opencode-host').click();
  await page.evaluate(() => {
    (window as any).__OPENCODE_BROWSER_TUI__?.term?.focus?.();
  });
}

async function waitForHostPrompt(page: Page, statusPrefix = 'Exited', timeout = 45000): Promise<void> {
  await page.waitForFunction((expectedStatusPrefix: string) => {
    const status = document.getElementById('webideTerminalStatus')?.textContent?.trim() || '';
    const term = (window as any).__almostnodeWebIDE?.terminal;
    if (!term) return false;

    const buffer = term.buffer.active;
    const lastLine = buffer.baseY + buffer.cursorY;
    let text = '';

    for (let i = 0; i <= lastLine; i++) {
      const line = buffer.getLine(i);
      if (line) text += line.translateToString(true) + '\n';
    }

    return status.startsWith(expectedStatusPrefix) && text.trimEnd().endsWith('$');
  }, statusPrefix, { timeout });
}

async function driveInteractiveHostCommand(
  page: Page,
  command: string,
  options: {
    timeout?: number;
    answerOverwriteWithNo?: boolean;
  } = {},
): Promise<void> {
  const timeout = options.timeout ?? 6 * 60 * 1000;
  const deadline = Date.now() + timeout;
  let overwriteAnswered = false;

  await page.evaluate((cmd) => {
    void (window as any).__almostnodeWebIDE.executeHostCommand(cmd);
  }, command);
  await expect(page.locator('#webideTerminalStatus')).toHaveText(`Running: ${command}`, { timeout: 20000 });

  while (Date.now() < deadline) {
    const [status, output] = await Promise.all([
      page.locator('#webideTerminalStatus').textContent(),
      getHostTerminalText(page),
    ]);
    const normalizedStatus = (status || '').trim();

    if (normalizedStatus.startsWith('Exited')) {
      await waitForHostPrompt(page, 'Exited', 30000);
      return;
    }

    const tail = output.slice(-5000);
    const needsDefaultEnter = /what style|which color|use css variables|tailwind\.config|would you like|react server components|alias prefix|select a style|pick a color/i.test(tail);
    const needsOverwriteAnswer = options.answerOverwriteWithNo
      && !overwriteAnswered
      && /overwrite|already exists/i.test(tail);

    if (needsDefaultEnter || needsOverwriteAnswer) {
      await focusHostTerminal(page);
      if (needsOverwriteAnswer) {
        await page.keyboard.type('n');
        overwriteAnswered = true;
      }
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      continue;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`Timed out waiting for "${command}" to finish in the host terminal.`);
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

  test('mounts OpenCode from the regular terminal and restores the shell tab on close', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    await loadWebIDE(page);

    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.executeHostCommand('printf "shell-before\\n"');
    });
    await page.waitForFunction(() => {
      return (document.querySelector('#webideTerminal .xterm-rows')?.textContent || '').includes('shell-before');
    });

    await page.evaluate(async () => {
      await (window as any).__almostnodeWebIDE.executeHostCommand('npx opencode-ai');
    });

    await expect(page.locator('#webideTerminalStatus')).toHaveText('Starting OpenCode...', { timeout: 20000 });
    await page.waitForFunction(() => Boolean((window as any).__OPENCODE_BROWSER_TUI__), {
      timeout: 180000,
    });
    await expect(page.locator('#webideTerminalStatus')).toHaveText('OpenCode ready', { timeout: 120000 });
    await expect(page.locator('.almostnode-terminal-surface__tab.is-active')).toContainText('OpenCode');

    await focusOpenCodeTerminal(page);
    await page.keyboard.type('!pwd');
    await page.keyboard.press('Enter');
    await expect.poll(async () => {
      const output = await getOpenCodeTerminalText(page);
      return output.includes('/workspace');
    }, { timeout: 120000 }).toBe(true);

    await focusOpenCodeTerminal(page);
    await page.keyboard.type('!ls');
    await page.keyboard.press('Enter');
    await expect.poll(async () => {
      const output = await getOpenCodeTerminalText(page);
      return output.includes('package.json') || output.includes('src');
    }, { timeout: 120000 }).toBe(true);

    const mountedState = await page.evaluate(() => {
      const host = (window as any).__almostnodeWebIDE;
      return {
        mounted: Boolean((window as any).__OPENCODE_BROWSER_TUI__),
        hasPackageJson: host.container.vfs.existsSync('/project/package.json'),
      };
    });
    expect(mountedState).toEqual({
      mounted: true,
      hasPackageJson: true,
    });

    await page.locator('.almostnode-terminal-surface__tab.is-active .almostnode-terminal-surface__tab-close').click();
    await expect(page.locator('.almostnode-terminal-surface__tab.is-active')).toContainText('Terminal 1');
    await expect.poll(async () => {
      const output = await getHostTerminalText(page);
      return output.includes('shell-before');
    }, { timeout: 30000 }).toBe(true);
  });

  test('runs shadcn from the seeded Web IDE workspace with debug output and survives a second run', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);
    await loadWebIDE(page, '?marketplace=mock&debug=all');

    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];
    let crashed = false;

    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error));
    });
    page.on('crash', () => {
      crashed = true;
    });

    const command = 'npx shadcn@latest add dropdown-menu';

    await driveInteractiveHostCommand(page, command, { timeout: 7 * 60 * 1000 });

    await expect(page.locator('#webideTerminalStatus')).toHaveText('Exited 0');
    const firstRunOutput = await getHostTerminalText(page);
    expect(firstRunOutput).toContain('[almostnode debug] enabled: all');
    expect(firstRunOutput).toContain(`$ ${command}`);
    expect(firstRunOutput).toMatch(/Resolving shadcn@latest|Installing \d+ packages|Applying \d+ file changes|Install changes applied/);

    await expect.poll(() => {
      return page.evaluate(() => {
        return (window as any).__almostnodeWebIDE.container.vfs.existsSync('/project/src/components/ui/dropdown-menu.tsx');
      });
    }, { timeout: 60000 }).toBe(true);

    expect(
      consoleMessages.some((message) => {
        return message.includes('[almostnode DEBUG]')
          && (
            message.includes('npx parsed')
            || message.includes('npm worker start')
            || message.includes('fetch proxy')
          );
      }),
    ).toBe(true);

    await driveInteractiveHostCommand(page, command, {
      timeout: 5 * 60 * 1000,
      answerOverwriteWithNo: true,
    });

    await expect(page.locator('#webideTerminalStatus')).toContainText('Exited');
    const secondRunOutput = await getHostTerminalText(page);
    expect(secondRunOutput).toContain(`$ ${command}`);
    expect(secondRunOutput).toMatch(/dropdown-menu|overwrite|already exists/i);
    expect(crashed).toBe(false);
    expect(pageErrors.join('\n')).not.toContain('Error code: 5');
  });
});
