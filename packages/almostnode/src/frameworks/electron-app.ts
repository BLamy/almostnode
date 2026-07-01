/**
 * Electron app orchestrator.
 *
 * Launches a modern (contextIsolation + preload) Electron app in dev mode:
 *  1. Resolve the `main` entry, the renderer root, and the preload script.
 *  2. Start a ViteDevServer for the renderer with the preload/contextBridge
 *     bootstrap injected into `<head>` (see electron-preload.ts).
 *  3. Expose the renderer URL via the env vars dev-mode apps read
 *     (VITE_DEV_SERVER_URL / ELECTRON_RENDERER_URL) and a private var the
 *     electron shim uses to rewrite `loadURL('http://localhost:*')`.
 *  4. Run the main entry through the runtime; `app`/`BrowserWindow`/`ipcMain`
 *     take over from there (windows render via the registered host).
 */
import type { Runtime } from '../runtime';
import type { VirtualFS } from '../virtual-fs';
import * as path from './../shims/path';
import { buildElectronPreloadBootstrap } from './electron-preload';

export interface ElectronLaunchContext {
  vfs: VirtualFS;
  runtime: Runtime;
  onLog?: (line: string) => void;
}

export interface ElectronAppInstance {
  rendererPort: number;
  rendererUrl: string;
  mainPath: string;
  close: () => void;
}

const RENDERER_ROOT_CANDIDATES = ['src/renderer', 'renderer', 'src', '.'];
const PRELOAD_CANDIDATES = [
  'src/preload/index.ts',
  'src/preload/index.js',
  'src/preload/index.mjs',
  'src/preload/index.cjs',
  'src/preload.ts',
  'src/preload.js',
  'preload.ts',
  'preload.js',
  'preload.cjs',
  'electron/preload.ts',
  'electron/preload.js',
];

function readJson(vfs: VirtualFS, filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(vfs.readFileSync(filePath, 'utf8') as string) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function firstExisting(vfs: VirtualFS, base: string, candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = path.resolve(base, rel);
    if (vfs.existsSync(abs)) return abs;
  }
  return null;
}

function detectRendererRoot(vfs: VirtualFS, appDir: string): string {
  for (const rel of RENDERER_ROOT_CANDIDATES) {
    const dir = path.resolve(appDir, rel);
    if (vfs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return appDir;
}

async function transpilePreload(source: string, filePath: string): Promise<string> {
  const isTs = /\.(ts|tsx|mts|cts)$/.test(filePath);
  const looksEsm = /\b(import|export)\b/.test(source);
  if (!isTs && !looksEsm) return source; // already CJS-compatible

  const esbuild = (globalThis as { __esbuild?: typeof import('esbuild-wasm') }).__esbuild;
  if (!esbuild) {
    // Best-effort: a raw ESM preload can't be executed as CJS without a
    // transform; surface a clear console error rather than silently breaking.
    console.warn(
      '[electron] esbuild unavailable — preload is ESM/TS and could not be transpiled',
    );
    return source;
  }
  const result = await esbuild.transform(source, {
    loader: isTs ? 'ts' : 'js',
    format: 'cjs',
    target: 'es2020',
  });
  return result.code;
}

function createBridgeServerWrapper(devServer: {
  getPort: () => number;
  handleRequest: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Buffer,
  ) => Promise<unknown>;
}) {
  return {
    listening: true,
    address: () => ({ port: devServer.getPort(), address: '0.0.0.0', family: 'IPv4' }),
    async handleRequest(
      method: string,
      url: string,
      headers: Record<string, string>,
      body?: string | Buffer,
    ) {
      const bodyBuffer = body
        ? typeof body === 'string'
          ? Buffer.from(body)
          : body
        : undefined;
      return devServer.handleRequest(method, url, headers, bodyBuffer);
    },
  };
}

/**
 * Launch an Electron app from source. `appDir` is the project root (contains
 * package.json). Returns once the main entry has been evaluated; windows open
 * asynchronously as the app reacts to `app` becoming ready.
 */
export async function launchElectronApp(
  appDir: string,
  ctx: ElectronLaunchContext,
): Promise<ElectronAppInstance> {
  const { vfs, runtime } = ctx;
  const log = ctx.onLog ?? (() => {});

  const pkg = readJson(vfs, path.join(appDir, 'package.json'));
  const mainRel = (pkg.main as string) || 'main.js';
  const mainPath = path.resolve(appDir, mainRel);
  if (!vfs.existsSync(mainPath)) {
    throw new Error(`electron: main entry not found: ${mainPath}`);
  }

  const rendererRoot = detectRendererRoot(vfs, appDir);
  const preloadPath = firstExisting(vfs, appDir, PRELOAD_CANDIDATES);
  let preloadSource = '';
  if (preloadPath) {
    preloadSource = await transpilePreload(
      vfs.readFileSync(preloadPath, 'utf8') as string,
      preloadPath,
    );
    log(`[electron] preload: ${preloadPath}\n`);
  }

  const [{ ViteDevServer }, { getServerBridge }] = await Promise.all([
    import('./vite-dev-server'),
    import('../server-bridge'),
  ]);
  const bridge = getServerBridge();
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      await bridge.initServiceWorker();
    } catch {
      // Service worker is optional.
    }
  }

  const port = bridge.findFreePort(5273);
  const server = new ViteDevServer(vfs, {
    port,
    root: rendererRoot,
    publicDir: `${rendererRoot}/public`.replace(/\/+/g, '/'),
    spaFallback: true,
    deploymentBasePath: bridge.getBasePath(),
    injectHead: buildElectronPreloadBootstrap({ preloadSource }),
  });
  server.start();
  bridge.registerServer(
    createBridgeServerWrapper(server as unknown as {
      getPort: () => number;
      handleRequest: (
        method: string,
        url: string,
        headers: Record<string, string>,
        body?: Buffer,
      ) => Promise<unknown>;
    }) as never,
    port,
    '0.0.0.0',
    { purpose: 'auxiliary', framework: 'vite', root: rendererRoot },
  );

  const rendererUrl = `${bridge.getServerUrl(port)}/`;
  log(`[electron] renderer dev server: ${rendererUrl} (root: ${rendererRoot})\n`);

  // Expose the renderer URL the way dev-mode apps expect to read it.
  const env = runtime.getProcess().env as Record<string, string | undefined>;
  env.VITE_DEV_SERVER_URL = rendererUrl;
  env.ELECTRON_RENDERER_URL = rendererUrl;
  env.__ALMOST_ELECTRON_DEV_URL = rendererUrl;

  log(`[electron] main: ${mainPath}\n`);
  await runtime.runFile(mainPath);

  return {
    rendererPort: port,
    rendererUrl,
    mainPath,
    close: () => {
      try {
        (server as unknown as { stop?: () => void }).stop?.();
      } finally {
        bridge.unregisterServer(port);
      }
    },
  };
}
