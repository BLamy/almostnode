import * as acorn from 'acorn';

import type { ResponseData } from './shims/http';
import { Buffer } from './shims/stream';
import type { VirtualFS } from './virtual-fs';
import { ModuleResolver, type ModuleFormat, type ResolvedModuleDescriptor, extractLikelyNamedExportsFromCode } from './module-resolution';
import { simpleHash } from './utils/hash';
import { uint8ToBase64 } from './utils/binary-encoding';
import * as pathShim from './shims/path';
import { getServerBridge } from './server-bridge';

const MODULE_ROUTE_PREFIX = '/__modules__/r';
const MODULE_SOURCE_HASH_VERSION = 'module-source-v2';
const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

type TransportMode = 'service-worker' | 'data';

export interface LoadedModuleRecord {
  format: ModuleFormat;
  id: string;
  url: string;
  namespace?: Record<string, unknown>;
}

export interface ModuleGraphLoaderOptions {
  vfs: VirtualFS;
  runtimeId: string;
  builtinModules: Record<string, unknown>;
  console: Record<string, unknown>;
  process: Record<string, unknown>;
  globalObject: Record<string, unknown>;
  requireCjs: (resolvedPath: string) => unknown;
  createRequire: (fromPath: string) => {
    (id: string): unknown;
    resolve?: (id: string) => string;
    cache?: Record<string, unknown>;
  };
}

interface InteropRegistry {
  builtins: Map<string, Record<string, unknown>>;
  cjsRequire: Map<string, (resolvedPath: string) => unknown>;
  requireFactories: Map<string, ModuleGraphLoaderOptions['createRequire']>;
  moduleUrls: Map<string, Map<string, string>>;
  runtimeGlobals: Map<string, Record<string, unknown>>;
  processes: Map<string, Record<string, unknown>>;
  getRuntimeGlobal: (runtimeId: string) => Record<string, unknown>;
  getProcess: (runtimeId: string) => Record<string, unknown> | undefined;
}

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<Record<string, unknown>>;

export class ModuleGraphLoader {
  private vfs: VirtualFS;
  private runtimeId: string;
  private builtinModules: Record<string, unknown>;
  private globalObject: Record<string, unknown>;
  private requireCjs: (resolvedPath: string) => unknown;
  private createRequire: ModuleGraphLoaderOptions['createRequire'];
  private resolver: ModuleResolver;
  private transportMode: TransportMode;
  private revision = 0;
  private bridgeRegistered = false;
  private bridgeReadyPromise: Promise<void> | null = null;
  private urlCache = new Map<string, Promise<string>>();
  private sourceCache = new Map<string, Promise<string>>();
  private moduleCache = new Map<string, Promise<LoadedModuleRecord>>();

  constructor(options: ModuleGraphLoaderOptions) {
    this.vfs = options.vfs;
    this.runtimeId = options.runtimeId;
    this.builtinModules = options.builtinModules;
    this.globalObject = options.globalObject;
    this.requireCjs = options.requireCjs;
    this.createRequire = options.createRequire;
    this.resolver = new ModuleResolver(this.vfs, {
      builtinModules: this.builtinModules,
    });
    this.transportMode = this.detectTransportMode();

    const registry = getInteropRegistry();
    registry.builtins.set(this.runtimeId, this.builtinModules);
    registry.cjsRequire.set(this.runtimeId, this.requireCjs);
    registry.requireFactories.set(this.runtimeId, this.createRequire);
    if (!registry.moduleUrls.has(this.runtimeId)) {
      registry.moduleUrls.set(this.runtimeId, new Map());
    }
    registry.runtimeGlobals.set(this.runtimeId, this.globalObject);
    registry.processes.set(this.runtimeId, options.process);
  }

  clearCache(): void {
    this.revision++;
    this.resolver.clearCache();
    this.urlCache.clear();
    this.sourceCache.clear();
    this.moduleCache.clear();
  }

  async importModule(specifier: string, fromPath = '/'): Promise<LoadedModuleRecord> {
    const descriptor = this.resolve(specifier, fromPath);
    const cacheKey = this.getCacheKey(descriptor);
    const cached = this.moduleCache.get(cacheKey);
    if (cached) return cached;

    const pending = this.importResolved(descriptor).catch((error) => {
      this.moduleCache.delete(cacheKey);
      throw error;
    });
    this.moduleCache.set(cacheKey, pending);
    return pending;
  }

  resolve(specifier: string, fromPath = '/'): ResolvedModuleDescriptor {
    const fromDir = specifier.startsWith('/') && this.vfs.existsSync(specifier)
      ? pathShim.dirname(specifier)
      : pathShim.dirname(fromPath);
    return this.resolver.resolve(specifier, fromDir || '/');
  }

  async createResponse(requestUrl: string): Promise<ResponseData> {
    const url = new URL(requestUrl, typeof location !== 'undefined' ? location.origin : 'http://localhost');
    const runtimeId = url.pathname.split('/')[3];
    if (runtimeId !== this.runtimeId) {
      return this.notFound(`Unknown module runtime '${runtimeId}'`);
    }

    const encodedId = url.searchParams.get('id');
    if (!encodedId) {
      return this.notFound('Missing module id');
    }

    const resolvedId = decodeURIComponent(encodedId);
    const descriptor = this.resolveDescriptorById(resolvedId);
    const source = await this.buildModuleSource(descriptor);

    return {
      statusCode: 200,
      statusMessage: 'OK',
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(source),
    };
  }

  private async importResolved(descriptor: ResolvedModuleDescriptor): Promise<LoadedModuleRecord> {
    const url = await this.getModuleUrl(descriptor);
    const namespace = await dynamicImport(url);

    return {
      format: descriptor.format,
      id: descriptor.resolvedPath,
      url,
      namespace,
    };
  }

  private async getModuleUrl(descriptor: ResolvedModuleDescriptor): Promise<string> {
    const cacheKey = this.getCacheKey(descriptor);
    const cached = this.urlCache.get(cacheKey);
    if (cached) return cached;

    let resolve!: (value: string) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    this.urlCache.set(cacheKey, pending);

    (async () => {
      try {
        const registry = getInteropRegistry();
        if (this.transportMode === 'service-worker') {
          await this.ensureBridgeReady();
          const hash = this.getModuleSourceHash(descriptor);
          const url = this.createServiceWorkerUrl(descriptor, hash);
          registry.moduleUrls.get(this.runtimeId)?.set(url, descriptor.resolvedPath);
          resolve(url);
          return;
        }

        const source = await this.buildModuleSource(descriptor);
        const encoded = uint8ToBase64(new TextEncoder().encode(source));
        const url = `data:text/javascript;base64,${encoded}`;
        registry.moduleUrls.get(this.runtimeId)?.set(url, descriptor.resolvedPath);
        resolve(url);
      } catch (e) {
        this.urlCache.delete(cacheKey);
        reject(e);
      }
    })();

    return pending;
  }

  private async buildModuleSource(descriptor: ResolvedModuleDescriptor): Promise<string> {
    const cacheKey = this.getCacheKey(descriptor);
    const cached = this.sourceCache.get(cacheKey);
    if (cached) return cached;

    let resolve!: (value: string) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    this.sourceCache.set(cacheKey, pending);

    (async () => {
      try {
        let result: string;
        switch (descriptor.format) {
          case 'builtin':
            result = this.buildBuiltinModuleSource(descriptor);
            break;
          case 'json':
            result = this.buildJsonModuleSource(descriptor);
            break;
          case 'cjs':
            result = this.buildCjsModuleSource(descriptor);
            break;
          case 'esm':
          default:
            try {
              result = await this.buildEsmModuleSource(descriptor);
            } catch {
              // ESM parsing failed (e.g. CJS code in a "type":"module" package) — fall back to CJS wrapper
              result = this.buildCjsModuleSource(descriptor);
            }
            break;
        }
        resolve(result);
      } catch (e) {
        this.sourceCache.delete(cacheKey);
        reject(e);
      }
    })();

    return pending;
  }

  private async buildEsmModuleSource(descriptor: ResolvedModuleDescriptor): Promise<string> {
    let code = this.vfs.readFileSync(descriptor.resolvedPath, 'utf8');
    if (code.startsWith('#!')) {
      code = code.slice(code.indexOf('\n') + 1);
    }

    const rewritten = await this.rewriteEsmSpecifiers(code, descriptor.resolvedPath);
    const runtimePreamble = this.createRuntimePreamble();
    if (!rewritten.metaNeedsPreamble) {
      return [runtimePreamble, rewritten.code].join('\n');
    }

    return [
      runtimePreamble,
      `const __almostnode_url = ${JSON.stringify(`file://${descriptor.resolvedPath}`)};`,
      `const __almostnode_filename = ${JSON.stringify(descriptor.resolvedPath)};`,
      `const __almostnode_dirname = ${JSON.stringify(pathShim.dirname(descriptor.resolvedPath))};`,
      'const __almostnode_import_meta = Object.assign(Object.create(null), import.meta, {',
      '  url: __almostnode_url,',
      '  filename: __almostnode_filename,',
      '  dirname: __almostnode_dirname,',
      '});',
      rewritten.code,
    ].join('\n');
  }

  private createRuntimePreamble(): string {
    return [
      'const __almostnode_hostGlobal = Function("return globalThis")();',
      `const __almostnode_global = __almostnode_hostGlobal.__almostnodeModuleInterop.getRuntimeGlobal(${JSON.stringify(this.runtimeId)});`,
      'const globalThis = __almostnode_global;',
      'const global = __almostnode_global;',
      'const console = __almostnode_global.console;',
      'const process = __almostnode_global.process;',
      'const Buffer = __almostnode_global.Buffer;',
    ].join('\n');
  }

  private buildJsonModuleSource(descriptor: ResolvedModuleDescriptor): string {
    const value = this.vfs.readFileSync(descriptor.resolvedPath, 'utf8');
    return `const __json = ${value};\nexport default __json;\n`;
  }

  private buildBuiltinModuleSource(descriptor: ResolvedModuleDescriptor): string {
    const builtinId = descriptor.builtinId || descriptor.resolvedPath;
    const builtin = this.builtinModules[builtinId];
    const names = builtin && (typeof builtin === 'object' || typeof builtin === 'function')
      ? Object.keys(builtin).filter((name) =>
        VALID_IDENTIFIER.test(name) && name !== 'default' && name !== '__esModule' && name !== 'createRequire'
      )
      : [];

    if (builtinId === 'module') {
      return [
        `const __base = globalThis.__almostnodeModuleInterop.getBuiltin(${JSON.stringify(this.runtimeId)}, ${JSON.stringify(builtinId)});`,
        `export const createRequire = (filenameOrUrl) => globalThis.__almostnodeModuleInterop.createRequire(${JSON.stringify(this.runtimeId)}, filenameOrUrl);`,
        ...names.map((name) => `export const ${name} = __base[${JSON.stringify(name)}];`),
        'const __mod = { ...__base, createRequire };',
        'export default __mod;',
        '',
      ].join('\n');
    }

    return [
      `const __mod = globalThis.__almostnodeModuleInterop.getBuiltin(${JSON.stringify(this.runtimeId)}, ${JSON.stringify(builtinId)});`,
      ...names.map((name) => `export const ${name} = __mod[${JSON.stringify(name)}];`),
      'export default __mod;',
      '',
    ].join('\n');
  }

  private buildCjsModuleSource(descriptor: ResolvedModuleDescriptor): string {
    const code = this.vfs.readFileSync(descriptor.resolvedPath, 'utf8');
    const names = Array.from(new Set([
      ...extractLikelyNamedExportsFromCode(code),
      ...this.getRuntimeNamedExports(descriptor.resolvedPath),
    ])).filter((name) => VALID_IDENTIFIER.test(name));

    return [
      `const __mod = globalThis.__almostnodeModuleInterop.requireCjs(${JSON.stringify(this.runtimeId)}, ${JSON.stringify(descriptor.resolvedPath)});`,
      ...names.map((name) => `export const ${name} = __mod[${JSON.stringify(name)}];`),
      'export default __mod;',
      '',
    ].join('\n');
  }

  private getRuntimeNamedExports(resolvedPath: string): string[] {
    try {
      const runtimeExports = this.requireCjs(resolvedPath);
      if (!runtimeExports || (typeof runtimeExports !== 'object' && typeof runtimeExports !== 'function')) {
        return [];
      }

      return Object.keys(runtimeExports).filter((name) =>
        VALID_IDENTIFIER.test(name) && name !== 'default' && name !== '__esModule'
      );
    } catch {
      return [];
    }
  }

  private async rewriteEsmSpecifiers(
    code: string,
    filename: string,
  ): Promise<{ code: string; metaNeedsPreamble: boolean }> {
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as any;

    const replacements: Array<[number, number, string]> = [];
    let metaNeedsPreamble = false;

    const addSpecifierReplacement = async (sourceNode: { start: number; end: number; value?: string }) => {
      if (typeof sourceNode.value !== 'string') return;
      const descriptor = this.resolve(sourceNode.value, filename);
      const targetUrl = await this.getModuleUrl(descriptor);
      replacements.push([sourceNode.start, sourceNode.end, JSON.stringify(targetUrl)]);
    };

    const walk = async (node: any) => {
      if (!node || typeof node !== 'object') return;

      switch (node.type) {
        case 'ImportDeclaration':
        case 'ExportAllDeclaration':
        case 'ExportNamedDeclaration':
          if (node.source) {
            await addSpecifierReplacement(node.source);
          }
          break;
        case 'ImportExpression':
          if (node.source?.type === 'Literal') {
            await addSpecifierReplacement(node.source);
          }
          break;
        case 'MetaProperty':
          if (node.meta?.name === 'import' && node.property?.name === 'meta') {
            replacements.push([node.start, node.end, '__almostnode_import_meta']);
            metaNeedsPreamble = true;
          }
          break;
        default:
          break;
      }

      for (const key of Object.keys(node)) {
        if (key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'parent') {
          continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
          for (const child of value) {
            await walk(child);
          }
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          await walk(value);
        }
      }
    };

    await walk(ast);
    replacements.sort((a, b) => b[0] - a[0]);

    let rewritten = code;
    for (const [start, end, value] of replacements) {
      rewritten = rewritten.slice(0, start) + value + rewritten.slice(end);
    }

    return { code: rewritten, metaNeedsPreamble };
  }

  private async ensureBridgeReady(): Promise<void> {
    if (this.bridgeReadyPromise) {
      return this.bridgeReadyPromise;
    }

    this.bridgeReadyPromise = (async () => {
      const bridge = getServerBridge();
      if (!this.bridgeRegistered) {
        bridge.registerModuleProvider(this.runtimeId, (url) => this.createResponse(url));
        this.bridgeRegistered = true;
      }
      await bridge.ensureServiceWorkerReady();
    })();

    return this.bridgeReadyPromise;
  }

  private createServiceWorkerUrl(descriptor: ResolvedModuleDescriptor, hash: string): string {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}${MODULE_ROUTE_PREFIX}/${encodeURIComponent(this.runtimeId)}/${descriptor.format}/${this.revision}/${hash}?id=${encodeURIComponent(descriptor.id)}`;
  }

  private getContentHash(descriptor: ResolvedModuleDescriptor): string {
    if (descriptor.format === 'builtin') {
      return simpleHash(`builtin:${descriptor.builtinId || descriptor.resolvedPath}`);
    }

    const source = this.vfs.readFileSync(descriptor.resolvedPath, 'utf8');
    return simpleHash(`${descriptor.format}:${descriptor.resolvedPath}:${source}`);
  }

  private getModuleSourceHash(descriptor: ResolvedModuleDescriptor): string {
    if (descriptor.format === 'builtin') {
      return simpleHash(
        `${MODULE_SOURCE_HASH_VERSION}:builtin:${descriptor.builtinId || descriptor.resolvedPath}`,
      );
    }

    const source = this.vfs.readFileSync(descriptor.resolvedPath, 'utf8');
    return simpleHash(
      `${MODULE_SOURCE_HASH_VERSION}:${descriptor.format}:${descriptor.resolvedPath}:${source}`,
    );
  }

  private resolveDescriptorById(id: string): ResolvedModuleDescriptor {
    if (id.startsWith('builtin:')) {
      const builtinId = id.slice('builtin:'.length);
      return {
        id,
        resolvedPath: builtinId,
        format: 'builtin',
        builtinId,
      };
    }

    return {
      id,
      resolvedPath: id,
      format: this.resolver.detectFormat(id),
    };
  }

  private getCacheKey(descriptor: ResolvedModuleDescriptor): string {
    return `${this.runtimeId}|${this.revision}|${descriptor.format}|${descriptor.id}|${this.getContentHash(descriptor)}`;
  }

  private detectTransportMode(): TransportMode {
    const isLikelyJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
    const hasSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

    if (hasSW && !isLikelyJsdom) {
      return 'service-worker';
    }

    return 'data';
  }

  private notFound(message: string): ResponseData {
    return {
      statusCode: 404,
      statusMessage: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from(message),
    };
  }
}

function getInteropRegistry(): InteropRegistry {
  if (!(globalThis as any).__almostnodeModuleInterop) {
    const builtins = new Map<string, Record<string, unknown>>();
    const cjsRequire = new Map<string, (resolvedPath: string) => unknown>();
    const requireFactories = new Map<string, ModuleGraphLoaderOptions['createRequire']>();
    const moduleUrls = new Map<string, Map<string, string>>();
    const runtimeGlobals = new Map<string, Record<string, unknown>>();
    const processes = new Map<string, Record<string, unknown>>();

    (globalThis as any).__almostnodeModuleInterop = {
      builtins,
      cjsRequire,
      requireFactories,
      moduleUrls,
      runtimeGlobals,
      processes,
      getBuiltin(runtimeId: string, builtinId: string): unknown {
        return builtins.get(runtimeId)?.[builtinId];
      },
      requireCjs(runtimeId: string, resolvedPath: string): unknown {
        const require = cjsRequire.get(runtimeId);
        if (!require) {
          throw new Error(`Missing CommonJS interop for runtime '${runtimeId}'`);
        }
        return require(resolvedPath);
      },
      createRequire(runtimeId: string, filenameOrUrl: string) {
        const factory = requireFactories.get(runtimeId);
        if (!factory) {
          throw new Error(`Missing createRequire interop for runtime '${runtimeId}'`);
        }

        let fromPath = filenameOrUrl;
        const knownModulePath = moduleUrls.get(runtimeId)?.get(filenameOrUrl);
        if (knownModulePath) {
          fromPath = knownModulePath;
        }
        if (typeof fromPath === 'string' && fromPath.startsWith('file://')) {
          fromPath = new URL(fromPath).pathname || '/';
        }

        return factory(fromPath);
      },
      getRuntimeGlobal(runtimeId: string): Record<string, unknown> {
        const runtimeGlobal = runtimeGlobals.get(runtimeId);
        if (!runtimeGlobal) {
          throw new Error(`Missing runtime global interop for runtime '${runtimeId}'`);
        }
        return runtimeGlobal;
      },
      getProcess(runtimeId: string): Record<string, unknown> | undefined {
        return processes.get(runtimeId);
      },
    };
  }

  return (globalThis as any).__almostnodeModuleInterop as InteropRegistry;
}
