/**
 * ViteDevServer - Vite-compatible dev server for browser environment
 * Serves files from VirtualFS with JSX/TypeScript transformation
 */

import { DevServer, DevServerOptions, ResponseData, HMRUpdate } from '../dev-server';
import { VirtualFS } from '../virtual-fs';
import { Buffer } from '../shims/stream';
import { simpleHash } from '../utils/hash';
import { addReactRefresh as _addReactRefresh, redirectNpmImports as _redirectNpmImports } from './code-transforms';
import { clearNpmBundleCache, bundleNpmModuleForBrowser } from './npm-serve';
import {
  ESBUILD_WASM_ESM_CDN,
  ESBUILD_WASM_BINARY_CDN,
  REACT_REFRESH_CDN,
  REACT_CDN,
  REACT_DOM_CDN,
  TAILWIND_CDN_URL,
} from '../config/cdn';
import { loadTailwindConfig } from './tailwind-config-loader';
import { generateAndWriteRouteTree } from './tanstack-route-tree';
import { almostnodeDebugLog, almostnodeDebugWarn, almostnodeDebugError } from '../utils/debug';

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<Record<string, unknown>>;

// Check if we're in a real browser environment (not jsdom or Node.js)
// jsdom has window but doesn't have ServiceWorker or SharedArrayBuffer
const isBrowser = typeof window !== 'undefined' &&
  typeof window.navigator !== 'undefined' &&
  'serviceWorker' in window.navigator;

// Window.__esbuild type is declared in src/types/external.d.ts

/**
 * Initialize esbuild-wasm for browser transforms
 * Uses window-level singleton to prevent "Cannot call initialize more than once" errors
 */
async function initEsbuild(): Promise<void> {
  if (!isBrowser) return;

  // Check if already initialized (survives HMR)
  if (window.__esbuild) {
    return;
  }

  // Check if initialization is in progress
  if (window.__esbuildInitPromise) {
    return window.__esbuildInitPromise;
  }

  // Permanent bail-out after a previous init failure to prevent retry storms
  if ((window as any).__esbuildInitFailed) {
    throw new Error('esbuild initialization previously failed permanently');
  }

  window.__esbuildInitPromise = (async () => {
    try {
      const mod = await dynamicImport(ESBUILD_WASM_ESM_CDN);

      const esbuildMod = mod.default || mod;

      try {
        await esbuildMod.initialize({
          wasmURL: ESBUILD_WASM_BINARY_CDN,
        });
        almostnodeDebugLog('vite', '[ViteDevServer] esbuild-wasm initialized');
      } catch (initError) {
        // If esbuild is already initialized (e.g., from a previous HMR cycle),
        // the WASM is still loaded and the module is usable
        if (initError instanceof Error && initError.message.includes('Cannot call "initialize" more than once')) {
          almostnodeDebugLog('vite', '[ViteDevServer] esbuild-wasm already initialized, reusing');
        } else {
          throw initError;
        }
      }

      window.__esbuild = esbuildMod;
    } catch (error) {
      almostnodeDebugError('vite', '[ViteDevServer] Failed to initialize esbuild:', error);
      (window as any).__esbuildInitFailed = true;
      window.__esbuildInitPromise = undefined;
      throw error;
    }
  })();

  return window.__esbuildInitPromise;
}

/**
 * Get the esbuild instance (after initialization)
 */
function getEsbuild(): typeof import('esbuild-wasm') | undefined {
  return isBrowser ? window.__esbuild : undefined;
}

export interface ViteDevServerOptions extends DevServerOptions {
  /**
   * Enable JSX transformation (default: true)
   */
  jsx?: boolean;

  /**
   * JSX factory function (default: 'React.createElement')
   */
  jsxFactory?: string;

  /**
   * JSX fragment function (default: 'React.Fragment')
   */
  jsxFragment?: string;

  /**
   * Auto-inject React import for JSX files (default: true)
   */
  jsxAutoImport?: boolean;

  /**
   * Enable SPA fallback - serve index.html for 404s on extensionless paths (default: false)
   */
  spaFallback?: boolean;

  /**
   * Path aliases for import resolution (e.g. { '~/': 'src/', '@/': 'src/' })
   */
  aliases?: Record<string, string>;

  /**
   * Enable TanStack Router route tree auto-generation (default: false)
   */
  tanstackRouter?: boolean;
}

/**
 * React Refresh preamble - MUST run before React is loaded
 * This script is blocking to ensure injectIntoGlobalHook runs first
 */
const REACT_REFRESH_PREAMBLE = `
<script type="module">
// Block until React Refresh is loaded and initialized
// This MUST happen before React is imported
const RefreshRuntime = await import('${REACT_REFRESH_CDN}').then(m => m.default || m);

// Hook into React BEFORE it's loaded
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshRuntime$ = RefreshRuntime;

// Track registrations for debugging
window.$RefreshRegCount$ = 0;

// Register function called by transformed modules
window.$RefreshReg$ = (type, id) => {
  window.$RefreshRegCount$++;
  RefreshRuntime.register(type, id);
};

// Signature function (simplified - always returns identity)
window.$RefreshSig$ = () => (type) => type;

console.log('[HMR] React Refresh initialized');
</script>
`;

/**
 * HMR client script injected into index.html
 * Implements the import.meta.hot API and handles HMR updates
 */
const HMR_CLIENT_SCRIPT = `
<script type="module">
(function() {
  // Track hot modules and their callbacks
  const hotModules = new Map();
  const pendingUpdates = new Map();

  // Implement import.meta.hot API (Vite-compatible)
  window.__vite_hot_context__ = function createHotContext(ownerPath) {
    // Return existing context if already created
    if (hotModules.has(ownerPath)) {
      return hotModules.get(ownerPath);
    }

    const hot = {
      // Persisted data between updates
      data: {},

      // Accept self-updates
      accept(callback) {
        hot._acceptCallback = callback;
      },

      // Cleanup before update
      dispose(callback) {
        hot._disposeCallback = callback;
      },

      // Force full reload
      invalidate() {
        location.reload();
      },

      // Prune callback (called when module is no longer imported)
      prune(callback) {
        hot._pruneCallback = callback;
      },

      // Event handlers (not implemented)
      on(event, cb) {},
      off(event, cb) {},
      send(event, data) {},

      // Internal callbacks
      _acceptCallback: null,
      _disposeCallback: null,
      _pruneCallback: null,
    };

    hotModules.set(ownerPath, hot);
    return hot;
  };

  // Listen for HMR updates via postMessage (works with sandboxed iframes)
  window.addEventListener('message', async (event) => {
    // Filter for HMR messages only
    if (!event.data || event.data.channel !== 'vite-hmr') return;
    const { type, path, timestamp } = event.data;

    if (type === 'update') {
      console.log('[HMR] Update:', path);

      if (path.endsWith('.css')) {
        // CSS hot reload - update stylesheet href
        const links = document.querySelectorAll('link[rel="stylesheet"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && href.includes(path.replace(/^\\//, ''))) {
            link.href = href.split('?')[0] + '?t=' + timestamp;
          }
        });

        // Also update any injected style tags
        const styles = document.querySelectorAll('style[data-vite-dev-id]');
        styles.forEach(style => {
          const id = style.getAttribute('data-vite-dev-id');
          if (id && id.includes(path.replace(/^\\//, ''))) {
            // Re-import the CSS module to get updated styles
            import(path + '?t=' + timestamp).catch(() => {});
          }
        });
      } else if (path.match(/\\.(jsx?|tsx?)$/)) {
        // JS/JSX hot reload with React Refresh
        await handleJSUpdate(path, timestamp);
      }
    } else if (type === 'full-reload') {
      console.log('[HMR] Full reload');
      location.reload();
    }
  });

  // Handle JS/JSX module updates
  async function handleJSUpdate(path, timestamp) {
    // Normalize path to match module keys
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const hot = hotModules.get(normalizedPath);

    try {
      // Call dispose callback if registered
      if (hot && hot._disposeCallback) {
        hot._disposeCallback(hot.data);
      }

      // Enqueue React Refresh (batches multiple updates)
      if (window.$RefreshRuntime$) {
        pendingUpdates.set(normalizedPath, timestamp);

        // Schedule refresh after a short delay to batch updates
        if (pendingUpdates.size === 1) {
          setTimeout(async () => {
            try {
              // Re-import all pending modules
              for (const [modulePath, ts] of pendingUpdates) {
                const moduleUrl = '.' + modulePath + '?t=' + ts;
                await import(moduleUrl);
              }

              // Perform React Refresh
              window.$RefreshRuntime$.performReactRefresh();
              console.log('[HMR] Updated', pendingUpdates.size, 'module(s)');

              pendingUpdates.clear();
            } catch (error) {
              console.error('[HMR] Failed to apply update:', error);
              pendingUpdates.clear();
              location.reload();
            }
          }, 30);
        }
      } else {
        // No React Refresh available, fall back to page reload
        console.log('[HMR] React Refresh not available, reloading page');
        location.reload();
      }
    } catch (error) {
      console.error('[HMR] Update failed:', error);
      location.reload();
    }
  }

  console.log('[HMR] Client ready with React Refresh support');
})();
</script>
`;

/**
 * Replay recording capture script — @@replay-nut protocol handler.
 * Produces simulationData packets matching Replay's expected format
 * (see vendor/builder-assets/appTemplate/src/messages/simulationData.ts).
 * Loads rrweb for DOM snapshots, captures interactions, network, and errors.
 */
const REPLAY_CAPTURE_SCRIPT = `
<script>
(function() {
  var simulationData = [];
  var startTime = Date.now();
  var nextRequestIndex = 0;

  function ts() { return new Date().toISOString(); }
  function relMs() { return Date.now() - startTime; }

  // ── Initial packets (matching simulationState.ts:initSimulationState) ──
  simulationData.push({ kind: 'version', version: '0.2.0', time: ts() });
  simulationData.push({ kind: 'viewport', size: { width: window.innerWidth, height: window.innerHeight }, time: ts() });
  simulationData.push({ kind: 'locationHref', href: location.href, time: ts() });
  simulationData.push({ kind: 'documentURL', url: location.href, time: ts() });
  simulationData.push({ kind: 'colorScheme', scheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', time: ts() });

  // ── rrweb DOM recording (loaded from CDN) ──
  import('https://esm.sh/rrweb@2.0.0-alpha.4').then(function(mod) {
    var record = mod.record || (mod.default && mod.default.record);
    if (!record) { console.warn('[Replay] rrweb record() not found in module'); return; }
    record({
      emit: function(event) {
        simulationData.push({ kind: 'rrweb', event: event, time: ts() });
      },
      checkoutEveryNms: 10000,
    });
    console.log('[Replay] rrweb recording started');
  }).catch(function(err) {
    console.warn('[Replay] Failed to load rrweb:', err.message || err);
  });

  // ── Selector builder ──
  function buildSelector(el) {
    if (!el || !el.tagName) return '';
    var parts = [];
    var cur = el;
    for (var i = 0; i < 5 && cur && cur.tagName; i++) {
      var s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(s + '#' + cur.id); break; }
      if (cur.className && typeof cur.className === 'string') {
        s += '.' + cur.className.trim().split(/\\s+/).join('.');
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ── Interaction capture (matching eventListeners.ts format) ──
  document.addEventListener('click', function(e) {
    var target = e.target;
    var rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
    simulationData.push({
      kind: 'interaction',
      interaction: {
        kind: 'click',
        time: relMs(),
        selector: buildSelector(target),
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0,
        x: rect ? e.clientX - rect.x : e.clientX,
        y: rect ? e.clientY - rect.y : e.clientY,
      },
      time: ts(),
    });
  }, { capture: true, passive: true });

  document.addEventListener('keydown', function(e) {
    simulationData.push({
      kind: 'interaction',
      interaction: { kind: 'keydown', time: relMs(), key: e.key, selector: buildSelector(e.target) },
      time: ts(),
    });
  }, { capture: true, passive: true });

  document.addEventListener('scroll', function() {
    simulationData.push({
      kind: 'interaction',
      interaction: {
        kind: 'scroll',
        time: relMs(),
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
      },
      time: ts(),
    });
  }, { capture: true, passive: true });

  document.addEventListener('input', function(e) {
    var target = e.target;
    simulationData.push({
      kind: 'interaction',
      interaction: {
        kind: 'input',
        time: relMs(),
        selector: buildSelector(target),
        value: target && target.value ? target.value.slice(0, 200) : '',
      },
      time: ts(),
    });
  }, { capture: true, passive: true });

  // ── Network capture (matching networkCapture.ts format) ──
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    var idx = nextRequestIndex++;
    var reqTime = ts();

    simulationData.push({
      kind: 'networkRequest',
      request: { requestIndex: idx, url: url, time: reqTime },
      time: reqTime,
    });

    return origFetch.apply(this, arguments).then(function(response) {
      simulationData.push({
        kind: 'networkResponse',
        response: { requestIndex: idx, responseStatus: response.status },
        time: ts(),
      });
      return response;
    }).catch(function(err) {
      simulationData.push({
        kind: 'networkResponse',
        response: { requestIndex: idx, error: err.message || String(err) },
        time: ts(),
      });
      throw err;
    });
  };

  // ── Error capture (matching detectedError.ts format) ──
  window.addEventListener('error', function(e) {
    simulationData.push({
      kind: 'detectedError',
      detectedError: {
        time: ts(),
        message: e.message || String(e),
        details: (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0),
      },
      time: ts(),
    });
  });

  window.addEventListener('unhandledrejection', function(e) {
    simulationData.push({
      kind: 'detectedError',
      detectedError: {
        time: ts(),
        message: e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled rejection',
      },
      time: ts(),
    });
  });

  // ── @@replay-nut message handler (matching messageHandler.ts) ──
  window.addEventListener('message', function(event) {
    if (!event.data || event.data.source !== '@@replay-nut' || !event.data.request) return;

    var request = event.data.request;
    if (request.request === 'recording-data') {
      var json = JSON.stringify(simulationData);
      var buffer = new TextEncoder().encode(json).buffer;
      window.parent.postMessage(
        { id: event.data.id, response: buffer, source: '@@replay-nut' },
        '*',
        [buffer]
      );
    }
  });

  console.log('[Replay] Recording capture initialized (' + simulationData.length + ' initial packets)');
})();
</script>
`;

export class ViteDevServer extends DevServer {
  private watcherCleanup: (() => void) | null = null;
  private options: ViteDevServerOptions;
  private hmrTargetWindow: Window | null = null;
  private transformCache: Map<string, { code: string; hash: string }> = new Map();
  private pendingInstalledPackagesCacheClear: ReturnType<typeof setTimeout> | null = null;
  private pendingRouteTreeRegen: ReturnType<typeof setTimeout> | null = null;
  private tailwindConfigScript: string = '';
  private tailwindConfigLoaded: boolean = false;
  private _dependencies: Record<string, string> | undefined;
  private _installedPackages: Set<string> | undefined;

  constructor(vfs: VirtualFS, options: ViteDevServerOptions) {
    super(vfs, options);
    this.options = {
      jsx: true,
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      jsxAutoImport: true,
      ...options,
    };
  }

  /**
   * Set the target window for HMR updates (typically iframe.contentWindow)
   * This enables HMR to work with sandboxed iframes via postMessage
   */
  setHMRTarget(targetWindow: Window): void {
    this.hmrTargetWindow = targetWindow;
  }

  clearInstalledPackagesCache(): void {
    this.transformCache.clear();
    this._installedPackages = undefined;
    this._dependencies = undefined;
    clearNpmBundleCache();
  }

  private scheduleInstalledPackagesCacheClear(): void {
    if (this.pendingInstalledPackagesCacheClear) {
      clearTimeout(this.pendingInstalledPackagesCacheClear);
    }

    this.pendingInstalledPackagesCacheClear = setTimeout(() => {
      this.pendingInstalledPackagesCacheClear = null;
      this.clearInstalledPackagesCache();
    }, 48);
  }

  /**
   * Handle an incoming HTTP request
   */
  async handleRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Buffer
  ): Promise<ResponseData> {
    // Parse URL
    const urlObj = new URL(url, 'http://localhost');
    let pathname = urlObj.pathname;

    // Serve bundled npm modules from VFS node_modules
    if (pathname.startsWith('/_npm/')) {
      return this.serveNpmModule(pathname);
    }

    // Handle ?url query parameter - return file path as URL string export
    if (urlObj.searchParams.has('url')) {
      const resolvedPath = this.resolveModulePath(pathname);
      if (this.exists(resolvedPath)) {
        const js = `export default ${JSON.stringify(pathname)};`;
        return {
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
          body: Buffer.from(js),
        };
      }
    }

    // Handle ?raw query parameter - return raw file content as string export
    if (urlObj.searchParams.has('raw')) {
      const resolvedPath = this.resolveModulePath(pathname);
      if (this.exists(resolvedPath)) {
        try {
          const content = this.vfs.readFileSync(resolvedPath, 'utf8');
          const js = `export default ${JSON.stringify(content)};`;
          return {
            statusCode: 200,
            statusMessage: 'OK',
            headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
            body: Buffer.from(js),
          };
        } catch {
          // Fall through to normal handling
        }
      }
    }

    // Handle root path - serve index.html
    if (pathname === '/') {
      pathname = '/index.html';
    }

    // Resolve the full path
    const filePath = this.resolveModulePath(pathname);

    // If the resolved path is a directory index file (e.g. foo/index.ts) but the
    // request URL doesn't end with '/', the browser will resolve relative imports
    // from the wrong base path.  Redirect to pathname + '/' so that './bar'
    // inside the index module resolves to foo/bar instead of ../bar.
    // Use a relative redirect (just the basename + /) so the /__virtual__/PORT/
    // prefix is preserved by the browser.
    if (!pathname.endsWith('/') && filePath !== this.resolvePath(pathname)) {
      const basePath = this.resolvePath(pathname);
      if (this.isDirectory(basePath) && filePath.startsWith(basePath + '/index.')) {
        const lastSegment = pathname.split('/').pop() || '';
        return {
          statusCode: 301,
          statusMessage: 'Moved Permanently',
          headers: { Location: lastSegment + '/' },
          body: Buffer.from(''),
        };
      }
    }

    // Check if file exists
    if (!this.exists(filePath)) {
      // Try with .html extension
      if (this.exists(filePath + '.html')) {
        return this.serveFile(filePath + '.html');
      }
      // Try index.html in directory
      if (this.isDirectory(filePath) && this.exists(filePath + '/index.html')) {
        return this.serveFile(filePath + '/index.html');
      }
      // SPA fallback: serve index.html for extensionless paths (client-side routing)
      if (this.options.spaFallback && !pathname.includes('.')) {
        return this.handleRequest(method, '/', headers, body);
      }
      return this.notFound(pathname);
    }

    // If it's a directory, redirect to index.html
    if (this.isDirectory(filePath)) {
      if (this.exists(filePath + '/index.html')) {
        return this.serveFile(filePath + '/index.html');
      }
      return this.notFound(pathname);
    }

    // Check if file needs transformation (JSX/TS)
    if (this.needsTransform(filePath)) {
      return this.transformAndServe(filePath, pathname);
    }

    // Check if CSS is being imported as a module (needs to be converted to JS)
    // In browser context with ES modules, CSS imports need to be served as JS
    if (pathname.endsWith('.css')) {
      // Check various header formats for sec-fetch-dest
      const secFetchDest =
        headers['sec-fetch-dest'] ||
        headers['Sec-Fetch-Dest'] ||
        headers['SEC-FETCH-DEST'] ||
        '';

      // In browser, serve CSS as module when:
      // 1. Requested as a script (sec-fetch-dest: script)
      // 2. Empty dest (sec-fetch-dest: empty) - fetch() calls
      // 3. No sec-fetch-dest but in browser context - assume module import
      const isModuleImport =
        secFetchDest === 'script' ||
        secFetchDest === 'empty' ||
        (isBrowser && secFetchDest === '');

      if (isModuleImport) {
        return this.serveCssAsModule(filePath);
      }
      // Otherwise serve as regular CSS (e.g., <link> tags with sec-fetch-dest: style)
      return this.serveFile(filePath);
    }

    // Check if it's HTML that needs HMR client injection
    if (pathname.endsWith('.html')) {
      return this.serveHtmlWithHMR(filePath);
    }

    // Serve JSON as ES module when imported from JS (like real Vite does)
    if (pathname.endsWith('.json')) {
      const secFetchDest =
        headers['sec-fetch-dest'] ||
        headers['Sec-Fetch-Dest'] ||
        headers['SEC-FETCH-DEST'] ||
        '';
      const isModuleImport =
        secFetchDest === 'script' ||
        secFetchDest === 'empty' ||
        (isBrowser && secFetchDest === '');
      if (isModuleImport) {
        try {
          const content = this.vfs.readFileSync(filePath, 'utf8');
          const js = `export default ${content};`;
          const buf = Buffer.from(js);
          return {
            statusCode: 200,
            statusMessage: 'OK',
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Content-Length': String(buf.length),
              'Cache-Control': 'no-cache',
            },
            body: buf,
          };
        } catch {
          // Fall through to serveFile
        }
      }
    }

    // Serve static file
    return this.serveFile(filePath);
  }

  /**
   * Start file watching for HMR
   */
  startWatching(): void {
    // Watch /src directory for changes
    const srcPath = this.root === '/' ? '/src' : `${this.root}/src`;

    try {
      const watcher = this.vfs.watch(srcPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = filename.startsWith('/') ? filename : `${srcPath}/${filename}`;
        if (eventType === 'change') {
          this.handleFileChange(fullPath);
        } else if (eventType === 'rename' && this.vfs.existsSync(fullPath)) {
          // 'rename' with existing file = creation (e.g. atomic write via rename, new file)
          this.handleFileChange(fullPath);
        }

        // Regenerate route tree when files under src/routes/ change
        if (this.options.tanstackRouter) {
          const routesPrefix = srcPath + '/routes';
          const checkPath = filename.startsWith('/') ? filename : `${srcPath}/${filename}`;
          if (checkPath.startsWith(routesPrefix) && /\.(tsx?|jsx?)$/.test(checkPath)) {
            this.scheduleRouteTreeRegen();
          }
        }
      });

      this.watcherCleanup = () => {
        watcher.close();
      };
    } catch (error) {
      almostnodeDebugWarn('vite', '[ViteDevServer] Could not watch /src directory:', error);
    }

    // Also watch for CSS files in root
    try {
      const rootWatcher = this.vfs.watch(this.root, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        const watchedPath = this.root === '/' ? `/${filename}` : `${this.root}/${filename}`;
        const isWatchedRootFile = filename.endsWith('.css')
          || /^tailwind\.config\.(ts|js|mjs)$/.test(filename)
          || filename === 'components.json';
        if (isWatchedRootFile && (eventType === 'change' || (eventType === 'rename' && this.vfs.existsSync(watchedPath)))) {
          this.handleFileChange(watchedPath);
        }
        if (filename === 'package.json' || filename === 'node_modules') {
          this.scheduleInstalledPackagesCacheClear();
        }
      });

      const originalCleanup = this.watcherCleanup;
      this.watcherCleanup = () => {
        originalCleanup?.();
        rootWatcher.close();
      };
    } catch {
      // Ignore if root watching fails
    }

    try {
      const nodeModulesPath = this.root === '/' ? '/node_modules' : `${this.root}/node_modules`;
      const nodeModulesWatcher = this.vfs.watch(nodeModulesPath, { recursive: true }, () => {
        this.scheduleInstalledPackagesCacheClear();
      });

      const originalCleanup = this.watcherCleanup;
      this.watcherCleanup = () => {
        originalCleanup?.();
        nodeModulesWatcher.close();
      };
    } catch {
      // Ignore if node_modules doesn't exist yet.
    }
  }

  /**
   * Handle file change event
   */
  private handleFileChange(path: string): void {
    if (/\/tailwind\.config\.(ts|js|mjs)$/.test(path)) {
      this.tailwindConfigLoaded = false;
      this.tailwindConfigScript = '';
    }

    // Determine update type:
    // - CSS and JS/JSX/TSX files: 'update' (handled by HMR client)
    // - Other files: 'full-reload'
    const isCSS = path.endsWith('.css');
    const isJS = /\.(jsx?|tsx?)$/.test(path);
    const updateType = (isCSS || isJS) ? 'update' : 'full-reload';

    // Strip the project root prefix so the path is relative to the server root
    // (e.g. /project/src/App.tsx → /src/App.tsx) matching how the browser loads modules
    const hmrPath = this.root !== '/' && path.startsWith(this.root + '/')
      ? path.slice(this.root.length)
      : path;

    const update: HMRUpdate = {
      type: updateType,
      path: hmrPath,
      timestamp: Date.now(),
    };

    // Emit event for ServerBridge
    this.emitHMRUpdate(update);

    // Send HMR update via postMessage (works with sandboxed iframes)
    if (this.hmrTargetWindow) {
      try {
        this.hmrTargetWindow.postMessage({ ...update, channel: 'vite-hmr' }, '*');
      } catch (e) {
        // Window may be closed or unavailable
      }
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.watcherCleanup) {
      this.watcherCleanup();
      this.watcherCleanup = null;
    }
    if (this.pendingInstalledPackagesCacheClear) {
      clearTimeout(this.pendingInstalledPackagesCacheClear);
      this.pendingInstalledPackagesCacheClear = null;
    }
    if (this.pendingRouteTreeRegen) {
      clearTimeout(this.pendingRouteTreeRegen);
      this.pendingRouteTreeRegen = null;
    }

    this.hmrTargetWindow = null;

    super.stop();
  }

  /**
   * Check if a file needs transformation
   */
  private needsTransform(path: string): boolean {
    return /\.(jsx|tsx|ts)$/.test(path);
  }

  private resolveModulePath(urlPath: string): string {
    const filePath = this.resolvePath(urlPath);
    if (this.exists(filePath) && !this.isDirectory(filePath)) {
      return filePath;
    }

    const extensionCandidates = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json'];
    for (const extension of extensionCandidates) {
      if (this.exists(filePath + extension)) {
        return filePath + extension;
      }
    }

    const indexCandidates = extensionCandidates.map((extension) => `${filePath}/index${extension}`);
    for (const candidate of indexCandidates) {
      if (this.exists(candidate)) {
        return candidate;
      }
    }

    return filePath;
  }

  /**
   * Transform and serve a JSX/TS file
   */
  private async transformAndServe(filePath: string, urlPath: string): Promise<ResponseData> {
    try {
      const content = this.vfs.readFileSync(filePath, 'utf8');
      const hash = simpleHash(content);

      // Check transform cache
      const cached = this.transformCache.get(filePath);
      if (cached && cached.hash === hash) {
        const buffer = Buffer.from(cached.code);
        return {
          statusCode: 200,
          statusMessage: 'OK',
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': String(buffer.length),
            'Cache-Control': 'no-cache',
            'X-Transformed': 'true',
            'X-Cache': 'hit',
          },
          body: buffer,
        };
      }

      const transformed = await this.transformCode(content, filePath);

      // Cache the transform result
      this.transformCache.set(filePath, { code: transformed, hash });

      const buffer = Buffer.from(transformed);
      return {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'no-cache',
          'X-Transformed': 'true',
        },
        body: buffer,
      };
    } catch (error) {
      almostnodeDebugError('vite', '[ViteDevServer] Transform error:', error);
      const message = error instanceof Error ? error.message : 'Transform failed';
      const body = `// Transform Error: ${message}\nconsole.error(${JSON.stringify(message)});`;
      return {
        statusCode: 200, // Return 200 with error in code to show in browser console
        statusMessage: 'OK',
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'X-Transform-Error': 'true',
        },
        body: Buffer.from(body),
      };
    }
  }

  /**
   * Transform JSX/TS code to browser-compatible JavaScript
   */
  private async transformCode(code: string, filename: string): Promise<string> {
    if (!isBrowser) {
      // In test environment, just return code as-is
      return code;
    }

    // Initialize esbuild if needed
    await initEsbuild();

    const esbuild = getEsbuild();
    if (!esbuild) {
      throw new Error('esbuild not available');
    }

    // Determine loader based on extension
    let loader: 'js' | 'jsx' | 'ts' | 'tsx' = 'js';
    if (filename.endsWith('.jsx')) loader = 'jsx';
    else if (filename.endsWith('.tsx')) loader = 'tsx';
    else if (filename.endsWith('.ts')) loader = 'ts';

    const result = await esbuild.transform(code, {
      loader,
      format: 'esm', // Keep as ES modules for browser
      target: 'esnext',
      jsx: 'automatic', // Use React 17+ automatic runtime
      jsxDev: loader === 'jsx' || loader === 'tsx',
      jsxImportSource: 'react',
      sourcemap: 'inline',
      sourcefile: filename,
    });

    let transformed = result.code;

    // Redirect bare npm imports to /_npm/ or esm.sh CDN
    transformed = this.redirectNpmImports(transformed);

    // Rewrite path aliases in import specifiers
    if (this.options.aliases && Object.keys(this.options.aliases).length > 0) {
      transformed = this.rewriteAliases(transformed, filename);
    }

    // Add React Refresh registration for JSX/TSX files
    if (/\.(jsx|tsx)$/.test(filename)) {
      return this.addReactRefresh(transformed, filename);
    }

    return transformed;
  }

  private addReactRefresh(code: string, filename: string): string {
    return _addReactRefresh(code, filename);
  }

  /**
   * Rewrite path alias prefixes in import/export specifiers to relative paths
   */
  private rewriteAliases(code: string, filename: string): string {
    const aliases = this.options.aliases;
    if (!aliases) return code;

    // Match import/export from "specifier" or import("specifier")
    return code.replace(
      /((?:import|export)\s+.*?\s+from\s+['"])([^'"]+)(['"])|(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
      (match, pre1, spec1, post1, pre2, spec2, post2) => {
        const specifier = spec1 || spec2;
        const pre = pre1 || pre2;
        const post = post1 || post2;

        for (const [alias, target] of Object.entries(aliases)) {
          if (specifier.startsWith(alias)) {
            // Replace alias with target path, then compute relative from current file
            let resolved = specifier.replace(alias, target);
            const fromDir = filename.replace(/\/[^/]+$/, '');
            // Strip root prefix from fromDir for relative computation
            const rootPrefix = this.root === '/' ? '' : this.root;
            const fromDirRel = rootPrefix && fromDir.startsWith(rootPrefix)
              ? fromDir.slice(rootPrefix.length)
              : fromDir;

            // If the resolved path points to a directory with an index file,
            // append the index filename so the browser URL has the correct
            // directory context for resolving relative imports within that module.
            const resolvedFsPath = this.root + '/' + resolved;
            const indexExts = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];
            for (const ext of indexExts) {
              if (this.exists(resolvedFsPath + '/index' + ext)) {
                resolved = resolved + '/index' + ext;
                break;
              }
            }

            const targetFull = '/' + resolved;

            // Compute relative path
            const fromParts = fromDirRel.split('/').filter(Boolean);
            const toParts = targetFull.split('/').filter(Boolean);

            // Find common prefix
            let common = 0;
            while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
              common++;
            }

            const ups = fromParts.length - common;
            const remainder = toParts.slice(common);
            let rel = ups > 0
              ? '../'.repeat(ups) + remainder.join('/')
              : './' + remainder.join('/');

            return pre + rel + post;
          }
        }
        return match;
      }
    );
  }

  /**
   * Schedule route tree regeneration (debounced)
   */
  private scheduleRouteTreeRegen(): void {
    if (!this.options.tanstackRouter) return;

    if (this.pendingRouteTreeRegen) {
      clearTimeout(this.pendingRouteTreeRegen);
    }

    this.pendingRouteTreeRegen = setTimeout(() => {
      this.pendingRouteTreeRegen = null;
      try {
        const changed = generateAndWriteRouteTree(this.vfs, this.root);
        if (changed) {
          almostnodeDebugLog('vite', '[ViteDevServer] Regenerated routeTree.gen.ts');
        }
      } catch (error) {
        almostnodeDebugWarn('vite', '[ViteDevServer] Failed to regenerate route tree:', error);
      }
    }, 100);
  }

  private getDependencies(): Record<string, string> {
    if (this._dependencies) return this._dependencies;
    let deps: Record<string, string> = {};
    try {
      const pkgPath = `${this.root}/package.json`;
      if (this.vfs.existsSync(pkgPath)) {
        const pkg = JSON.parse(this.vfs.readFileSync(pkgPath, 'utf-8'));
        deps = { ...pkg.dependencies, ...pkg.devDependencies };
      }
    } catch { /* ignore parse errors */ }
    this._dependencies = deps;
    return deps;
  }

  private getInstalledPackages(): Set<string> {
    if (this._installedPackages) return this._installedPackages;
    const pkgs = new Set<string>();
    const nmDir = this.root === '/' ? '/node_modules' : `${this.root}/node_modules`;
    try {
      if (!this.vfs.existsSync(nmDir)) {
        this._installedPackages = pkgs;
        return pkgs;
      }
      const entries = this.vfs.readdirSync(nmDir) as string[];
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
          const scopeDir = nmDir + '/' + entry;
          try {
            const scopeEntries = this.vfs.readdirSync(scopeDir) as string[];
            for (const sub of scopeEntries) {
              pkgs.add(entry + '/' + sub);
            }
          } catch { /* ignore */ }
        } else {
          pkgs.add(entry);
        }
      }
    } catch { /* ignore */ }
    this._installedPackages = pkgs;
    return pkgs;
  }

  /**
   * Packages handled by the import map injected into index.html.
   * These must NOT be rewritten by redirectNpmImports — the import map
   * already maps the bare specifiers to the correct CDN URLs.
   */
  private static IMPORT_MAP_PACKAGES = [
    'react', 'react-dom',
  ];

  private redirectNpmImports(code: string): string {
    return _redirectNpmImports(code, ViteDevServer.IMPORT_MAP_PACKAGES, this.getDependencies(), undefined, this.getInstalledPackages());
  }

  private async serveNpmModule(pathname: string): Promise<ResponseData> {
    const specifier = pathname.slice('/_npm/'.length);
    if (!specifier) {
      return this.notFound(pathname);
    }

    try {
      let code = await bundleNpmModuleForBrowser(specifier, [this.root, '/']);
      // Rewrite any bare specifiers that esbuild left external (e.g., unresolved
      // transitive deps converted to ESM imports by patchExternalRequires)
      code = this.redirectNpmImports(code);
      return {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: Buffer.from(code),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      almostnodeDebugError('vite', `[ViteDevServer] Failed to bundle npm module '${specifier}':`, msg);
      // Return a valid JS module so browsers don't reject it due to MIME type
      const errorJs = `console.error(${JSON.stringify(`[almostnode] Failed to bundle '${specifier}': ${msg}`)});\nthrow new Error(${JSON.stringify(`Failed to bundle '${specifier}': ${msg}`)});\nexport default undefined;\n`;
      return {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
        body: Buffer.from(errorJs),
      };
    }
  }

  /**
   * Serve CSS file as a JavaScript module that injects styles
   * This is needed because ES module imports of CSS files need to return JS
   */
  private serveCssAsModule(filePath: string): ResponseData {
    try {
      const css = this.vfs.readFileSync(filePath, 'utf8');

      // Create JavaScript that injects the CSS into the document
      const js = `
// CSS Module: ${filePath}
const css = ${JSON.stringify(css)};
const style = document.createElement('style');
style.setAttribute('data-vite-dev-id', ${JSON.stringify(filePath)});
style.textContent = css;
document.head.appendChild(style);
export default css;
`;

      const buffer = Buffer.from(js);
      return {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'no-cache',
        },
        body: buffer,
      };
    } catch (error) {
      return this.serverError(error);
    }
  }

  /**
   * Serve HTML file with HMR client script injected
   *
   * IMPORTANT: React Refresh preamble MUST be injected before any module scripts.
   * The preamble uses top-level await to block until React Refresh is loaded
   * and injectIntoGlobalHook is called. This ensures React Refresh hooks into
   * React BEFORE React is imported by any module.
   */
  private async serveHtmlWithHMR(filePath: string): Promise<ResponseData> {
    try {
      let content = this.vfs.readFileSync(filePath, 'utf8');
      const tailwindInjection = await this.getTailwindInjection(content);

      // Inject a React import map if the HTML doesn't already have one.
      // This lets seed HTML omit the esm.sh boilerplate — the platform provides it.
      if (!content.includes('"importmap"')) {
        const importMap = `<script type="importmap">
{
  "imports": {
    "react": "${REACT_CDN}?dev",
    "react/": "${REACT_CDN}&dev/",
    "react-dom": "${REACT_DOM_CDN}?dev",
    "react-dom/": "${REACT_DOM_CDN}&dev/"
  }
}
</script>`;
        if (content.includes('</head>')) {
          content = content.replace('</head>', `${importMap}\n</head>`);
        } else if (content.includes('<head>')) {
          content = content.replace('<head>', `<head>\n${importMap}`);
        }
      }

      // Inject React Refresh preamble before any app module scripts.
      // Firefox requires all <script type="importmap"> to appear before any <script type="module">,
      // so if the HTML contains an import map, inject AFTER the last one (not right after <head>).
      const importMapRegex = /<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>[\s\S]*?<\/script>/gi;
      let lastImportMapEnd = -1;
      let match;
      while ((match = importMapRegex.exec(content)) !== null) {
        lastImportMapEnd = match.index + match[0].length;
      }

      if (tailwindInjection) {
        if (lastImportMapEnd !== -1) {
          content = content.slice(0, lastImportMapEnd) + tailwindInjection + content.slice(lastImportMapEnd);
        } else if (content.includes('<head>')) {
          content = content.replace('<head>', `<head>\n${tailwindInjection}`);
        } else if (content.includes('<html')) {
          content = content.replace(/<html[^>]*>/, `$&${tailwindInjection}`);
        } else {
          content = tailwindInjection + content;
        }
      }

      if (lastImportMapEnd !== -1) {
        // Insert preamble right after the last import map </script>
        content = content.slice(0, lastImportMapEnd) + REACT_REFRESH_PREAMBLE + content.slice(lastImportMapEnd);
      } else if (content.includes('<head>')) {
        content = content.replace('<head>', `<head>${REACT_REFRESH_PREAMBLE}`);
      } else if (content.includes('<html')) {
        // If no <head>, inject after <html...>
        content = content.replace(/<html[^>]*>/, `$&${REACT_REFRESH_PREAMBLE}`);
      } else {
        // Prepend if no html tag
        content = REACT_REFRESH_PREAMBLE + content;
      }

      // Inject HMR client script before </head> or </body>
      if (content.includes('</head>')) {
        content = content.replace('</head>', `${HMR_CLIENT_SCRIPT}</head>`);
      } else if (content.includes('</body>')) {
        content = content.replace('</body>', `${HMR_CLIENT_SCRIPT}</body>`);
      } else {
        // Append at the end if no closing tag found
        content += HMR_CLIENT_SCRIPT;
      }

      // Inject Replay recording capture script (before </body> so DOM is ready)
      if (content.includes('</body>')) {
        content = content.replace('</body>', `${REPLAY_CAPTURE_SCRIPT}</body>`);
      } else {
        content += REPLAY_CAPTURE_SCRIPT;
      }

      const buffer = Buffer.from(content);
      return {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(buffer.length),
          'Cache-Control': 'no-cache',
        },
        body: buffer,
      };
    } catch (error) {
      return this.serverError(error);
    }
  }

  private async loadTailwindConfigIfNeeded(): Promise<string> {
    if (this.tailwindConfigLoaded) {
      return this.tailwindConfigScript;
    }

    try {
      const result = await loadTailwindConfig(this.vfs, this.root);

      if (result.success) {
        this.tailwindConfigScript = result.configScript;
      } else if (result.error) {
        almostnodeDebugWarn('vite', '[ViteDevServer] Tailwind config warning:', result.error);
        this.tailwindConfigScript = '';
      }
    } catch (error) {
      almostnodeDebugWarn('vite', '[ViteDevServer] Failed to load tailwind.config:', error);
      this.tailwindConfigScript = '';
    }

    this.tailwindConfigLoaded = true;
    return this.tailwindConfigScript;
  }

  private hasTailwindProjectMarker(): boolean {
    const root = this.root === '/' ? '' : this.root;
    return (
      this.vfs.existsSync(`${root}/components.json`)
      || this.vfs.existsSync(`${root}/tailwind.config.ts`)
      || this.vfs.existsSync(`${root}/tailwind.config.js`)
      || this.vfs.existsSync(`${root}/tailwind.config.mjs`)
    );
  }

  private async getTailwindInjection(html: string): Promise<string> {
    if (html.includes('cdn.tailwindcss.com')) {
      return '';
    }
    if (!this.hasTailwindProjectMarker()) {
      return '';
    }

    const configScript = await this.loadTailwindConfigIfNeeded();
    return `<script src="${TAILWIND_CDN_URL}"></script>\n${configScript}`;
  }
}

export default ViteDevServer;
