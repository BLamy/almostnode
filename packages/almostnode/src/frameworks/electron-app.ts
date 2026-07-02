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
  /** Resolves with the exit code when the app quits itself (app.quit/exit). */
  whenQuit: Promise<number>;
  close: () => void;
}

// Source roots first (dev); packaged build outputs next so a production
// `loadFile('dist/index.html')` still finds a served root; app dir last.
const RENDERER_ROOT_CANDIDATES = [
  'src/renderer',
  'renderer',
  'src',
  'dist',
  'build',
  'out',
  '.',
];
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
// Conventional main-process *source* entries, used when `pkg.main` points at a
// build output (electron-vite → `out/main/index.js`, vite-plugin-electron →
// `dist-electron/main/index.js`) that doesn't exist until a build runs. We run
// the source directly through the runtime, so map back to it.
const MAIN_CANDIDATES = [
  'src/main/index.ts',
  'src/main/index.js',
  'src/main.ts',
  'src/main.js',
  'electron/main/index.ts',
  'electron/main/index.js',
  'electron/main.ts',
  'electron/main.js',
  'main.ts',
  'main.js',
];

function readJson(vfs: VirtualFS, filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(vfs.readFileSync(filePath, 'utf8') as string) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Install an app's package.json dependencies into `<appDir>/node_modules` via
 * the runtime PackageManager, unless they're already installed. Best-effort:
 * failures are logged (some apps run fine with only their declared devDeps
 * missing), never fatal.
 */
async function installAppDependencies(
  appDir: string,
  vfs: VirtualFS,
  log: (line: string) => void,
): Promise<void> {
  const pkg = readJson(vfs, path.join(appDir, 'package.json'));
  const deps = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };
  if (Object.keys(deps).length === 0) return; // dependency-free (vanilla) app
  if (vfs.existsSync(path.join(appDir, 'node_modules'))) return; // already installed
  try {
    const { PackageManager } = await import('../npm');
    const pm = new PackageManager(vfs, { cwd: appDir });
    log(`[electron] installing ${Object.keys(deps).length} dependencies…\n`);
    await pm.installFromPackageJson({
      onProgress: (message: string) => log(`[electron] ${message}\n`),
    });
    log('[electron] dependencies installed\n');
  } catch (error) {
    log(
      `[electron] npm install failed (continuing): ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
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

/**
 * Resolve the main-process entry to a file that exists on disk. Prefers
 * `pkg.main`; when that points at an unbuilt output (electron-vite →
 * `out/main/index.js`, vite-plugin-electron → `dist-electron/main/index.js`),
 * falls back to the conventional source entry so the app runs without a
 * separate main-process build. Returns null if nothing runnable is found.
 */
export function resolveMainEntry(
  vfs: VirtualFS,
  appDir: string,
  pkg: Record<string, unknown>,
): string | null {
  const mainRel = (pkg.main as string) || 'main.js';
  const mainPath = path.resolve(appDir, mainRel);
  if (vfs.existsSync(mainPath)) return mainPath;
  return firstExisting(vfs, appDir, MAIN_CANDIDATES);
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

/**
 * Whether a preload script imports a bare npm specifier other than `electron` —
 * i.e. something a single-file transform would leave as an unresolvable
 * `require` (e.g. `@electron-toolkit/preload`). Relative/absolute imports and
 * `electron`/`electron/*` don't count. Used to decide whether to bundle.
 */
export function preloadImportsBareModule(source: string): boolean {
  // Scan each import/require specifier (kept on one line via [^'"\n]) and flag
  // the first bare npm one — i.e. not relative/absolute and not electron itself.
  const re = /\b(?:import|require)\b[^\n]*?['"]([^'"\n]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const spec = match[1];
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    if (spec === 'electron' || spec.startsWith('electron/')) continue;
    return true;
  }
  return false;
}

/**
 * Bundle a preload script and its npm dependencies into a single CJS module for
 * the renderer bootstrap, keeping `electron` external so it binds to the
 * injected renderer bridge (`preloadRequire`). Real preloads commonly import
 * helpers like `@electron-toolkit/preload`, which a single-file transform would
 * leave as an unresolvable `require`. Falls back to the single-file transform
 * when there's nothing to bundle or esbuild is unavailable.
 */
async function bundlePreload(
  source: string,
  filePath: string,
  vfs: VirtualFS,
  log: (line: string) => void,
): Promise<string> {
  // Only bundle when the preload imports a bare (npm) specifier other than
  // electron — otherwise the proven single-file transform suffices.
  if (!preloadImportsBareModule(source)) {
    return transpilePreload(source, filePath);
  }

  try {
    const esbuild = await import('../shims/esbuild');
    if (!esbuild.isInitialized()) await esbuild.initialize();
    const ext = path.extname(filePath).toLowerCase();
    const loader: 'ts' | 'tsx' | 'jsx' | 'js' =
      ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx'
      : /\.(ts|mts|cts)$/.test(ext) ? 'ts' : 'js';
    const result = await esbuild.build({
      stdin: { contents: source, resolveDir: path.dirname(filePath), loader },
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      external: ['electron', 'electron/renderer'],
      write: false,
      vfs,
    });
    const bundled = result.outputFiles?.[0]?.text;
    if (bundled) {
      log('[electron] bundled preload with dependencies\n');
      return bundled;
    }
  } catch (error) {
    log(
      `[electron] preload bundling failed (${
        error instanceof Error ? error.message : String(error)
      }); using single-file transform\n`,
    );
  }
  return transpilePreload(source, filePath);
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
  const mainPath = resolveMainEntry(vfs, appDir, pkg);
  if (!mainPath) {
    throw new Error(
      `electron: main entry not found: ${path.resolve(appDir, mainRel)}`,
    );
  }
  if (mainPath !== path.resolve(appDir, mainRel)) {
    log(`[electron] main '${mainRel}' not built; using source entry ${mainPath}\n`);
  }

  // Type II: `electron <dir>` is a real npm project — install its declared
  // dependencies before launch when node_modules isn't already populated, so
  // apps built from source (with real npm deps) run without a manual `npm i`.
  await installAppDependencies(appDir, vfs, log);

  const rendererRoot = detectRendererRoot(vfs, appDir);
  const preloadPath = firstExisting(vfs, appDir, PRELOAD_CANDIDATES);

  // The module loader (and preload transform) strip TypeScript via esbuild.
  // Initializing esbuild lazily *during* the main's module load can stall in
  // this runtime, so warm it on the main thread up front when the main or
  // preload is TS — populating `window.__esbuild` so the later transpile is
  // immediate. Best-effort: a warm-up failure falls through to the old path.
  const mainIsTs = /\.(ts|tsx|mts|cts)$/.test(mainPath);
  const preloadIsTs = !!preloadPath && /\.(ts|tsx|mts|cts)$/.test(preloadPath);
  if (mainIsTs || preloadIsTs) {
    try {
      const { initTransformer } = await import('../transform');
      await initTransformer();
    } catch (error) {
      log(
        `[electron] esbuild warm-up failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }

  let preloadSource = '';
  if (preloadPath) {
    preloadSource = await bundlePreload(
      vfs.readFileSync(preloadPath, 'utf8') as string,
      preloadPath,
      vfs,
      log,
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
  // Absolute VFS path the renderer server is rooted at — lets the shim map a
  // packaged `loadFile(<root>/index.html)` onto the served virtual origin.
  env.__ALMOST_ELECTRON_RENDERER_ROOT = rendererRoot;

  // Observe the shim's quit event (in-app `app.quit()` / `app.exit()`) so the
  // `electron` command can end its session instead of leaving a zombie.
  const electronShim = runtime.getBuiltin('electron') as {
    app?: { on?: (event: string, listener: (...args: unknown[]) => void) => unknown };
  } | null;
  const whenQuit = new Promise<number>((resolve) => {
    electronShim?.app?.on?.('quit', (...args: unknown[]) => {
      resolve(typeof args[1] === 'number' ? args[1] : 0);
    });
  });

  log(`[electron] main: ${mainPath}\n`);
  await runtime.runFile(mainPath);

  return {
    rendererPort: port,
    rendererUrl,
    mainPath,
    whenQuit,
    close: () => {
      try {
        (server as unknown as { stop?: () => void }).stop?.();
      } finally {
        bridge.unregisterServer(port);
      }
    },
  };
}
