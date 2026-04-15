import type {
  ProjectCodespaceRecord,
  ProjectEnvironmentKind,
  ProjectGitRemoteRecord,
  ProjectRecord,
  ProjectRepoRef,
} from './project-db';

export const CODESPACE_UPGRADE_BRANCH_PREFIX = 'almostnode/codespace-';
export const CODESPACE_SECRET_NAME = 'ALMOSTNODE_KEYCHAIN_BUNDLE';
export const CODESPACE_BOOTSTRAP_SCRIPT_PATH = '/project/.devcontainer/almostnode-keychain-bootstrap.mjs';
export const CODESPACE_DEVCONTAINER_PATH = '/project/.devcontainer/devcontainer.json';

export interface ProjectEnvironmentMenuState {
  activeEnvironment: ProjectEnvironmentKind;
  label: string;
  detail: string;
  canSyncCredentials: boolean;
  syncDisabledReason?: string;
}

export function createCodespaceUpgradeBranchName(
  now = new Date(),
): string {
  const parts = [
    now.getUTCFullYear().toString().padStart(4, '0'),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
    now.getUTCHours().toString().padStart(2, '0'),
    now.getUTCMinutes().toString().padStart(2, '0'),
    now.getUTCSeconds().toString().padStart(2, '0'),
  ];
  return `${CODESPACE_UPGRADE_BRANCH_PREFIX}${parts.join('')}`;
}

export function normalizeCodespaceState(state: string | null | undefined): string {
  const normalized = state?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return 'unknown';
  }
  if (normalized === 'available') {
    return 'running';
  }
  if (normalized === 'shutdown' || normalized === 'stopped') {
    return 'stopped';
  }
  if (normalized === 'queued' || normalized === 'provisioning') {
    return 'starting';
  }
  return normalized;
}

export function deriveProjectEnvironmentMenuState(
  project: Pick<ProjectRecord, 'activeEnvironment' | 'codespace' | 'gitRemote'>,
): ProjectEnvironmentMenuState {
  const activeEnvironment = project.activeEnvironment === 'codespace'
    ? 'codespace'
    : 'local';
  const codespaceState = normalizeCodespaceState(project.codespace?.state);
  const canSyncCredentials = project.codespace?.supportsBridge === true;
  let detail = 'Run in this browser with AlmostNode.';

  if (activeEnvironment === 'codespace') {
    switch (codespaceState) {
      case 'running':
        detail = 'Connected to your GitHub Codespace.';
        break;
      case 'starting':
      case 'creating':
        detail = 'Starting your GitHub Codespace.';
        break;
      case 'stopped':
        detail = 'Codespace exists but is currently stopped.';
        break;
      case 'error':
        detail = 'Codespace setup hit an error.';
        break;
      default:
        detail = 'Codespace is selected for this project.';
        break;
    }
  } else if (project.codespace?.name) {
    detail = `Local workspace active. Codespace ${project.codespace.displayName || project.codespace.name} is available.`;
  }

  return {
    activeEnvironment,
    label: activeEnvironment === 'codespace'
      ? formatCodespaceLabel(codespaceState)
      : 'Local',
    detail,
    canSyncCredentials,
    syncDisabledReason: canSyncCredentials
      ? undefined
      : 'Credential sync requires an almostnode Codespace bootstrap.',
  };
}

export function formatCodespaceLabel(state: string): string {
  switch (normalizeCodespaceState(state)) {
    case 'creating':
      return 'Codespace: Create/Open';
    case 'starting':
      return 'Codespace: Starting';
    case 'running':
      return 'Codespace: Running';
    case 'stopped':
      return 'Codespace: Stopped';
    case 'error':
      return 'Codespace: Error';
    default:
      return 'Codespace';
  }
}

export function inferProjectRepoRef(
  project: Pick<ProjectRecord, 'repoRef' | 'gitRemote'>,
  branch?: string | null,
): ProjectRepoRef | null {
  if (project.repoRef) {
    return {
      ...project.repoRef,
      branch: branch?.trim() || project.repoRef.branch,
    };
  }

  const remote = project.gitRemote;
  if (!remote?.repositoryFullName) {
    return null;
  }

  const [owner, repo] = remote.repositoryFullName.split('/');
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    branch: branch?.trim() || 'main',
    remoteUrl: remote.url,
  };
}

export function projectSupportsCodespaceBootstrap(
  project: Pick<ProjectRecord, 'codespace' | 'gitRemote'>,
  hasBootstrapFiles: boolean,
): boolean {
  if (project.codespace?.supportsBridge === true) {
    return true;
  }

  if (!project.gitRemote?.repositoryFullName) {
    return true;
  }

  return hasBootstrapFiles;
}

export function toProjectRepoRef(
  gitRemote: ProjectGitRemoteRecord,
  branch: string,
): ProjectRepoRef | null {
  if (!gitRemote.repositoryFullName) {
    return null;
  }

  const [owner, repo] = gitRemote.repositoryFullName.split('/');
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    branch,
    remoteUrl: gitRemote.url,
  };
}

export function mergeCodespaceRecord(
  current: ProjectCodespaceRecord | null | undefined,
  next: Partial<ProjectCodespaceRecord>,
): ProjectCodespaceRecord | null {
  const name = next.name ?? current?.name;
  const displayName = next.displayName ?? current?.displayName ?? name;
  const webUrl = next.webUrl ?? current?.webUrl;

  if (!name || !displayName || !webUrl) {
    return null;
  }

  return {
    name,
    displayName,
    webUrl,
    state: next.state ?? current?.state ?? 'unknown',
    machine: next.machine ?? current?.machine ?? null,
    idleTimeoutMinutes:
      next.idleTimeoutMinutes ?? current?.idleTimeoutMinutes ?? null,
    retentionHours: next.retentionHours ?? current?.retentionHours ?? null,
    supportsBridge: next.supportsBridge ?? current?.supportsBridge ?? false,
    lastSyncedAt: next.lastSyncedAt ?? current?.lastSyncedAt ?? null,
  };
}
