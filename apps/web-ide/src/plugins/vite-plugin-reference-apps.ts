/**
 * Vite plugin for loading reference apps from builder-assets.
 *
 * 1. Virtual module `virtual:reference-apps-manifest` — list of available reference apps
 * 2. Dev server middleware `GET /__api/reference-app/{path}/files` — merged FileTree
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { Plugin, ViteDevServer } from 'vite';

// ── Types ──

export interface ReferenceAppEntry {
  path: string;      // e.g. "basic/TodoApp"
  category: string;  // e.g. "basic"
  name: string;      // e.g. "TodoApp"
}

interface BlockJson {
  path: string;
  version: string;
  files: Array<{ src: string; dst: string }>;
  database?: string;
  dependentBlocks?: string[];
  storeUpdate?: {
    importLine: string;
    reducerLine: string;
  };
  dependencies?: Record<string, string>;
}

/** Nested FileTree: each node is either a file or a directory containing children. */
export interface FileTreeNode {
  file?: { contents: string };
  directory?: Record<string, FileTreeNode>;
}

export type FileTree = Record<string, FileTreeNode>;

// Files to skip from builder-assets (almostnode has its own equivalents)
const SKIP_PREFIXES = ['netlify/', 'shared-node/', 'tests/', '.env'];
const SKIP_FILES = new Set(['netlify.toml', '.env.example', 'block.json', 'templateVersion.txt', 'features.md', 'CHANGELOG.md', 'README.md']);

function shouldSkipFile(relPath: string): boolean {
  if (SKIP_FILES.has(relPath)) return true;
  return SKIP_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

// ── Helpers ──

function readBlockJson(dir: string): BlockJson | null {
  const blockJsonPath = join(dir, 'block.json');
  if (!existsSync(blockJsonPath)) return null;
  return JSON.parse(readFileSync(blockJsonPath, 'utf8'));
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function setNestedFile(tree: FileTree, filePath: string, contents: string): void {
  const parts = filePath.split('/');
  const fileName = parts.pop()!;
  let current = tree;

  for (const part of parts) {
    if (!current[part]) {
      current[part] = { directory: {} };
    }
    current = current[part].directory!;
  }

  current[fileName] = { file: { contents } };
}

/**
 * Scan referenceApps directory and return the list of available apps.
 */
function scanReferenceApps(referenceAppsDir: string): ReferenceAppEntry[] {
  const entries: ReferenceAppEntry[] = [];

  if (!existsSync(referenceAppsDir)) return entries;

  for (const category of readdirSync(referenceAppsDir, { withFileTypes: true })) {
    if (!category.isDirectory() || category.name.startsWith('.')) continue;
    const categoryDir = join(referenceAppsDir, category.name);

    for (const app of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      // Some apps are nested one more level (backends/BankingData/AccountViewer)
      const blockJson = readBlockJson(join(categoryDir, app.name));
      if (blockJson) {
        entries.push({
          path: `${category.name}/${app.name}`,
          category: category.name,
          name: app.name,
        });
      } else {
        // Check sub-apps (e.g. backends/BankingData/AccountViewer)
        const subDir = join(categoryDir, app.name);
        for (const subApp of readdirSync(subDir, { withFileTypes: true })) {
          if (!subApp.isDirectory()) continue;
          if (readBlockJson(join(subDir, subApp.name))) {
            entries.push({
              path: `${category.name}/${app.name}/${subApp.name}`,
              category: category.name,
              name: `${app.name}/${subApp.name}`,
            });
          }
        }
      }
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Resolve all dependent blocks recursively, returning them in dependency order.
 * Also collects storeUpdate injections.
 */
function resolveBlocks(
  blockPaths: string[],
  builderAssetsDir: string,
  visited: Set<string> = new Set(),
): { blockDirs: Array<{ dir: string; blockJson: BlockJson }>; storeUpdates: Array<{ importLine: string; reducerLine: string }> } {
  const result: Array<{ dir: string; blockJson: BlockJson }> = [];
  const storeUpdates: Array<{ importLine: string; reducerLine: string }> = [];

  for (const blockPath of blockPaths) {
    if (visited.has(blockPath)) continue;
    visited.add(blockPath);

    const dir = join(builderAssetsDir, blockPath);
    const blockJson = readBlockJson(dir);
    if (!blockJson) continue;

    // Resolve nested dependencies first
    if (blockJson.dependentBlocks?.length) {
      const nested = resolveBlocks(blockJson.dependentBlocks, builderAssetsDir, visited);
      result.push(...nested.blockDirs);
      storeUpdates.push(...nested.storeUpdates);
    }

    result.push({ dir, blockJson });

    if (blockJson.storeUpdate) {
      storeUpdates.push(blockJson.storeUpdate);
    }
  }

  return { blockDirs: result, storeUpdates };
}

/**
 * Build a merged FileTree for a reference app.
 */
function buildReferenceAppFileTree(appPath: string, builderAssetsDir: string): FileTree {
  const referenceAppsDir = join(builderAssetsDir, 'referenceApps');
  const appDir = join(referenceAppsDir, appPath);
  const appBlockJson = readBlockJson(appDir);
  if (!appBlockJson) {
    throw new Error(`No block.json found for reference app: ${appPath}`);
  }

  const tree: FileTree = {};

  // 1. Resolve and apply all dependent blocks (appTemplate first, then blocks)
  const dependentBlocks = appBlockJson.dependentBlocks || [];
  const { blockDirs, storeUpdates } = resolveBlocks(dependentBlocks, builderAssetsDir);

  for (const { dir, blockJson } of blockDirs) {
    for (const { src, dst } of blockJson.files) {
      if (shouldSkipFile(dst)) continue;
      const srcPath = join(dir, src);
      if (!existsSync(srcPath)) continue;
      try {
        const stat = statSync(srcPath);
        if (!stat.isFile()) continue;
        const contents = readFileSync(srcPath, 'utf8');
        setNestedFile(tree, dst, contents);
      } catch {
        // Skip unreadable files
      }
    }
  }

  // 2. Overlay app-specific files
  for (const { src, dst } of appBlockJson.files) {
    if (shouldSkipFile(dst)) continue;
    const srcPath = join(appDir, src);
    if (!existsSync(srcPath)) continue;
    try {
      const stat = statSync(srcPath);
      if (!stat.isFile()) continue;
      const contents = readFileSync(srcPath, 'utf8');
      setNestedFile(tree, dst, contents);
    } catch {
      // Skip
    }
  }

  // 3. Apply store updates (inject reducer imports/properties)
  if (storeUpdates.length > 0) {
    applyStoreUpdates(tree, storeUpdates);
  }

  return tree;
}

/**
 * Apply storeUpdate injections to src/store/index.ts in the FileTree.
 */
function applyStoreUpdates(tree: FileTree, updates: Array<{ importLine: string; reducerLine: string }>): void {
  // Navigate to src/store/index.ts
  const storeNode = tree.src?.directory?.store?.directory?.['index.ts'];
  if (!storeNode?.file) return;

  let content = storeNode.file.contents;

  for (const { importLine, reducerLine } of updates) {
    // Only inject if not already present (app overlay may already have them)
    if (!content.includes(importLine)) {
      content = content.replace('// InsertReducerImport', `${importLine}\n// InsertReducerImport`);
    }
    if (!content.includes(reducerLine)) {
      content = content.replace('// InsertReducerProperty', `${reducerLine}\n    // InsertReducerProperty`);
    }
  }

  storeNode.file.contents = content;
}

// ── Plugin ──

const VIRTUAL_ID = 'virtual:reference-apps-manifest';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function referenceAppsPlugin(options: { builderAssetsDir: string }): Plugin {
  const { builderAssetsDir } = options;
  const referenceAppsDir = join(builderAssetsDir, 'referenceApps');

  return {
    name: 'reference-apps',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;
      const apps = scanReferenceApps(referenceAppsDir);
      return `export default ${JSON.stringify(apps)};`;
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const prefix = '/__api/reference-app/';
        const suffix = '/files';

        if (!req.url?.startsWith(prefix) || !req.url.endsWith(suffix)) {
          return next();
        }

        const appPath = decodeURIComponent(req.url.slice(prefix.length, -suffix.length));

        try {
          const fileTree = buildReferenceAppFileTree(appPath, builderAssetsDir);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(fileTree));
        } catch (error) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: (error as Error).message }));
        }
      });
    },
  };
}
