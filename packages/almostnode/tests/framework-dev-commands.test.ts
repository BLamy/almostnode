import { describe, expect, it, vi } from 'vitest';
import { createContainer } from '../src/index';
import pako from 'pako';

vi.mock('../src/frameworks/npm-serve', () => {
  let moduleVfs: { existsSync: (path: string) => boolean } | null = null;

  return {
    initNpmServe(vfs: { existsSync: (path: string) => boolean }) {
      moduleVfs = vfs;
    },
    clearNpmBundleCache() {},
    async bundleNpmModuleForBrowser(specifier: string, searchRoots: string[] = ['/']) {
      if (!moduleVfs) {
        throw new Error('npm serve not initialized');
      }

      for (const root of searchRoots) {
        const normalizedRoot = root === '/' ? '' : root.replace(/\/$/, '');
        const pkgJsonPath = `${normalizedRoot}/node_modules/${specifier}/package.json`.replace(/\/+/g, '/');
        if (moduleVfs.existsSync(pkgJsonPath)) {
          return `export default ${JSON.stringify(specifier)};`;
        }
      }

      throw new Error(`Package not installed: ${specifier}`);
    },
  };
});

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('framework dev shell commands', () => {
  it('wires `next dev` from npm scripts to internal NextDevServer', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173' });

    container.vfs.mkdirSync('/workspace/next-app/pages', { recursive: true });
    container.vfs.writeFileSync('/workspace/next-app/pages/index.jsx', 'export default function Home(){ return <main>next ok</main>; }');
    container.vfs.writeFileSync(
      '/workspace/next-app/package.json',
      JSON.stringify({
        name: 'next-app',
        version: '0.0.1',
        scripts: {
          dev: 'next dev --turbopack',
        },
      }, null, 2)
    );

    const output: string[] = [];
    const controller = new AbortController();
    const runPromise = container.run('cd /workspace/next-app && npm run dev', {
      signal: controller.signal,
      onStdout: (chunk) => output.push(chunk),
      onStderr: (chunk) => output.push(chunk),
    });

    await waitFor(() => container.serverBridge.getServerPorts().includes(3000));
    expect(output.join('')).toContain('/__virtual__/3000/');

    const response = await container.serverBridge.handleRequest(3000, 'GET', '/', {});
    expect(response.statusCode).not.toBe(503);

    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(130);
    expect(container.serverBridge.getServerPorts()).not.toContain(3000);
  }, 30000);

  it('wires `vite` from npm scripts to internal ViteDevServer', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173' });

    container.vfs.mkdirSync('/workspace/vite-app', { recursive: true });
    container.vfs.writeFileSync('/workspace/vite-app/index.html', '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
    container.vfs.writeFileSync('/workspace/vite-app/main.js', 'document.getElementById("app").textContent = "vite ok";');
    container.vfs.writeFileSync(
      '/workspace/vite-app/package.json',
      JSON.stringify({
        name: 'vite-app',
        version: '0.0.1',
        scripts: {
          dev: 'vite --host --port 5174',
        },
      }, null, 2)
    );

    const output: string[] = [];
    const controller = new AbortController();
    const runPromise = container.run('cd /workspace/vite-app && npm run dev', {
      signal: controller.signal,
      onStdout: (chunk) => output.push(chunk),
      onStderr: (chunk) => output.push(chunk),
    });

    await waitFor(() => container.serverBridge.getServerPorts().includes(5174));
    expect(output.join('')).toContain('/__virtual__/5174/');

    const response = await container.serverBridge.handleRequest(5174, 'GET', '/', {});
    expect(response.statusCode).toBe(200);

    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(130);
    expect(container.serverBridge.getServerPorts()).not.toContain(5174);
  }, 30000);

  it('makes newly installed packages visible to a running Next preview without restart', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173', installMode: 'main-thread' });

    container.vfs.mkdirSync('/pages', { recursive: true });
    container.vfs.writeFileSync('/pages/index.jsx', 'export default function Home(){ return <main>next ok</main>; }');
    container.vfs.writeFileSync(
      '/package.json',
      JSON.stringify({
        name: 'next-app',
        version: '0.0.1',
        scripts: {
          dev: 'next dev --turbopack',
        },
      }, null, 2),
    );

    const manifest = {
      name: 'tiny-pkg',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'tiny-pkg',
          version: '1.0.0',
          dist: {
            tarball: 'https://registry.npmjs.org/tiny-pkg/-/tiny-pkg-1.0.0.tgz',
            shasum: 'abc123',
          },
          dependencies: {},
        },
      },
    };
    const tarball = pako.gzip(createMinimalTarball({
      'package/package.json': '{"name":"tiny-pkg","version":"1.0.0"}',
      'package/index.js': 'module.exports = "tiny";',
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('registry.npmjs.org/tiny-pkg') && !urlStr.includes('.tgz')) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('.tgz')) {
        return new Response(tarball, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const controller = new AbortController();
    const runPromise = container.run('npm run dev', {
      signal: controller.signal,
      onStdout: () => {},
      onStderr: () => {},
    });

    await waitFor(() => container.serverBridge.getServerPorts().includes(3000));

    const before = await container.serverBridge.handleRequest(3000, 'GET', '/_npm/tiny-pkg', {});
    expect(before.statusCode).toBe(500);

    const installResult = await container.run('npm install tiny-pkg');
    expect(installResult.exitCode).toBe(0);

    const after = await container.serverBridge.handleRequest(3000, 'GET', '/_npm/tiny-pkg', {});
    expect(after.statusCode).toBe(200);
    expect(after.body.toString()).toContain('tiny');

    controller.abort();
    await runPromise;
  }, 30000);

  it('wires `npx wrangler dev` to the internal Workers-style dev server', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173' });

    container.vfs.mkdirSync('/workspace/cloudflare-worker/src', { recursive: true });
    container.vfs.writeFileSync(
      '/workspace/cloudflare-worker/src/index.ts',
      [
        'export default {',
        '  async fetch(_request, env) {',
        '    return new Response(`worker ${env.APP_NAME}`);',
        '  },',
        '};',
        '',
      ].join('\n'),
    );
    container.vfs.writeFileSync(
      '/workspace/cloudflare-worker/wrangler.toml',
      [
        'name = "cloudflare-worker"',
        'main = "src/index.ts"',
        '',
        '[vars]',
        'APP_NAME = "ok"',
        '',
        '[dev]',
        'port = 8787',
        '',
      ].join('\n'),
    );

    const output: string[] = [];
    const controller = new AbortController();
    const runPromise = container.run('cd /workspace/cloudflare-worker && npx wrangler dev', {
      signal: controller.signal,
      onStdout: (chunk) => output.push(chunk),
      onStderr: (chunk) => output.push(chunk),
    });

    await waitFor(() => container.serverBridge.getServerPorts().includes(8787));
    expect(output.join('')).toContain('/__virtual__/8787/');

    const response = await container.serverBridge.handleRequest(8787, 'GET', '/', {});
    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toBe('worker ok');

    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(130);
    expect(container.serverBridge.getServerPorts()).not.toContain(8787);
  }, 30000);

  it('wires `wrangler pages dev` to the internal Pages-style static server', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173' });

    container.vfs.mkdirSync('/workspace/cloudflare-pages/dist', { recursive: true });
    container.vfs.writeFileSync(
      '/workspace/cloudflare-pages/dist/index.html',
      '<!doctype html><html><body><main>pages ok</main></body></html>',
    );
    container.vfs.writeFileSync(
      '/workspace/cloudflare-pages/wrangler.toml',
      [
        'name = "cloudflare-pages"',
        'pages_build_output_dir = "dist"',
        '',
      ].join('\n'),
    );

    const output: string[] = [];
    const controller = new AbortController();
    const runPromise = container.run('cd /workspace/cloudflare-pages && wrangler pages dev', {
      signal: controller.signal,
      onStdout: (chunk) => output.push(chunk),
      onStderr: (chunk) => output.push(chunk),
    });

    await waitFor(() => container.serverBridge.getServerPorts().includes(8788));
    expect(output.join('')).toContain('/__virtual__/8788/');

    const response = await container.serverBridge.handleRequest(8788, 'GET', '/', {});
    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toContain('pages ok');

    controller.abort();
    const result = await runPromise;

    expect(result.exitCode).toBe(130);
    expect(container.serverBridge.getServerPorts()).not.toContain(8788);
  }, 30000);
});

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
    for (let index = 0; index < 512; index += 1) {
      checksum += header[index];
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
