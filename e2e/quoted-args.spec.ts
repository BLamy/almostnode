import { expect, test, type Page } from '@playwright/test';

async function loadWebIDE(page: Page) {
  await page.goto('/examples/web-ide-demo.html?template=vite&marketplace=mock', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeWebIDE), {
    timeout: 30000,
  });
  // Wait for initial setup
  await page.waitForTimeout(3000);
}

test.describe('quoted argument handling', () => {
  // Test the exact path Claude Code uses: child_process.exec()
  test('child_process.exec handles double-quoted arguments', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      // Write a script that uses child_process.exec with quoted args
      host.container.vfs.writeFileSync('/test-quotes.js', `
        const { exec } = require('child_process');
        exec('echo "hello world"', (error, stdout, stderr) => {
          console.log('RESULT:' + JSON.stringify({ error: error?.message || null, stdout, stderr }));
        });
      `);
      const r = await host.container.run('node /test-quotes.js');
      return r;
    });

    expect(result.stdout).toContain('hello world');
    expect(result.stdout).not.toContain('unexpected EOF');
    expect(result.stderr || '').not.toContain('unexpected EOF');
  });

  // Test via container.run (the simple path)
  test('container.run handles double-quoted echo', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      return host.container.run('echo "hello world"');
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello world');
  });

  // Test via terminal session (webide terminal path)
  test('terminal session handles double-quoted echo', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      const session = host.container.createTerminalSession({ cwd: '/' });
      return session.run('echo "hello world"');
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello world');
  });

  // Test child_process.exec with pg command (what Claude Code does)
  test('child_process.exec handles pg with double-quoted SQL', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      host.container.vfs.writeFileSync('/test-pg-quotes.js', `
        const { exec } = require('child_process');
        exec('pg "SELECT 1 as test"', (error, stdout, stderr) => {
          console.log('RESULT:' + JSON.stringify({ error: error?.message || null, stdout, stderr }));
        });
      `);
      const r = await host.container.run('node /test-pg-quotes.js');
      return r;
    });

    // Must not crash with bash quote parsing error
    expect(result.stdout + (result.stderr || '')).not.toContain('unexpected EOF');
  });

  // Test spawn with bash -c wrapping (how Claude Code often runs commands)
  test('child_process.exec with bash -c wrapper handles quotes', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      host.container.vfs.writeFileSync('/test-bash-c.js', `
        const { exec } = require('child_process');
        exec("bash -c 'echo \\"hello world\\"'", (error, stdout, stderr) => {
          console.log('RESULT:' + JSON.stringify({ error: error?.message || null, stdout, stderr }));
        });
      `);
      const r = await host.container.run('node /test-bash-c.js');
      return r;
    });

    expect(result.stdout).toContain('hello world');
    expect(result.stdout + (result.stderr || '')).not.toContain('unexpected EOF');
  });

  // Test spawn (another path Claude Code might use)
  test('child_process.spawn with bash -c handles quoted arguments', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      host.container.vfs.writeFileSync('/test-spawn.js', `
        const { spawn } = require('child_process');
        const child = spawn('bash', ['-c', 'echo "hello world"']);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => stdout += d);
        child.stderr.on('data', (d) => stderr += d);
        child.on('close', (code) => {
          console.log('RESULT:' + JSON.stringify({ code, stdout, stderr }));
        });
      `);
      const r = await host.container.run('node /test-spawn.js');
      return r;
    });

    expect(result.stdout).toContain('hello world');
    expect(result.stdout + (result.stderr || '')).not.toContain('unexpected EOF');
  });

  // Test execSync path
  test('child_process.execSync handles double-quoted arguments', async ({ page }) => {
    await loadWebIDE(page);

    const result = await page.evaluate(async () => {
      const host = (window as any).__almostnodeWebIDE;
      host.container.vfs.writeFileSync('/test-execsync.js', `
        const { execSync } = require('child_process');
        try {
          const output = execSync('echo "hello world"').toString();
          console.log('RESULT:' + output);
        } catch (e) {
          console.log('ERROR:' + e.message);
        }
      `);
      const r = await host.container.run('node /test-execsync.js');
      return r;
    });

    expect(result.stdout).toContain('hello world');
    expect(result.stdout + (result.stderr || '')).not.toContain('unexpected EOF');
  });
});
