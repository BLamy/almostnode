import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/index';

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
});
