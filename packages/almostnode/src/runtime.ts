/**
 * Runtime - Execute user code with shimmed Node.js globals
 *
 * ESM to CJS transformation is now handled during npm install by transform.ts
 * using esbuild-wasm. This runtime just executes the pre-transformed CJS code.
 */

import { VirtualFS } from './virtual-fs';
import type { IRuntime, IExecuteResult, IRuntimeOptions } from './runtime-interface';
import type { PackageJson } from './types/package-json';
import { simpleHash } from './utils/hash';
import { uint8ToBase64, uint8ToHex } from './utils/binary-encoding';
import { createFsShim, FsShim } from './shims/fs';
import * as pathShim from './shims/path';
import { createProcess, Process } from './shims/process';
import * as httpShim from './shims/http';
import * as httpsShim from './shims/https';
import * as netShim from './shims/net';
import eventsShim from './shims/events';
import streamShim, { promises as streamPromisesShim } from './shims/stream';
import streamConsumersShim from './shims/stream-consumers';
import * as urlShim from './shims/url';
import * as querystringShim from './shims/querystring';
import * as utilShim from './shims/util';
import * as ttyShim from './shims/tty';
import * as osShim from './shims/os';
import * as cryptoShim from './shims/crypto';
import * as zlibShim from './shims/zlib';
import * as dnsShim from './shims/dns';
import bufferShim from './shims/buffer';
import * as childProcessShim from './shims/child_process';
import { initChildProcess } from './shims/child_process';
import { getServerBridge } from './server-bridge';
import * as chokidarShim from './shims/chokidar';
import * as wsShim from './shims/ws';
import * as fseventsShim from './shims/fsevents';
import * as readdirpShim from './shims/readdirp';
import * as moduleShim from './shims/module';
import * as perfHooksShim from './shims/perf_hooks';
import * as workerThreadsShim from './shims/worker_threads';
import * as esbuildShim from './shims/esbuild';
import * as rollupShim from './shims/rollup';
import * as v8Shim from './shims/v8';
import * as readlineShim from './shims/readline';
import * as tlsShim from './shims/tls';
import * as http2Shim from './shims/http2';
import * as clusterShim from './shims/cluster';
import * as dgramShim from './shims/dgram';
import * as vmShim from './shims/vm';
import * as inspectorShim from './shims/inspector';
import * as asyncHooksShim from './shims/async_hooks';
import * as domainShim from './shims/domain';
import * as diagnosticsChannelShim from './shims/diagnostics_channel';
import { ModuleGraphLoader } from './module-graph-loader';
import { ModuleResolver, type ModuleFormat } from './module-resolution';

import assertShim from './shims/assert';
import { resolve as resolveExports, imports as resolveImports } from 'resolve.exports';
import { transformEsmToCjsSimple } from './frameworks/code-transforms';
import * as acorn from 'acorn';
import { almostnodeDebugError, almostnodeDebugLog } from './utils/debug';
import {
  getDefaultNetworkController,
  networkFetch,
  selectNetworkRouteForUrl,
  setDefaultNetworkController,
} from './network';
import type { NetworkController, NetworkOptions } from './network/types';

const CJS_REQUIRE_HELPER = '__almostnodeRequire';

/**
 * Walk an acorn AST recursively, calling the callback for every node.
 */
function walkAst(node: any, callback: (node: any) => void): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') {
    callback(node);
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.type === 'string') {
            walkAst(item, callback);
          }
        }
      } else if (typeof child.type === 'string') {
        walkAst(child, callback);
      }
    }
  }
}

/**
 * Transform dynamic imports in code: import('x') -> __dynamicImport('x')
 * Regex-based fallback for when AST parsing fails.
 */
function transformDynamicImportsRegex(code: string): string {
  return code.replace(/(?<![.$\w])import\s*\(/g, '__dynamicImport(');
}

function hasAwaitedDynamicImports(code: string): boolean {
  return /\bawait\s+__dynamicImport\s*\(/.test(code) || /\bawait\s+import\s*\(/.test(code);
}

function findFirstAwaitLine(code: string): string | null {
  const match = code.match(/^[^\n]*\bawait\b[^\n]*$/m);
  if (!match) return null;
  return match[0].trim().slice(0, 200);
}

function isLikelyTopLevelAwaitSyntaxError(message: string): boolean {
  return message.includes('await is only valid') ||
    message.includes("Unexpected reserved word 'await'") ||
    message.includes('Unexpected identifier');
}

function createWrappedModuleCode(moduleCode: string, asyncBody = false): string {
  return `(function($exports, $require, $module, $filename, $dirname, $process, $console, $importMeta, $dynamicImport) {
var exports = $exports;
var require = $require;
var ${CJS_REQUIRE_HELPER} = $require;
var module = $module;
var __filename = $filename;
var __dirname = $dirname;
var process = $process;
var console = $console;
var import_meta = $importMeta;
var __dynamicImport = $dynamicImport;
// Set up global.process and globalThis.process for code that accesses them directly
var global = globalThis;
globalThis.process = $process;
global.process = $process;
return (${asyncBody ? 'async ' : ''}function() {
${moduleCode}
}).call(this);
})`;
}

/**
 * CJS wrappers can't parse top-level await.
 * Rewrite awaited dynamic imports to synchronous require(...) for compatibility.
 */
function rewriteAwaitedDynamicImports(code: string): string {
  let rewritten = code;
  rewritten = rewritten.replace(/\bawait\s+__dynamicImport\s*\(/g, `${CJS_REQUIRE_HELPER}(`);
  rewritten = rewritten.replace(/\bawait\s+import\s*\(/g, `${CJS_REQUIRE_HELPER}(`);
  return rewritten;
}

/**
 * All-in-one ESM to CJS transform using AST.
 * Handles import/export declarations, import.meta, and dynamic imports in a single pass.
 * Falls back to regex-based transforms if acorn can't parse the code.
 */
function transformEsmToCjs(code: string, filename: string): string {
  // Quick check: does the code have any ESM-like patterns?
  const maybeEsm = /\bimport\b|\bexport\b|\bimport\.meta\b/.test(code) || hasAwaitedDynamicImports(code);
  if (!maybeEsm) return rewriteAwaitedDynamicImports(code);

  try {
    return transformEsmToCjsAst(code, filename);
  } catch {
    // Acorn can't parse — fall back to regex transforms
    return transformEsmToCjsRegexFallback(code, filename);
  }
}

/**
 * AST-based ESM to CJS transform. Parses once with acorn, then:
 * 1. Replaces import.meta with import_meta (the wrapper-provided variable)
 * 2. Replaces dynamic import() with __dynamicImport()
 * 3. Transforms import/export declarations to require/exports
 *
 * Steps 1 & 2 use a deep AST walk (handles nodes inside functions/classes).
 * Step 3 re-parses the modified code via transformEsmToCjsSimple.
 */
function transformEsmToCjsAst(code: string, filename: string): string {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any;

  // Collect deep replacements: import.meta → import_meta, import() → __dynamicImport()
  const deepReplacements: Array<[number, number, string]> = [];

  walkAst(ast, (node: any) => {
    // import.meta → import_meta (variable provided by module wrapper)
    if (node.type === 'MetaProperty' && node.meta?.name === 'import' && node.property?.name === 'meta') {
      deepReplacements.push([node.start, node.end, 'import_meta']);
    }
    // import('x') → __dynamicImport('x')
    if (node.type === 'ImportExpression') {
      // Replace just the 'import' keyword, preserving the (...) part
      deepReplacements.push([node.start, node.start + 6, '__dynamicImport']);
    }
  });

  // Check for actual import/export declarations
  const hasImportDecl = ast.body.some((n: any) => n.type === 'ImportDeclaration');
  const hasExportDecl = ast.body.some((n: any) => n.type?.startsWith('Export'));

  // Apply deep replacements from end to start (preserves earlier positions)
  let transformed = code;
  deepReplacements.sort((a, b) => b[0] - a[0]);
  for (const [start, end, replacement] of deepReplacements) {
    transformed = transformed.slice(0, start) + replacement + transformed.slice(end);
  }

  // Transform import/export declarations (re-parses the modified code)
  if (hasImportDecl || hasExportDecl) {
    transformed = transformEsmToCjsSimple(transformed);

    if (hasExportDecl) {
      transformed = 'Object.defineProperty(exports, "__esModule", { value: true });\n' + transformed;
    }
  }

  return rewriteAwaitedDynamicImports(transformed);
}

/**
 * Regex-based fallback for ESM to CJS transform (when acorn can't parse).
 */
function transformEsmToCjsRegexFallback(code: string, filename: string): string {
  let transformed = code;

  // Replace import.meta (regex — may match in strings, but this is the fallback)
  transformed = transformed.replace(/\bimport\.meta\.url\b/g, `"file://${filename}"`);
  transformed = transformed.replace(/\bimport\.meta\.dirname\b/g, `"${pathShim.dirname(filename)}"`);
  transformed = transformed.replace(/\bimport\.meta\.filename\b/g, `"${filename}"`);
  transformed = transformed.replace(/\bimport\.meta\b/g, `({ url: "file://${filename}", dirname: "${pathShim.dirname(filename)}", filename: "${filename}" })`);

  // Replace dynamic imports
  transformed = transformDynamicImportsRegex(transformed);

  // Transform import/export (AST with its own regex fallback)
  const hasImport = /\bimport\s+[\w{*'"]/m.test(code);
  const hasExport = /\bexport\s+(?:default|const|let|var|function|class|{|\*)/m.test(code);
  if (hasImport || hasExport) {
    transformed = transformEsmToCjsSimple(transformed);
    if (hasExport) {
      transformed = 'Object.defineProperty(exports, "__esModule", { value: true });\n' + transformed;
    }
  }

  return rewriteAwaitedDynamicImports(transformed);
}

/**
 * Create a dynamic import function for a module context
 * Returns a function that wraps require() in a Promise
 */
function createDynamicImport(moduleRequire: RequireFunction): (specifier: string) => Promise<unknown> {
  return async (specifier: string): Promise<unknown> => {
    try {
      const mod = moduleRequire(specifier);

      // If the module has a default export or is already ESM-like, return as-is
      if (mod && typeof mod === 'object' && ('default' in (mod as object) || '__esModule' in (mod as object))) {
        return mod;
      }

      // For CommonJS modules, wrap in an object with default export
      // This matches how dynamic import() handles CJS modules
      return {
        default: mod,
        ...(mod && typeof mod === 'object' ? mod as object : {}),
      };
    } catch (error) {
      // Re-throw as a rejected promise (which is what dynamic import does)
      throw error;
    }
  };
}

/**
 * signal-exit v3 exports a callable function; v4 exports an object with onExit().
 * Some packages (e.g. proper-lockfile) still call require('signal-exit') as a function.
 * Return a callable wrapper when the installed module is the v4 object shape.
 */
function normalizeSignalExitExport(moduleExports: unknown): unknown {
  if (typeof moduleExports === 'function') {
    const fn = moduleExports as ((...args: unknown[]) => unknown) & Record<string, unknown>;
    if (typeof fn.onExit !== 'function') {
      fn.onExit = (...args: unknown[]) => fn(...args);
    }
    if (!('default' in fn)) {
      fn.default = fn;
    }
    return fn;
  }

  if (!moduleExports || typeof moduleExports !== 'object') {
    return moduleExports;
  }

  const signalExitObj = moduleExports as Record<string, unknown>;
  const onExit = signalExitObj.onExit;
  if (typeof onExit !== 'function') {
    return moduleExports;
  }

  const compat = ((...args: unknown[]) => (onExit as (...a: unknown[]) => unknown)(...args)) as
    ((...args: unknown[]) => unknown) & Record<string, unknown>;
  Object.assign(compat, signalExitObj);
  if (!('default' in compat)) {
    compat.default = compat;
  }
  return compat;
}

/**
 * Some transpiled CJS bundles mark exports with __esModule but omit a default export.
 * esbuild's __toESM(require(...)) helper then exposes .default as undefined.
 * Provide a fallback default pointing at the module namespace object.
 */
function normalizeMissingEsmDefault(moduleExports: unknown): unknown {
  if (!moduleExports || (typeof moduleExports !== 'object' && typeof moduleExports !== 'function')) {
    return moduleExports;
  }

  const mod = moduleExports as Record<string, unknown>;
  if (!('__esModule' in mod) || 'default' in mod) {
    return moduleExports;
  }

  try {
    Object.defineProperty(mod, 'default', {
      value: moduleExports,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return moduleExports;
  } catch {
    if (typeof moduleExports === 'function') {
      const original = moduleExports as (...args: unknown[]) => unknown;
      const wrapped = ((...args: unknown[]) => original(...args)) as
        ((...args: unknown[]) => unknown) & Record<string, unknown>;
      Object.assign(wrapped, mod);
      wrapped.default = moduleExports;
      return wrapped;
    }

    return {
      ...mod,
      default: moduleExports,
    };
  }
}

export interface Module {
  id: string;
  filename: string;
  url: string;
  format: ModuleFormat;
  exports: unknown;
  namespace?: Record<string, unknown>;
  loaded: boolean;
  children: Module[];
  paths: string[];
  executionPromise?: Promise<unknown>;
}

export interface RuntimeOptions {
  cwd?: string;
  env?: Record<string, string>;
  onConsole?: (method: string, args: unknown[]) => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  childProcessController?: childProcessShim.ChildProcessController;
  builtinModules?: Record<string, unknown>;
  network?: NetworkOptions;
  networkController?: NetworkController;
}

export interface RequireFunction {
  (id: string): unknown;
  resolve: (id: string) => string;
  cache: Record<string, Module>;
}

interface ResolverCaches {
  resolutionCache: Map<string, string | null>;
  packageJsonCache: Map<string, PackageJson | null>;
}

/**
 * Create a basic string_decoder module
 */
function createStringDecoderModule() {
  class StringDecoder {
    encoding: string;
    constructor(encoding?: string) {
      this.encoding = encoding || 'utf8';
    }
    write(buffer: Uint8Array): string {
      return new TextDecoder(this.encoding).decode(buffer);
    }
    end(buffer?: Uint8Array): string {
      if (buffer) return this.write(buffer);
      return '';
    }
  }
  return { StringDecoder };
}

/**
 * Create a basic timers module
 */
function createTimersModule() {
  return {
    setTimeout: (...args: any[]) => (globalThis.setTimeout as any)(...args),
    setInterval: (...args: any[]) => (globalThis.setInterval as any)(...args),
    setImmediate: (fn: (...args: unknown[]) => void, ...args: unknown[]) => (globalThis.setTimeout as any)(fn, 0, ...args),
    clearTimeout: (handle: unknown) => (globalThis.clearTimeout as any)(handle),
    clearInterval: (handle: unknown) => (globalThis.clearInterval as any)(handle),
    clearImmediate: (handle: unknown) => (globalThis.clearTimeout as any)(handle),
  };
}

function createTimersPromisesModule() {
  return {
    setTimeout: (ms: number, value?: unknown) => new Promise((resolve) => (globalThis.setTimeout as any)(() => resolve(value), ms)),
    setInterval: (...args: any[]) => (globalThis.setInterval as any)(...args),
    setImmediate: (value?: unknown) => new Promise((resolve) => (globalThis.setTimeout as any)(() => resolve(value), 0)),
    scheduler: {
      wait: (ms: number) => new Promise((resolve) => (globalThis.setTimeout as any)(resolve, ms)),
    },
  };
}

/**
 * Minimal execa shim backed by child_process.exec.
 * Supports the APIs used by shadcn CLI: named export `execa` and default callable.
 */
function createExecaModule() {
  const quoteArg = (value: string) => JSON.stringify(value);

  const run = (
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; reject?: boolean }
  ) => new Promise<{
    command: string;
    escapedCommand: string;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    failed: boolean;
    signal: string | null;
  }>((resolve, reject) => {
    const execOptions = {
      cwd: options?.cwd,
      env: options?.env,
    };

    childProcessShim.exec(command, execOptions, (error, stdout, stderr) => {
      const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
        ? ((error as unknown as { code: number }).code)
        : 0;
      const result = {
        command,
        escapedCommand: command,
        cwd: options?.cwd || '/',
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        exitCode,
        failed: exitCode !== 0,
        signal: null as string | null,
      };

      if (exitCode !== 0 && options?.reject !== false) {
        const execaError = new Error(`Command failed with exit code ${exitCode}: ${command}`) as Error & typeof result;
        Object.assign(execaError, result);
        reject(execaError);
        return;
      }

      resolve(result);
    });
  });

  const execa = (
    file: string,
    args: string[] = [],
    options?: { cwd?: string; env?: Record<string, string>; reject?: boolean }
  ) => {
    const command = [file, ...args].map(quoteArg).join(' ');
    return run(command, options);
  };

  const execaCommand = (
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; reject?: boolean }
  ) => run(command, options);

  // Default export is callable and also exposes helpers.
  const execaDefault = Object.assign(execa, {
    execa,
    command: execaCommand,
    execaCommand,
  });

  return {
    execa,
    execaCommand,
    default: execaDefault,
  };
}

/**
 * Minimal prettier shim - just returns input unchanged
 * This is needed because prettier uses createRequire which conflicts with our runtime
 */
const prettierShim = {
  format: (source: string, _options?: unknown) => Promise.resolve(source),
  formatWithCursor: (source: string, _options?: unknown) => Promise.resolve({ formatted: source, cursorOffset: 0 }),
  check: (_source: string, _options?: unknown) => Promise.resolve(true),
  resolveConfig: () => Promise.resolve(null),
  resolveConfigFile: () => Promise.resolve(null),
  clearConfigCache: () => {},
  getFileInfo: () => Promise.resolve({ ignored: false, inferredParser: null }),
  getSupportInfo: () => Promise.resolve({ languages: [], options: [] }),
  version: '3.0.0',
  doc: {
    builders: {},
    printer: {},
    utils: {},
  },
};

/**
 * Create a mutable copy of a module for packages that need to patch it
 * (e.g., Sentry needs to patch http.request/http.get)
 */
function makeMutable(mod: Record<string, unknown>): Record<string, unknown> {
  const mutable: Record<string, unknown> = {};
  for (const key of Object.keys(mod)) {
    mutable[key] = mod[key];
  }
  return mutable;
}

const CONSOLE_METHOD_NAMES = [
  'log', 'error', 'warn', 'info', 'debug', 'trace', 'dir', 'dirxml',
  'time', 'timeEnd', 'timeLog', 'assert', 'clear', 'count', 'countReset',
  'group', 'groupCollapsed', 'groupEnd', 'table',
] as const;
const HOST_CONSOLE = globalThis.console;

type ConsoleMethodName = typeof CONSOLE_METHOD_NAMES[number];

const DEFAULT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const FORBIDDEN_XHR_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
]);

function getRuntimeCorsProxy(): string {
  const envProxy = (globalThis as { process?: { env?: Record<string, unknown> } }).process?.env?.CORS_PROXY_URL;
  if (typeof envProxy === 'string' && envProxy) {
    return envProxy;
  }
  if (typeof localStorage !== 'undefined') {
    const override = localStorage.getItem('__corsProxyUrl');
    if (override) return override;
  }
  return DEFAULT_CORS_PROXY;
}

function shouldProxyBrowserUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return false;
  if (rawUrl.includes('almostnode-cors-proxy')) return false;
  if (typeof location !== 'undefined' && rawUrl.includes(location.host)) return false;
  return true;
}

function getProxiedBrowserUrl(rawUrl: string): string {
  return getRuntimeCorsProxy() + encodeURIComponent(rawUrl);
}

type AlmostnodePatchedXMLHttpRequest = XMLHttpRequest & {
  __almostnodeOriginalUrl?: string;
  __almostnodeRequestMethod?: string;
  __almostnodeRoute?: 'browser' | 'tailscale';
  __almostnodeProxied?: boolean;
  __almostnodeRequestHeaders?: Headers;
  __almostnodeResponseHeaders?: Headers;
  __almostnodeAborted?: boolean;
};

function createXhrEvent(type: string): Event {
  if (typeof Event === 'function') {
    return new Event(type);
  }
  return { type } as Event;
}

function setXhrInstanceValue(
  xhr: AlmostnodePatchedXMLHttpRequest,
  key: string,
  value: unknown,
): void {
  try {
    Object.defineProperty(xhr, key, {
      configurable: true,
      writable: true,
      value,
    });
  } catch {
    try {
      (xhr as unknown as Record<string, unknown>)[key] = value;
    } catch {
      // Ignore read-only XHR properties that cannot be shadowed.
    }
  }
}

function emitXhrEvent(
  xhr: AlmostnodePatchedXMLHttpRequest,
  type: string,
): void {
  const event = createXhrEvent(type);
  const handler = (xhr as unknown as Record<string, unknown>)[`on${type}`];
  if (typeof handler === 'function') {
    try {
      (handler as (event: Event) => void).call(xhr, event);
    } catch {
      // Keep browser listeners flowing even if a property handler throws.
    }
  }

  if (typeof xhr.dispatchEvent === 'function') {
    try {
      xhr.dispatchEvent(event);
    } catch {
      // Ignore dispatch failures on mocked XHR implementations.
    }
  }
}

function setXhrReadyState(
  xhr: AlmostnodePatchedXMLHttpRequest,
  readyState: number,
): void {
  setXhrInstanceValue(xhr, 'readyState', readyState);
  emitXhrEvent(xhr, 'readystatechange');
}

function getXhrRoute(
  rawUrl: string,
): 'browser' | 'tailscale' {
  const controller = getDefaultNetworkController();
  return selectNetworkRouteForUrl(
    rawUrl,
    controller.getConfig(),
    typeof location !== 'undefined' ? location : null,
  );
}

function formatXhrResponseHeaders(headers: Headers): string {
  const lines: string[] = [];
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`);
  });
  return lines.join('\r\n');
}

async function readXhrResponseBody(
  response: Response,
  responseType: XMLHttpRequestResponseType,
): Promise<{ responseValue: unknown; responseText?: string }> {
  switch (responseType) {
    case 'arraybuffer':
      return { responseValue: await response.arrayBuffer() };
    case 'blob':
      return { responseValue: await response.blob() };
    case 'json': {
      const text = await response.text();
      if (!text) {
        return { responseValue: null, responseText: text };
      }
      try {
        return { responseValue: JSON.parse(text), responseText: text };
      } catch {
        return { responseValue: null, responseText: text };
      }
    }
    case 'document': {
      const text = await response.text();
      return { responseValue: text, responseText: text };
    }
    case 'text':
    case '':
    default: {
      const text = await response.text();
      return { responseValue: text, responseText: text };
    }
  }
}

/**
 * Built-in modules registry
 */
const builtinModules: Record<string, unknown> = {
  path: pathShim,
  // Make http/https mutable so packages like Sentry can patch them
  http: makeMutable(httpShim as unknown as Record<string, unknown>),
  https: makeMutable(httpsShim as unknown as Record<string, unknown>),
  net: netShim,
  events: eventsShim,
  stream: streamShim,
  'stream/promises': streamPromisesShim,
  'stream/consumers': streamConsumersShim,
  buffer: bufferShim,
  url: urlShim,
  querystring: querystringShim,
  util: utilShim,
  tty: ttyShim,
  os: osShim,
  crypto: cryptoShim,
  zlib: zlibShim,
  dns: dnsShim,
  'dns/promises': dnsShim.promises,
  assert: assertShim,
  string_decoder: createStringDecoderModule(),
  timers: createTimersModule(),
  _http_common: {},
  _http_incoming: {},
  _http_outgoing: {},
  // New shims for Vite support
  chokidar: chokidarShim,
  ws: wsShim,
  fsevents: fseventsShim,
  readdirp: readdirpShim,
  module: moduleShim,
  perf_hooks: perfHooksShim,
  worker_threads: workerThreadsShim,
  esbuild: esbuildShim,
  rollup: rollupShim,
  v8: v8Shim,
  readline: readlineShim,
  tls: tlsShim,
  http2: http2Shim,
  cluster: clusterShim,
  dgram: dgramShim,
  vm: vmShim,
  inspector: inspectorShim,
  'inspector/promises': inspectorShim,
  async_hooks: asyncHooksShim,
  domain: domainShim,
  diagnostics_channel: diagnosticsChannelShim,
  execa: createExecaModule(),
  // Node.js 'constants' module (deprecated alias for os.constants + fs.constants)
  // Used by graceful-fs and other packages for file open flags
  constants: {
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_CREAT: 64,
    O_EXCL: 128,
    O_TRUNC: 512,
    O_APPEND: 1024,
    O_SYNC: 1052672,
    O_SYMLINK: 0x200000,  // 2097152
    O_NONBLOCK: 2048,
    S_IFMT: 61440,
    S_IFREG: 32768,
    S_IFDIR: 16384,
    S_IFLNK: 40960,
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
  },
  // prettier uses createRequire which doesn't work in our runtime, so we shim it
  prettier: prettierShim,
  // Some packages explicitly require 'console' (with Console constructor)
  console: {
    ...console,
    Console: class Console {
      private _stdout: { write: (s: string) => void } | null;
      private _stderr: { write: (s: string) => void } | null;
      constructor(options?: unknown) {
        // Node's Console accepts (stdout, stderr) or { stdout, stderr }
        const opts = options as Record<string, unknown> | undefined;
        if (opts && typeof opts === 'object' && 'write' in opts) {
          // new Console(stdout, stderr) — first arg is stdout stream
          this._stdout = opts as unknown as { write: (s: string) => void };
          this._stderr = (arguments[1] as { write: (s: string) => void }) || this._stdout;
        } else if (opts && typeof opts === 'object' && 'stdout' in opts) {
          // new Console({ stdout, stderr })
          this._stdout = opts.stdout as { write: (s: string) => void } || null;
          this._stderr = (opts.stderr as { write: (s: string) => void }) || this._stdout;
        } else {
          this._stdout = null;
          this._stderr = null;
        }

        for (const methodName of CONSOLE_METHOD_NAMES) {
          const method = (this as Record<string, unknown>)[methodName];
          if (typeof method === 'function') {
            (this as Record<string, unknown>)[methodName] = method.bind(this);
          }
        }
      }
      private _write(stream: 'out' | 'err', args: unknown[]) {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n';
        const target = stream === 'err' ? this._stderr : this._stdout;
        if (target) target.write(msg);
        else if (stream === 'err') console.error(...args);
        else console.log(...args);
      }
      log(...args: unknown[]) { this._write('out', args); }
      error(...args: unknown[]) { this._write('err', args); }
      warn(...args: unknown[]) { this._write('err', args); }
      info(...args: unknown[]) { this._write('out', args); }
      debug(...args: unknown[]) { this._write('out', args); }
      trace(...args: unknown[]) { this._write('err', args); }
      dir(obj: unknown) { this._write('out', [obj]); }
      dirxml(...args: unknown[]) { this._write('out', args); }
      time(_label?: string) {}
      timeEnd(_label?: string) {}
      timeLog(_label?: string) {}
      assert(value: unknown, ...args: unknown[]) { if (!value) this._write('err', ['Assertion failed:', ...args]); }
      clear() {}
      count(_label?: string) {}
      countReset(_label?: string) {}
      group(..._args: unknown[]) {}
      groupCollapsed(..._args: unknown[]) {}
      groupEnd() {}
      table(data: unknown) { this._write('out', [data]); }
    },
  },
  // util/types is accessed as a subpath
  'util/types': utilShim.types,
  // path subpaths (our path shim is already POSIX-based)
  'path/posix': pathShim,
  'path/win32': pathShim.win32,
  // timers subpaths
  'timers/promises': createTimersPromisesModule(),
};

let runtimeIdCounter = 0;

function createRuntimeId(): string {
  runtimeIdCounter += 1;
  return `almostnode-runtime-${runtimeIdCounter}`;
}

const ACTIVE_TIMER_OWNER_KEY = '__almostnodeActiveTimerOwner';

type TimerTrackingOwner = {
  registerPendingTimer: (handle: AlmostNodeTimerHandle) => void;
  unregisterPendingTimer: (handle: AlmostNodeTimerHandle) => void;
  setPendingTimerRef: (handle: AlmostNodeTimerHandle, refed: boolean) => void;
};

type AlmostNodeTimerHandle = {
  _id: unknown;
  __almostnodeRefed: boolean;
  __almostnodeTimerOwner: TimerTrackingOwner | null;
  ref: () => AlmostNodeTimerHandle;
  unref: () => AlmostNodeTimerHandle;
  hasRef: () => boolean;
  refresh: () => AlmostNodeTimerHandle;
  [Symbol.toPrimitive]: () => number;
};

function getActiveTimerOwner(): TimerTrackingOwner | null {
  return ((globalThis as any)[ACTIVE_TIMER_OWNER_KEY] as TimerTrackingOwner | null | undefined) ?? null;
}

function withActiveTimerOwner<T>(owner: TimerTrackingOwner | null, fn: () => T): T {
  const previousOwner = getActiveTimerOwner();
  (globalThis as any)[ACTIVE_TIMER_OWNER_KEY] = owner;
  try {
    return fn();
  } finally {
    (globalThis as any)[ACTIVE_TIMER_OWNER_KEY] = previousOwner;
  }
}

async function withActiveTimerOwnerAsync<T>(owner: TimerTrackingOwner | null, fn: () => Promise<T>): Promise<T> {
  const previousOwner = getActiveTimerOwner();
  (globalThis as any)[ACTIVE_TIMER_OWNER_KEY] = owner;
  try {
    return await fn();
  } finally {
    (globalThis as any)[ACTIVE_TIMER_OWNER_KEY] = previousOwner;
  }
}

function isAlmostNodeTimerHandle(value: unknown): value is AlmostNodeTimerHandle {
  return !!value && typeof value === 'object' && '__almostnodeTimerOwner' in (value as Record<string, unknown>);
}

/**
 * Create a require function for a specific module context
 */
function createRequire(
  vfs: VirtualFS,
  fsShim: FsShim,
  process: Process,
  currentDir: string,
  moduleCache: Record<string, Module>,
  builtinModuleMap: Record<string, unknown>,
  options: RuntimeOptions,
  processedCodeCache?: Map<string, string>,
  resolverCaches?: ResolverCaches
): RequireFunction {
  const builtinModules = builtinModuleMap;
  const moduleFormatResolver = new ModuleResolver(vfs, { builtinModules });
  // Module resolution cache for faster repeated imports
  const resolutionCache: Map<string, string | null> =
    resolverCaches?.resolutionCache ?? new Map();

  // Package.json parsing cache
  const packageJsonCache: Map<string, PackageJson | null> =
    resolverCaches?.packageJsonCache ?? new Map();

  const childProcessModule = childProcessShim.createChildProcessModule({
    controller: options.childProcessController ?? childProcessShim.getDefaultChildProcessController(),
    getDefaultCwd: () => process.cwd(),
    getDefaultEnv: () => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
          env[key] = value;
        }
      }
      return env;
    },
  });

  const getParsedPackageJson = (pkgPath: string): PackageJson | null => {
    if (packageJsonCache.has(pkgPath)) {
      return packageJsonCache.get(pkgPath)!;
    }
    if (!vfs.existsSync(pkgPath)) {
      packageJsonCache.set(pkgPath, null);
      return null;
    }
    try {
      const content = vfs.readFileSync(pkgPath, 'utf8');
      const parsed = JSON.parse(content) as PackageJson;
      packageJsonCache.set(pkgPath, parsed);
      return parsed;
    } catch {
      packageJsonCache.set(pkgPath, null);
      return null;
    }
  };

  const resolveDirectoryIndex = (dirPath: string): string | null => {
    const indexCandidates = ['index.js', 'index.json', 'index.node'];
    for (const indexFile of indexCandidates) {
      const indexPath = pathShim.join(dirPath, indexFile);
      if (vfs.existsSync(indexPath)) {
        return indexPath;
      }
    }
    return null;
  };

  const resolveModule = (id: string, fromDir: string): string => {
    // Handle node: protocol prefix (Node.js 16+)
    if (id.startsWith('node:')) {
      id = id.slice(5);
    }

    // Built-in modules
    if (id === 'child_process' || builtinModules[id] || id === 'fs' || id === 'process' || id === 'url' || id === 'querystring' || id === 'util') {
      return id;
    }

    // Package imports: #something resolves via nearest package.json "imports" field
    if (id.startsWith('#')) {
      let searchDir = fromDir;
      while (searchDir !== '/') {
        const pkgPath = pathShim.join(searchDir, 'package.json');
        const pkg = getParsedPackageJson(pkgPath);
        if (pkg?.imports) {
          try {
            const resolved = resolveImports(pkg, id, { require: true });
            if (resolved && resolved.length > 0) {
              const fullPath = pathShim.join(searchDir, resolved[0]);
              if (vfs.existsSync(fullPath)) return fullPath;
            }
          } catch {
            // resolveImports throws if no match found
          }
        }
        searchDir = pathShim.dirname(searchDir);
      }
      throw new Error(`Cannot find module '${id}'`);
    }

    // Check resolution cache
    const cacheKey = `${fromDir}|${id}`;
    const cached = resolutionCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached === null) {
        throw new Error(`Cannot find module '${id}'`);
      }
      return cached;
    }

    // Relative paths
    if (id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) {
      const resolved = id.startsWith('/')
        ? id
        : pathShim.resolve(fromDir, id);

      // Try exact path
      if (vfs.existsSync(resolved)) {
        const stats = vfs.statSync(resolved);
        if (stats.isFile()) {
          resolutionCache.set(cacheKey, resolved);
          return resolved;
        }
        // Directory - Node falls back to index.js/index.json/index.node
        const indexPath = resolveDirectoryIndex(resolved);
        if (indexPath) {
          resolutionCache.set(cacheKey, indexPath);
          return indexPath;
        }
      }

      // Try with extensions
      const extensions = ['.js', '.json'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (vfs.existsSync(withExt)) {
          resolutionCache.set(cacheKey, withExt);
          return withExt;
        }
      }

      resolutionCache.set(cacheKey, null);
      throw new Error(`Cannot find module '${id}' from '${fromDir}'`);
    }

    // Helper to try resolving a path with extensions
    const tryResolveFile = (basePath: string): string | null => {
      // Try exact path first
      if (vfs.existsSync(basePath)) {
        const stats = vfs.statSync(basePath);
        if (stats.isFile()) {
          return basePath;
        }
        // Directory - Node falls back to index.js/index.json/index.node
        const indexPath = resolveDirectoryIndex(basePath);
        if (indexPath) {
          return indexPath;
        }
      }

      // Try with extensions
      const extensions = ['.js', '.json', '.node'];
      for (const ext of extensions) {
        const withExt = basePath + ext;
        if (vfs.existsSync(withExt)) {
          return withExt;
        }
      }

      return null;
    };

    // Some packages moved CJS output from build/src/* to build/cjs/src/*.
    // Allow legacy deep imports (e.g. gaxios/build/src/common) to resolve.
    const tryResolveBuildCjsFallback = (
      nodeModulesDir: string,
      moduleId: string
    ): string | null => {
      if (!moduleId.includes('/build/src/')) return null;
      const cjsModuleId = moduleId.replace('/build/src/', '/build/cjs/src/');
      if (cjsModuleId === moduleId) return null;
      return tryResolveFile(pathShim.join(nodeModulesDir, cjsModuleId));
    };

    // Apply browser field object remapping for a resolved file within a package
    const applyBrowserFieldRemap = (resolvedPath: string, pkg: PackageJson, pkgRoot: string): string | null => {
      if (!pkg.browser || typeof pkg.browser !== 'object') return resolvedPath;
      const browserMap = pkg.browser as Record<string, string | false>;
      // Build relative path from package root (e.g., "./lib/node.js")
      const relPath = './' + pathShim.relative(pkgRoot, resolvedPath);
      // Also check without extension for common patterns
      const relPathNoExt = relPath.replace(/\.(js|json|cjs|mjs)$/, '');
      for (const key of [relPath, relPathNoExt]) {
        if (key in browserMap) {
          if (browserMap[key] === false) return null; // Module excluded in browser
          return tryResolveFile(pathShim.join(pkgRoot, browserMap[key] as string));
        }
      }
      return resolvedPath;
    };

    // Helper to resolve from a node_modules directory
    const tryResolveFromNodeModules = (nodeModulesDir: string, moduleId: string): string | null => {
      // Determine the package name and root
      const parts = moduleId.split('/');
      const pkgName = parts[0].startsWith('@') && parts.length > 1
        ? `${parts[0]}/${parts[1]}`  // Scoped package
        : parts[0];

      const pkgRoot = pathShim.join(nodeModulesDir, pkgName);
      const pkgPath = pathShim.join(pkgRoot, 'package.json');

      // Check package.json first — it controls entry points (browser, main, exports)
      const pkg = getParsedPackageJson(pkgPath);
      if (pkg) {
        // npm alias installs can place package files under an alias directory
        // (e.g. node_modules/ink) while package.json name is different
        // (e.g. "@jrichman/ink"). resolve.exports needs the declared specifier.
        const exportsModuleId = (() => {
          const declaredName = typeof pkg.name === 'string' ? pkg.name : null;
          if (!declaredName || declaredName === pkgName) {
            return moduleId;
          }
          if (moduleId === pkgName) {
            return declaredName;
          }
          if (moduleId.startsWith(`${pkgName}/`)) {
            return `${declaredName}${moduleId.slice(pkgName.length)}`;
          }
          return moduleId;
        })();

        // Use resolve.exports to handle the exports field
        if (pkg.exports) {
          // Try require first, then import. Some packages have broken ESM builds (convex).
          // If the CJS entry throws "cannot be imported with require()", the loadModule
          // fallback will retry with the import condition.
          for (const conditions of [{ require: true }, { import: true }] as const) {
            try {
              const resolved = resolveExports(pkg, exportsModuleId, conditions);
              if (resolved && resolved.length > 0) {
                const exportPath = resolved[0];
                const fullExportPath = pathShim.join(pkgRoot, exportPath);
                const resolvedFile = tryResolveFile(fullExportPath);
                if (resolvedFile) {
                  // Skip CJS stub files that just throw "cannot be imported with require()"
                  // These are common in ESM-only packages (vitest, etc.)
                  if (resolvedFile.endsWith('.cjs')) {
                    try {
                      const content = vfs.readFileSync(resolvedFile, 'utf8') as string;
                      if (content.trimStart().startsWith('throw ')) {
                        continue; // Skip this entry, try next condition
                      }
                    } catch { /* proceed if we can't read */ }
                  }
                  return resolvedFile;
                }
              }
            } catch {
              // resolveExports throws if no match found, try next
            }
          }
        }

        // If this is the package root (no sub-path), use browser/main/module entry
        if (pkgName === moduleId) {
          // Prefer browser field (string form) since we're running in a browser
          let main: string | undefined;
          if (typeof pkg.browser === 'string') {
            main = pkg.browser;
          }
          if (!main && pkg.module) {
            // module field is used by ESM-only packages (e.g., estree-walker)
            main = pkg.module as string;
          }
          if (!main) {
            main = pkg.main || 'index.js';
          }
          const mainPath = pathShim.join(pkgRoot, main);
          const resolvedMain = tryResolveFile(mainPath);
          if (resolvedMain) return resolvedMain;
        }
      }

      // Fall back to direct file/directory resolution (for sub-paths or packages without package.json)
      const fullPath = pathShim.join(nodeModulesDir, moduleId);
      const resolved = tryResolveFile(fullPath);
      if (resolved) return resolved;

      const cjsFallback = tryResolveBuildCjsFallback(nodeModulesDir, moduleId);
      if (cjsFallback) return cjsFallback;

      return null;
    };

    // Node modules resolution
    let searchDir = fromDir;
    while (searchDir !== '/') {
      const nodeModulesDir = pathShim.join(searchDir, 'node_modules');
      const resolved = tryResolveFromNodeModules(nodeModulesDir, id);
      if (resolved) {
        resolutionCache.set(cacheKey, resolved);
        return resolved;
      }

      searchDir = pathShim.dirname(searchDir);
    }

    // Try root node_modules as last resort
    const rootResolved = tryResolveFromNodeModules('/node_modules', id);
    if (rootResolved) {
      resolutionCache.set(cacheKey, rootResolved);
      return rootResolved;
    }

    resolutionCache.set(cacheKey, null);
    throw new Error(`Cannot find module '${id}'`);
  };

  const loadModule = (resolvedPath: string): Module => {
    // Return cached module
    if (moduleCache[resolvedPath]) {
      return moduleCache[resolvedPath];
    }

    // Create module object
    const module: Module = {
      id: resolvedPath,
      filename: resolvedPath,
      url: `file://${resolvedPath}`,
      format: moduleFormatResolver.detectFormat(resolvedPath),
      exports: {},
      loaded: false,
      children: [],
      paths: [],
    };

    // Cache before loading to handle circular dependencies
    moduleCache[resolvedPath] = module;

    // Evict oldest entry if cache exceeds bounds
    const cacheKeys = Object.keys(moduleCache);
    // Large CLIs (e.g. gemini-cli-core) can legitimately load thousands of modules.
    // Keep a higher cap to avoid eviction/reload thrash that can cause stalls.
    if (cacheKeys.length > 20000) {
      delete moduleCache[cacheKeys[0]];
    }

    // Handle JSON files
    if (resolvedPath.endsWith('.json')) {
      const content = vfs.readFileSync(resolvedPath, 'utf8');
      module.exports = JSON.parse(content);
      module.loaded = true;
      return module;
    }

    // Read and execute JS file
    const rawCode = vfs.readFileSync(resolvedPath, 'utf8');
    const dirname = pathShim.dirname(resolvedPath);

    // Check processed code cache (useful for HMR when module cache is cleared but code hasn't changed)
    // Use a simple hash of the content for cache key to handle content changes
    const codeCacheKey = `${resolvedPath}|${simpleHash(rawCode)}`;
    let code = processedCodeCache?.get(codeCacheKey);

    if (!code) {
      code = rawCode;

      // Strip shebang line if present (e.g. #!/usr/bin/env node)
      if (code.startsWith('#!')) {
        code = code.slice(code.indexOf('\n') + 1);
      }

      // Cache the processed code
      processedCodeCache?.set(codeCacheKey, code);
    }

    // Create require for this module
    const moduleRequire = createRequire(
      vfs,
      fsShim,
      process,
      dirname,
      moduleCache,
      builtinModules,
      options,
      processedCodeCache,
      resolverCaches
    );
    moduleRequire.cache = moduleCache;

    // Create console wrapper
    const consoleWrapper = createConsoleWrapper(options.onConsole);

    // Execute module code
    // We use an outer/inner function pattern to avoid conflicts:
    // - Outer function receives parameters and sets up vars
    // - Inner function runs the code, allowing let/const to shadow without "already declared" errors
    // - import.meta is provided for ESM code that uses it
    try {
      const importMetaUrl = 'file://' + resolvedPath;
      let fn;
      try {
        fn = eval(createWrappedModuleCode(code));
      } catch (evalError) {
        const msg = evalError instanceof Error ? evalError.message : String(evalError);
        if (isLikelyTopLevelAwaitSyntaxError(msg)) {
          const rewrittenCode = rewriteAwaitedDynamicImports(code);
          if (rewrittenCode !== code) {
            try {
              fn = eval(createWrappedModuleCode(rewrittenCode));
              code = rewrittenCode;
              processedCodeCache?.set(codeCacheKey, code);
            } catch {
              // Fall through to a clearer syntax error below.
            }
          }
        }

        if (!fn) {
          const awaitLine = findFirstAwaitLine(code);
          const awaitDetail = awaitLine ? `\n[almostnode] first await line: ${awaitLine}` : '';
          throw new SyntaxError(`${msg} (in ${resolvedPath})${awaitDetail}`);
        }
      }
      // Create dynamic import function for this module context
      const dynamicImport = createDynamicImport(moduleRequire);

      const executionResult = fn(
        module.exports,
        moduleRequire,
        module,
        resolvedPath,
        dirname,
        process,
        consoleWrapper,
        { url: importMetaUrl, dirname, filename: resolvedPath },
        dynamicImport
      );
      if (executionResult && typeof (executionResult as Promise<unknown>).then === 'function') {
        module.executionPromise = executionResult as Promise<unknown>;
      }

      module.loaded = true;
    } catch (error) {
      // Remove from cache on error
      delete moduleCache[resolvedPath];
      // Enhance runtime errors with the module path for easier debugging
      if (error instanceof Error && !error.message.includes('(in /')) {
        error.message = `${error.message} (in ${resolvedPath})`;
      }
      throw error;
    }

    return module;
  };

  const require: RequireFunction = (id: string): unknown => {
    // Handle node: protocol prefix (Node.js 16+)
    if (id.startsWith('node:')) {
      id = id.slice(5);
    }

    // Built-in modules
    if (id === 'fs') {
      return fsShim;
    }
    if (id === 'fs/promises') {
      return fsShim.promises;
    }
    if (id === 'process') {
      return process;
    }
    if (id === 'child_process') {
      return childProcessModule;
    }
    // yoga-layout v3 uses top-level await in its default entry, which cannot
    // be synchronously required from transformed CJS. node command preloads it.
    if (id === 'yoga-layout') {
      const preloadedYoga = (globalThis as any).__almostnodeYogaLayout;
      if (preloadedYoga) {
        return preloadedYoga;
      }
      const yogaLoadError = (globalThis as any).__almostnodeYogaLayoutError;
      if (yogaLoadError) {
        throw yogaLoadError instanceof Error
          ? yogaLoadError
          : new Error(String(yogaLoadError));
      }
    }
    // Special handling for 'module' - provide a working createRequire
    if (id === 'module') {
      return {
        ...moduleShim,
        createRequire: (filenameOrUrl: string) => {
          // Convert file:// URL to path
          let fromPath = filenameOrUrl;
          if (filenameOrUrl.startsWith('file://')) {
            fromPath = filenameOrUrl.slice(7); // Remove 'file://'
            // Handle Windows-style file:///C:/ URLs (though unlikely in our env)
            if (fromPath.startsWith('/') && fromPath[2] === ':') {
              fromPath = fromPath.slice(1);
            }
          }
          // Get directory from the path
          const fromDir = pathShim.dirname(fromPath);
          // Return a require function that resolves from this directory
          const newRequire = createRequire(
            vfs,
            fsShim,
            process,
            fromDir,
            moduleCache,
            builtinModules,
            options,
            processedCodeCache,
            resolverCaches
          );
          newRequire.cache = moduleCache;
          return newRequire;
        },
      };
    }
    if (builtinModules[id]) {
      return builtinModules[id];
    }

    // Intercept rollup and esbuild - always use our shims
    // These packages have native binaries that don't work in browser
    if (id === 'rollup' || id.startsWith('rollup/') || id.startsWith('@rollup/')) {
      almostnodeDebugLog('runtime', '[runtime] Intercepted rollup:', id);
      return builtinModules['rollup'];
    }
    if (id === 'esbuild' || id.startsWith('esbuild/') || id.startsWith('@esbuild/')) {
      almostnodeDebugLog('runtime', '[runtime] Intercepted esbuild:', id);
      return builtinModules['esbuild'];
    }
    // Intercept prettier - uses createRequire which doesn't work in our runtime
    if (id === 'prettier' || id.startsWith('prettier/')) {
      return builtinModules['prettier'];
    }
    const resolved = resolveModule(id, currentDir);
    const resolvedFormat = moduleFormatResolver.detectFormat(resolved);
    if (resolvedFormat === 'esm') {
      const err = new Error(
        `ERR_REQUIRE_ESM: require() of ES Module '${id}' is not supported. Use import() instead.`
      );
      (err as Error & { code?: string }).code = 'ERR_REQUIRE_ESM';
      throw err;
    }

    // If resolved to a built-in name (shouldn't happen but safety check)
    if (builtinModules[resolved]) {
      return builtinModules[resolved];
    }

    // Also check if resolved path is to rollup, esbuild, or prettier in node_modules
    if (resolved.includes('/node_modules/rollup/') ||
        resolved.includes('/node_modules/@rollup/')) {
      return builtinModules['rollup'];
    }
    if (resolved.includes('/node_modules/esbuild/') ||
        resolved.includes('/node_modules/@esbuild/')) {
      return builtinModules['esbuild'];
    }
    if (resolved.includes('/node_modules/prettier/')) {
      return builtinModules['prettier'];
    }

    let loadedExports = loadModule(resolved).exports;
    if (resolved.includes('/node_modules/')) {
      loadedExports = normalizeMissingEsmDefault(loadedExports);
    }
    if (id === 'signal-exit' || resolved.includes('/node_modules/signal-exit/')) {
      loadedExports = normalizeSignalExitExport(loadedExports);
    }
    return loadedExports;
  };

  require.resolve = (id: string): string => {
    if (id === 'fs' || id === 'process' || id === 'child_process' || builtinModules[id]) {
      return id;
    }
    return resolveModule(id, currentDir);
  };

  require.cache = moduleCache;

  return require;
}

/**
 * Create a console wrapper that can capture output
 */
function createConsoleWrapper(
  onConsole?: (method: string, args: unknown[]) => void
): Console {
  const ConsoleCtor = (builtinModules.console as { Console?: unknown }).Console;
  const wrapper = {
    log: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('log', args);
      } else {
        HOST_CONSOLE.log(...args);
      }
    },
    error: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('error', args);
      } else {
        HOST_CONSOLE.error(...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('warn', args);
      } else {
        HOST_CONSOLE.warn(...args);
      }
    },
    info: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('info', args);
      } else {
        HOST_CONSOLE.info(...args);
      }
    },
    debug: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('debug', args);
      } else {
        HOST_CONSOLE.debug(...args);
      }
    },
    trace: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('trace', args);
      } else {
        HOST_CONSOLE.trace(...args);
      }
    },
    dir: (obj: unknown) => {
      if (onConsole) {
        onConsole('dir', [obj]);
      } else {
        HOST_CONSOLE.dir(obj);
      }
    },
    dirxml: (...args: unknown[]) => {
      if (onConsole) {
        onConsole('dirxml', args);
      } else {
        HOST_CONSOLE.dirxml?.(...args);
      }
    },
    time: HOST_CONSOLE.time.bind(HOST_CONSOLE),
    timeEnd: HOST_CONSOLE.timeEnd.bind(HOST_CONSOLE),
    timeLog: HOST_CONSOLE.timeLog.bind(HOST_CONSOLE),
    assert: HOST_CONSOLE.assert.bind(HOST_CONSOLE),
    clear: HOST_CONSOLE.clear.bind(HOST_CONSOLE),
    count: HOST_CONSOLE.count.bind(HOST_CONSOLE),
    countReset: HOST_CONSOLE.countReset.bind(HOST_CONSOLE),
    group: HOST_CONSOLE.group.bind(HOST_CONSOLE),
    groupCollapsed: HOST_CONSOLE.groupCollapsed.bind(HOST_CONSOLE),
    groupEnd: HOST_CONSOLE.groupEnd.bind(HOST_CONSOLE),
    table: HOST_CONSOLE.table.bind(HOST_CONSOLE),
    timeStamp: HOST_CONSOLE.timeStamp?.bind(HOST_CONSOLE) ?? (() => {}),
    Console: ConsoleCtor,
  };

  return wrapper as unknown as Console;
}

/**
 * Runtime class for executing code in virtual environment
 * Note: This class has sync methods for backward compatibility.
 * Use createRuntime() factory for IRuntime interface compliance.
 */
export class Runtime {
  private vfs: VirtualFS;
  private fsShim: FsShim;
  private process: Process;
  private runtimeId: string;
  private pendingRefedTimers = new Set<AlmostNodeTimerHandle>();
  private moduleCache: Record<string, Module> = {};
  private builtinModules: Record<string, unknown>;
  private formatDetector: ModuleResolver;
  private moduleLoader: ModuleGraphLoader;
  private options: RuntimeOptions;
  private networkController: NetworkController;
  /** Cache for pre-processed code (after ESM transform) before eval */
  private processedCodeCache: Map<string, string> = new Map();
  /** Shared resolver caches to avoid per-module duplication and exception churn */
  private resolverCaches: ResolverCaches = {
    resolutionCache: new Map(),
    packageJsonCache: new Map(),
  };

  constructor(vfs: VirtualFS, options: RuntimeOptions = {}) {
    this.vfs = vfs;
    this.runtimeId = createRuntimeId();
    const childProcessController = options.childProcessController ?? initChildProcess(vfs);
    this.networkController = options.networkController ?? getDefaultNetworkController();
    setDefaultNetworkController(this.networkController);
    if (options.network) {
      void this.networkController.configure(options.network);
    }
    // Create process first so we can get cwd for fs shim
    this.process = createProcess({
      cwd: options.cwd || '/',
      env: options.env,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
    // Create fs shim with cwd getter for relative path resolution
    this.fsShim = createFsShim(vfs, () => this.process.cwd());
    this.builtinModules = {
      ...builtinModules,
      fs: this.fsShim,
      'fs/promises': this.fsShim.promises,
      process: this.process,
      child_process: childProcessShim,
      ...(options.builtinModules || {}),
    };
    this.options = {
      ...options,
      childProcessController,
    };
    this.formatDetector = new ModuleResolver(this.vfs, {
      builtinModules: this.builtinModules,
    });
    this.moduleLoader = new ModuleGraphLoader({
      vfs: this.vfs,
      runtimeId: this.runtimeId,
      builtinModules: this.builtinModules,
      console: createConsoleWrapper(this.options.onConsole) as unknown as Record<string, unknown>,
      process: this.process as unknown as Record<string, unknown>,
      requireCjs: (resolvedPath: string) => this.requireCommonJsModule(resolvedPath),
      createRequire: (fromPath: string) => this.createLegacyRequire(pathShim.dirname(fromPath)),
    });

    // Initialize file watcher shims with VFS
    chokidarShim.setVFS(vfs);
    readdirpShim.setVFS(vfs);

    // Initialize esbuild shim with VFS for file access
    esbuildShim.setVFS(vfs);

    // Polyfill Node.js `global` (alias for globalThis) so ESM modules served via
    // /_npm/ that reference `global` don't throw ReferenceError in browsers.
    if (typeof (globalThis as any).global === 'undefined') {
      (globalThis as any).global = globalThis;
    }

    // Polyfill setImmediate/clearImmediate (Node.js globals not available in browsers)
    if (typeof globalThis.setImmediate === 'undefined') {
      (globalThis as any).setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
      (globalThis as any).clearImmediate = (id: number) => clearTimeout(id);
    }

    // Patch globalThis.fetch to route cross-origin requests through CORS proxy.
    // Node.js code (native fetch, node-fetch v3) calls globalThis.fetch directly.
    // In the browser, cross-origin requests will fail without CORS headers.
    if (!(globalThis.fetch as any).__almostnode) {
      const origFetch = globalThis.fetch.bind(globalThis);
      (globalThis as any).__almostnodeNativeFetch = origFetch;
      (globalThis as any).fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          return networkFetch(input, init, getDefaultNetworkController());
        },
        { __almostnode: true },
      );
    }

    // Patch XMLHttpRequest to use the same CORS proxy path as fetch().
    // Some CLIs bundle axios/XHR adapters and bypass global fetch entirely.
    if (typeof globalThis.XMLHttpRequest === 'function' && !(globalThis.XMLHttpRequest as any).__almostnode) {
      const xhrProto = (globalThis.XMLHttpRequest as typeof XMLHttpRequest & {
        prototype: XMLHttpRequest;
      }).prototype as XMLHttpRequest & {
        __almostnodeOriginalOpen?: XMLHttpRequest['open'];
        __almostnodeOriginalAbort?: XMLHttpRequest['abort'];
        __almostnodeOriginalGetAllResponseHeaders?: XMLHttpRequest['getAllResponseHeaders'];
        __almostnodeOriginalGetResponseHeader?: XMLHttpRequest['getResponseHeader'];
        __almostnodeOriginalSend?: XMLHttpRequest['send'];
        __almostnodeOriginalSetRequestHeader?: XMLHttpRequest['setRequestHeader'];
      };
      const origOpen = xhrProto.open;
      const origSend = xhrProto.send;
      const origAbort = xhrProto.abort;
      const origGetResponseHeader = xhrProto.getResponseHeader;
      const origGetAllResponseHeaders = xhrProto.getAllResponseHeaders;
      const origSetRequestHeader = xhrProto.setRequestHeader;

      xhrProto.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
      ) {
        const requestedUrl = typeof url === 'string' ? url : String(url);
        const route = getXhrRoute(requestedUrl);
        const proxied = route === 'browser' && shouldProxyBrowserUrl(requestedUrl);
        const effectiveUrl = proxied ? getProxiedBrowserUrl(requestedUrl) : requestedUrl;
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        xhr.__almostnodeOriginalUrl = requestedUrl;
        xhr.__almostnodeRequestMethod = method;
        xhr.__almostnodeRoute = route;
        xhr.__almostnodeProxied = proxied;
        xhr.__almostnodeRequestHeaders = new Headers();
        xhr.__almostnodeResponseHeaders = new Headers();
        xhr.__almostnodeAborted = false;
        return origOpen.call(this, method, effectiveUrl, async ?? true, username ?? null, password ?? null);
      };

      xhrProto.setRequestHeader = function (name: string, value: string) {
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        const lowerName = String(name || '').toLowerCase();
        if (FORBIDDEN_XHR_HEADERS.has(lowerName)) {
          return;
        }

        if (xhr.__almostnodeProxied && (lowerName === 'host' || lowerName === 'accept-encoding')) {
          return;
        }

        xhr.__almostnodeRequestHeaders ??= new Headers();
        xhr.__almostnodeRequestHeaders.append(name, value);

        if (xhr.__almostnodeRoute === 'tailscale') {
          return;
        }

        try {
          return origSetRequestHeader.call(this, name, value);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/unsafe header/i.test(message)) {
            return;
          }
          throw error;
        }
      };

      xhrProto.getResponseHeader = function (name: string) {
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        if (xhr.__almostnodeRoute === 'tailscale') {
          return xhr.__almostnodeResponseHeaders?.get(name) ?? null;
        }
        return origGetResponseHeader.call(this, name);
      };

      xhrProto.getAllResponseHeaders = function () {
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        if (xhr.__almostnodeRoute === 'tailscale') {
          return formatXhrResponseHeaders(xhr.__almostnodeResponseHeaders ?? new Headers());
        }
        return origGetAllResponseHeaders.call(this);
      };

      xhrProto.abort = function () {
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        if (xhr.__almostnodeRoute !== 'tailscale') {
          return origAbort.call(this);
        }

        xhr.__almostnodeAborted = true;
        setXhrInstanceValue(xhr, 'status', 0);
        setXhrInstanceValue(xhr, 'statusText', '');
        setXhrReadyState(xhr, 0);
        emitXhrEvent(xhr, 'abort');
        emitXhrEvent(xhr, 'loadend');
      };

      xhrProto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        const xhr = this as AlmostnodePatchedXMLHttpRequest;
        if (xhr.__almostnodeRoute !== 'tailscale') {
          return origSend.call(this, body as Document | XMLHttpRequestBodyInit | null | undefined);
        }

        const requestedUrl = xhr.__almostnodeOriginalUrl;
        if (!requestedUrl) {
          throw new Error('XMLHttpRequest.send() called before open().');
        }

        xhr.__almostnodeAborted = false;

        void (async () => {
          try {
            const requestHeaders = new Headers(xhr.__almostnodeRequestHeaders);
            const method = (xhr.__almostnodeRequestMethod || 'GET').toUpperCase();
            const request = new Request(requestedUrl, {
              method,
              headers: requestHeaders,
              body: method === 'GET' || method === 'HEAD'
                ? undefined
                : (body as BodyInit | null | undefined),
              credentials: xhr.withCredentials ? 'include' : 'same-origin',
              redirect: 'follow',
            });
            const response = await networkFetch(request, undefined, getDefaultNetworkController());
            if (xhr.__almostnodeAborted) {
              return;
            }

            const responseHeaders = new Headers(response.headers);
            const { responseValue, responseText } = await readXhrResponseBody(
              response,
              xhr.responseType || '',
            );
            if (xhr.__almostnodeAborted) {
              return;
            }

            xhr.__almostnodeResponseHeaders = responseHeaders;
            setXhrInstanceValue(xhr, 'status', response.status);
            setXhrInstanceValue(xhr, 'statusText', response.statusText);
            setXhrInstanceValue(xhr, 'responseURL', response.url || requestedUrl);
            setXhrReadyState(xhr, 2);
            setXhrReadyState(xhr, 3);
            setXhrInstanceValue(xhr, 'response', responseValue);
            if (responseText !== undefined) {
              setXhrInstanceValue(xhr, 'responseText', responseText);
            }
            setXhrReadyState(xhr, 4);
            emitXhrEvent(xhr, 'load');
            emitXhrEvent(xhr, 'loadend');
          } catch (error) {
            if (xhr.__almostnodeAborted) {
              return;
            }

            setXhrInstanceValue(xhr, 'status', 0);
            setXhrInstanceValue(xhr, 'statusText', '');
            setXhrReadyState(xhr, 4);
            emitXhrEvent(xhr, 'error');
            emitXhrEvent(xhr, 'loadend');
          }
        })();
      };

      Object.defineProperty(globalThis.XMLHttpRequest, '__almostnode', {
        value: true,
        configurable: true,
      });
    }

    // DEBUG: Patch JSON.parse to log details when it fails on truncated data
    // This helps diagnose "Unexpected end of JSON input" errors from packages
    if (!(JSON.parse as any).__almostnode_debug) {
      const origJsonParse = JSON.parse;
      (JSON as any).parse = Object.assign(function debugJsonParse(text: string, ...rest: unknown[]) {
        try {
          return origJsonParse.call(JSON, text, ...rest as []);
        } catch (err) {
          if (err instanceof SyntaxError && err.message.includes('end of JSON')) {
            const preview = typeof text === 'string' ? text.slice(0, 500) : String(text);
            almostnodeDebugError('json', `[almostnode DEBUG] JSON.parse failed: ${err.message}`);
            almostnodeDebugError(
              'json',
              `[almostnode DEBUG] Input length: ${typeof text === 'string' ? text.length : 'N/A'}, preview: ${JSON.stringify(preview)}`,
            );
            almostnodeDebugError('json', `[almostnode DEBUG] Stack:`, new Error().stack);
          }
          throw err;
        }
      }, { __almostnode_debug: true });
    }

    // Patch timers to:
    // 1. return Node.js-compatible Timeout objects
    // 2. keep track of ref'ed timers so child_process can avoid completing early
    if (!(globalThis.setTimeout as any).__almostnodeTracked) {
      const origSetTimeout = globalThis.setTimeout.bind(globalThis);
      const origSetInterval = globalThis.setInterval.bind(globalThis);
      const origClearTimeout = globalThis.clearTimeout.bind(globalThis);
      const origClearInterval = globalThis.clearInterval.bind(globalThis);

      const createTimerHandle = (
        id: ReturnType<typeof origSetTimeout>,
        owner: TimerTrackingOwner | null,
      ): AlmostNodeTimerHandle => {
        const handle: AlmostNodeTimerHandle = {
          _id: id,
          __almostnodeRefed: true,
          __almostnodeTimerOwner: owner,
          ref() {
            if (!handle.__almostnodeRefed) {
              handle.__almostnodeRefed = true;
              owner?.setPendingTimerRef(handle, true);
            }
            return handle;
          },
          unref() {
            if (handle.__almostnodeRefed) {
              handle.__almostnodeRefed = false;
              owner?.setPendingTimerRef(handle, false);
            }
            return handle;
          },
          hasRef() {
            return handle.__almostnodeRefed;
          },
          refresh() {
            return handle;
          },
          [Symbol.toPrimitive]() {
            return typeof id === 'number' ? id : Number(id);
          },
        };

        owner?.registerPendingTimer(handle);
        return handle;
      };

      (globalThis as any).setTimeout = Object.assign((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const owner = getActiveTimerOwner();
        let handle: AlmostNodeTimerHandle;
        const wrappedCallback = typeof callback === 'function'
          ? (...callbackArgs: unknown[]) => {
            owner?.unregisterPendingTimer(handle);
            return withActiveTimerOwner(owner, () => (callback as (...cbArgs: unknown[]) => unknown)(...callbackArgs));
          }
          : callback;
        const id = origSetTimeout(wrappedCallback as TimerHandler, delay, ...args);
        handle = createTimerHandle(id, owner);
        return handle;
      }, { __almostnodeTracked: true });

      (globalThis as any).setInterval = Object.assign((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const owner = getActiveTimerOwner();
        const wrappedCallback = typeof callback === 'function'
          ? (...callbackArgs: unknown[]) => withActiveTimerOwner(owner, () => (callback as (...cbArgs: unknown[]) => unknown)(...callbackArgs))
          : callback;
        const id = origSetInterval(wrappedCallback as TimerHandler, delay, ...args);
        return createTimerHandle(id, owner);
      }, { __almostnodeTracked: true });

      (globalThis as any).clearTimeout = (timer: unknown) => {
        if (isAlmostNodeTimerHandle(timer)) {
          timer.__almostnodeTimerOwner?.unregisterPendingTimer(timer);
        }
        origClearTimeout(isAlmostNodeTimerHandle(timer) ? timer._id as ReturnType<typeof origSetTimeout> : timer as ReturnType<typeof origSetTimeout>);
      };

      (globalThis as any).clearInterval = (timer: unknown) => {
        if (isAlmostNodeTimerHandle(timer)) {
          timer.__almostnodeTimerOwner?.unregisterPendingTimer(timer);
        }
        origClearInterval(isAlmostNodeTimerHandle(timer) ? timer._id as ReturnType<typeof origSetInterval> : timer as ReturnType<typeof origSetInterval>);
      };
    }

    // Polyfill Error.captureStackTrace/prepareStackTrace for Safari/WebKit
    // (V8-specific API used by Express's depd and other npm packages)
    this.setupStackTracePolyfill();

    // Polyfill TextDecoder to handle base64/base64url/hex gracefully
    // (Some CLI tools incorrectly try to use TextDecoder for these)
    this.setupTextDecoderPolyfill();
  }

  registerPendingTimer = (handle: AlmostNodeTimerHandle): void => {
    if (!handle.__almostnodeRefed) return;
    this.pendingRefedTimers.add(handle);
  };

  unregisterPendingTimer = (handle: AlmostNodeTimerHandle): void => {
    this.pendingRefedTimers.delete(handle);
  };

  setPendingTimerRef = (handle: AlmostNodeTimerHandle, refed: boolean): void => {
    if (refed) {
      this.pendingRefedTimers.add(handle);
      return;
    }
    this.pendingRefedTimers.delete(handle);
  };

  hasPendingRefedTimers(): boolean {
    return this.pendingRefedTimers.size > 0;
  }

  private withTimerOwner<T>(fn: () => T): T {
    return withActiveTimerOwner(this, fn);
  }

  private withTimerOwnerAsync<T>(fn: () => Promise<T>): Promise<T> {
    return withActiveTimerOwnerAsync(this, fn);
  }

  /**
   * Set up a polyfilled TextDecoder that handles binary encodings
   */
  private setupTextDecoderPolyfill(): void {
    const OriginalTextDecoder = globalThis.TextDecoder;

    class PolyfillTextDecoder {
      private encoding: string;
      private decoder: TextDecoder | null = null;

      constructor(encoding: string = 'utf-8', options?: TextDecoderOptions) {
        this.encoding = encoding.toLowerCase();

        // For valid text encodings, use the real TextDecoder
        const validTextEncodings = [
          'utf-8', 'utf8', 'utf-16le', 'utf-16be', 'utf-16',
          'ascii', 'iso-8859-1', 'latin1', 'windows-1252'
        ];

        if (validTextEncodings.includes(this.encoding)) {
          try {
            this.decoder = new OriginalTextDecoder(encoding, options);
          } catch {
            // Fall back to utf-8
            this.decoder = new OriginalTextDecoder('utf-8', options);
          }
        }
        // For binary encodings (base64, base64url, hex), decoder stays null
      }

      decode(input?: BufferSource, options?: TextDecodeOptions): string {
        if (this.decoder) {
          return this.decoder.decode(input, options);
        }

        // Handle binary encodings manually
        if (!input) return '';

        const bytes = input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

        if (this.encoding === 'base64') {
          return uint8ToBase64(bytes);
        }

        if (this.encoding === 'base64url') {
          return uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        }

        if (this.encoding === 'hex') {
          return uint8ToHex(bytes);
        }

        // Fallback: decode as utf-8
        return new OriginalTextDecoder('utf-8').decode(input, options);
      }

      get fatal(): boolean {
        return this.decoder?.fatal ?? false;
      }

      get ignoreBOM(): boolean {
        return this.decoder?.ignoreBOM ?? false;
      }
    }

    globalThis.TextDecoder = PolyfillTextDecoder as unknown as typeof TextDecoder;
  }

  /**
   * Polyfill V8's Error.captureStackTrace and Error.prepareStackTrace for Safari/WebKit.
   * Express's `depd` and other npm packages use these V8-specific APIs which don't
   * exist in Safari, causing "callSite.getFileName is not a function" errors.
   */
  private setupStackTracePolyfill(): void {
    // Only polyfill if not already available (i.e., not V8/Chrome)
    if (typeof (Error as any).captureStackTrace === 'function') return;

    // Set a default stackTraceLimit so Math.max(10, undefined) doesn't produce NaN
    // (depd and other packages read this value)
    if ((Error as any).stackTraceLimit === undefined) {
      (Error as any).stackTraceLimit = 10;
    }

    // Parse a stack trace string into structured frames
    function parseStack(stack: string): Array<{fn: string, file: string, line: number, col: number}> {
      if (!stack) return [];
      const frames: Array<{fn: string, file: string, line: number, col: number}> = [];
      const lines = stack.split('\n');

      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('Error') || line.startsWith('TypeError')) continue;

        let fn = '', file = '', lineNo = 0, colNo = 0;

        // Safari format: "functionName@file:line:col" or "@file:line:col"
        const safariMatch = line.match(/^(.*)@(.*?):(\d+):(\d+)$/);
        if (safariMatch) {
          fn = safariMatch[1] || '';
          file = safariMatch[2];
          lineNo = parseInt(safariMatch[3], 10);
          colNo = parseInt(safariMatch[4], 10);
          frames.push({ fn, file, line: lineNo, col: colNo });
          continue;
        }

        // Chrome format: "at functionName (file:line:col)" or "at file:line:col"
        const chromeMatch = line.match(/^at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?$/);
        if (chromeMatch) {
          fn = chromeMatch[1] || '';
          file = chromeMatch[2];
          lineNo = parseInt(chromeMatch[3], 10);
          colNo = parseInt(chromeMatch[4], 10);
          frames.push({ fn, file, line: lineNo, col: colNo });
          continue;
        }
      }
      return frames;
    }

    // Create a mock CallSite object from a parsed frame
    function createCallSite(frame: {fn: string, file: string, line: number, col: number}) {
      return {
        getFileName: () => frame.file || null,
        getLineNumber: () => frame.line || null,
        getColumnNumber: () => frame.col || null,
        getFunctionName: () => frame.fn || null,
        getMethodName: () => frame.fn || null,
        getTypeName: () => null,
        getThis: () => undefined,
        getFunction: () => undefined,
        getEvalOrigin: () => undefined,
        isNative: () => false,
        isConstructor: () => false,
        isToplevel: () => !frame.fn,
        isEval: () => false,
        toString: () => frame.fn
          ? `${frame.fn} (${frame.file}:${frame.line}:${frame.col})`
          : `${frame.file}:${frame.line}:${frame.col}`,
      };
    }

    // Helper: parse stack and create CallSite objects, used by both captureStackTrace and .stack getter
    function buildCallSites(stack: string, constructorOpt?: Function) {
      const frames = parseStack(stack);
      let startIdx = 0;
      if (constructorOpt && constructorOpt.name) {
        for (let i = 0; i < frames.length; i++) {
          if (frames[i].fn === constructorOpt.name) {
            startIdx = i + 1;
            break;
          }
        }
      }
      return frames.slice(startIdx).map(createCallSite);
    }

    // Symbol to store raw stack string, used by the .stack getter
    const stackSymbol = Symbol('rawStack');

    // Intercept .stack on Error.prototype so that packages using the V8 pattern
    // "Error.prepareStackTrace = fn; new Error().stack" also get CallSite objects.
    // In V8, reading .stack lazily triggers prepareStackTrace; Safari doesn't do this.
    Object.defineProperty(Error.prototype, 'stack', {
      get() {
        const rawStack = (this as any)[stackSymbol];
        if (rawStack !== undefined && typeof (Error as any).prepareStackTrace === 'function') {
          const callSites = buildCallSites(rawStack);
          try {
            return (Error as any).prepareStackTrace(this, callSites);
          } catch {
            return rawStack;
          }
        }
        return rawStack;
      },
      set(value: string) {
        (this as any)[stackSymbol] = value;
      },
      configurable: true,
      enumerable: false,
    });

    // Polyfill Error.captureStackTrace
    (Error as any).captureStackTrace = function(target: any, constructorOpt?: Function) {
      // Temporarily clear prepareStackTrace to get the raw stack string
      // (otherwise our .stack getter would call prepareStackTrace recursively)
      const savedPrepare = (Error as any).prepareStackTrace;
      (Error as any).prepareStackTrace = undefined;
      const err = new Error();
      const rawStack = err.stack || '';
      (Error as any).prepareStackTrace = savedPrepare;

      // If prepareStackTrace is set, provide structured call sites
      if (typeof savedPrepare === 'function') {
        const callSites = buildCallSites(rawStack, constructorOpt);
        try {
          target.stack = savedPrepare(target, callSites);
        } catch (e) {
          console.warn('[almostnode] Error.prepareStackTrace threw:', e);
          target.stack = rawStack;
        }
      } else {
        target.stack = rawStack;
      }
    };
  }

  private createModuleRecord(
    id: string,
    format: ModuleFormat,
    exportsValue: unknown = {},
    namespace?: Record<string, unknown>,
  ): Module {
    return {
      id,
      filename: id,
      url: format === 'builtin' ? `builtin:${id}` : `file://${id}`,
      format,
      exports: exportsValue,
      namespace,
      loaded: false,
      children: [],
      paths: [],
    };
  }

  private createLegacyRequire(currentDir: string): RequireFunction {
    return createRequire(
      this.vfs,
      this.fsShim,
      this.process,
      currentDir,
      this.moduleCache,
      this.builtinModules,
      this.options,
      this.processedCodeCache,
      this.resolverCaches,
    );
  }

  private buildExecuteResult(module: Module, namespace?: Record<string, unknown>): IExecuteResult {
    const normalizedNamespace = namespace || (
      module.exports && typeof module.exports === 'object'
        ? module.exports as Record<string, unknown>
        : { default: module.exports }
    );

    module.namespace = normalizedNamespace;
    module.loaded = true;

    return {
      exports: normalizedNamespace.default ?? module.exports,
      namespace: normalizedNamespace,
      module,
    };
  }

  private requireCommonJsModule(resolvedPath: string): unknown {
    const module = this.loadModule(resolvedPath);
    let loadedExports = module.exports;
    if (resolvedPath.includes('/node_modules/')) {
      loadedExports = normalizeMissingEsmDefault(loadedExports);
    }
    if (resolvedPath.includes('/node_modules/signal-exit/') || resolvedPath === 'signal-exit') {
      loadedExports = normalizeSignalExitExport(loadedExports);
    }
    module.exports = loadedExports;
    return loadedExports;
  }

  async importModule(specifier: string, fromPath = '/'): Promise<IExecuteResult> {
    return this.withTimerOwnerAsync(async () => {
      const loaded = await this.moduleLoader.importModule(specifier, fromPath);
      const namespace = loaded.namespace || {};
      const module = this.moduleCache[loaded.id] || this.createModuleRecord(
        loaded.id,
        loaded.format,
        namespace.default ?? namespace,
        namespace,
      );
      module.url = loaded.url;
      module.format = loaded.format;
      module.exports = namespace.default ?? namespace;
      module.namespace = namespace;
      module.executionPromise = Promise.resolve(module.exports);
      module.loaded = true;
      this.moduleCache[loaded.id] = module;
      return this.buildExecuteResult(module, namespace);
    });
  }

  /**
   * Execute code as a module.
   */
  async execute(
    code: string,
    filename: string = '/index.js'
  ): Promise<IExecuteResult> {
    // Write code to virtual file system
    this.vfs.writeFileSync(filename, code);
    const format = this.formatDetector.detectFormat(filename, code);
    if (format === 'esm') {
      return this.importModule(filename, filename);
    }

    const module = this.loadModule(filename);
    return this.buildExecuteResult(module);
  }

  /**
   * Execute code as a module (async version for IRuntime interface)
   * Alias: executeSync() is the same as execute() for backward compatibility
   */
  executeSync = (
    code: string,
    filename: string = '/index.js',
  ): { exports: unknown; module: Module } => {
    this.vfs.writeFileSync(filename, code);
    const module = this.loadModule(filename);
    return {
      exports: module.exports,
      module,
    };
  };

  /**
   * Execute code as a module (async - for IRuntime interface)
   */
  async executeAsync(
    code: string,
    filename: string = '/index.js'
  ): Promise<IExecuteResult> {
    return this.execute(code, filename);
  }

  /**
   * Run a file from the virtual file system.
   */
  async runFile(filename: string): Promise<IExecuteResult> {
    const code = this.vfs.readFileSync(filename, 'utf8');
    return this.execute(code, filename);
  }

  /**
   * Alias for runFile (backward compatibility)
   */
  runFileSync = (filename: string): { exports: unknown; module: Module } => {
    const module = this.loadModule(filename);
    return {
      exports: module.exports,
      module,
    };
  };

  /**
   * Run a file from the virtual file system (async - for IRuntime interface)
   */
  async runFileAsync(filename: string): Promise<IExecuteResult> {
    return this.runFile(filename);
  }

  loadModule(filename: string): Module {
    return this.withTimerOwner(() => {
      const require = this.createLegacyRequire(pathShim.dirname(filename));
      const resolved = require.resolve(filename);
      require(filename);
      const loaded = this.moduleCache[resolved];
      if (!loaded) {
        throw new Error(`Failed to load module '${filename}'`);
      }
      return loaded;
    });
  }

  registerBuiltinModule(name: string, moduleExports: unknown): void {
    this.builtinModules[name] = moduleExports;
    this.clearCache();
  }

  /**
   * Clear the module cache
   */
  clearCache(): void {
    // Clear contents in-place so closures that captured the reference still see the cleared cache
    for (const key of Object.keys(this.moduleCache)) {
      delete this.moduleCache[key];
    }
    this.processedCodeCache.clear();
    this.resolverCaches.resolutionCache.clear();
    this.resolverCaches.packageJsonCache.clear();
    this.formatDetector.clearCache();
    this.moduleLoader.clearCache();
  }

  /**
   * Get the virtual file system
   */
  getVFS(): VirtualFS {
    return this.vfs;
  }

  /**
   * Get the process object
   */
  getProcess(): Process {
    return this.process;
  }

  getNetwork(): NetworkController {
    return this.networkController;
  }

  /**
   * Create a REPL context that evaluates expressions and persists state.
   *
   * Returns an object with an `eval` method that:
   * - Returns the value of the last expression (unlike `execute` which returns module.exports)
   * - Persists variables between calls (`var x = 1` then `x` works)
   * - Has access to `require`, `console`, `process`, `Buffer` (same as execute)
   *
   * Security: The eval runs inside a Generator's local scope via direct eval,
   * NOT in the global scope. Only the runtime's own require/console/process are
   * exposed — the same sandbox boundary as execute(). Variables created in the
   * REPL are confined to the generator's closure and cannot leak to the page.
   *
   * Note: `const`/`let` are transformed to `var` so they persist across calls
   * (var hoists to the generator's function scope, const/let are block-scoped
   * to each eval call and would be lost).
   */
  createREPL(): { eval: (code: string) => Promise<unknown> } {
    const require = this.createLegacyRequire('/');
    const consoleWrapper = createConsoleWrapper(this.options.onConsole);
    const process = this.process;
    const buffer = bufferShim.Buffer;

    // Use a Generator to maintain a persistent eval scope.
    // Generator functions preserve their local scope across yields, so
    // var declarations from eval() persist between calls. Direct eval
    // runs in the generator's scope (not global), providing isolation.
    const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
    const replGen = new GeneratorFunction(
      'require',
      'console',
      'process',
      'Buffer',
      `var __code, __result;
while (true) {
  __code = yield;
  try {
    __result = eval(__code);
    yield { value: __result, error: null };
  } catch (e) {
    yield { value: undefined, error: e };
  }
}`
    )(require, consoleWrapper, process, buffer);
    replGen.next(); // prime the generator

    return {
      async eval(code: string): Promise<unknown> {
        // Transform const/let to var for persistence across REPL calls.
        // var declarations in direct eval are added to the enclosing function
        // scope (the generator), so they survive across yields.
        const transformed = code.replace(/^\s*(const|let)\s+/gm, 'var ');

        // Try as expression first (wrapping in parens), fall back to statement.
        // replGen.next(code) sends code to the generator, which evals it and
        // yields the result — so the result is in the return value of .next().
        const exprResult = replGen.next('(' + transformed + ')').value as { value: unknown; error: unknown };
        if (!exprResult.error) {
          // Advance past the wait-for-code yield so it's ready for next call
          replGen.next();
          return exprResult.value;
        }

        // Expression parse failed — advance past wait-for-code, then try as statement
        replGen.next();
        const stmtResult = replGen.next(transformed).value as { value: unknown; error: unknown };
        if (stmtResult.error) {
          replGen.next(); // advance past wait-for-code yield
          throw stmtResult.error;
        }
        replGen.next(); // advance past wait-for-code yield
        return stmtResult.value;
      },
    };
  }
}

/**
 * Create and execute code in a new runtime.
 */
export async function execute(
  code: string,
  vfs: VirtualFS,
  options?: RuntimeOptions
): Promise<IExecuteResult> {
  const runtime = new Runtime(vfs, options);
  return runtime.execute(code);
}

// Re-export types
export type { IRuntime, IExecuteResult, IRuntimeOptions } from './runtime-interface';

export default Runtime;
