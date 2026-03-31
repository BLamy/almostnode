import * as acorn from 'acorn';
import { imports as resolveImports, resolve as resolveExports } from 'resolve.exports';

import type { VirtualFS } from './virtual-fs';
import type { PackageJson } from './types/package-json';
import * as pathShim from './shims/path';

export type ModuleFormat = 'esm' | 'cjs' | 'json' | 'builtin';

export interface ResolvedModuleDescriptor {
  id: string;
  resolvedPath: string;
  format: ModuleFormat;
  builtinId?: string;
}

export interface ModuleResolverOptions {
  builtinModules?: Record<string, unknown>;
}

type AstNode = {
  type?: string;
  [key: string]: unknown;
};

interface ResolverCaches {
  resolutionCache: Map<string, ResolvedModuleDescriptor | null>;
  packageJsonCache: Map<string, PackageJson | null>;
  packageTypeCache: Map<string, 'module' | 'commonjs' | null>;
}

const DEFAULT_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs',
  'fs/promises', 'fsevents', 'http', 'http2', 'https', 'inspector', 'module',
  'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process',
  'querystring', 'readline', 'readdirp', 'rollup', 'stream',
  'stream/consumers', 'stream/promises', 'string_decoder', 'tls', 'tty', 'url', 'util',
  'util/types', 'v8', 'vm', 'worker_threads', 'ws', 'zlib',
]);

const INDEX_CANDIDATES = [
  'index.js',
  'index.mjs',
  'index.cjs',
  'index.json',
  'index.ts',
  'index.tsx',
  'index.jsx',
  'index.node',
] as const;

const FILE_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.ts',
  '.tsx',
  '.jsx',
  '.node',
] as const;

export class ModuleResolver {
  private vfs: VirtualFS;
  private builtinModules: Record<string, unknown>;
  private caches: ResolverCaches;

  constructor(vfs: VirtualFS, options: ModuleResolverOptions = {}) {
    this.vfs = vfs;
    this.builtinModules = options.builtinModules || {};
    this.caches = {
      resolutionCache: new Map(),
      packageJsonCache: new Map(),
      packageTypeCache: new Map(),
    };
  }

  clearCache(): void {
    this.caches.resolutionCache.clear();
    this.caches.packageJsonCache.clear();
    this.caches.packageTypeCache.clear();
  }

  resolve(specifier: string, fromDir: string): ResolvedModuleDescriptor {
    const normalizedSpecifier = specifier.startsWith('node:')
      ? specifier.slice(5)
      : specifier;

    if (this.isBuiltin(normalizedSpecifier)) {
      return {
        id: `builtin:${normalizedSpecifier}`,
        resolvedPath: normalizedSpecifier,
        format: 'builtin',
        builtinId: normalizedSpecifier,
      };
    }

    const cacheKey = `${fromDir}|${normalizedSpecifier}`;
    const cached = this.caches.resolutionCache.get(cacheKey);
    if (cached !== undefined) {
      if (!cached) {
        throw new Error(`Cannot find module '${specifier}'`);
      }
      return cached;
    }

    let resolvedPath: string | null = null;
    if (normalizedSpecifier.startsWith('#')) {
      resolvedPath = this.resolvePackageImport(normalizedSpecifier, fromDir);
    } else if (
      normalizedSpecifier.startsWith('./') ||
      normalizedSpecifier.startsWith('../') ||
      normalizedSpecifier.startsWith('/')
    ) {
      resolvedPath = this.resolveFileSpecifier(normalizedSpecifier, fromDir);
    } else {
      resolvedPath = this.resolveNodeModulesSpecifier(normalizedSpecifier, fromDir);
    }

    if (!resolvedPath) {
      this.caches.resolutionCache.set(cacheKey, null);
      throw new Error(`Cannot find module '${specifier}'`);
    }

    const descriptor: ResolvedModuleDescriptor = {
      id: resolvedPath,
      resolvedPath,
      format: this.detectFormat(resolvedPath),
    };
    this.caches.resolutionCache.set(cacheKey, descriptor);
    return descriptor;
  }

  detectFormat(filePath: string, sourceOverride?: string): ModuleFormat {
    if (filePath.startsWith('builtin:')) return 'builtin';
    if (filePath.endsWith('.json')) return 'json';
    if (filePath.endsWith('.mjs')) return 'esm';
    if (filePath.endsWith('.cjs')) return 'cjs';

    const packageType = this.getPackageTypeForFile(filePath);

    const code = sourceOverride ?? this.safeReadFile(filePath);
    if (!code) {
      return packageType === 'module' ? 'esm' : 'cjs';
    }

    try {
      const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      }) as unknown as AstNode;
      if (hasEsmSyntax(ast)) {
        return 'esm';
      }
      if (hasCommonJsSyntax(ast)) {
        return 'cjs';
      }
    } catch {
      // Code fails to parse as ESM — treat as CJS regardless of package type
      return 'cjs';
    }

    // No ESM syntax found — trust the package.json "type" field
    if (packageType === 'module') {
      return 'esm';
    }

    return 'cjs';
  }

  private isBuiltin(specifier: string): boolean {
    return specifier in this.builtinModules || DEFAULT_BUILTINS.has(specifier);
  }

  private resolvePackageImport(specifier: string, fromDir: string): string | null {
    let searchDir = fromDir;
    while (true) {
      const pkgJsonPath = pathShim.join(searchDir, 'package.json');
      const pkg = this.getParsedPackageJson(pkgJsonPath);
      if (pkg?.imports) {
        try {
          const resolved = resolveImports(pkg, specifier);
          if (resolved && resolved.length > 0) {
            const target = pathShim.join(searchDir, resolved[0]);
            const file = this.tryResolveFile(target);
            if (file) return file;
          }
        } catch {
          // No match in this package.json imports field.
        }
      }

      const parent = pathShim.dirname(searchDir);
      if (parent === searchDir) {
        break;
      }
      searchDir = parent;
    }

    return null;
  }

  private resolveFileSpecifier(specifier: string, fromDir: string): string | null {
    const target = specifier.startsWith('/')
      ? specifier
      : pathShim.resolve(fromDir, specifier);
    return this.tryResolveFile(target);
  }

  private resolveNodeModulesSpecifier(specifier: string, fromDir: string): string | null {
    let searchDir = fromDir;
    while (true) {
      const nodeModulesDir = pathShim.join(searchDir, 'node_modules');
      const resolved = this.tryResolveFromNodeModules(nodeModulesDir, specifier);
      if (resolved) {
        return resolved;
      }

      const parent = pathShim.dirname(searchDir);
      if (parent === searchDir) {
        break;
      }
      searchDir = parent;
    }

    return this.tryResolveFromNodeModules('/node_modules', specifier);
  }

  private tryResolveFromNodeModules(nodeModulesDir: string, specifier: string): string | null {
    const parts = specifier.split('/');
    const pkgName = parts[0].startsWith('@') && parts.length > 1
      ? `${parts[0]}/${parts[1]}`
      : parts[0];

    const pkgRoot = pathShim.join(nodeModulesDir, pkgName);
    const pkgJsonPath = pathShim.join(pkgRoot, 'package.json');
    const pkg = this.getParsedPackageJson(pkgJsonPath);

    if (pkg) {
      const exportsSpecifier = this.getExportsSpecifier(pkg, pkgName, specifier);
      if (pkg.exports) {
        try {
          const resolved = resolveExports(pkg, exportsSpecifier);
          if (resolved && resolved.length > 0) {
            const fullPath = pathShim.join(pkgRoot, resolved[0]);
            const file = this.tryResolveFile(fullPath);
            if (file) return file;
          }
        } catch {
          // Fall back to module/main when exports does not match.
        }
      }

      if (specifier === pkgName) {
        const entry = pkg.module || pkg.main || 'index.js';
        const file = this.tryResolveFile(pathShim.join(pkgRoot, entry));
        if (file) return file;
      }
    }

    const directPath = this.tryResolveFile(pathShim.join(nodeModulesDir, specifier));
    if (directPath) return directPath;

    if (specifier.includes('/build/src/')) {
      const fallback = specifier.replace('/build/src/', '/build/cjs/src/');
      if (fallback !== specifier) {
        return this.tryResolveFile(pathShim.join(nodeModulesDir, fallback));
      }
    }

    return null;
  }

  private tryResolveFile(basePath: string): string | null {
    if (this.vfs.existsSync(basePath)) {
      try {
        const stats = this.vfs.statSync(basePath);
        if (stats.isFile()) {
          return basePath;
        }
        const indexPath = this.resolveDirectoryIndex(basePath);
        if (indexPath) return indexPath;
      } catch {
        // Ignore stat failures and continue to extension probing.
      }
    }

    for (const extension of FILE_EXTENSIONS) {
      const withExt = `${basePath}${extension}`;
      if (this.vfs.existsSync(withExt)) {
        return withExt;
      }
    }

    return null;
  }

  private resolveDirectoryIndex(dirPath: string): string | null {
    for (const candidate of INDEX_CANDIDATES) {
      const indexPath = pathShim.join(dirPath, candidate);
      if (this.vfs.existsSync(indexPath)) {
        return indexPath;
      }
    }
    return null;
  }

  private getParsedPackageJson(pkgPath: string): PackageJson | null {
    if (this.caches.packageJsonCache.has(pkgPath)) {
      return this.caches.packageJsonCache.get(pkgPath)!;
    }

    try {
      const parsed = JSON.parse(this.vfs.readFileSync(pkgPath, 'utf8')) as PackageJson;
      this.caches.packageJsonCache.set(pkgPath, parsed);
      return parsed;
    } catch {
      this.caches.packageJsonCache.set(pkgPath, null);
      return null;
    }
  }

  private getPackageTypeForFile(filePath: string): 'module' | 'commonjs' | null {
    const directory = pathShim.dirname(filePath);
    if (this.caches.packageTypeCache.has(directory)) {
      return this.caches.packageTypeCache.get(directory)!;
    }

    let searchDir = directory;
    while (true) {
      const pkgJsonPath = pathShim.join(searchDir, 'package.json');
      const pkg = this.getParsedPackageJson(pkgJsonPath);
      if (pkg) {
        const type = pkg.type === 'module' ? 'module' : 'commonjs';
        this.caches.packageTypeCache.set(directory, type);
        return type;
      }

      const parent = pathShim.dirname(searchDir);
      if (parent === searchDir) {
        break;
      }
      searchDir = parent;
    }

    this.caches.packageTypeCache.set(directory, null);
    return null;
  }

  private getExportsSpecifier(pkg: PackageJson, pkgName: string, specifier: string): string {
    const declaredName = typeof pkg.name === 'string' ? pkg.name : null;
    if (!declaredName || declaredName === pkgName) {
      return specifier;
    }
    if (specifier === pkgName) {
      return declaredName;
    }
    if (specifier.startsWith(`${pkgName}/`)) {
      return `${declaredName}${specifier.slice(pkgName.length)}`;
    }
    return specifier;
  }

  private safeReadFile(filePath: string): string {
    try {
      return this.vfs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }
}

function hasEsmSyntax(ast: AstNode): boolean {
  const body = Array.isArray(ast.body) ? ast.body as AstNode[] : [];

  if (body.some((node) => node.type === 'ImportDeclaration' || String(node.type).startsWith('Export'))) {
    return true;
  }

  let found = false;

  const walk = (node: unknown, functionDepth: number) => {
    if (found || !node || typeof node !== 'object') {
      return;
    }

    const current = node as AstNode;

    if (
      current.type === 'MetaProperty'
      && (current.meta as AstNode | undefined)?.name === 'import'
      && (current.property as AstNode | undefined)?.name === 'meta'
    ) {
      found = true;
      return;
    }

    if (functionDepth === 0 && (current.type === 'AwaitExpression' || (current.type === 'ForOfStatement' && current.await === true))) {
      found = true;
      return;
    }

    const nextFunctionDepth = functionDepth + (isFunctionNode(current) ? 1 : 0);

    for (const [key, value] of Object.entries(current)) {
      if (
        key === 'start'
        || key === 'end'
        || key === 'loc'
        || key === 'range'
        || key === 'parent'
        || key === 'type'
      ) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const child of value) {
          walk(child, nextFunctionDepth);
          if (found) return;
        }
      } else {
        walk(value, nextFunctionDepth);
        if (found) return;
      }
    }
  };

  for (const node of body) {
    walk(node, 0);
    if (found) {
      return true;
    }
  }

  return false;
}

function hasCommonJsSyntax(ast: AstNode): boolean {
  const body = Array.isArray(ast.body) ? ast.body as AstNode[] : [];
  let found = false;

  const walk = (node: unknown) => {
    if (found || !node || typeof node !== 'object') {
      return;
    }

    const current = node as AstNode;

    if (
      current.type === 'CallExpression'
      && (current.callee as AstNode | undefined)?.type === 'Identifier'
      && (current.callee as { name?: string }).name === 'require'
    ) {
      found = true;
      return;
    }

    if (current.type === 'AssignmentExpression' && isCommonJsExportTarget(current.left as AstNode | undefined)) {
      found = true;
      return;
    }

    if (
      current.type === 'Identifier'
      && (((current as { name?: string }).name === '__dirname') || ((current as { name?: string }).name === '__filename'))
    ) {
      found = true;
      return;
    }

    for (const [key, value] of Object.entries(current)) {
      if (
        key === 'start'
        || key === 'end'
        || key === 'loc'
        || key === 'range'
        || key === 'parent'
        || key === 'type'
      ) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const child of value) {
          walk(child);
          if (found) return;
        }
      } else {
        walk(value);
        if (found) return;
      }
    }
  };

  for (const node of body) {
    walk(node);
    if (found) {
      return true;
    }
  }

  return false;
}

function isCommonJsExportTarget(node: AstNode | undefined): boolean {
  if (!node || node.type !== 'MemberExpression') {
    return false;
  }

  const object = node.object as AstNode | undefined;
  const property = node.property as AstNode | undefined;
  const propertyName = property && 'name' in property
    ? (property as { name?: string }).name
    : property && 'value' in property
      ? String((property as { value?: unknown }).value)
      : undefined;

  if (object?.type === 'Identifier' && (object as { name?: string }).name === 'exports') {
    return true;
  }

  if (
    object?.type === 'Identifier'
    && (object as { name?: string }).name === 'module'
    && propertyName === 'exports'
  ) {
    return true;
  }

  return isCommonJsExportTarget(object);
}

function isFunctionNode(node: AstNode): boolean {
  return node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression';
}

export function extractLikelyNamedExportsFromCode(code: string): string[] {
  const names = new Set<string>();

  for (const match of code.matchAll(/exports\.(\w+)\s*=/g)) {
    if (match[1] !== 'default' && match[1] !== '__esModule') {
      names.add(match[1]);
    }
  }

  const exportHelperMatch = code.match(/__export\(\w+,\s*\{([^}]+)\}/);
  if (exportHelperMatch) {
    for (const match of exportHelperMatch[1].matchAll(/(\w+)\s*:/g)) {
      if (match[1] !== 'default' && match[1] !== '__esModule') {
        names.add(match[1]);
      }
    }
  }

  return [...names];
}
