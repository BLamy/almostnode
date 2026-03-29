import { stream } from 'almostnode';

export const PROJECT_ROOT = '/project';
const SKIPPED_PATH_PREFIXES = [
  `${PROJECT_ROOT}/node_modules`,
  `${PROJECT_ROOT}/.git`,
] as const;

const { Buffer } = stream;

export interface SerializedFile {
  path: string;
  contentBase64: string;
}

function serializedFilesToMap(files: Iterable<SerializedFile>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of files) {
    if (!shouldPersistProjectPath(file.path)) {
      continue;
    }
    snapshot.set(normalizeProjectPath(file.path), file.contentBase64);
  }
  return snapshot;
}

function normalizeScopedPath(vfsPath: string, roots: readonly string[]): string {
  const normalized = vfsPath.replace(/\\/g, '/').replace(/\/+$/g, '');
  const matchesRoot = roots.some((root) => (
    normalized === root || normalized.startsWith(`${root}/`)
  ));
  if (!matchesRoot) {
    throw new Error(`Serialized file path must be under one of: ${roots.join(', ')} (${vfsPath})`);
  }
  return normalized;
}

function shouldPersistScopedPath(vfsPath: string, roots: readonly string[]): boolean {
  const normalized = vfsPath.replace(/\\/g, '/').replace(/\/+$/g, '');
  return roots.some((root) => (
    normalized === root || normalized.startsWith(`${root}/`)
  ));
}

function normalizeProjectPath(vfsPath: string): string {
  const normalized = vfsPath.replace(/\\/g, '/');
  if (
    normalized === PROJECT_ROOT
    || normalized === `${PROJECT_ROOT}/`
    || !normalized.startsWith(`${PROJECT_ROOT}/`)
  ) {
    throw new Error(`Serialized file path must be under ${PROJECT_ROOT}: ${vfsPath}`);
  }
  return normalized;
}

function toBase64(raw: unknown): string {
  if (typeof raw === 'string') {
    return Buffer.from(raw, 'utf8').toString('base64');
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString('base64');
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)).toString('base64');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString('base64');
  }
  return Buffer.from(String(raw), 'utf8').toString('base64');
}

export function shouldPersistProjectPath(vfsPath: string): boolean {
  const normalized = vfsPath.replace(/\\/g, '/');
  if (
    normalized === PROJECT_ROOT
    || normalized === `${PROJECT_ROOT}/`
    || !normalized.startsWith(`${PROJECT_ROOT}/`)
  ) {
    return false;
  }
  return !SKIPPED_PATH_PREFIXES.some((prefix) => (
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  ));
}

function collectProjectFiles(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
  },
  directoryPath: string,
  out: SerializedFile[],
): void {
  if (!shouldPersistProjectPath(directoryPath) && directoryPath !== PROJECT_ROOT) {
    return;
  }

  let entries: string[] = [];
  try {
    entries = vfs.readdirSync(directoryPath) as string[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = `${directoryPath}/${entry}`;
    try {
      const stat = vfs.statSync(fullPath);
      if (stat.isDirectory()) {
        collectProjectFiles(vfs, fullPath, out);
        continue;
      }
      if (!shouldPersistProjectPath(fullPath)) {
        continue;
      }

      const content = vfs.readFileSync(fullPath);
      out.push({
        path: normalizeProjectPath(fullPath),
        contentBase64: toBase64(content),
      });
    } catch {
      // Ignore unreadable files while collecting snapshots.
    }
  }
}

function collectScopedFiles(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
  },
  directoryPath: string,
  roots: readonly string[],
  out: SerializedFile[],
): void {
  if (!shouldPersistScopedPath(directoryPath, roots)) {
    return;
  }

  let entries: string[] = [];
  try {
    entries = vfs.readdirSync(directoryPath) as string[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = `${directoryPath}/${entry}`;
    try {
      const stat = vfs.statSync(fullPath);
      if (stat.isDirectory()) {
        collectScopedFiles(vfs, fullPath, roots, out);
        continue;
      }
      if (!shouldPersistScopedPath(fullPath, roots)) {
        continue;
      }

      const content = vfs.readFileSync(fullPath);
      out.push({
        path: normalizeScopedPath(fullPath, roots),
        contentBase64: toBase64(content),
      });
    } catch {
      // Ignore unreadable files while collecting snapshots.
    }
  }
}

export function collectProjectFilesBase64(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
  },
): SerializedFile[] {
  if (!vfs.existsSync(PROJECT_ROOT)) {
    return [];
  }

  const files: SerializedFile[] = [];
  collectProjectFiles(vfs, PROJECT_ROOT, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function collectScopedFilesBase64(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
  },
  roots: readonly string[],
): SerializedFile[] {
  const files: SerializedFile[] = [];

  for (const root of roots) {
    if (!vfs.existsSync(root)) {
      continue;
    }
    collectScopedFiles(vfs, root, roots, files);
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function ensureVfsDirectoryExists(
  vfs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  },
  directoryPath: string,
): void {
  if (!directoryPath || directoryPath === '/') return;
  if (vfs.existsSync(directoryPath)) return;
  vfs.mkdirSync(directoryPath, { recursive: true });
}

export function loadProjectFilesIntoVfs(
  vfs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    writeFileSync: (path: string, content: Buffer | Uint8Array | string) => void;
  },
  files: SerializedFile[],
): void {
  vfs.mkdirSync(PROJECT_ROOT, { recursive: true });

  for (const file of files) {
    const normalizedPath = normalizeProjectPath(file.path);
    if (!shouldPersistProjectPath(normalizedPath)) {
      continue;
    }
    const separatorIndex = normalizedPath.lastIndexOf('/');
    if (separatorIndex <= 0) continue;
    const directoryPath = normalizedPath.slice(0, separatorIndex);
    ensureVfsDirectoryExists(vfs, directoryPath);

    const content = Buffer.from(file.contentBase64, 'base64');
    vfs.writeFileSync(normalizedPath, content);
  }
}

export function replaceProjectFilesInVfs(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    writeFileSync: (path: string, content: Buffer | Uint8Array | string) => void;
    unlinkSync: (path: string) => void;
    rmdirSync: (path: string) => void;
  },
  files: SerializedFile[],
): void {
  vfs.mkdirSync(PROJECT_ROOT, { recursive: true });

  const previousMap = serializedFilesToMap(collectProjectFilesBase64(vfs));
  const nextMap = serializedFilesToMap(files);

  for (const [path, contentBase64] of nextMap.entries()) {
    if (previousMap.get(path) === contentBase64) {
      previousMap.delete(path);
      continue;
    }

    const separatorIndex = path.lastIndexOf('/');
    if (separatorIndex > 0) {
      ensureVfsDirectoryExists(vfs, path.slice(0, separatorIndex));
    }

    vfs.writeFileSync(path, Buffer.from(contentBase64, 'base64'));
    previousMap.delete(path);
  }

  for (const path of previousMap.keys()) {
    removeVfsEntryRecursive(vfs, path);
  }
}

export function replaceScopedFilesInVfs(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    readFileSync: (path: string) => unknown;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    writeFileSync: (path: string, content: Buffer | Uint8Array | string) => void;
    unlinkSync: (path: string) => void;
    rmdirSync: (path: string) => void;
  },
  roots: readonly string[],
  files: SerializedFile[],
): void {
  for (const root of roots) {
    ensureVfsDirectoryExists(vfs, root);
  }

  const previousMap = new Map<string, string>();
  for (const file of collectScopedFilesBase64(vfs, roots)) {
    previousMap.set(file.path, file.contentBase64);
  }

  const nextMap = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = normalizeScopedPath(file.path, roots);
    nextMap.set(normalizedPath, file.contentBase64);
  }

  for (const [path, contentBase64] of nextMap.entries()) {
    if (previousMap.get(path) === contentBase64) {
      previousMap.delete(path);
      continue;
    }

    const separatorIndex = path.lastIndexOf('/');
    if (separatorIndex > 0) {
      ensureVfsDirectoryExists(vfs, path.slice(0, separatorIndex));
    }

    vfs.writeFileSync(path, Buffer.from(contentBase64, 'base64'));
    previousMap.delete(path);
  }

  for (const path of previousMap.keys()) {
    removeVfsEntryRecursive(vfs, path);
  }
}

export function removeVfsEntryRecursive(
  vfs: {
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    unlinkSync: (path: string) => void;
    rmdirSync: (path: string) => void;
  },
  targetPath: string,
): void {
  let stat: { isDirectory: () => boolean };
  try {
    stat = vfs.statSync(targetPath);
  } catch {
    return;
  }

  if (!stat.isDirectory()) {
    vfs.unlinkSync(targetPath);
    return;
  }

  let entries: string[] = [];
  try {
    entries = vfs.readdirSync(targetPath) as string[];
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    removeVfsEntryRecursive(vfs, `${targetPath}/${entry}`);
  }

  try {
    vfs.rmdirSync(targetPath);
  } catch {
    // Ignore root or non-empty directory removal errors.
  }
}

export function clearProjectVfs(
  vfs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => unknown;
    statSync: (path: string) => { isDirectory: () => boolean };
    unlinkSync: (path: string) => void;
    rmdirSync: (path: string) => void;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  },
): void {
  if (!vfs.existsSync(PROJECT_ROOT)) {
    vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    return;
  }

  let entries: string[] = [];
  try {
    entries = vfs.readdirSync(PROJECT_ROOT) as string[];
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    removeVfsEntryRecursive(vfs, `${PROJECT_ROOT}/${entry}`);
  }
}

export function projectPathFromRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('relative project path cannot be empty');
  }
  return `${PROJECT_ROOT}/${normalized}`;
}
