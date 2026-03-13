import {
  IExtensionGalleryManifestService,
  IExtensionManagementServerService,
  IExtensionService,
  IExtensionsWorkbenchService,
  IFileService,
  IUserDataProfileService,
  IWebExtensionsScannerService,
  IWorkbenchExtensionEnablementService,
  IWorkbenchExtensionManagementService,
  StandaloneServices,
  SyncDescriptor,
} from '@codingame/monaco-vscode-api';
import type { IEditorOverrideServices } from '@codingame/monaco-vscode-api/vscode/vs/editor/standalone/browser/standaloneServices';
import { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import { VSBuffer } from '@codingame/monaco-vscode-api/vscode/vs/base/common/buffer';
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { MarkdownString } from '@codingame/monaco-vscode-api/vscode/vs/base/common/htmlContent';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { ExtensionGalleryManifestStatus, ExtensionGalleryResourceType } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionGalleryManifest';
import { InstallOperation } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement';
import type {
  IExtensionsControlManifest,
  IGalleryExtension,
  IGalleryExtensionVersion,
  ILocalExtension,
  IQueryOptions,
  ITranslation,
  InstallExtensionEvent,
  InstallExtensionInfo,
  InstallExtensionResult,
  InstallOptions,
  Metadata,
  StatisticType,
  UninstallExtensionEvent,
  UninstallExtensionInfo,
  UninstallOptions,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement';
import {
  IExtensionGalleryService,
  IExtensionManagementService,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement.service';
import {
  ExtensionType,
  TargetPlatform,
  type IExtension,
  type IExtensionIdentifier,
  type IExtensionManifest,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import {
  EnablementState,
  ExtensionInstallLocation,
  type IExtensionManagementServer,
  type IResourceExtension,
  type IScannedExtension,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionsWorkbenchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService';
import { assessExtensionManifest } from './extension-compat';
import { emptyControlManifest, extensionInfoKey, detailToGalleryExtension, makeSinglePagePager, type OpenVSXClientLike } from './open-vsx';
import { unpackVsix, writeExtensionArchive } from './vsix';

const DISABLED_EXTENSIONS_STORAGE_KEY = 'almostnode.webide.disabledExtensions.v1';
const EXTENSION_INSTALL_ROOT = URI.file('/.almostnode-vscode/extensions');
const EXTENSION_DOWNLOAD_ROOT = URI.file('/.almostnode-vscode/downloads');

function getCurrentProfileLocation(): URI {
  return StandaloneServices.get(IUserDataProfileService).currentProfile.extensionsResource;
}

function splitExtensionId(id: string): { namespace: string; name: string } | null {
  const [namespace, ...nameParts] = id.split('.');
  const name = nameParts.join('.');

  if (!namespace || !name) {
    return null;
  }

  return { namespace, name };
}

function sanitizeFileComponent(value: string): string {
  return value.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
}

function isEnabledState(state: EnablementState): boolean {
  return state === EnablementState.EnabledGlobally || state === EnablementState.EnabledWorkspace;
}

function getExtensionInstallLocation(extension: { manifest: IExtensionManifest; identifier: IExtensionIdentifier; version: string }): URI {
  const id = sanitizeFileComponent(extension.identifier.id);
  const version = sanitizeFileComponent(extension.version);
  return URI.joinPath(EXTENSION_INSTALL_ROOT, `${id}-${version}`);
}

function now(): number {
  return Date.now();
}

type DeltaCapableExtensionService = IExtensionService & {
  deltaExtensions(toAdd: IExtension[], toRemove: IExtension[]): Promise<void>;
};

function getDeltaExtensionService(): DeltaCapableExtensionService {
  return StandaloneServices.get(IExtensionService) as DeltaCapableExtensionService;
}

async function syncRuntimeExtensions(toAdd: IExtension[], toRemove: IExtension[]): Promise<void> {
  try {
    await Promise.race([
      getDeltaExtensionService().deltaExtensions(toAdd, toRemove),
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(() => reject(new Error('Timed out while syncing runtime extensions.')), 3000);
      }),
    ]);
  } catch (error) {
    console.warn('[almostnode webide] Runtime extension sync did not complete.', error);
  }
}

function toLocalExtension(scanned: IScannedExtension): ILocalExtension {
  return {
    ...scanned,
    isWorkspaceScoped: false,
    isMachineScoped: false,
    isApplicationScoped: Boolean(scanned.metadata?.isApplicationScoped),
    publisherId: scanned.metadata?.publisherId || scanned.identifier.uuid || null,
    installedTimestamp: scanned.metadata?.installedTimestamp || now(),
    isPreReleaseVersion: Boolean(scanned.metadata?.preRelease),
    hasPreReleaseVersion: Boolean(scanned.metadata?.hasPreReleaseVersion || scanned.metadata?.preRelease),
    private: Boolean(scanned.metadata?.private),
    preRelease: Boolean(scanned.metadata?.preRelease),
    updated: Boolean(scanned.metadata?.updated),
    pinned: Boolean(scanned.metadata?.pinned),
    source: (scanned.metadata?.source as 'gallery' | 'resource' | 'vsix') || 'gallery',
    size: Number(scanned.metadata?.size || 0),
  };
}

function toResourceExtension(local: ILocalExtension): IResourceExtension {
  return {
    type: 'resource',
    identifier: local.identifier,
    location: local.location,
    manifest: local.manifest,
    readmeUri: local.readmeUrl,
    changelogUri: local.changelogUrl,
  };
}

async function ensureFolder(fileService: IFileService, resource: URI): Promise<void> {
  await fileService.createFolder(resource);
}

async function readUriBytes(fileService: IFileService, resource: URI): Promise<Uint8Array> {
  if (resource.scheme === 'http' || resource.scheme === 'https') {
    const response = await fetch(resource.toString(true));
    return new Uint8Array(await response.arrayBuffer());
  }

  const result = await fileService.readFile(resource);
  return result.value.buffer;
}

class AlmostnodeExtensionGalleryManifestService {
  readonly _serviceBrand = undefined;

  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChangeExtensionGalleryManifest = this.changeEmitter.event;
  readonly onDidChangeExtensionGalleryManifestStatus = Event.None;

  constructor(private readonly baseUrl: string) {}

  get extensionGalleryManifestStatus() {
    return ExtensionGalleryManifestStatus.Available;
  }

  async getExtensionGalleryManifest() {
    const root = this.baseUrl.replace(/\/$/, '');
    return {
      version: '1',
      resources: [
        { id: `${root}/vscode/gallery`, type: ExtensionGalleryResourceType.ExtensionQueryService },
        { id: `${root}/vscode/unpkg/{publisher}/{name}/{version}/{path}`, type: ExtensionGalleryResourceType.ExtensionResourceUri },
        { id: `${root}/extension/{publisher}/{name}`, type: ExtensionGalleryResourceType.ExtensionDetailsViewUri },
        { id: `${root}/extension/{publisher}/{name}`, type: ExtensionGalleryResourceType.ExtensionRatingViewUri },
      ],
      capabilities: {
        extensionQuery: {},
      },
    };
  }
}

class AlmostnodeWorkbenchExtensionEnablementService {
  readonly _serviceBrand = undefined;

  private readonly changedEmitter = new Emitter<readonly IExtension[]>();
  readonly onEnablementChanged = this.changedEmitter.event;
  private readonly disabledIds = new Set<string>();

  constructor() {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const raw = localStorage.getItem(DISABLED_EXTENSIONS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const values = JSON.parse(raw) as string[];
      for (const value of values) {
        this.disabledIds.add(value.toLowerCase());
      }
    } catch {
      localStorage.removeItem(DISABLED_EXTENSIONS_STORAGE_KEY);
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(DISABLED_EXTENSIONS_STORAGE_KEY, JSON.stringify([...this.disabledIds]));
  }

  getEnablementState(extension: IExtension): EnablementState {
    return this.disabledIds.has(extension.identifier.id.toLowerCase())
      ? EnablementState.DisabledGlobally
      : EnablementState.EnabledGlobally;
  }

  getEnablementStates(extensions: IExtension[]): EnablementState[] {
    return extensions.map((extension) => this.getEnablementState(extension));
  }

  getDependenciesEnablementStates(): [IExtension, EnablementState][] {
    return [];
  }

  canChangeEnablement(extension: IExtension): boolean {
    return !extension.isBuiltin;
  }

  canChangeWorkspaceEnablement(): boolean {
    return false;
  }

  isEnabled(extension: IExtension): boolean {
    return !this.disabledIds.has(extension.identifier.id.toLowerCase());
  }

  isEnabledEnablementState(state: EnablementState): boolean {
    return isEnabledState(state);
  }

  isDisabledGlobally(extension: IExtension): boolean {
    return this.disabledIds.has(extension.identifier.id.toLowerCase());
  }

  async setEnablement(extensions: IExtension[], state: EnablementState): Promise<boolean[]> {
    const enable = isEnabledState(state);
    const extensionService = getDeltaExtensionService();
    const scannerService = StandaloneServices.get(IWebExtensionsScannerService);
    const profileLocation = getCurrentProfileLocation();
    const changed: IExtension[] = [];

    for (const extension of extensions) {
      if (!this.canChangeEnablement(extension)) {
        continue;
      }

      const id = extension.identifier.id.toLowerCase();
      const wasEnabled = !this.disabledIds.has(id);
      if (enable === wasEnabled) {
        continue;
      }

      if (enable) {
        this.disabledIds.delete(id);
      } else {
        this.disabledIds.add(id);
      }
      changed.push(extension);
    }

    this.persist();

    for (const extension of changed) {
      if (enable) {
        const scanned = await scannerService.scanExistingExtension(extension.location, extension.type, profileLocation);
        if (scanned) {
          await syncRuntimeExtensions([scanned], []);
        }
      } else {
        await syncRuntimeExtensions([], [extension]);
      }
    }

    if (changed.length > 0) {
      this.changedEmitter.fire(changed);
    }

    return changed.map(() => false);
  }

  async updateExtensionsEnablementsWhenWorkspaceTrustChanges(): Promise<void> {
    return;
  }
}

class AlmostnodeWorkbenchExtensionManagementService {
  readonly _serviceBrand = undefined;
  readonly preferPreReleases = false;

  private readonly onInstallEmitter = new Emitter<InstallExtensionEvent>();
  readonly onInstallExtension = this.onInstallEmitter.event;

  private readonly didInstallEmitter = new Emitter<readonly InstallExtensionResult[]>();
  readonly onDidInstallExtensions = this.didInstallEmitter.event;
  readonly onProfileAwareDidInstallExtensions = this.didInstallEmitter.event;

  private readonly onUninstallEmitter = new Emitter<UninstallExtensionEvent>();
  readonly onUninstallExtension = this.onUninstallEmitter.event;

  private readonly didUninstallEmitter = new Emitter<{ identifier: IExtensionIdentifier; profileLocation: URI; error?: string }>();
  readonly onDidUninstallExtension = this.didUninstallEmitter.event;
  readonly onProfileAwareDidUninstallExtension = this.didUninstallEmitter.event;

  private readonly didUpdateMetadataEmitter = new Emitter<{ profileLocation: URI; local: ILocalExtension }>();
  readonly onDidUpdateExtensionMetadata = this.didUpdateMetadataEmitter.event;
  readonly onProfileAwareDidUpdateExtensionMetadata = this.didUpdateMetadataEmitter.event;

  private readonly didChangeProfileEmitter = new Emitter<{ added: ILocalExtension[]; removed: ILocalExtension[] }>();
  readonly onDidChangeProfile = this.didChangeProfileEmitter.event;

  private readonly didEnableExtensionsEmitter = new Emitter<IExtension[]>();
  readonly onDidEnableExtensions = this.didEnableExtensionsEmitter.event;

  readonly server: IExtensionManagementServer = {
    id: 'web',
    label: 'Browser',
    extensionManagementService: this,
  };

  constructor(
    private readonly galleryService: AlmostnodeExtensionGalleryService,
    private readonly enablementService: AlmostnodeWorkbenchExtensionEnablementService,
  ) {
    this.enablementService.onEnablementChanged((extensions) => {
      const enabled = extensions.filter((extension) => this.enablementService.isEnabled(extension));
      if (enabled.length > 0) {
        this.didEnableExtensionsEmitter.fire(enabled);
      }
    });
  }

  private get fileService(): IFileService {
    return StandaloneServices.get(IFileService);
  }

  private get extensionService(): DeltaCapableExtensionService {
    return getDeltaExtensionService();
  }

  private get scannerService(): IWebExtensionsScannerService {
    return StandaloneServices.get(IWebExtensionsScannerService);
  }

  private get currentProfileLocation(): URI {
    return getCurrentProfileLocation();
  }

  private async installFromBytes(
    source: URI | IGalleryExtension,
    bytes: Uint8Array,
    installOptions?: InstallOptions,
  ): Promise<ILocalExtension> {
    const archive = unpackVsix(bytes);
    const compatibility = assessExtensionManifest(archive.manifest);

    if (!compatibility.compatible) {
      throw new Error(compatibility.reason || 'The extension is not compatible with the browser workbench.');
    }

    const identifier = {
      id: `${archive.manifest.publisher}.${archive.manifest.name}`,
    };
    const location = getExtensionInstallLocation({
      manifest: archive.manifest,
      identifier,
      version: archive.manifest.version,
    });

    await ensureFolder(this.fileService, EXTENSION_INSTALL_ROOT);
    if (await this.fileService.exists(location)) {
      await this.fileService.del(location, { recursive: true });
    }
    await ensureFolder(this.fileService, location);
    await writeExtensionArchive(this.fileService, location, archive);

    const metadata: Metadata = {
      id: `${identifier.id}@${archive.manifest.version}`,
      publisherId: archive.manifest.publisher,
      publisherDisplayName: archive.manifest.publisher,
      installedTimestamp: now(),
      preRelease: false,
      hasPreReleaseVersion: false,
      source: source instanceof URI ? 'vsix' : 'gallery',
      isBuiltin: false,
      isSystem: false,
      size: bytes.byteLength,
    };

    const scanned = await this.scannerService.addExtension(location, metadata, this.currentProfileLocation);
    const local = toLocalExtension(scanned);

    if (this.enablementService.isEnabled(local)) {
      await syncRuntimeExtensions([scanned], []);
    }

    this.didChangeProfileEmitter.fire({ added: [local], removed: [] });
    this.didInstallEmitter.fire([
      {
        identifier: local.identifier,
        operation: InstallOperation.Install,
        source,
        local,
        profileLocation: this.currentProfileLocation,
      },
    ]);

    return local;
  }

  async zip(): Promise<URI> {
    throw new Error('Zipping extensions is not supported in the browser workbench.');
  }

  async getManifest(vsix: URI): Promise<IExtensionManifest> {
    const bytes = await readUriBytes(this.fileService, vsix);
    return unpackVsix(bytes).manifest;
  }

  async install(vsix: URI, options?: InstallOptions): Promise<ILocalExtension> {
    const bytes = await readUriBytes(this.fileService, vsix);
    return this.installFromBytes(vsix, bytes, options);
  }

  async canInstall(extension: IGalleryExtension): Promise<true | MarkdownString> {
    const manifest = await this.galleryService.getManifest(extension);
    const compatibility = assessExtensionManifest(manifest || {
      name: extension.name,
      publisher: extension.publisher,
      version: extension.version,
      engines: { vscode: '*' },
    });

    if (compatibility.compatible) {
      return true;
    }

    return new MarkdownString(compatibility.reason || 'This extension is not compatible with the browser workbench.');
  }

  async installFromGallery(extension: IGalleryExtension, options?: InstallOptions): Promise<ILocalExtension> {
    this.onInstallEmitter.fire({
      identifier: extension.identifier,
      source: extension,
      profileLocation: this.currentProfileLocation,
      applicationScoped: options?.isApplicationScoped,
      workspaceScoped: options?.isWorkspaceScoped,
    });

    const detail = await this.galleryService.resolveDetail(extension);
    const bytes = await this.galleryService.downloadBytes(detail);
    return this.installFromBytes(extension, bytes, options);
  }

  async installGalleryExtensions(extensions: InstallExtensionInfo[]): Promise<InstallExtensionResult[]> {
    const results: InstallExtensionResult[] = [];

    for (const item of extensions) {
      try {
        const local = await this.installFromGallery(item.extension, item.options);
        results.push({
          identifier: item.extension.identifier,
          operation: InstallOperation.Install,
          source: item.extension,
          local,
          profileLocation: this.currentProfileLocation,
        });
      } catch (error) {
        results.push({
          identifier: item.extension.identifier,
          operation: InstallOperation.Install,
          source: item.extension,
          error: error as Error,
          profileLocation: this.currentProfileLocation,
        });
      }
    }

    this.didInstallEmitter.fire(results);
    return results;
  }

  async installFromLocation(location: URI): Promise<ILocalExtension> {
    const bytes = await readUriBytes(this.fileService, location);
    return this.installFromBytes(location, bytes);
  }

  async installExtensionsFromProfile(): Promise<ILocalExtension[]> {
    return [];
  }

  async uninstall(extension: ILocalExtension, options?: UninstallOptions): Promise<void> {
    this.onUninstallEmitter.fire({
      identifier: extension.identifier,
      profileLocation: this.currentProfileLocation,
      applicationScoped: options?.donotIncludePack,
      workspaceScoped: false,
    });

    if (this.enablementService.isEnabled(extension)) {
      await syncRuntimeExtensions([], [extension]);
    }

    const scanned = await this.scannerService.scanExistingExtension(
      extension.location,
      extension.type,
      this.currentProfileLocation,
    );

    if (scanned) {
      await this.scannerService.removeExtension(scanned, this.currentProfileLocation);
    }

    if (await this.fileService.exists(extension.location)) {
      await this.fileService.del(extension.location, { recursive: true });
    }

    this.didChangeProfileEmitter.fire({ added: [], removed: [extension] });
    this.didUninstallEmitter.fire({
      identifier: extension.identifier,
      profileLocation: this.currentProfileLocation,
    });
  }

  async uninstallExtensions(extensions: UninstallExtensionInfo[]): Promise<void> {
    for (const item of extensions) {
      await this.uninstall(item.extension, item.options);
    }
  }

  async toggleApplicationScope(extension: ILocalExtension): Promise<ILocalExtension> {
    return this.updateMetadata(extension, { isApplicationScoped: !extension.isApplicationScoped });
  }

  async getInstalled(type?: ExtensionType, profileLocation = this.currentProfileLocation): Promise<ILocalExtension[]> {
    const installed = await this.scannerService.scanUserExtensions(profileLocation, { skipInvalidExtensions: false });
    return installed
      .filter((extension) => (type == null ? true : extension.type === type))
      .map((extension) => toLocalExtension(extension));
  }

  async getExtensionsControlManifest(): Promise<IExtensionsControlManifest> {
    return emptyControlManifest();
  }

  async copyExtensions(): Promise<void> {
    return;
  }

  async updateMetadata(local: ILocalExtension, metadata: Partial<Metadata>): Promise<ILocalExtension> {
    const updated = await this.scannerService.updateMetadata(local, metadata, this.currentProfileLocation);
    const next = toLocalExtension(updated);
    this.didUpdateMetadataEmitter.fire({
      profileLocation: this.currentProfileLocation,
      local: next,
    });
    return next;
  }

  async resetPinnedStateForAllUserExtensions(pinned: boolean): Promise<void> {
    const installed = await this.getInstalled(ExtensionType.User);
    await Promise.all(installed.map((extension) => this.updateMetadata(extension, { pinned })));
  }

  async download(extension: IGalleryExtension, operation: InstallOperation): Promise<URI> {
    await ensureFolder(this.fileService, EXTENSION_DOWNLOAD_ROOT);
    const resource = URI.joinPath(
      EXTENSION_DOWNLOAD_ROOT,
      `${sanitizeFileComponent(extension.identifier.id)}-${sanitizeFileComponent(extension.version)}.vsix`,
    );
    await this.galleryService.download(extension, resource);
    return resource;
  }

  registerParticipant(): void {
    return;
  }

  async getTargetPlatform(): Promise<TargetPlatform> {
    return TargetPlatform.WEB;
  }

  async cleanUp(): Promise<void> {
    return;
  }

  async getExtensions(locations: URI[]): Promise<IResourceExtension[]> {
    const extensions = await Promise.all(
      locations.map(async (location) => {
        const manifest = await this.scannerService.scanExtensionManifest(location);
        if (!manifest) {
          return null;
        }
        return {
          type: 'resource',
          identifier: { id: `${manifest.publisher}.${manifest.name}` },
          location,
          manifest,
        } satisfies IResourceExtension;
      }),
    );

    return extensions.filter((extension): extension is IResourceExtension => Boolean(extension));
  }

  getInstalledWorkspaceExtensionLocations(): URI[] {
    return [];
  }

  async getInstalledWorkspaceExtensions(): Promise<ILocalExtension[]> {
    return [];
  }

  async getInstallableServers(extension: IGalleryExtension): Promise<IExtensionManagementServer[]> {
    const canInstall = await this.canInstall(extension);
    return canInstall === true ? [this.server] : [];
  }

  async installVSIX(location: URI): Promise<ILocalExtension> {
    return this.installFromLocation(location);
  }

  async installResourceExtension(extension: IResourceExtension): Promise<ILocalExtension> {
    const scanned = await this.scannerService.addExtension(extension.location, { source: 'resource' }, this.currentProfileLocation);
    const local = toLocalExtension(scanned);
    if (this.enablementService.isEnabled(local)) {
      await syncRuntimeExtensions([scanned], []);
    }
    return local;
  }

  async updateFromGallery(gallery: IGalleryExtension, extension: ILocalExtension, installOptions?: InstallOptions): Promise<ILocalExtension> {
    await this.uninstall(extension);
    return this.installFromGallery(gallery, installOptions);
  }

  async requestPublisherTrust(): Promise<void> {
    return;
  }

  isPublisherTrusted(): boolean {
    return true;
  }

  getTrustedPublishers() {
    return [];
  }

  trustPublishers(): void {
    return;
  }

  untrustPublishers(): void {
    return;
  }
}

class AlmostnodeExtensionManagementServerService {
  readonly _serviceBrand = undefined;
  readonly localExtensionManagementServer = null;
  readonly remoteExtensionManagementServer = null;

  constructor(private readonly managementService: AlmostnodeWorkbenchExtensionManagementService) {}

  get webExtensionManagementServer() {
    return this.managementService.server;
  }

  getExtensionManagementServer(): IExtensionManagementServer {
    return this.managementService.server;
  }

  getExtensionInstallLocation(): ExtensionInstallLocation {
    return ExtensionInstallLocation.Web;
  }
}

class AlmostnodeExtensionGalleryService {
  readonly _serviceBrand = undefined;

  private readonly detailCache = new Map<string, ReturnType<typeof detailCacheValue>>();

  constructor(private readonly client: OpenVSXClientLike) {}

  isEnabled(): boolean {
    return true;
  }

  private async cacheExtension(detail: Awaited<ReturnType<OpenVSXClientLike['getLatest']>>) {
    const manifest = await this.client.getManifest(detail);
    const gallery = detailToGalleryExtension(detail, manifest);
    this.detailCache.set(extensionInfoKey({ id: gallery.identifier.id, version: gallery.version }), {
      detail,
      manifest,
      gallery,
    });
    return { detail, manifest, gallery };
  }

  async resolveDetail(extension: IGalleryExtension) {
    const key = extensionInfoKey({ id: extension.identifier.id, version: extension.version });
    const cached = this.detailCache.get(key);
    if (cached) {
      return cached.detail;
    }

    const split = splitExtensionId(extension.identifier.id);
    if (!split) {
      throw new Error(`Invalid extension identifier: ${extension.identifier.id}`);
    }

    const { namespace, name } = split;
    const detail = await this.client.getLatest(namespace, name);
    return (await this.cacheExtension(detail)).detail;
  }

  async downloadBytes(detail: Awaited<ReturnType<OpenVSXClientLike['getLatest']>>): Promise<Uint8Array> {
    return this.client.downloadVsix(detail);
  }

  async query(
    options: IQueryOptions,
    _token?: CancellationToken,
  ): Promise<ReturnType<typeof makeSinglePagePager<IGalleryExtension>>> {
    const query = (options.text || '').trim().replace(/^@web\s*/i, '');
    const result = await this.client.search(query, options.pageSize || 20);

    const entries = await Promise.all(result.extensions.map(async (entry) => {
      const detail = await this.client.getLatest(entry.namespace, entry.name);
      return this.cacheExtension(detail);
    }));

    const firstPage = entries
      .filter(({ manifest }) => {
        if (!manifest) return false;
        return assessExtensionManifest(manifest).compatible;
      })
      .map(({ gallery }) => gallery);

    return makeSinglePagePager(firstPage);
  }

  async getExtensions(
    extensionInfos: ReadonlyArray<{ id: string; version?: string }>,
    _optionsOrToken?: unknown,
    _token?: CancellationToken,
  ): Promise<IGalleryExtension[]> {
    const items = await Promise.all(extensionInfos.map(async (info) => {
      const key = extensionInfoKey(info);
      const cached = this.detailCache.get(key);
      if (cached) {
        return cached.gallery;
      }

      const split = splitExtensionId(info.id);
      if (!split) {
        return null;
      }

      try {
        const detail = await this.client.getLatest(split.namespace, split.name);
        return (await this.cacheExtension(detail)).gallery;
      } catch {
        return null;
      }
    }));

    return items.filter((item): item is IGalleryExtension => item != null);
  }

  async isExtensionCompatible(
    extension: IGalleryExtension,
    _includePreRelease = false,
    _targetPlatform = TargetPlatform.WEB,
  ): Promise<boolean> {
    const manifest = await this.getManifest(extension);
    if (!manifest) {
      return false;
    }
    return assessExtensionManifest(manifest).compatible;
  }

  async getCompatibleExtension(
    extension: IGalleryExtension,
    _includePreRelease = false,
    _targetPlatform = TargetPlatform.WEB,
  ): Promise<IGalleryExtension | null> {
    return (await this.isExtensionCompatible(extension)) ? extension : null;
  }

  async getAllCompatibleVersions(
    extensionIdentifier: IExtensionIdentifier,
    _includePreRelease = false,
    _targetPlatform = TargetPlatform.WEB,
  ): Promise<IGalleryExtensionVersion[]> {
    const split = splitExtensionId(extensionIdentifier.id);
    if (!split) {
      return [];
    }

    const { namespace, name } = split;
    const versions = this.client.getVersions ? await this.client.getVersions(namespace, name) : [];
    return versions;
  }

  async getAllVersions(extensionIdentifier: IExtensionIdentifier): Promise<IGalleryExtensionVersion[]> {
    return this.getAllCompatibleVersions(extensionIdentifier);
  }

  async download(
    extension: IGalleryExtension,
    location: URI,
    _operation?: InstallOperation,
  ): Promise<void> {
    const detail = await this.resolveDetail(extension);
    const bytes = await this.downloadBytes(detail);
    await ensureFolder(StandaloneServices.get(IFileService), EXTENSION_DOWNLOAD_ROOT);
    await StandaloneServices.get(IFileService).writeFile(location, VSBuffer.wrap(bytes));
  }

  async downloadSignatureArchive(extension: IGalleryExtension, location: URI): Promise<void> {
    const detail = await this.resolveDetail(extension);
    if (!detail.files?.signature) {
      throw new Error('No signature archive is available for this extension.');
    }
    const response = await fetch(detail.files.signature);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await StandaloneServices.get(IFileService).writeFile(location, VSBuffer.wrap(bytes));
  }

  async reportStatistic(
    _publisher: string,
    _name: string,
    _version: string,
    _type: StatisticType,
  ): Promise<void> {
    return;
  }

  async getReadme(extension: IGalleryExtension, _token?: CancellationToken): Promise<string> {
    const detail = await this.resolveDetail(extension);
    return this.client.getReadme(detail);
  }

  async getManifest(extension: IGalleryExtension, _token?: CancellationToken): Promise<IExtensionManifest | null> {
    const detail = await this.resolveDetail(extension);
    return this.client.getManifest(detail);
  }

  async getChangelog(extension: IGalleryExtension, _token?: CancellationToken): Promise<string> {
    const detail = await this.resolveDetail(extension);
    return this.client.getChangelog(detail);
  }

  async getCoreTranslation(): Promise<ITranslation | null> {
    return null;
  }

  async getExtensionsControlManifest(): Promise<IExtensionsControlManifest> {
    return emptyControlManifest();
  }
}

function detailCacheValue(detail: Awaited<ReturnType<OpenVSXClientLike['getLatest']>>, manifest: IExtensionManifest | null, gallery: IGalleryExtension) {
  return { detail, manifest, gallery };
}

export interface ExtensionServiceOverrideBundle {
  overrides: IEditorOverrideServices;
  galleryService: AlmostnodeExtensionGalleryService;
  managementService: AlmostnodeWorkbenchExtensionManagementService;
  enablementService: AlmostnodeWorkbenchExtensionEnablementService;
}

export function createExtensionServiceOverrides(client: OpenVSXClientLike, galleryBaseUrl: string): ExtensionServiceOverrideBundle {
  const galleryService = new AlmostnodeExtensionGalleryService(client);
  const enablementService = new AlmostnodeWorkbenchExtensionEnablementService();
  const managementService = new AlmostnodeWorkbenchExtensionManagementService(galleryService, enablementService);
  const serverService = new AlmostnodeExtensionManagementServerService(managementService);
  const manifestService = new AlmostnodeExtensionGalleryManifestService(galleryBaseUrl);

  const overrides: IEditorOverrideServices = {
    [IExtensionGalleryService.toString()]: galleryService,
    [IExtensionManagementService.toString()]: managementService,
    [IWorkbenchExtensionManagementService.toString()]: managementService,
    [IExtensionManagementServerService.toString()]: serverService,
    [IWorkbenchExtensionEnablementService.toString()]: enablementService,
    [IExtensionGalleryManifestService.toString()]: manifestService,
    [IExtensionsWorkbenchService.toString()]: new SyncDescriptor(ExtensionsWorkbenchService, [], true),
  };

  return {
    overrides,
    galleryService,
    managementService,
    enablementService,
  };
}
