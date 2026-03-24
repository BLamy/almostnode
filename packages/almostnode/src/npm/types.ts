import type { RegistryOptions, PackageManifest } from './registry';
import type { ResolvedPackage } from './resolver';
import type { VFSSnapshot } from '../runtime-interface';
import type { VFSPatch } from './vfs-patch';

export type InstallMode = 'auto' | 'worker' | 'main-thread';

export interface InstallOptions {
  registry?: string;
  save?: boolean;
  saveDev?: boolean;
  includeDev?: boolean;
  includeOptional?: boolean;
  onProgress?: (message: string) => void;
  /** Deprecated no-op. Module transformation now happens at load time. */
  transform?: boolean;
}

export interface InstallResult {
  installed: Map<string, ResolvedPackage>;
  added: string[];
}

export interface SerializableInstallOptions {
  registry?: string;
  save?: boolean;
  saveDev?: boolean;
  includeDev?: boolean;
  includeOptional?: boolean;
  transform?: boolean;
}

export interface PackageManagerMutationSummary {
  touchesNodeModules: boolean;
  touchesPackageJson: boolean;
}

export interface PackageManagerSettings {
  cwd: string;
  registry?: string;
  cache?: Map<string, PackageManifest>;
}

export interface SerializedInstallResult {
  installed: Array<[string, ResolvedPackage]>;
  added: string[];
}

export interface InstallRequestPackage {
  kind: 'package';
  packageSpec: string;
}

export interface InstallRequestPackageJson {
  kind: 'packageJson';
}

export type InstallRequest = InstallRequestPackage | InstallRequestPackageJson;

export interface InstallWorkerPayload {
  snapshot: VFSSnapshot;
  settings: Omit<PackageManagerSettings, 'cache'>;
  request: InstallRequest;
  options: SerializableInstallOptions;
}

export interface InstallWorkerResponse {
  patch: VFSPatch;
  result: SerializedInstallResult;
}

export interface PackageManagerWorkerClient {
  runInstall(
    payload: InstallWorkerPayload,
    onProgress?: ((message: string) => void) | null,
  ): Promise<InstallWorkerResponse>;
  terminate?(): void;
}

export type PackageManagerWorkerClientFactory = () => PackageManagerWorkerClient;

export interface PackageManagerOptions extends RegistryOptions {
  cwd?: string;
  installMode?: InstallMode;
  onMutation?: (summary: PackageManagerMutationSummary) => void | Promise<void>;
  workerClientFactory?: PackageManagerWorkerClientFactory;
}
