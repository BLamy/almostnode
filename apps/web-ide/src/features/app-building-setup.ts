import type { VirtualFS } from 'almostnode';
import type { AppBuildingConfig } from './project-db';

export const APP_BUILDING_CONFIG_PATH = '/__almostnode/keychain/app-building-config.json';
export const DEFAULT_APP_BUILDING_IMAGE_REF = 'ghcr.io/replayio/app-building:latest';
export const DEFAULT_APP_BUILDING_REPOSITORY_CLONE_URL = 'https://github.com/replayio/app-building/';
export const DEFAULT_APP_BUILDING_REPOSITORY_BASE_BRANCH = 'main';

export interface AppBuildingSetupDraft {
  flyAppName: string;
  flyApiToken: string;
  infisicalClientId: string;
  infisicalClientSecret: string;
  infisicalProjectId: string;
  infisicalEnvironment: string;
  repositoryCloneUrl: string;
  repositoryBaseBranch: string;
  imageRef: string;
}

export interface AppBuildingRepositorySummary {
  name: string;
  fullName: string;
  htmlUrl: string;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function normalizeFlyApiToken(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^(FlyV1|Bearer)\s+/i, '')
    .trim();
}

function ensureParentDir(vfs: VirtualFS, filePath: string): void {
  const parentPath = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  if (parentPath !== '/' && !vfs.existsSync(parentPath)) {
    vfs.mkdirSync(parentPath, { recursive: true });
  }
}

export function normalizeAppBuildingSetupDraft(
  value?: Partial<AppBuildingSetupDraft> | null,
): AppBuildingSetupDraft {
  return {
    flyAppName: String(value?.flyAppName || '').trim(),
    flyApiToken: normalizeFlyApiToken(value?.flyApiToken),
    infisicalClientId: String(value?.infisicalClientId || '').trim(),
    infisicalClientSecret: String(value?.infisicalClientSecret || '').trim(),
    infisicalProjectId: String(value?.infisicalProjectId || '').trim(),
    infisicalEnvironment: String(value?.infisicalEnvironment || '').trim(),
    repositoryCloneUrl: String(
      value?.repositoryCloneUrl || DEFAULT_APP_BUILDING_REPOSITORY_CLONE_URL,
    ).trim() || DEFAULT_APP_BUILDING_REPOSITORY_CLONE_URL,
    repositoryBaseBranch: String(
      value?.repositoryBaseBranch || DEFAULT_APP_BUILDING_REPOSITORY_BASE_BRANCH,
    ).trim() || DEFAULT_APP_BUILDING_REPOSITORY_BASE_BRANCH,
    imageRef: String(value?.imageRef || '').trim(),
  };
}

export function validateAppBuildingSetupDraft(
  draft: AppBuildingSetupDraft,
): string | null {
  if (!draft.flyAppName) {
    return 'Fly app name is required.';
  }
  if (!draft.flyApiToken) {
    return 'Fly API token is required.';
  }
  if (!draft.infisicalClientId) {
    return 'Infisical client ID is required.';
  }
  if (!draft.infisicalClientSecret) {
    return 'Infisical client secret is required.';
  }
  if (!draft.infisicalProjectId) {
    return 'Infisical project ID is required.';
  }
  if (!draft.infisicalEnvironment) {
    return 'Infisical environment is required.';
  }
  return null;
}

export function summarizeAppBuildingRepository(
  cloneUrl: string,
): AppBuildingRepositorySummary {
  const normalized = cloneUrl.trim();

  const sshMatch = normalized.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/i);
  const fullName = (sshMatch?.[1] || httpsMatch?.[1] || '').replace(/^\/+|\/+$/g, '');

  if (fullName.includes('/')) {
    const parts = fullName.split('/');
    const name = parts[parts.length - 1] || fullName;
    return {
      name,
      fullName,
      htmlUrl: `https://github.com/${fullName}`,
    };
  }

  const fallbackName = normalized
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.git$/i, '')
    || normalized;

  return {
    name: fallbackName,
    fullName: fallbackName,
    htmlUrl: '',
  };
}

export function readAppBuildingSetup(vfs: VirtualFS): AppBuildingSetupDraft {
  if (!vfs.existsSync(APP_BUILDING_CONFIG_PATH)) {
    return normalizeAppBuildingSetupDraft();
  }

  try {
    const raw = vfs.readFileSync(APP_BUILDING_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppBuildingSetupDraft>;
    return normalizeAppBuildingSetupDraft(parsed);
  } catch {
    return normalizeAppBuildingSetupDraft();
  }
}

export function writeAppBuildingSetup(
  vfs: VirtualFS,
  draft: AppBuildingSetupDraft,
): void {
  ensureParentDir(vfs, APP_BUILDING_CONFIG_PATH);
  vfs.writeFileSync(
    APP_BUILDING_CONFIG_PATH,
    ensureTrailingNewline(JSON.stringify(draft, null, 2)),
  );
}

export function buildAppBuildingConfigSummary(
  projectId: string,
  draft: AppBuildingSetupDraft,
): AppBuildingConfig {
  return {
    projectId,
    flyAppName: draft.flyAppName || null,
    imageRef: draft.imageRef || null,
    infisicalEnvironment: draft.infisicalEnvironment || null,
    hasInfisicalCredentials: Boolean(
      draft.infisicalClientId && draft.infisicalClientSecret,
    ),
    hasFlyApiToken: Boolean(draft.flyApiToken),
    updatedAt: Date.now(),
  };
}
