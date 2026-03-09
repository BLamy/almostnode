import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions';
import { TargetPlatform } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import type {
  IExtensionInfo,
  IGalleryExtension,
  IGalleryExtensionVersion,
  IExtensionsControlManifest,
} from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement';

export interface OpenVSXSearchResponse {
  offset: number;
  totalSize: number;
  extensions: OpenVSXSearchResult[];
}

export interface OpenVSXSearchResult {
  url?: string;
  files?: {
    download?: string;
    icon?: string;
    manifest?: string;
    readme?: string;
    changelog?: string;
    signature?: string;
  };
  name: string;
  namespace: string;
  version: string;
  timestamp?: string;
  verified?: boolean;
  downloadCount?: number;
  displayName?: string;
  description?: string;
  deprecated?: boolean;
}

export interface OpenVSXExtensionDetail extends OpenVSXSearchResult {
  namespaceDisplayName?: string;
  targetPlatform?: string;
  preRelease?: boolean;
  preview?: boolean;
  averageRating?: number;
  reviewCount?: number;
  categories?: string[];
  tags?: string[];
  homepage?: string;
  repository?: string;
  sponsorLink?: string;
  bugs?: string;
  license?: string;
  extensionKind?: string[];
  engines?: {
    vscode?: string;
  };
  dependencies?: string[];
  bundledExtensions?: string[];
  localizedLanguages?: string[];
  allVersions?: Record<string, string>;
}

export interface OpenVSXClientLike {
  search(query: string, size?: number): Promise<OpenVSXSearchResponse>;
  getLatest(namespace: string, name: string): Promise<OpenVSXExtensionDetail>;
  getManifest(detail: OpenVSXExtensionDetail): Promise<IExtensionManifest | null>;
  getReadme(detail: OpenVSXExtensionDetail): Promise<string>;
  getChangelog(detail: OpenVSXExtensionDetail): Promise<string>;
  downloadVsix(detail: OpenVSXExtensionDetail): Promise<Uint8Array>;
  getVersions?(namespace: string, name: string): Promise<IGalleryExtensionVersion[]>;
}

type FetchLike = typeof fetch;

function normalizePlatform(input?: string): TargetPlatform {
  if (!input || input === 'universal') {
    return TargetPlatform.WEB;
  }

  if (input.toLowerCase() === 'web') {
    return TargetPlatform.WEB;
  }

  return TargetPlatform.WEB;
}

function toUnixTime(value?: string): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function createGalleryAsset(uri?: string | null) {
  if (!uri) return null;
  return { uri, fallbackUri: uri };
}

export class OpenVSXClient implements OpenVSXClientLike {
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(options?: { baseUrl?: string; fetch?: FetchLike }) {
    this.fetcher = options?.fetch ?? fetch;
    this.baseUrl = (options?.baseUrl ?? 'https://open-vsx.org').replace(/\/$/, '');
  }

  async search(query: string, size = 20): Promise<OpenVSXSearchResponse> {
    const url = new URL(`${this.baseUrl}/api/-/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('size', String(size));
    const response = await this.fetcher(url);
    return response.json();
  }

  async getLatest(namespace: string, name: string): Promise<OpenVSXExtensionDetail> {
    const response = await this.fetcher(`${this.baseUrl}/api/${namespace}/${name}/latest`);
    return response.json();
  }

  async getManifest(detail: OpenVSXExtensionDetail): Promise<IExtensionManifest | null> {
    if (!detail.files?.manifest) {
      return null;
    }

    const response = await this.fetcher(detail.files.manifest);
    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async getReadme(detail: OpenVSXExtensionDetail): Promise<string> {
    if (!detail.files?.readme) {
      return '';
    }

    const response = await this.fetcher(detail.files.readme);
    return response.ok ? response.text() : '';
  }

  async getChangelog(detail: OpenVSXExtensionDetail): Promise<string> {
    if (!detail.files?.changelog) {
      return '';
    }

    const response = await this.fetcher(detail.files.changelog);
    return response.ok ? response.text() : '';
  }

  async downloadVsix(detail: OpenVSXExtensionDetail): Promise<Uint8Array> {
    if (!detail.files?.download) {
      throw new Error(`No VSIX download available for ${detail.namespace}.${detail.name}`);
    }

    const response = await this.fetcher(detail.files.download);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes;
  }

  async getVersions(namespace: string, name: string): Promise<IGalleryExtensionVersion[]> {
    const detail = await this.getLatest(namespace, name);
    const versions = Object.keys(detail.allVersions || {}).filter((version) => version !== 'latest');
    return versions.map((version) => ({
      version,
      date: detail.timestamp || new Date().toISOString(),
      isPreReleaseVersion: Boolean(detail.preRelease),
      targetPlatforms: [TargetPlatform.WEB],
    }));
  }
}

export function emptyControlManifest(): IExtensionsControlManifest {
  return {
    malicious: [],
    deprecated: {},
    search: [],
    autoUpdate: {},
  };
}

export function detailToGalleryExtension(
  detail: OpenVSXExtensionDetail,
  manifest: IExtensionManifest | null,
): IGalleryExtension {
  const id = `${detail.namespace}.${detail.name}`;
  const resourceTemplateVersion = detail.version;
  const detailsLink = `https://open-vsx.org/extension/${detail.namespace}/${detail.name}`;

  return {
    type: 'gallery',
    name: detail.name,
    identifier: {
      id,
      uuid: detail.url || id,
    },
    version: detail.version,
    displayName: detail.displayName || detail.name,
    publisherId: detail.namespace,
    publisher: detail.namespace,
    publisherDisplayName: detail.namespaceDisplayName || detail.namespace,
    description: detail.description || '',
    installCount: detail.downloadCount || 0,
    rating: detail.averageRating || 0,
    ratingCount: detail.reviewCount || 0,
    categories: detail.categories || [],
    tags: detail.tags || [],
    releaseDate: toUnixTime(detail.timestamp),
    lastUpdated: toUnixTime(detail.timestamp),
    preview: Boolean(detail.preview),
    private: false,
    hasPreReleaseVersion: Boolean(detail.preRelease),
    hasReleaseVersion: true,
    isSigned: Boolean(detail.files?.signature),
    allTargetPlatforms: [TargetPlatform.WEB],
    assets: {
      manifest: createGalleryAsset(detail.files?.manifest || undefined),
      readme: createGalleryAsset(detail.files?.readme || undefined),
      changelog: createGalleryAsset(detail.files?.changelog || undefined),
      license: null,
      repository: null,
      download: createGalleryAsset(detail.files?.download || undefined)!,
      icon: createGalleryAsset(detail.files?.icon || undefined),
      signature: createGalleryAsset(detail.files?.signature || undefined),
      coreTranslations: [],
    },
    properties: {
      dependencies: manifest?.extensionDependencies || detail.dependencies || [],
      extensionPack: manifest?.extensionPack || detail.bundledExtensions || [],
      engine: manifest?.engines?.vscode || detail.engines?.vscode,
      enabledApiProposals: manifest?.enabledApiProposals ? [...manifest.enabledApiProposals] : [],
      localizedLanguages: detail.localizedLanguages ? [...detail.localizedLanguages] : [],
      targetPlatform: normalizePlatform(detail.targetPlatform),
      isPreReleaseVersion: Boolean(detail.preRelease),
      executesCode: Boolean(manifest?.browser || manifest?.main),
    },
    detailsLink,
    ratingLink: detailsLink,
    supportLink: detail.bugs,
    publisherLink: `https://open-vsx.org/namespace/${detail.namespace}`,
    publisherSponsorLink: detail.sponsorLink,
  };
}

export function makeSinglePagePager<T>(items: T[]) {
  return {
    firstPage: items,
    total: items.length,
    pageSize: items.length || 1,
    getPage: async (pageIndex: number) => (pageIndex === 0 ? items : []),
  };
}

export function extensionInfoKey(info: IExtensionInfo): string {
  return `${info.id.toLowerCase()}@${info.version || 'latest'}`;
}
