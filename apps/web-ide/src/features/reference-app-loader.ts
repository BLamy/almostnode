/**
 * Flattens a nested FileTree (from the reference-apps API) into a flat
 * Record<string, string> suitable for VFS population.
 */

import type { FileTree, FileTreeNode } from '../plugins/vite-plugin-reference-apps';

/**
 * Flatten a nested FileTree into { "path/to/file.ts": "contents", ... }.
 */
export function flattenFileTree(tree: FileTree): Record<string, string> {
  const result: Record<string, string> = {};

  function walk(node: Record<string, FileTreeNode>, prefix: string) {
    for (const [name, child] of Object.entries(node)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.file) {
        result[path] = child.file.contents;
      } else if (child.directory) {
        walk(child.directory, path);
      }
    }
  }

  walk(tree, '');
  return result;
}

export interface ReferenceAppFiles {
  /** Flat map of relative path → file contents */
  files: Record<string, string>;
  /** Default file to open in editor */
  defaultFile: string;
  /** Command to run in terminal */
  runCommand: string;
}

/**
 * Fetch a reference app's file tree from the dev server API, flatten it,
 * and return it with defaults.
 */
export async function fetchReferenceApp(appPath: string): Promise<ReferenceAppFiles> {
  const res = await fetch(`/__api/reference-app/${encodeURIComponent(appPath)}/files`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to load reference app "${appPath}": ${body.error}`);
  }

  const tree: FileTree = await res.json();
  const files = flattenFileTree(tree);

  return {
    files,
    defaultFile: detectDefaultFile(files),
    runCommand: 'npm run dev',
  };
}

function detectDefaultFile(files: Record<string, string>): string {
  // Prefer HomePage or Home page
  const candidates = [
    'src/pages/HomePage.tsx',
    'src/pages/Home.tsx',
    'src/App.tsx',
    'src/main.tsx',
  ];
  for (const c of candidates) {
    if (files[c]) return c;
  }
  // Fall back to first .tsx file in src/
  const firstTsx = Object.keys(files).find((f) => f.startsWith('src/') && f.endsWith('.tsx'));
  return firstTsx || 'src/App.tsx';
}
