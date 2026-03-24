import { expect, test, type Page } from '@playwright/test';
import pako from 'pako';

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

    for (let i = 0; i <= lastLine; i += 1) {
      const line = buffer.getLine(i);
      if (line) text += line.translateToString(true) + '\n';
    }

    return text;
  });
}

function createLargePackageTarball(packageName: string, fileCount: number): Uint8Array {
  const files: Record<string, string> = {
    'package/package.json': JSON.stringify({
      name: packageName,
      version: '1.0.0',
      main: 'index.js',
    }),
    'package/index.js': 'module.exports = "ok";',
  };

  for (let index = 0; index < fileCount; index += 1) {
    files[`package/lib/file-${index}.js`] = `export const value${index} = ${index};\n`;
  }

  return pako.gzip(createMinimalTarball(files));
}

function createMinimalTarball(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [filename, content] of Object.entries(files)) {
    const contentBytes = encoder.encode(content);
    const header = new Uint8Array(512);
    header.set(encoder.encode(filename).slice(0, 100), 0);
    header.set(encoder.encode('0000644\0'), 100);
    header.set(encoder.encode('0000000\0'), 108);
    header.set(encoder.encode('0000000\0'), 116);
    header.set(encoder.encode(contentBytes.length.toString(8).padStart(11, '0') + ' '), 124);
    header.set(encoder.encode('00000000000\0'), 136);
    header.set(encoder.encode('        '), 148);
    header[156] = 48;

    let checksum = 0;
    for (let offset = 0; offset < 512; offset += 1) {
      checksum += header[offset];
    }
    header.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);

    chunks.push(header);

    const paddedSize = Math.ceil(contentBytes.length / 512) * 512;
    const paddedContent = new Uint8Array(paddedSize);
    paddedContent.set(contentBytes);
    chunks.push(paddedContent);
  }

  chunks.push(new Uint8Array(1024));

  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

test.describe('web-ide installs', () => {
  test('stays interactive while npm install applies module changes', async ({ page }) => {
    test.setTimeout(60000);

    const packageName = 'ui-freeze-pkg';
    const manifestUrl = `https://registry.npmjs.org/${packageName}`;
    const tarballUrl = `https://registry.npmjs.org/${packageName}/-/${packageName}-1.0.0.tgz`;
    const tarball = createLargePackageTarball(packageName, 800);
    const manifest = {
      name: packageName,
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: packageName,
          version: '1.0.0',
          dist: {
            tarball: tarballUrl,
            shasum: 'ui-freeze',
          },
          dependencies: {},
        },
      },
    };

    await page.route('https://registry.npmjs.org/**', async (route) => {
      const url = route.request().url();
      if (url === manifestUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(manifest),
        });
        return;
      }
      if (url === tarballUrl) {
        await route.fulfill({
          status: 200,
          body: Buffer.from(tarball),
        });
        return;
      }
      await route.continue();
    });

    await page.route('https://almostnode-cors-proxy.langtail.workers.dev/**', async (route) => {
      const proxiedUrl = new URL(route.request().url()).searchParams.get('url') || '';
      if (proxiedUrl === manifestUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(manifest),
        });
        return;
      }
      if (proxiedUrl === tarballUrl) {
        await route.fulfill({
          status: 200,
          body: Buffer.from(tarball),
        });
        return;
      }
      await route.continue();
    });

    await loadWebIDE(page);

    await page.evaluate(() => {
      (window as any).__ticks = 0;
      (window as any).__tickTimer = window.setInterval(() => {
        (window as any).__ticks += 1;
      }, 16);
      (window as any).__almostnodeWebIDE.executeHostCommand('npm install ui-freeze-pkg');
    });

    await expect.poll(() => getHostTerminalText(page), { timeout: 30000 }).toContain('Applying');

    await page.locator('.almostnode-terminal-surface__new-tab').click();
    await expect(page.locator('.almostnode-terminal-surface__tab', { hasText: 'Terminal 2' })).toHaveCount(1);

    await expect.poll(() => page.evaluate(() => (window as any).__ticks), { timeout: 5000 }).toBeGreaterThan(2);

    await page.locator('.almostnode-terminal-surface__tab', { hasText: 'Terminal 1' }).click();
    await expect(page.locator('#webideTerminalStatus')).toHaveText('Exited 0', { timeout: 30000 });

    const installed = await page.evaluate(() => {
      return (window as any).__almostnodeWebIDE.container.vfs.existsSync('/project/node_modules/ui-freeze-pkg/package.json');
    });
    expect(installed).toBe(true);

    await page.evaluate(() => {
      window.clearInterval((window as any).__tickTimer);
    });
  });
});
