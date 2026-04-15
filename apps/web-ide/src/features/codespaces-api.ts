import type {
  ProjectCodespaceRecord,
  ProjectRepoRef,
} from './project-db';

const SESSION_STORAGE_KEY = 'almostnode.codespaces.session-id';

export interface GitHubDeviceAuthStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
}

export interface GitHubDeviceAuthPollResponse {
  status: 'pending' | 'authorized';
  sessionId?: string;
  user?: {
    login: string;
    id: number;
    avatarUrl: string | null;
  };
  accessTokenExpiresAt?: string | null;
  error?: string;
}

export interface GitHubAccessTokenSessionResponse {
  sessionId: string;
  user: {
    login: string;
    id: number;
    avatarUrl: string | null;
  };
  scopes: string | null;
}

export interface EnsureCodespaceRequest {
  projectId: string;
  projectName: string;
  repoRef: ProjectRepoRef;
  displayName: string;
  machine: string | null;
  idleTimeoutMinutes: number | null;
  retentionHours: number | null;
  supportsBridge: boolean;
}

export interface SyncCodespaceCredentialsRequest {
  projectId: string;
  codespaceName: string;
  repoRef: ProjectRepoRef;
  payload: string;
}

export interface CodespacesApiProjectResponse {
  projectId: string;
  repoRef: ProjectRepoRef | null;
  codespace: ProjectCodespaceRecord | null;
}

function getCodespacesApiBaseUrl(): string {
  const configured = import.meta.env.VITE_CODESPACES_API_BASE_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }
  return '/__api/codespaces';
}

function getStoredCodespacesSessionId(): string | null {
  try {
    const value = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function setStoredCodespacesSessionId(sessionId: string | null): void {
  try {
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const sessionId = getStoredCodespacesSessionId();
  if (sessionId) {
    headers.set('x-almostnode-codespaces-session', sessionId);
  }

  const response = await fetch(`${getCodespacesApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Codespaces API request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export async function startGitHubDeviceAuth(): Promise<GitHubDeviceAuthStartResponse> {
  return requestJson<GitHubDeviceAuthStartResponse>('/auth/github/device/start', {
    method: 'POST',
    body: '{}',
  });
}

export async function connectGitHubAccessTokenSession(
  accessToken: string,
): Promise<GitHubAccessTokenSessionResponse> {
  const response = await requestJson<GitHubAccessTokenSessionResponse>(
    '/auth/github/session',
    {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    },
  );

  setStoredCodespacesSessionId(response.sessionId);
  return response;
}

export async function pollGitHubDeviceAuth(
  deviceCode: string,
): Promise<GitHubDeviceAuthPollResponse> {
  const response = await requestJson<GitHubDeviceAuthPollResponse>(
    '/auth/github/device/poll',
    {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    },
  );

  if (response.status === 'authorized' && response.sessionId) {
    setStoredCodespacesSessionId(response.sessionId);
  }

  return response;
}

export async function getProjectCodespace(
  projectId: string,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(`/projects/${encodeURIComponent(projectId)}/codespace`);
}

export async function ensureProjectCodespace(
  payload: EnsureCodespaceRequest,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(
    `/projects/${encodeURIComponent(payload.projectId)}/codespace/ensure`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function startProjectCodespace(
  projectId: string,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}/codespace/start`,
    {
      method: 'POST',
      body: '{}',
    },
  );
}

export async function stopProjectCodespace(
  projectId: string,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}/codespace/stop`,
    {
      method: 'POST',
      body: '{}',
    },
  );
}

export async function rebuildProjectCodespace(
  projectId: string,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}/codespace/rebuild`,
    {
      method: 'POST',
      body: '{}',
    },
  );
}

export async function syncProjectCodespaceCredentials(
  payload: SyncCodespaceCredentialsRequest,
): Promise<CodespacesApiProjectResponse> {
  return requestJson<CodespacesApiProjectResponse>(
    `/projects/${encodeURIComponent(payload.projectId)}/codespace/sync-credentials`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}
