import { createNodeError, type VirtualFS } from '../virtual-fs';
import {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  createFileSystemProviderError,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type FileSystemProviderError,
  type IStat,
  type IWatchOptions,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files';
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { DisposableStore, toDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';

function toFsError(error: unknown): FileSystemProviderError {
  if (
    error instanceof Error
    && 'code' in error
    && Object.values(FileSystemProviderErrorCode).includes((error as FileSystemProviderError).code)
  ) {
    return error as FileSystemProviderError;
  }

  const nodeError = error as { code?: string; message?: string };
  switch (nodeError?.code) {
    case 'ENOENT':
      return createFileSystemProviderError(nodeError.message || 'Not found', FileSystemProviderErrorCode.FileNotFound);
    case 'EEXIST':
      return createFileSystemProviderError(nodeError.message || 'Already exists', FileSystemProviderErrorCode.FileExists);
    case 'ENOTEMPTY':
      return createFileSystemProviderError(nodeError.message || 'Directory not empty', FileSystemProviderErrorCode.Unknown);
    case 'EISDIR':
      return createFileSystemProviderError(nodeError.message || 'Is a directory', FileSystemProviderErrorCode.FileIsADirectory);
    case 'ENOTDIR':
      return createFileSystemProviderError(nodeError.message || 'Not a directory', FileSystemProviderErrorCode.FileNotADirectory);
    default:
      return createFileSystemProviderError(nodeError?.message || 'File system error', FileSystemProviderErrorCode.Unknown);
  }
}

function isWorkspaceUri(resource: URI, workspaceRoot: string): boolean {
  return resource.scheme === 'file'
    && (resource.path === workspaceRoot || resource.path.startsWith(`${workspaceRoot}/`));
}

export class VfsFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite
    | FileSystemProviderCapabilities.PathCaseSensitive;
  readonly onDidChangeCapabilities = new Emitter<void>().event;

  private readonly changeEmitter = new Emitter<readonly IFileChange[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  private readonly disposables = new DisposableStore();

  constructor(
    private readonly vfs: VirtualFS,
    private readonly workspaceRoot: string,
  ) {
    this.disposables.add(
      toDisposable(() => {
        this.changeEmitter.dispose();
      }),
    );

    const workspaceWatcher = this.vfs.watch(this.workspaceRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        return;
      }

      const fullPath = filename.startsWith(this.workspaceRoot)
        ? filename
        : `${this.workspaceRoot}/${filename}`.replace(/\/+/g, '/');
      const resource = URI.file(fullPath);
      const exists = this.vfs.existsSync(fullPath);
      const type = eventType === 'rename'
        ? (exists ? FileChangeType.ADDED : FileChangeType.DELETED)
        : FileChangeType.UPDATED;

      this.changeEmitter.fire([{ type, resource }]);
    });

    this.disposables.add(toDisposable(() => workspaceWatcher.close()));
  }

  private assertWorkspaceResource(resource: URI): string {
    if (!isWorkspaceUri(resource, this.workspaceRoot)) {
      throw createFileSystemProviderError('Not found', FileSystemProviderErrorCode.FileNotFound);
    }
    return decodeURIComponent(resource.path);
  }

  private toStat(path: string): IStat {
    const stats = this.vfs.statSync(path);
    return {
      type: stats.isDirectory() ? FileType.Directory : FileType.File,
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
      permissions: undefined,
    };
  }

  async stat(resource: URI): Promise<IStat> {
    try {
      return this.toStat(this.assertWorkspaceResource(resource));
    } catch (error) {
      throw toFsError(error);
    }
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    try {
      return this.vfs.readFileSync(this.assertWorkspaceResource(resource));
    } catch (error) {
      throw toFsError(error);
    }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    try {
      const path = this.assertWorkspaceResource(resource);
      return this.vfs.readdirSync(path).map((name) => {
        const childPath = `${path}/${name}`.replace(/\/+/g, '/');
        const childStats = this.vfs.statSync(childPath);
        return [name, childStats.isDirectory() ? FileType.Directory : FileType.File];
      });
    } catch (error) {
      throw toFsError(error);
    }
  }

  watch(resource: URI, options: IWatchOptions) {
    try {
      const path = this.assertWorkspaceResource(resource);
      const watcher = this.vfs.watch(path, { recursive: Boolean(options.recursive) }, (eventType, filename) => {
        const relative = filename || '';
        const fullPath = path === this.workspaceRoot
          ? `${this.workspaceRoot}/${relative}`.replace(/\/+/g, '/')
          : `${path}/${relative}`.replace(/\/+/g, '/');
        const exists = this.vfs.existsSync(fullPath);
        this.changeEmitter.fire([
          {
            resource: URI.file(fullPath),
            type: eventType === 'rename'
              ? (exists ? FileChangeType.ADDED : FileChangeType.DELETED)
              : FileChangeType.UPDATED,
          },
        ]);
      });

      return toDisposable(() => watcher.close());
    } catch {
      return toDisposable(() => {});
    }
  }

  async writeFile(resource: URI, content: Uint8Array, options: IFileWriteOptions): Promise<void> {
    try {
      const path = this.assertWorkspaceResource(resource);
      const exists = this.vfs.existsSync(path);
      if (!exists && !options.create) {
        throw createNodeError('ENOENT', 'writeFile', path);
      }
      if (exists && !options.overwrite) {
        throw createNodeError('EEXIST', 'writeFile', path);
      }
      this.vfs.writeFileSync(path, content);
      this.changeEmitter.fire([{ resource, type: exists ? FileChangeType.UPDATED : FileChangeType.ADDED }]);
    } catch (error) {
      throw toFsError(error);
    }
  }

  async mkdir(resource: URI): Promise<void> {
    try {
      this.vfs.mkdirSync(this.assertWorkspaceResource(resource), { recursive: true });
      this.changeEmitter.fire([{ resource, type: FileChangeType.ADDED }]);
    } catch (error) {
      throw toFsError(error);
    }
  }

  private removeRecursive(path: string): void {
    const stats = this.vfs.statSync(path);
    if (!stats.isDirectory()) {
      this.vfs.unlinkSync(path);
      return;
    }

    for (const child of this.vfs.readdirSync(path)) {
      this.removeRecursive(`${path}/${child}`.replace(/\/+/g, '/'));
    }
    this.vfs.rmdirSync(path);
  }

  async delete(resource: URI, options: IFileDeleteOptions): Promise<void> {
    try {
      const path = this.assertWorkspaceResource(resource);
      const stats = this.vfs.statSync(path);
      if (stats.isDirectory()) {
        if (options.recursive) {
          this.removeRecursive(path);
        } else {
          this.vfs.rmdirSync(path);
        }
      } else {
        this.vfs.unlinkSync(path);
      }
      this.changeEmitter.fire([{ resource, type: FileChangeType.DELETED }]);
    } catch (error) {
      throw toFsError(error);
    }
  }

  async rename(from: URI, to: URI, options: IFileOverwriteOptions): Promise<void> {
    try {
      const fromPath = this.assertWorkspaceResource(from);
      const toPath = this.assertWorkspaceResource(to);
      if (this.vfs.existsSync(toPath)) {
        if (!options.overwrite) {
          throw createNodeError('EEXIST', 'rename', toPath);
        }
        this.removeRecursive(toPath);
      }
      this.vfs.renameSync(fromPath, toPath);
      this.changeEmitter.fire([
        { resource: from, type: FileChangeType.DELETED },
        { resource: to, type: FileChangeType.ADDED },
      ]);
    } catch (error) {
      throw toFsError(error);
    }
  }
}
