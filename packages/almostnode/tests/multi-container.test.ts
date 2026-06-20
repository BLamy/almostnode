/**
 * Multi-container integration tests: two createContainer() instances sharing
 * the page-global server bridge and http port space, with per-container VFS,
 * server ownership, and npm bundle cache isolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createContainer } from '../src/index';
import { resetServerBridge } from '../src/server-bridge';
import {
  bundleNpmModuleForBrowser,
  clearNpmBundleCache,
} from '../src/frameworks/npm-serve';
import { getDefaultNetworkController } from '../src/network';
import type { VirtualFS } from '../src/virtual-fs';

// Fake esbuild: "bundle" output is just the entry file's content from the
// VFS the build was given, so tests can detect which VFS produced a bundle.
vi.mock('../src/shims/esbuild', () => {
  let globalVfs: VirtualFS | null = null;
  const setVFS = (vfs: VirtualFS) => {
    globalVfs = vfs;
  };
  const build = async (options: {
    vfs?: VirtualFS;
    entryPoints?: string[];
  }) => {
    const vfs = options.vfs ?? globalVfs;
    const entry = options.entryPoints?.[0];
    const text =
      entry && vfs ? (vfs.readFileSync(entry, 'utf8') as string) : 'export default "no-entry";';
    return {
      errors: [],
      warnings: [],
      outputFiles: [{ path: entry ?? '<stdin>', contents: new Uint8Array(), text }],
    };
  };
  const mod = {
    setVFS,
    initialize: async () => {},
    isInitialized: () => true,
    build,
  };
  return {
    ...mod,
    // Mirrors the real shim: a per-runtime module whose build() falls back
    // to the runtime's own VFS instead of the module-level binding.
    createEsbuildModule: (vfs: VirtualFS) => ({
      ...mod,
      build: (options: { vfs?: VirtualFS; entryPoints?: string[] }) =>
        build({ ...options, vfs: options.vfs ?? vfs }),
    }),
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

function writeHttpServerScript(
  vfs: VirtualFS,
  scriptPath: string,
  port: number,
): void {
  vfs.writeFileSync(
    scriptPath,
    [
      "const http = require('http');",
      "const fs = require('fs');",
      'const server = http.createServer((req, res) => {',
      "  res.end(fs.readFileSync('/payload.txt', 'utf8'));",
      '});',
      "server.on('error', (err) => console.log('ERR:' + err.code + ':' + err.message));",
      `server.listen(${port}, () => console.log('LISTENING:${port}'));`,
      '',
    ].join('\n'),
  );
}

describe('multi-container', () => {
  beforeEach(() => {
    resetServerBridge();
    clearNpmBundleCache();
  });

  it('gives each container a unique id and a shared server bridge', () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });

    expect(containerA.id).toBeTruthy();
    expect(containerB.id).toBeTruthy();
    expect(containerA.id).not.toBe(containerB.id);
    expect(containerA.vfs).not.toBe(containerB.vfs);
    // The port space is page-global: one bridge for all containers.
    expect(containerA.serverBridge).toBe(containerB.serverBridge);
    // Each container keeps its own network controller; the first one created
    // in this process stays the page default (set-if-unset).
    expect(containerA.network).not.toBe(containerB.network);
    expect(getDefaultNetworkController()).toBe(containerA.network);
  });

  it('routes same-numbered ports to each container\'s own VFS content', async () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });
    const bridge = containerA.serverBridge;

    containerA.vfs.writeFileSync('/payload.txt', 'payload-a');
    containerB.vfs.writeFileSync('/payload.txt', 'payload-b');
    writeHttpServerScript(containerA.vfs, '/server.js', 3000);
    writeHttpServerScript(containerB.vfs, '/server.js', 3001);

    const abortA = new AbortController();
    const abortB = new AbortController();
    const outputA: string[] = [];
    const outputB: string[] = [];
    const runA = containerA.run('node /server.js', {
      signal: abortA.signal,
      onStdout: (chunk) => outputA.push(chunk),
    });
    const runB = containerB.run('node /server.js', {
      signal: abortB.signal,
      onStdout: (chunk) => outputB.push(chunk),
    });

    await waitFor(() => bridge.getServerPorts().includes(3000));
    await waitFor(() => bridge.getServerPorts().includes(3001));

    const responseA = await bridge.handleRequest(3000, 'GET', '/', {});
    const responseB = await bridge.handleRequest(3001, 'GET', '/', {});
    expect(responseA.body.toString()).toBe('payload-a');
    expect(responseB.body.toString()).toBe('payload-b');

    abortA.abort();
    abortB.abort();
    await Promise.all([runA, runB]);
  }, 30000);

  it('emits EADDRINUSE when a second container listens on a taken port', async () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });
    const bridge = containerA.serverBridge;

    containerA.vfs.writeFileSync('/payload.txt', 'payload-a');
    containerB.vfs.writeFileSync('/payload.txt', 'payload-b');
    writeHttpServerScript(containerA.vfs, '/server.js', 3100);
    writeHttpServerScript(containerB.vfs, '/server.js', 3100);

    const abortA = new AbortController();
    const abortB = new AbortController();
    const outputB: string[] = [];
    const runA = containerA.run('node /server.js', { signal: abortA.signal });

    await waitFor(() => bridge.getServerPorts().includes(3100));

    const runB = containerB.run('node /server.js', {
      signal: abortB.signal,
      onStdout: (chunk) => outputB.push(chunk),
    });

    await waitFor(() => outputB.join('').includes('ERR:'));
    expect(outputB.join('')).toContain('ERR:EADDRINUSE:listen EADDRINUSE: address already in use :::3100');
    expect(outputB.join('')).not.toContain('LISTENING:3100');

    // The original server keeps serving its own content.
    const response = await bridge.handleRequest(3100, 'GET', '/', {});
    expect(response.body.toString()).toBe('payload-a');

    abortA.abort();
    abortB.abort();
    await Promise.all([runA, runB]);
  }, 30000);

  it('lets the same container abort and rerun a server on the same port', async () => {
    const container = createContainer({ baseUrl: 'http://localhost:5173' });
    const bridge = container.serverBridge;

    container.vfs.writeFileSync('/payload.txt', 'payload-v1');
    writeHttpServerScript(container.vfs, '/server.js', 3200);

    const abortFirst = new AbortController();
    const runFirst = container.run('node /server.js', {
      signal: abortFirst.signal,
    });
    await waitFor(() => bridge.getServerPorts().includes(3200));
    abortFirst.abort();
    await runFirst;

    // Rerunning in the SAME container replaces the stale registration
    // silently — the historical restart path must not hit EADDRINUSE.
    container.vfs.writeFileSync('/payload.txt', 'payload-v2');
    const abortSecond = new AbortController();
    const outputSecond: string[] = [];
    const runSecond = container.run('node /server.js', {
      signal: abortSecond.signal,
      onStdout: (chunk) => outputSecond.push(chunk),
    });

    await waitFor(() => outputSecond.join('').includes('LISTENING:3200'));
    expect(outputSecond.join('')).not.toContain('ERR:EADDRINUSE');

    const response = await bridge.handleRequest(3200, 'GET', '/', {});
    expect(response.body.toString()).toBe('payload-v2');

    abortSecond.abort();
    await runSecond;
  }, 30000);

  it('dispose() removes only the disposed container\'s servers', async () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });
    const bridge = containerA.serverBridge;

    for (const container of [containerA, containerB]) {
      container.vfs.mkdirSync('/app/dist', { recursive: true });
      container.vfs.writeFileSync(
        '/app/wrangler.toml',
        'name = "app"\npages_build_output_dir = "dist"\n',
      );
    }
    containerA.vfs.writeFileSync('/app/dist/index.html', '<main>pages-a</main>');
    containerB.vfs.writeFileSync('/app/dist/index.html', '<main>pages-b</main>');

    const abortA = new AbortController();
    const abortB = new AbortController();
    const runA = containerA.run('cd /app && wrangler pages dev --port 8790', {
      signal: abortA.signal,
    });
    const runB = containerB.run('cd /app && wrangler pages dev --port 8791', {
      signal: abortB.signal,
    });

    await waitFor(() => bridge.getServerPorts().includes(8790));
    await waitFor(() => bridge.getServerPorts().includes(8791));
    expect(bridge.getServerMetadata(8790)?.ownerId).toBe(containerA.id);
    expect(bridge.getServerMetadata(8791)?.ownerId).toBe(containerB.id);

    containerA.dispose();
    const resultA = await runA;
    expect(resultA.exitCode).toBe(130);

    expect(bridge.getServerPorts()).not.toContain(8790);
    expect(bridge.getServerPorts()).toContain(8791);

    const response = await bridge.handleRequest(8791, 'GET', '/', {});
    expect(response.body.toString()).toContain('pages-b');

    // Disposing again is a no-op.
    containerA.dispose();

    abortB.abort();
    await runB;
  }, 30000);

  it('dispose() closes raw node servers so another container can take the port', async () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });
    const bridge = containerA.serverBridge;

    containerA.vfs.writeFileSync('/payload.txt', 'from-a');
    containerB.vfs.writeFileSync('/payload.txt', 'from-b');
    writeHttpServerScript(containerA.vfs, '/server.js', 8795);
    writeHttpServerScript(containerB.vfs, '/server.js', 8795);

    const abortA = new AbortController();
    const runA = containerA.run('node /server.js', { signal: abortA.signal });
    await waitFor(() => bridge.getServerPorts().includes(8795));
    expect(bridge.getServerMetadata(8795)?.ownerId).toBe(containerA.id);

    // Raw servers outlive their command by design — only dispose() closes
    // them. Without that close, the page-global server registry would keep
    // the dead server listening and EADDRINUSE container B forever.
    containerA.dispose();
    await runA;
    expect(bridge.getServerPorts()).not.toContain(8795);

    const abortB = new AbortController();
    const outputB: string[] = [];
    const runB = containerB.run('node /server.js', {
      signal: abortB.signal,
      onStdout: (chunk) => outputB.push(chunk),
    });

    await waitFor(() => outputB.join('').includes('LISTENING:8795'));
    expect(outputB.join('')).not.toContain('ERR:EADDRINUSE');
    expect(bridge.getServerMetadata(8795)?.ownerId).toBe(containerB.id);

    const response = await bridge.handleRequest(8795, 'GET', '/', {});
    expect(response.body.toString()).toBe('from-b');

    abortB.abort();
    await runB;
    containerB.dispose();
  }, 30000);

  it('isolates the npm bundle cache per VFS for the same specifier', async () => {
    const containerA = createContainer({ baseUrl: 'http://localhost:5173' });
    const containerB = createContainer({ baseUrl: 'http://localhost:5173' });

    for (const [container, marker] of [
      [containerA, 'pkg-a'],
      [containerB, 'pkg-b'],
    ] as const) {
      container.vfs.mkdirSync('/node_modules/widget', { recursive: true });
      container.vfs.writeFileSync(
        '/node_modules/widget/package.json',
        JSON.stringify({ name: 'widget', version: '1.0.0', main: 'index.js' }),
      );
      container.vfs.writeFileSync(
        '/node_modules/widget/index.js',
        `export default "${marker}";`,
      );
    }

    const bundleA = await bundleNpmModuleForBrowser('widget', ['/'], containerA.vfs);
    const bundleB = await bundleNpmModuleForBrowser('widget', ['/'], containerB.vfs);
    expect(bundleA).toContain('pkg-a');
    expect(bundleB).toContain('pkg-b');

    // Cached per VFS: clearing A leaves B's cache intact.
    containerA.vfs.writeFileSync('/node_modules/widget/index.js', 'export default "pkg-a2";');
    containerB.vfs.writeFileSync('/node_modules/widget/index.js', 'export default "pkg-b2";');
    expect(await bundleNpmModuleForBrowser('widget', ['/'], containerA.vfs)).toContain('pkg-a');
    clearNpmBundleCache(containerA.vfs);
    expect(await bundleNpmModuleForBrowser('widget', ['/'], containerA.vfs)).toContain('pkg-a2');
    expect(await bundleNpmModuleForBrowser('widget', ['/'], containerB.vfs)).toContain('pkg-b');
  }, 30000);
});
