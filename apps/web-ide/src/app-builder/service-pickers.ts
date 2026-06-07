import {
  DEFAULT_FLY_API_BASE_URL,
  fetchFlyApps,
  type FlyAppSummary,
} from '../../../../packages/almostnode/src/shims/fly-auth';
import {
  DEFAULT_NETLIFY_API_BASE_URL,
  fetchNetlifyAccounts,
  type NetlifyAccount,
} from '../../../../packages/almostnode/src/shims/netlify-auth';
import {
  fetchInfisicalProjects,
  type InfisicalProjectInfo,
} from '../../../../packages/almostnode/src/shims/infisical-auth';

export interface AppBuilderSelections {
  flyApp: string | null;
  netlifyAccountSlug: string | null;
  infisicalProjectId: string | null;
  infisicalEnvironment: string | null;
  neonProjectId: string | null;
  neonProjectName: string | null;
  /** Project-scoped or org-scoped key minted via the standalone provision flow. */
  neonApiKey: string | null;
  neonOrgId: string | null;
  neonOrgName: string | null;
  /**
   * Anthropic API key pasted directly into the app-builder page.
   * Overrides any Claude OAuth token read from the vault when syncing to Infisical.
   * Persisted in localStorage — only populated if the user typed a value on this page.
   */
  anthropicApiKey: string | null;
}

const SELECTIONS_STORAGE_KEY = 'almostnode.appBuilder.selections.v1';

export function readSelections(): AppBuilderSelections {
  try {
    const raw = localStorage.getItem(SELECTIONS_STORAGE_KEY);
    if (!raw) return emptySelections();
    const parsed = JSON.parse(raw) as Partial<AppBuilderSelections>;
    return {
      flyApp: typeof parsed.flyApp === 'string' ? parsed.flyApp : null,
      netlifyAccountSlug:
        typeof parsed.netlifyAccountSlug === 'string' ? parsed.netlifyAccountSlug : null,
      infisicalProjectId:
        typeof parsed.infisicalProjectId === 'string' ? parsed.infisicalProjectId : null,
      infisicalEnvironment:
        typeof parsed.infisicalEnvironment === 'string' ? parsed.infisicalEnvironment : null,
      neonProjectId:
        typeof parsed.neonProjectId === 'string' ? parsed.neonProjectId : null,
      neonProjectName:
        typeof parsed.neonProjectName === 'string' ? parsed.neonProjectName : null,
      neonApiKey: typeof parsed.neonApiKey === 'string' ? parsed.neonApiKey : null,
      neonOrgId: typeof parsed.neonOrgId === 'string' ? parsed.neonOrgId : null,
      neonOrgName:
        typeof parsed.neonOrgName === 'string' ? parsed.neonOrgName : null,
      anthropicApiKey:
        typeof parsed.anthropicApiKey === 'string' ? parsed.anthropicApiKey : null,
    };
  } catch {
    return emptySelections();
  }
}

export function writeSelections(selections: AppBuilderSelections): void {
  localStorage.setItem(SELECTIONS_STORAGE_KEY, JSON.stringify(selections));
}

export function emptySelections(): AppBuilderSelections {
  return {
    flyApp: null,
    netlifyAccountSlug: null,
    infisicalProjectId: null,
    infisicalEnvironment: null,
    neonProjectId: null,
    neonProjectName: null,
    neonApiKey: null,
    neonOrgId: null,
    neonOrgName: null,
    anthropicApiKey: null,
  };
}

export async function fetchFlyAppList(token: string): Promise<FlyAppSummary[]> {
  return fetchFlyApps(DEFAULT_FLY_API_BASE_URL, token);
}

export async function fetchNetlifyAccountList(token: string): Promise<NetlifyAccount[]> {
  return fetchNetlifyAccounts(DEFAULT_NETLIFY_API_BASE_URL, token);
}

export async function fetchInfisicalProjectList(
  token: string,
  domain: string,
): Promise<InfisicalProjectInfo[]> {
  return fetchInfisicalProjects(domain, token);
}

export type {
  FlyAppSummary,
  NetlifyAccount,
  InfisicalProjectInfo,
};
