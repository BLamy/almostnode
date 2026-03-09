import { test, expect, type Page } from '@playwright/test';

const CLAUDE_CODE_SMOKE_COMMAND = 'npx @anthropic-ai/claude-code --version';

async function getTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__shadcnTerminal;
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

async function waitForTerminalText(page: Page, text: string, timeout = 45000) {
  await page.waitForFunction(
    (searchText: string) => {
      const term = (window as any).__shadcnTerminal;
      if (!term) return false;

      const buffer = term.buffer.active;
      const lastLine = buffer.baseY + buffer.cursorY;
      let content = '';

      for (let i = 0; i <= lastLine; i++) {
        const line = buffer.getLine(i);
        if (line) content += line.translateToString(true) + '\n';
      }

      return content.includes(searchText);
    },
    text,
    { timeout }
  );
}

async function waitForPrompt(page: Page, timeout = 45000) {
  await page.waitForFunction(
    () => {
      const status = document.getElementById('status')?.textContent?.trim();
      const term = (window as any).__shadcnTerminal;
      if (!term) return false;

      const buffer = term.buffer.active;
      const lastLine = buffer.baseY + buffer.cursorY;
      let text = '';

      for (let i = 0; i <= lastLine; i++) {
        const line = buffer.getLine(i);
        if (line) text += line.translateToString(true) + '\n';
      }

      return status === 'Ready' && text.trimEnd().endsWith('$');
    },
    { timeout }
  );
}

async function waitForCommandToComplete(page: Page, command: string, timeout = 5 * 60 * 1000) {
  await page.waitForFunction(
    (searchCommand: string) => {
      const status = document.getElementById('status')?.textContent?.trim();
      const term = (window as any).__shadcnTerminal;
      if (!term) return false;

      const buffer = term.buffer.active;
      const lastLine = buffer.baseY + buffer.cursorY;
      let text = '';

      for (let i = 0; i <= lastLine; i++) {
        const line = buffer.getLine(i);
        if (line) text += line.translateToString(true) + '\n';
      }

      return status === 'Ready'
        && text.includes(`[${searchCommand}]`)
        && text.trimEnd().endsWith('$');
    },
    command,
    { timeout }
  );
}

test.describe('claude-code on shadcn page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/shadcn-demo.html');
    await page.waitForFunction(
      () => Boolean((window as any).__shadcnContainer) && Boolean((window as any).__shadcnTerminal),
      { timeout: 45000 }
    );
    await waitForPrompt(page);
  });

  test('launches the installed CLI from the interactive shell', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);

    const initialOutput = await getTerminalText(page);
    expect(initialOutput).toContain('$');

    await page.locator('#terminal').click();
    await page.evaluate(() => {
      (window as any).__shadcnTerminal?.focus?.();
    });
    await page.keyboard.type(CLAUDE_CODE_SMOKE_COMMAND);
    await page.keyboard.press('Enter');

    await waitForCommandToComplete(page, CLAUDE_CODE_SMOKE_COMMAND);

    const output = await getTerminalText(page);
    expect(output).toContain(`[${CLAUDE_CODE_SMOKE_COMMAND}]`);
    expect(output).toMatch(/(?:^|\n)v?\d+\.\d+\.\d+(?: \(Claude Code\))?(?:\n|$)/);
    expect(output).not.toContain(`npx: command "claude-code" exited with code`);
    expect(output).not.toContain(`Unexpected identifier 'node'`);
    expect(output).not.toContain('SyntaxError: Unexpected identifier');
    expect(output).not.toContain('exit code: 1');
  });

  test('starts the interactive CLI without console constructor errors or orphan exits', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    const consoleMessages: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error));
    });

    await page.locator('#terminal').click();
    await page.evaluate(() => {
      (window as any).__shadcnTerminal?.focus?.();
    });
    await page.keyboard.type('npx @anthropic-ai/claude-code');
    await page.keyboard.press('Enter');

    await waitForTerminalText(page, 'Installed 1 packages', 5 * 60 * 1000);
    await page.waitForTimeout(32000);

    const interactiveOutput = await getTerminalText(page);
    expect(interactiveOutput).toContain('[npx @anthropic-ai/claude-code]');
    expect(interactiveOutput).toContain('Installed 1 packages');
    expect(interactiveOutput).not.toContain('Unhandled rejection');
    expect(interactiveOutput).not.toContain('console.Console is not a constructor');
    expect(interactiveOutput).not.toContain('TypeError: console.Console is not a constructor');
    expect(interactiveOutput).not.toContain('exited with code 129');
    expect(interactiveOutput).not.toContain('exit code: 129');
    expect(consoleMessages.join('\n')).not.toContain('Refused to set unsafe header "User-Agent"');
    expect(consoleMessages.join('\n')).not.toContain('blocked by CORS policy');
    expect(consoleMessages.join('\n')).not.toContain('net::ERR_FAILED');
    expect(pageErrors.join('\n')).not.toContain('unreachable');
  });

  test('supports spawnSync which probes in the browser shell', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const scriptPath = '/project/spawnsync-smoke.js';
      (window as any).__shadcnContainer.vfs.writeFileSync(
        scriptPath,
        [
          "const cp = require('child_process');",
          "const found = cp.spawnSync('which', ['node'], { encoding: 'utf8' });",
          "const missing = cp.spawnSync('which', ['rg'], { encoding: 'utf8' });",
          "console.log('FOUND=' + found.stdout.trim());",
          "console.log('MISSING=' + missing.status);",
        ].join('\n')
      );

      return await (window as any).__shadcnContainer.run(`node ${scriptPath}`, { cwd: '/project' });
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('FOUND=/usr/bin/node');
    expect(result.stdout).toContain('MISSING=1');
    expect(result.stdout).not.toContain('spawnSync is not supported');
  });

  test('supports the events and fs/promises APIs Claude uses after login', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const scriptPath = '/project/claude-runtime-smoke.js';
      (window as any).__shadcnContainer.vfs.writeFileSync(
        scriptPath,
        [
          "const fs = require('fs');",
          "const { appendFile, open } = require('fs/promises');",
          "const { getMaxListeners, setMaxListeners } = require('events');",
          "const signal = new AbortController().signal;",
          "setMaxListeners(21, signal);",
          "console.log('MAX=' + getMaxListeners(signal));",
          "fs.writeFileSync('/project/filehandle-smoke.txt', 'hello world');",
          "(async () => {",
          "  const handle = await open('/project/filehandle-smoke.txt', 'r');",
          "  const stats = await handle.stat();",
          "  const buffer = Buffer.alloc(5);",
          "  const { bytesRead } = await handle.read(buffer, 0, 5, 0);",
          "  await handle.close();",
          "  console.log('SIZE=' + stats.size);",
          "  console.log('READ=' + bytesRead + ':' + buffer.toString());",
          "  await appendFile('/project/filehandle-smoke.txt', '!');",
          "  console.log('APPEND=' + fs.readFileSync('/project/filehandle-smoke.txt', 'utf8'));",
          "})().catch((error) => {",
          "  console.error(error);",
          "  process.exitCode = 1;",
          "});",
        ].join('\n')
      );

      return await (window as any).__shadcnContainer.run(`node ${scriptPath}`, { cwd: '/project' });
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('MAX=21');
    expect(result.stdout).toContain('SIZE=11');
    expect(result.stdout).toContain('READ=5:hello');
    expect(result.stdout).toContain('APPEND=hello world!');
    expect(result.stdout).not.toContain('setMaxListeners');
    expect(result.stdout).not.toContain('import_promises.open');
    expect(result.stdout).not.toContain('import_promises.appendFile');
  });
});
