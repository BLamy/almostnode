/**
 * ESM to CJS Transformer using esbuild-wasm
 *
 * Transforms ES modules to CommonJS format during npm install,
 * so require() can work synchronously.
 */

import { VirtualFS } from './virtual-fs';
import { ESBUILD_WASM_ESM_CDN, ESBUILD_WASM_BINARY_CDN } from './config/cdn';
import * as acorn from 'acorn';

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<Record<string, unknown>>;

const CJS_REQUIRE_HELPER = '__almostnodeRequire';

// Check if we're in a real browser environment (not Node.js or jsdom tests)
const isNodeLike = typeof process !== 'undefined' && Boolean((process as { versions?: { node?: string } }).versions?.node);
const isLikelyJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
const isBrowser = typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  !isNodeLike &&
  !isLikelyJsdom;

// Window.__esbuild type is declared in src/types/external.d.ts

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks',
  'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls',
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib', 'async_hooks', 'inspector', 'module',
]);

function walkAst(node: any, callback: (node: any, parent: any | null) => void, parent: any | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') {
    callback(node, parent);
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.type === 'string') {
            walkAst(item, callback, node);
          }
        }
      } else if (typeof child.type === 'string') {
        walkAst(child, callback, node);
      }
    }
  }
}

function parseDynamicImportAst(code: string): any | null {
  const parse = (sourceType: 'module' | 'script') => (
    acorn.parse(code, { ecmaVersion: 'latest', sourceType })
  );

  try {
    return parse('module');
  } catch {
    try {
      return parse('script');
    } catch {
      return null;
    }
  }
}

function applyReplacements(code: string, replacements: Array<[number, number, string]>): string {
  if (replacements.length === 0) return code;

  let patched = code;
  replacements.sort((a, b) => b[0] - a[0]);
  for (const [start, end, replacement] of replacements) {
    patched = patched.slice(0, start) + replacement + patched.slice(end);
  }

  return patched;
}

function rewriteDynamicImportsForCjs(code: string): string {
  const ast = parseDynamicImportAst(code);
  if (!ast) {
    return code;
  }

  const replacements: Array<[number, number, string]> = [];

  walkAst(ast, (node, parent) => {
    if (node.type === 'AwaitExpression') {
      const awaited = node.argument;
      if (awaited?.type === 'ImportExpression' && awaited.source) {
        const sourceCode = code.slice(awaited.source.start, awaited.source.end);
        replacements.push([node.start, node.end, `${CJS_REQUIRE_HELPER}(${sourceCode})`]);
        return;
      }

      if (
        awaited?.type === 'CallExpression'
        && awaited.callee?.type === 'Identifier'
        && awaited.callee.name === '__dynamicImport'
        && awaited.arguments?.length === 1
      ) {
        const arg = awaited.arguments[0];
        const sourceCode = code.slice(arg.start, arg.end);
        replacements.push([node.start, node.end, `${CJS_REQUIRE_HELPER}(${sourceCode})`]);
      }
      return;
    }

    if (node.type !== 'ImportExpression') {
      return;
    }

    if (parent?.type === 'AwaitExpression' && parent.argument === node) {
      return;
    }

    if (node.source?.type !== 'Literal' || typeof node.source.value !== 'string') {
      return;
    }

    const specifier = node.source.value;
    if (!specifier.startsWith('node:') && !NODE_BUILTINS.has(specifier)) {
      return;
    }

    const sourceCode = code.slice(node.source.start, node.source.end);
    replacements.push([node.start, node.end, `Promise.resolve(${CJS_REQUIRE_HELPER}(${sourceCode}))`]);
  });

  return applyReplacements(code, replacements);
}

/**
 * Initialize esbuild-wasm (reuses existing instance if already initialized)
 */
export async function initTransformer(): Promise<void> {
  // Skip in non-browser environments (tests)
  if (!isBrowser) {
    console.log('[transform] Skipping esbuild init (not in browser)');
    return;
  }

  // Reuse existing esbuild instance from window (may have been initialized by next-dev-server)
  if (window.__esbuild) {
    console.log('[transform] Reusing existing esbuild instance');
    return;
  }

  // If another init is in progress, wait for it
  if (window.__esbuildInitPromise) {
    return window.__esbuildInitPromise;
  }

  // Permanent bail-out after a previous init failure to prevent retry storms
  if ((window as any).__esbuildInitFailed) {
    throw new Error('esbuild initialization previously failed permanently');
  }

  window.__esbuildInitPromise = (async () => {
    try {
      console.log('[transform] Loading esbuild-wasm...');

      // Load esbuild-wasm from CDN
      const mod = await dynamicImport(ESBUILD_WASM_ESM_CDN);

      // esm.sh wraps the module - get the actual esbuild object
      const esbuildMod = mod.default || mod;

      try {
        await esbuildMod.initialize({
          wasmURL: ESBUILD_WASM_BINARY_CDN,
        });
        console.log('[transform] esbuild-wasm initialized');
      } catch (initError) {
        // Handle "already initialized" error gracefully
        if (initError instanceof Error && initError.message.includes('Cannot call "initialize" more than once')) {
          console.log('[transform] esbuild-wasm already initialized, reusing');
        } else {
          throw initError;
        }
      }

      window.__esbuild = esbuildMod;
    } catch (error) {
      console.error('[transform] Failed to initialize esbuild:', error);
      (window as any).__esbuildInitFailed = true;
      window.__esbuildInitPromise = undefined;
      throw error;
    }
  })();

  return window.__esbuildInitPromise;
}

/**
 * Check if transformer is ready
 */
export function isTransformerReady(): boolean {
  // In non-browser, we skip transformation
  if (!isBrowser) return true;
  return window.__esbuild !== undefined;
}

/**
 * Transform a single file from ESM to CJS
 */
export async function transformFile(
  code: string,
  filename: string
): Promise<string> {
  // Skip in non-browser environments
  if (!isBrowser) {
    return code;
  }

  if (!window.__esbuild) {
    await initTransformer();
  }

  const esbuild = window.__esbuild;
  if (!esbuild) {
    throw new Error('esbuild not initialized');
  }

  // Determine loader based on file extension
  let loader: 'js' | 'jsx' | 'ts' | 'tsx' = 'js';
  if (filename.endsWith('.jsx')) loader = 'jsx';
  else if (filename.endsWith('.ts')) loader = 'ts';
  else if (filename.endsWith('.tsx')) loader = 'tsx';
  else if (filename.endsWith('.mjs')) loader = 'js';

  const rewriteAwaitImportsForCjs = (input: string): string => rewriteDynamicImportsForCjs(input);

  const runTransform = async (inputCode: string): Promise<string> => {
    const result = await esbuild.transform(inputCode, {
      loader,
      format: 'cjs',
      target: 'esnext',
      platform: 'neutral',
      // Replace import.meta with our runtime-provided variable
      // This is the proper esbuild way to handle import.meta in CJS
      define: {
        'import.meta.url': 'import_meta.url',
        'import.meta.dirname': 'import_meta.dirname',
        'import.meta.filename': 'import_meta.filename',
        'import.meta': 'import_meta',
      },
    });

    let transformed = result.code;

    return rewriteAwaitImportsForCjs(transformed);
  };

  try {
    return await runTransform(code);
  } catch (error: unknown) {
    // Check if it's a top-level await error and try rewriting awaited imports.
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('Top-level await')) {
      const rewritten = rewriteAwaitImportsForCjs(code);
      if (rewritten !== code) {
        try {
          return await runTransform(rewritten);
        } catch (rewriteError) {
          console.warn(`[transform] Top-level await rewrite failed for ${filename}:`, rewriteError);
        }
      }
      console.log(`[transform] Skipping ${filename} (has unsupported top-level await)`);
      return code;
    }

    console.warn(`[transform] Failed to transform ${filename}:`, error);
    // Return original code if transform fails
    return code;
  }
}

/**
 * Check if a file needs ESM to CJS transformation
 */
function needsTransform(filename: string, code: string): boolean {
  // .mjs files are always ESM
  if (filename.endsWith('.mjs')) {
    return true;
  }

  // .cjs files are always CJS
  if (filename.endsWith('.cjs')) {
    return false;
  }

  // Check for ESM syntax
  const hasImport = /\bimport\s+[\w{*'"]/m.test(code);
  const hasExport = /\bexport\s+(?:default|const|let|var|function|class|{|\*)/m.test(code);
  const hasImportMeta = /\bimport\.meta\b/.test(code);
  const hasDynamicImport = /\bimport\s*\(/.test(code);

  return hasImport || hasExport || hasImportMeta || hasDynamicImport;
}

/**
 * Check if a file has dynamic imports that need patching
 */
function hasDynamicNodeImports(code: string): boolean {
  // Check for import("node:...") or import('node:...')
  if (/\bimport\s*\(\s*["']node:/.test(code)) {
    return true;
  }
  // Check for dynamic imports of common node builtins
  if (/\bimport\s*\(\s*["'](fs|path|http|https|net|url|util|events|stream|os|crypto)["']/.test(code)) {
    return true;
  }
  return false;
}

/**
 * Patch dynamic imports in already-CJS code (e.g., pre-bundled packages)
 */
export function patchDynamicImports(code: string): string {
  return rewriteDynamicImportsForCjs(code);
}

/**
 * Transform all ESM files in a package directory to CJS
 */
export async function transformPackage(
  vfs: VirtualFS,
  pkgPath: string,
  onProgress?: (msg: string) => void
): Promise<number> {
  let transformedCount = 0;

  // Find all JS files in the package
  const jsFiles = findJsFiles(vfs, pkgPath);

  onProgress?.(`  Transforming ${jsFiles.length} files in ${pkgPath}...`);

  // Transform files in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < jsFiles.length; i += BATCH_SIZE) {
    const batch = jsFiles.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const code = vfs.readFileSync(filePath, 'utf8');

          if (needsTransform(filePath, code)) {
            // Full ESM to CJS transformation
            const transformed = await transformFile(code, filePath);
            vfs.writeFileSync(filePath, transformed);
            transformedCount++;
          } else if (hasDynamicNodeImports(code)) {
            // Just patch dynamic imports in already-CJS code
            const patched = patchDynamicImports(code);
            vfs.writeFileSync(filePath, patched);
            transformedCount++;
          }
        } catch (error) {
          // Skip files that can't be read/transformed
          console.warn(`[transform] Skipping ${filePath}:`, error);
        }
      })
    );
  }

  return transformedCount;
}

/**
 * Find all JavaScript files in a directory recursively
 */
function findJsFiles(vfs: VirtualFS, dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = vfs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = dir + '/' + entry;

      try {
        const stat = vfs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules inside packages (nested deps)
          if (entry !== 'node_modules') {
            files.push(...findJsFiles(vfs, fullPath));
          }
        } else if (
          entry.endsWith('.js') ||
          entry.endsWith('.mjs') ||
          entry.endsWith('.jsx')
        ) {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files;
}
