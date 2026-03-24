import type { VirtualFS } from 'almostnode';
import type { DesktopBridge } from './bridge';
import {
  PROJECT_ROOT,
  collectProjectFilesBase64,
  ensureVfsDirectoryExists,
  projectPathFromRelative,
  removeVfsEntryRecursive,
  shouldPersistProjectPath,
  type SerializedFile,
} from './project-snapshot';

const FLUSH_DEBOUNCE_MS = 120;

export interface ProjectFileWriteOp {
  type: 'write';
  path: string;
  contentBase64: string;
}

export interface ProjectFileDeleteOp {
  type: 'delete';
  path: string;
}

export type ProjectFileApplyOp = ProjectFileWriteOp | ProjectFileDeleteOp;

export interface HostProjectFileChangedPayload {
  kind: 'changed' | 'deleted';
  relativePath: string;
  contentBase64?: string;
  eventType?: string;
}

function serializedFilesToMap(files: SerializedFile[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of files) {
    if (!shouldPersistProjectPath(file.path)) continue;
    snapshot.set(file.path, file.contentBase64);
  }
  return snapshot;
}

export function diffSerializedFiles(
  previousFiles: Iterable<SerializedFile> | Map<string, string>,
  nextFiles: SerializedFile[],
): ProjectFileApplyOp[] {
  const previousMap = previousFiles instanceof Map
    ? new Map(previousFiles)
    : serializedFilesToMap(Array.from(previousFiles));
  const nextMap = serializedFilesToMap(nextFiles);
  const ops: ProjectFileApplyOp[] = [];

  for (const [path, contentBase64] of nextMap.entries()) {
    if (previousMap.get(path) === contentBase64) {
      previousMap.delete(path);
      continue;
    }
    previousMap.delete(path);
    ops.push({ type: 'write', path, contentBase64 });
  }

  for (const path of previousMap.keys()) {
    ops.push({ type: 'delete', path });
  }

  ops.sort((left, right) => left.path.localeCompare(right.path));
  return ops;
}

export class ProjectMirrorService {
  private readonly lastMirrored = new Map<string, string>();
  private watcher: { close: () => void } | null = null;
  private flushTimer: number | null = null;
  private flushInFlight: Promise<void> | null = null;

  constructor(
    private readonly vfs: VirtualFS,
    private readonly bridge: DesktopBridge,
    initialFiles: SerializedFile[] = [],
  ) {
    const initialSnapshot = serializedFilesToMap(initialFiles);
    for (const [path, contentBase64] of initialSnapshot.entries()) {
      this.lastMirrored.set(path, contentBase64);
    }
  }

  start(): void {
    if (this.watcher) return;
    this.watcher = this.vfs.watch(PROJECT_ROOT, { recursive: true }, () => {
      this.scheduleFlush();
    });
    this.scheduleFlush();
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  scheduleFlush(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
    }

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async flushNow(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
      return;
    }

    this.flushInFlight = (async () => {
      const nextFiles = collectProjectFilesBase64(this.vfs);
      const ops = diffSerializedFiles(this.lastMirrored, nextFiles);
      if (ops.length === 0) {
        return;
      }

      await this.bridge.invoke('project-files:apply-ops', { ops });
      this.lastMirrored.clear();
      for (const file of nextFiles) {
        this.lastMirrored.set(file.path, file.contentBase64);
      }
    })().catch((error) => {
      console.error('[Project Mirror] Failed to flush VFS changes to disk:', error);
    }).finally(() => {
      this.flushInFlight = null;
    });

    await this.flushInFlight;
  }

  applyHostChange(payload: HostProjectFileChangedPayload): void {
    if (!payload || typeof payload.relativePath !== 'string') {
      return;
    }

    let projectPath: string;
    try {
      projectPath = projectPathFromRelative(payload.relativePath);
    } catch {
      return;
    }

    if (!shouldPersistProjectPath(projectPath)) {
      return;
    }

    if (payload.kind === 'deleted') {
      this.lastMirrored.delete(projectPath);
      removeVfsEntryRecursive(this.vfs, projectPath);
      return;
    }

    if (payload.kind !== 'changed' || typeof payload.contentBase64 !== 'string') {
      return;
    }

    const separatorIndex = projectPath.lastIndexOf('/');
    if (separatorIndex > 0) {
      ensureVfsDirectoryExists(this.vfs, projectPath.slice(0, separatorIndex));
    }

    this.lastMirrored.set(projectPath, payload.contentBase64);
    this.vfs.writeFileSync(projectPath, Buffer.from(payload.contentBase64, 'base64'));
  }
}
