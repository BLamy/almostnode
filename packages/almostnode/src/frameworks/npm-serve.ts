/**
 * NPM package bundling for browser consumption.
 *
 * Bundles npm packages installed in VFS node_modules into single ESM files
 * using esbuild-wasm. This replaces esm.sh CDN for packages that are
 * locally installed, giving us full control over resolution (no CDN bugs).
 *
 * React packages are kept external — they continue to load from esm.sh
 * so the entire app shares one React instance.
 */

import { build, setVFS, type BuildResult } from '../shims/esbuild';
import type { VirtualFS } from '../virtual-fs';

/** Packages that must stay external (loaded via import map / esm.sh). */
const ALWAYS_EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
];

interface NpmServeState {
  /** In-memory cache: specifier → bundled ESM code. */
  cache: Map<string, string>;
  /** Epoch the cache was last validated against (see clearNpmBundleCache). */
  epoch: number;
}

/**
 * Per-VFS bundle state. Keyed weakly so disposed containers don't retain
 * their bundle caches. The no-arg clearNpmBundleCache() can't iterate a
 * WeakMap, so it bumps `clearAllEpoch` instead and caches are invalidated
 * lazily on next access.
 */
const npmServeStateByVfs = new WeakMap<VirtualFS, NpmServeState>();
let clearAllEpoch = 0;

/** Fallback state for legacy callers that never provided a VFS. */
const fallbackState: NpmServeState = { cache: new Map(), epoch: 0 };

/** Legacy VFS instance used when bundleNpmModuleForBrowser gets no vfs arg. */
let moduleVFS: VirtualFS | null = null;

function getNpmServeState(vfs: VirtualFS | null): NpmServeState {
  let state: NpmServeState;
  if (vfs) {
    const existing = npmServeStateByVfs.get(vfs);
    if (existing) {
      state = existing;
    } else {
      state = { cache: new Map(), epoch: clearAllEpoch };
      npmServeStateByVfs.set(vfs, state);
    }
  } else {
    state = fallbackState;
  }
  if (state.epoch !== clearAllEpoch) {
    state.cache.clear();
    state.epoch = clearAllEpoch;
  }
  return state;
}

/**
 * Clear the bundle cache (e.g., after npm install).
 * Pass a VFS to clear only that instance's cache; no-arg clears all.
 */
export function clearNpmBundleCache(vfs?: VirtualFS): void {
  if (vfs) {
    npmServeStateByVfs.get(vfs)?.cache.clear();
    return;
  }
  clearAllEpoch++;
  fallbackState.cache.clear();
  fallbackState.epoch = clearAllEpoch;
}

/**
 * Ensure the esbuild VFS plugin can access our virtual file system.
 * Must be called before bundleNpmModuleForBrowser.
 */
export function initNpmServe(vfs: VirtualFS): void {
  setVFS(vfs);
  moduleVFS = vfs;
}

/**
 * Resolve a package specifier to its browser-bundle entry point in VFS.
 * Prefers native ESM/server-like entries first now that install-time
 * ESM-to-CJS transformation is no longer the default.
 */
/**
 * Recursively resolve nested export conditions to a file path string.
 * Handles doubly-nested conditions like convex uses:
 *   { "import": { "types": "...", "import": "./dist/esm/server/index.js" },
 *     "require": { "types": "...", "require": "./dist/cjs/server/index.js" } }
 *
 * Prefers import > module > default > require.
 * Skips 'types' condition (resolves to .d.ts files).
 */
const CJS_CONDITION_PRIORITY = ['browser', 'import', 'module', 'default', 'require'] as const;

function resolveExportEntry(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    for (const condition of CJS_CONDITION_PRIORITY) {
      const value = obj[condition];
      if (value !== undefined) {
        const result = resolveExportEntry(value);
        if (result) return result;
      }
    }
  }
  return undefined;
}

/** Check that a VFS path is an existing file (not a directory). */
function isFile(vfs: VirtualFS, path: string): boolean {
  if (!vfs.existsSync(path)) return false;
  try { return !vfs.statSync(path).isDirectory(); } catch { return false; }
}

function resolvePackageEntry(
  vfs: VirtualFS | null,
  specifier: string,
  searchRoots: string[] = ['/'],
): string | null {
  if (!vfs) return null;

  const parts = specifier.split('/');
  const isScoped = parts[0].startsWith('@');
  const pkgName = isScoped ? parts.slice(0, 2).join('/') : parts[0];
  const subPath = isScoped ? parts.slice(2).join('/') : parts.slice(1).join('/');

  for (const root of searchRoots) {
    const normalizedRoot = root === '/' ? '' : root.replace(/\/$/, '');
    const pkgDir = `${normalizedRoot}/node_modules/${pkgName}`.replace(/\/+/g, '/');
    const pkgJsonPath = pkgDir + '/package.json';
    if (!vfs.existsSync(pkgJsonPath)) {
      continue;
    }

    try {
      const pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));
      const exports = pkgJson.exports;

      if (exports && typeof exports === 'object') {
        const key = subPath ? './' + subPath : '.';
        const exportsMap = exports as Record<string, unknown>;
        const entry = exportsMap[key];
        if (entry) {
          const resolved = resolveExportEntry(entry);
          if (resolved) {
            const fullPath = pkgDir + '/' + resolved.replace(/^\.\//, '');
            if (isFile(vfs, fullPath)) return fullPath;
          }
        }

        // Try wildcard export patterns (e.g., "./*": "./dist/es5/*.js")
        if (subPath) {
          for (const expKey of Object.keys(exportsMap)) {
            const starIdx = expKey.indexOf('*');
            if (starIdx === -1) continue;
            const prefix = expKey.slice(0, starIdx);
            const suffix = expKey.slice(starIdx + 1);
            if (key.startsWith(prefix) && (suffix === '' || key.endsWith(suffix))) {
              const matched = suffix
                ? key.slice(prefix.length, key.length - suffix.length)
                : key.slice(prefix.length);
              const target = exportsMap[expKey];
              const targetPath = resolveExportEntry(target);
              if (targetPath) {
                const expanded = targetPath.replace('*', matched);
                const fullPath = pkgDir + '/' + expanded.replace(/^\.\//, '');
                if (isFile(vfs, fullPath)) return fullPath;
              }
            }
          }
        }
      }

      if (!subPath) {
        const mainEntry = pkgJson.module || pkgJson.main;
        if (mainEntry) {
          const fullPath = pkgDir + '/' + mainEntry.replace(/^\.\//, '');
          if (isFile(vfs, fullPath)) return fullPath;
        }
        const defaultPath = pkgDir + '/index.js';
        if (isFile(vfs, defaultPath)) return defaultPath;
      } else {
        const directPath = pkgDir + '/' + subPath;
        for (const ext of ['', '.js', '.cjs', '.mjs', '.json']) {
          if (isFile(vfs, directPath + ext)) return directPath + ext;
        }
        // Infer subpath location from main/module fields.
        // e.g., main="dist/es5/index.js" + subPath="constants"
        //   → try "dist/es5/constants.js"
        for (const field of [pkgJson.module, pkgJson.main]) {
          if (typeof field !== 'string') continue;
          const lastSlash = field.lastIndexOf('/');
          if (lastSlash === -1) continue;
          const dir = field.slice(0, lastSlash + 1).replace(/^\.\//, '');
          for (const ext of ['', '.js', '.cjs', '.mjs', '.json']) {
            const inferredPath = pkgDir + '/' + dir + subPath + ext;
            if (isFile(vfs, inferredPath)) return inferredPath;
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return null;
}

/**
 * Extract named export identifiers from a CJS file produced by ESM→CJS transform.
 * Looks for esbuild's `__export(xxx, { name: () => ... })` pattern.
 */
function extractCjsExportNames(content: string): string[] {
  // Match esbuild's __export(varName, { key: () => ..., key2: () => ... })
  const match = content.match(/__export\(\w+,\s*\{([^}]+)\}/);
  if (match) {
    return [...match[1].matchAll(/(\w+)\s*:/g)]
      .map(m => m[1])
      .filter(n => n !== 'default' && n !== '__esModule');
  }
  // Fallback: exports.X = ... pattern
  return [...new Set(
    [...content.matchAll(/exports\.(\w+)\s*=/g)]
      .map(m => m[1])
      .filter(n => n !== 'default' && n !== '__esModule')
  )];
}

/**
 * Post-process esbuild's CJS→ESM bundle to add explicit named exports.
 *
 * esbuild wraps CJS entries as `export default require_xxx();` with no named
 * exports. We find the require function name from that line, then append
 * explicit `export var X = __pkg.X;` for each known export name.
 */
function addNamedExports(code: string, exportNames: string[]): string {
  if (exportNames.length === 0) return code;

  // Find `export default require_xxx();` — the CJS wrapper export
  const match = code.match(/export\s+default\s+(require_\w+)\(\)\s*;?/);
  if (!match) return code;

  const fnName = match[0];
  const requireFn = match[1];

  const replacement =
    `var __pkg = ${requireFn}();\nexport default __pkg;\n` +
    exportNames.map(n => `export var ${n} = __pkg.${n};`).join('\n') + '\n';

  return code.replace(fnName, replacement);
}

/**
 * Replace esbuild's `__require("ext")` calls with proper ESM imports.
 *
 * esbuild generates `__require("react")` for CJS external dependencies in ESM
 * format, which throws at runtime. We find ALL `__require("...")` calls,
 * add ESM `import * as` declarations at the top, and replace each call
 * with the namespace reference.
 */
function patchExternalRequires(code: string): string {
  // Find all unique __require("specifier") calls
  const matches = new Set<string>();
  for (const m of code.matchAll(/__require\(["']([^"']+)["']\)/g)) {
    matches.add(m[1]);
  }
  if (matches.size === 0) return code;

  const specs = [...matches];
  const imports = specs.map((ext, i) =>
    `import * as __ext${i} from "${ext}";`
  ).join('\n');

  let patched = code;
  for (let i = 0; i < specs.length; i++) {
    const ext = specs[i];
    patched = patched.split(`__require("${ext}")`).join(`__ext${i}`);
    patched = patched.split(`__require('${ext}')`).join(`__ext${i}`);
  }

  return imports + '\n' + patched;
}

/**
 * Bundle an npm package from VFS node_modules into a single ESM file.
 *
 * @param specifier - The bare npm specifier (e.g., "@ai-sdk/react", "zod/v4")
 * @param searchRoots - VFS roots whose node_modules are searched, in order
 * @param vfs - VFS to bundle from; falls back to the initNpmServe() instance
 * @returns The bundled ESM code string
 */
export async function bundleNpmModuleForBrowser(
  specifier: string,
  searchRoots: string[] = ['/'],
  vfs?: VirtualFS,
): Promise<string> {
  const resolvedVfs = vfs ?? moduleVFS;
  const { cache } = getNpmServeState(resolvedVfs);
  const cacheKey = `${searchRoots.join('|')}::${specifier}`;
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Resolve the package entry directly from VFS.
  const entryPath = resolvePackageEntry(resolvedVfs, specifier, searchRoots);

  // Extract likely named exports from CJS entries before bundling.
  let exportNames: string[] = [];
  if (entryPath && resolvedVfs) {
    try {
      const entryContent = resolvedVfs.readFileSync(entryPath, 'utf8');
      exportNames = extractCjsExportNames(entryContent);
    } catch { /* ignore read errors */ }
  }

  let result: BuildResult;

  if (entryPath) {
    // Use the resolved CJS entry as a direct entry point
    result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      target: 'esnext',
      external: ALWAYS_EXTERNAL,
      write: false,
      vfs: resolvedVfs ?? undefined,
    });
  } else {
    // Fallback: use stdin with bare specifier (for packages without exports field)
    const virtualEntry = `export * from '${specifier}';\n`;
    result = await build({
      stdin: {
        contents: virtualEntry,
        resolveDir: `${(searchRoots[0] === '/' ? '' : searchRoots[0]).replace(/\/$/, '')}/node_modules`.replace(/\/+/g, '/'),
        loader: 'js',
      },
      bundle: true,
      format: 'esm',
      target: 'esnext',
      external: ALWAYS_EXTERNAL,
      write: false,
      vfs: resolvedVfs ?? undefined,
    });
  }

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error(`esbuild produced no output for '${specifier}'`);
  }

  // esbuild-wasm's outputFiles have `contents` (Uint8Array) and `text` (getter)
  // Use contents + TextDecoder as a reliable fallback
  const outFile = result.outputFiles[0];
  let code = outFile.text;
  if (!code && outFile.contents && outFile.contents.length > 0) {
    code = new TextDecoder().decode(outFile.contents);
  }

  if (!code) {
    throw new Error(`esbuild produced empty output for '${specifier}' (entry: ${entryPath || 'stdin'})`);
  }

  // Post-process: replace __require("ext") with ESM imports
  code = patchExternalRequires(code);

  // If the raw entry file didn't yield CJS export names (e.g. entry was ESM
  // but esbuild wrapped transitive CJS deps, or resolvePackageEntry returned
  // null), try extracting them from the bundled output itself.
  if (exportNames.length === 0 && /export\s+default\s+require_\w+\(\)/.test(code)) {
    exportNames = extractCjsExportNames(code);
  }

  // Post-process: add named ESM exports for CJS bundles
  if (exportNames.length > 0) {
    code = addNamedExports(code, exportNames);
  }

  cache.set(cacheKey, code);
  return code;
}
