// Walks a virtual filesystem into a nested tree the React Aria <Tree> can
// render. The VFS is the single source of truth — this is derived on every
// relevant workspace change rather than kept in a parallel store.

export interface FileNode {
  /** Absolute path — also used as the Tree item id. */
  path: string;
  /** Base name (last path segment). */
  name: string;
  type: "file" | "directory";
  /** Present for directories; omitted for files. */
  children?: FileNode[];
}

/** Minimal structural subset of the VFS used for tree building (and testing). */
export interface TreeFs {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
}

export interface BuildTreeOptions {
  /**
   * Directory base names that are shown as leaves rather than walked into.
   * Defaults to the heavy/generated directories that bog down a tree.
   */
  excludeDirs?: string[];
}

export const DEFAULT_EXCLUDED_DIRS = ["node_modules", ".git", "dist"];

function sortNodes(nodes: FileNode[]): FileNode[] {
  // Directories first, then files; each group case-insensitive alphabetical —
  // matching VS Code / Windsurf explorer ordering.
  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Build the children of `root` as a nested {@link FileNode} list. Excluded
 * directories appear as collapsed leaves (their contents are not walked).
 */
export function buildFileTree(
  fs: TreeFs,
  root: string,
  options: BuildTreeOptions = {},
): FileNode[] {
  const excluded = new Set(options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS);

  const visit = (dir: string): FileNode[] => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }

    const nodes: FileNode[] = [];
    for (const name of entries) {
      const path = `${dir}/${name}`;
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(path).isDirectory();
      } catch {
        continue;
      }

      if (!isDirectory) {
        nodes.push({ path, name, type: "file" });
        continue;
      }

      const children = excluded.has(name) ? [] : visit(path);
      nodes.push({ path, name, type: "directory", children });
    }

    return sortNodes(nodes);
  };

  if (!fs.existsSync(root)) {
    return [];
  }
  return visit(root);
}

/** Flatten a tree into a path -> node lookup (used for drop targets, menus). */
export function indexNodes(nodes: FileNode[]): Map<string, FileNode> {
  const map = new Map<string, FileNode>();
  const walk = (items: FileNode[]): void => {
    for (const node of items) {
      map.set(node.path, node);
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
}

/** Parent directory of a path (`/a/b/c` -> `/a/b`). */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** Base name of a path (`/a/b/c` -> `c`). */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
