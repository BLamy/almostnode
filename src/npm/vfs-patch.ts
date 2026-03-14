import { base64ToUint8, uint8ToBase64 } from '../utils/binary-encoding';
import type { VFSSnapshot, VFSFileEntry } from '../runtime-interface';
import type { VirtualFS } from '../virtual-fs';

export interface VFSMkdirOperation {
  type: 'mkdir';
  path: string;
}

export interface VFSWriteFileOperation {
  type: 'writeFile';
  path: string;
  content: string;
}

export interface VFSUnlinkOperation {
  type: 'unlink';
  path: string;
}

export interface VFSRmdirOperation {
  type: 'rmdir';
  path: string;
}

export type VFSPatchOperation =
  | VFSMkdirOperation
  | VFSWriteFileOperation
  | VFSUnlinkOperation
  | VFSRmdirOperation;

export interface VFSPatch {
  operations: VFSPatchOperation[];
  changedPaths: string[];
  touchesNodeModules: boolean;
  touchesPackageJson: boolean;
}

export interface ApplyVfsPatchOptions {
  chunkSize?: number;
  yieldControl?: () => Promise<void>;
}

interface SnapshotEntryRecord {
  path: string;
  type: 'file' | 'directory';
  content?: string;
}

export function createInstallSnapshot(vfs: VirtualFS, cwd: string): VFSSnapshot {
  const files: VFSFileEntry[] = [];
  const seen = new Set<string>();

  addDirectoryChain(vfs, cwd, files, seen);

  const packageJsonPath = joinPath(cwd, 'package.json');
  if (vfs.existsSync(packageJsonPath)) {
    addFileEntry(vfs, packageJsonPath, files, seen);
  }

  const nodeModulesPath = joinPath(cwd, 'node_modules');
  if (vfs.existsSync(nodeModulesPath)) {
    addNodeModulesSnapshot(vfs, nodeModulesPath, files, seen);
  }

  return { files };
}

export function diffVfsSnapshots(before: VFSSnapshot, after: VFSSnapshot): VFSPatch {
  const beforeMap = snapshotToMap(before);
  const afterMap = snapshotToMap(after);

  const unlinkOps: VFSUnlinkOperation[] = [];
  const rmdirOps: VFSRmdirOperation[] = [];
  const mkdirOps: VFSMkdirOperation[] = [];
  const writeFileOps: VFSWriteFileOperation[] = [];

  for (const [path, entry] of beforeMap) {
    if (path === '/') continue;
    const next = afterMap.get(path);
    if (next && next.type === entry.type) {
      continue;
    }

    if (entry.type === 'file') {
      unlinkOps.push({ type: 'unlink', path });
    } else {
      rmdirOps.push({ type: 'rmdir', path });
    }
  }

  for (const [path, entry] of afterMap) {
    if (path === '/') continue;
    const previous = beforeMap.get(path);
    if (!previous || previous.type !== entry.type) {
      if (entry.type === 'directory') {
        mkdirOps.push({ type: 'mkdir', path });
      } else {
        writeFileOps.push({ type: 'writeFile', path, content: entry.content || '' });
      }
      continue;
    }

    if (entry.type === 'file' && previous.content !== entry.content) {
      writeFileOps.push({ type: 'writeFile', path, content: entry.content || '' });
    }
  }

  unlinkOps.sort((left, right) => depthOf(right.path) - depthOf(left.path));
  rmdirOps.sort((left, right) => depthOf(right.path) - depthOf(left.path));
  mkdirOps.sort((left, right) => depthOf(left.path) - depthOf(right.path));
  writeFileOps.sort((left, right) => left.path.localeCompare(right.path));

  const operations: VFSPatchOperation[] = [
    ...unlinkOps,
    ...rmdirOps,
    ...mkdirOps,
    ...writeFileOps,
  ];
  const changedPaths = Array.from(new Set(operations.map((operation) => operation.path)));

  return {
    operations,
    changedPaths,
    touchesNodeModules: changedPaths.some((path) => path === '/node_modules' || path.endsWith('/node_modules') || path.includes('/node_modules/')),
    touchesPackageJson: changedPaths.some((path) => path.endsWith('/package.json')),
  };
}

export async function applyVfsPatch(
  vfs: VirtualFS,
  patch: VFSPatch,
  options: ApplyVfsPatchOptions = {},
): Promise<void> {
  const chunkSize = options.chunkSize ?? 64;
  const yieldControl = options.yieldControl || defaultYieldControl;

  for (let index = 0; index < patch.operations.length; index += 1) {
    const operation = patch.operations[index];
    switch (operation.type) {
      case 'mkdir':
        vfs.mkdirSync(operation.path, { recursive: true });
        break;
      case 'writeFile':
        vfs.writeFileSync(operation.path, base64ToUint8(operation.content));
        break;
      case 'unlink':
        if (vfs.existsSync(operation.path)) {
          vfs.unlinkSync(operation.path);
        }
        break;
      case 'rmdir':
        if (vfs.existsSync(operation.path)) {
          vfs.rmdirSync(operation.path);
        }
        break;
    }

    if ((index + 1) % chunkSize === 0 && index + 1 < patch.operations.length) {
      await yieldControl();
    }
  }
}

function snapshotToMap(snapshot: VFSSnapshot): Map<string, SnapshotEntryRecord> {
  return new Map(
    snapshot.files.map((entry) => [entry.path, {
      path: entry.path,
      type: entry.type,
      content: entry.content,
    }]),
  );
}

function addDirectoryChain(
  vfs: VirtualFS,
  targetPath: string,
  files: VFSFileEntry[],
  seen: Set<string>,
): void {
  const normalized = normalizePath(targetPath);
  const segments = normalized.split('/').filter(Boolean);
  addDirectoryEntry('/', files, seen);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    if (vfs.existsSync(current)) {
      addDirectoryEntry(current, files, seen);
    }
  }
}

/**
 * Snapshot only what the install worker needs from node_modules:
 * - Directory entries for each package (so existsSync/readdirSync works)
 * - package.json files with content (for version checks)
 * - Nested node_modules (recurse)
 *
 * Skips all other files (source code, compiled output, etc.) entirely.
 * This reduces snapshot entries from ~5000-20000 to ~200-400 for large installs,
 * preventing tab crashes from postMessage/structured-clone overhead.
 */
function addNodeModulesSnapshot(
  vfs: VirtualFS,
  nodeModulesPath: string,
  files: VFSFileEntry[],
  seen: Set<string>,
): void {
  addDirectoryEntry(nodeModulesPath, files, seen);

  for (const entry of vfs.readdirSync(nodeModulesPath)) {
    if (entry.startsWith('.')) continue;

    const childPath = joinPath(nodeModulesPath, entry);

    if (entry.startsWith('@')) {
      // Scoped packages: add scope dir, then snapshot each package inside
      addDirectoryEntry(childPath, files, seen);
      for (const scopedEntry of vfs.readdirSync(childPath)) {
        addPackageSnapshot(vfs, joinPath(childPath, scopedEntry), files, seen);
      }
    } else {
      addPackageSnapshot(vfs, childPath, files, seen);
    }
  }
}

function addPackageSnapshot(
  vfs: VirtualFS,
  pkgPath: string,
  files: VFSFileEntry[],
  seen: Set<string>,
): void {
  try {
    const stats = vfs.statSync(pkgPath);
    if (!stats.isDirectory()) return;
  } catch {
    return;
  }

  addDirectoryEntry(pkgPath, files, seen);

  // Include package.json with full content
  const pkgJsonPath = joinPath(pkgPath, 'package.json');
  if (vfs.existsSync(pkgJsonPath)) {
    addFileEntry(vfs, pkgJsonPath, files, seen);
  }

  // Recurse into nested node_modules
  const nestedNm = joinPath(pkgPath, 'node_modules');
  if (vfs.existsSync(nestedNm)) {
    addNodeModulesSnapshot(vfs, nestedNm, files, seen);
  }
}

function addDirectoryEntry(path: string, files: VFSFileEntry[], seen: Set<string>): void {
  const normalized = normalizePath(path);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  files.push({ path: normalized, type: 'directory' });
}

function addFileEntry(
  vfs: VirtualFS,
  path: string,
  files: VFSFileEntry[],
  seen: Set<string>,
): void {
  const normalized = normalizePath(path);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);

  // Only include content for package.json files — the install worker only reads
  // these (version checks). All other files are stubs (exist but empty).
  // This reduces snapshot size from ~100MB to ~500KB for large node_modules.
  const isEssential = normalized.endsWith('/package.json') || normalized === 'package.json';
  files.push({
    path: normalized,
    type: 'file',
    content: isEssential ? uint8ToBase64(vfs.readFileSync(normalized)) : '',
  });
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path.replace(/\/+/g, '/') : `/${path}`.replace(/\/+/g, '/');
}

function joinPath(parent: string, child: string): string {
  const prefix = normalizePath(parent);
  return prefix === '/' ? `/${child}` : `${prefix}/${child}`;
}

function depthOf(path: string): number {
  return normalizePath(path).split('/').filter(Boolean).length;
}

async function defaultYieldControl(): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
