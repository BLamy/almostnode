import { VirtualFS } from '../virtual-fs';
import {
  deserializeInstallResult,
  executeInstallRequest,
  listInstalledPackages,
  toSerializableInstallOptions,
} from './core';
import { applyVfsPatch, createInstallSnapshot } from './vfs-patch';
import { NpmInstallWorkerClient } from './worker-client';
import { almostnodeDebugError, almostnodeDebugLog } from '../utils/debug';
import type {
  InstallMode,
  InstallOptions,
  InstallRequest,
  InstallResult,
  PackageManagerMutationSummary,
  PackageManagerOptions,
  PackageManagerSettings,
  PackageManagerWorkerClient,
} from './types';
import type { RegistryOptions } from './registry';

/**
 * npm Package Manager for VirtualFS
 */
export class PackageManager {
  private vfs: VirtualFS;
  private cwd: string;
  private registryOptions: RegistryOptions;
  private installMode: InstallMode;
  private onMutation: ((summary: PackageManagerMutationSummary) => void | Promise<void>) | null;
  private workerClientFactory: () => PackageManagerWorkerClient;
  private workerClient: PackageManagerWorkerClient | null = null;

  constructor(vfs: VirtualFS, options: PackageManagerOptions = {}) {
    this.vfs = vfs;
    this.cwd = options.cwd || '/';
    this.registryOptions = {
      registry: options.registry,
      cache: options.cache || new Map(),
    };
    this.installMode = options.installMode || 'auto';
    this.onMutation = options.onMutation || null;
    this.workerClientFactory = options.workerClientFactory || (() => new NpmInstallWorkerClient());
  }

  /**
   * Install a package and its dependencies
   */
  async install(
    packageSpec: string,
    options: InstallOptions = {}
  ): Promise<InstallResult> {
    return this.executeInstallRequest({ kind: 'package', packageSpec }, options);
  }

  /**
   * Install all dependencies from package.json
   */
  async installFromPackageJson(options: InstallOptions = {}): Promise<InstallResult> {
    return this.executeInstallRequest({ kind: 'packageJson' }, options);
  }

  /**
   * List installed packages
   */
  list(): Record<string, string> {
    return listInstalledPackages(this.vfs, this.cwd);
  }

  private async executeInstallRequest(
    request: InstallRequest,
    options: InstallOptions,
  ): Promise<InstallResult> {
    if (this.shouldUseWorker()) {
      almostnodeDebugLog('npm', `[almostnode DEBUG] npm worker start: ${formatInstallRequest(request)} cwd=${this.cwd}`);
      try {
        return await this.installInWorker(request, options);
      } catch (error) {
        const workerMessage = toErrorMessage(error);
        almostnodeDebugError('npm', `[almostnode DEBUG] npm worker failed: ${formatInstallRequest(request)} -> ${workerMessage}`);
        this.workerClient?.terminate?.();
        this.workerClient = null;
        options.onProgress?.('npm: worker install failed; retrying on main thread...');

        try {
          const result = await this.installInMainThread(request, options);
          almostnodeDebugLog('npm', `[almostnode DEBUG] npm main-thread retry succeeded: ${formatInstallRequest(request)} cwd=${this.cwd}`);
          return result;
        } catch (mainThreadError) {
          const mainThreadMessage = toErrorMessage(mainThreadError);
          almostnodeDebugError(
            'npm',
            `[almostnode DEBUG] npm main-thread retry failed: ${formatInstallRequest(request)} -> ${mainThreadMessage}`,
          );
          options.onProgress?.('npm: install failed after worker retry and main-thread retry.');
          throw new Error(`worker install failed: ${workerMessage}; main-thread retry failed: ${mainThreadMessage}`);
        }
      }
    }

    return this.installInMainThread(request, options);
  }

  private async installInMainThread(
    request: InstallRequest,
    options: InstallOptions,
  ): Promise<InstallResult> {
    const result = await executeInstallRequest(this.vfs, this.getSettings(), request, options);
    await this.notifyMutation({
      touchesNodeModules: result.added.length > 0,
      touchesPackageJson: request.kind === 'package' && !!(options.save || options.saveDev),
    });
    return result;
  }

  private shouldUseWorker(): boolean {
    if (this.installMode === 'main-thread') {
      return false;
    }
    return typeof Worker !== 'undefined';
  }

  private async installInWorker(
    request: InstallRequest,
    options: InstallOptions,
  ): Promise<InstallResult> {
    const client = this.workerClient || this.workerClientFactory();
    this.workerClient = client;
    const snapshot = createInstallSnapshot(this.vfs, this.cwd);

    const response = await client.runInstall(
      {
        snapshot,
        settings: {
          cwd: this.cwd,
          registry: options.registry || this.registryOptions.registry,
        },
        request,
        options: toSerializableInstallOptions(options),
      },
      options.onProgress || null,
    );
    almostnodeDebugLog(
      'npm',
      `[almostnode DEBUG] npm worker patch: ${formatInstallRequest(request)} operations=${response.patch.operations.length} changedPaths=${response.patch.changedPaths.length} snapshotEntries=${snapshot.files.length}`,
    );

    if (response.patch.operations.length > 0) {
      options.onProgress?.(`Applying ${response.patch.operations.length} file changes...`);
      await applyVfsPatch(this.vfs, response.patch);
      options.onProgress?.('Install changes applied');
      almostnodeDebugLog(
        'npm',
        `[almostnode DEBUG] npm worker patch applied: ${formatInstallRequest(request)} operations=${response.patch.operations.length}`,
      );
    } else {
      almostnodeDebugLog('npm', `[almostnode DEBUG] npm worker patch applied: ${formatInstallRequest(request)} operations=0`);
    }

    await this.notifyMutation({
      touchesNodeModules: response.patch.touchesNodeModules,
      touchesPackageJson: response.patch.touchesPackageJson,
    });

    return deserializeInstallResult(response.result);
  }

  private getSettings(): PackageManagerSettings {
    return {
      cwd: this.cwd,
      registry: this.registryOptions.registry,
      cache: this.registryOptions.cache,
    };
  }

  private async notifyMutation(summary: PackageManagerMutationSummary): Promise<void> {
    await this.onMutation?.(summary);
  }
}

function formatInstallRequest(request: InstallRequest): string {
  if (request.kind === 'package') {
    return `package:${request.packageSpec}`;
  }
  return 'packageJson';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Convenience function for quick installs
export async function install(
  packageSpec: string,
  vfs: VirtualFS,
  options?: InstallOptions
): Promise<InstallResult> {
  const pm = new PackageManager(vfs);
  return pm.install(packageSpec, options);
}

// Re-export types and modules
export { Registry } from './registry';
export type { RegistryOptions, PackageVersion, PackageManifest } from './registry';
export type { ResolvedPackage, ResolveOptions } from './resolver';
export type { ExtractOptions } from './tarball';
export type {
  InstallMode,
  InstallOptions,
  InstallResult,
  PackageManagerMutationSummary,
  PackageManagerOptions,
} from './types';
export { normalizeBin, parsePackageSpec, serializeInstallResult, deserializeInstallResult } from './core';
