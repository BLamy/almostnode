import {
  buildNeonAuthorizationUrl,
  createNeonPkcePair,
  exchangeNeonAuthorizationCode,
  NEON_CALLBACK_REDIRECT_URI,
  type NeonCredentials,
} from '../../../../packages/almostnode/src/shims/neon-auth';

const DEFAULT_NEON_API_HOST = 'https://console.neon.tech/api/v2';

export interface NeonPendingLogin {
  state: string;
  codeVerifier: string;
  authorizationUrl: string;
  redirectUri: string;
}

export async function startNeonManualLogin(): Promise<NeonPendingLogin> {
  const { codeVerifier, codeChallenge, state } = await createNeonPkcePair();
  const authorizationUrl = buildNeonAuthorizationUrl({ state, codeChallenge });
  return {
    state,
    codeVerifier,
    authorizationUrl,
    redirectUri: NEON_CALLBACK_REDIRECT_URI,
  };
}

export async function completeNeonManualLogin(
  pending: NeonPendingLogin,
  callbackUrl: string,
): Promise<NeonCredentials> {
  const trimmed = callbackUrl.trim();
  if (!trimmed) {
    throw new Error('Paste the full callback URL from the browser address bar.');
  }
  const parsed = parseCallbackUrl(trimmed);
  if (!parsed.code) {
    throw new Error("Couldn't find a ?code=… parameter in that URL.");
  }
  if (parsed.state && parsed.state !== pending.state) {
    throw new Error(
      'OAuth state mismatch — the callback URL is from a different login attempt. Click "Start over" and retry.',
    );
  }
  return exchangeNeonAuthorizationCode({
    code: parsed.code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  });
}

function parseCallbackUrl(raw: string): { code: string | null; state: string | null } {
  // Accept either a full URL or just the query string fragment.
  try {
    const url = new URL(raw);
    return {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
    };
  } catch {
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
    const params = new URLSearchParams(q);
    return {
      code: params.get('code'),
      state: params.get('state'),
    };
  }
}

export interface NeonProject {
  id: string;
  name: string;
  region_id?: string | null;
  org_id?: string | null;
}

export interface NeonProjectScopedKey {
  id: string;
  name: string;
  key: string;
  projectId: string;
}

export interface NeonOrganization {
  id: string;
  name: string;
  handle?: string | null;
}

export interface NeonOrgScopedKey {
  id: string;
  name: string;
  key: string;
  orgId: string;
}

async function neonJson(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${DEFAULT_NEON_API_HOST}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const detail =
      (parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message?: unknown }).message ?? '')
        : '') ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Neon API error (${path}): ${detail}`);
  }

  return parsed;
}

export async function listNeonProjects(accessToken: string): Promise<NeonProject[]> {
  const payload = (await neonJson('/projects', accessToken)) as {
    projects?: Array<{ id?: unknown; name?: unknown; region_id?: unknown; org_id?: unknown }>;
  } | null;
  const rows = payload?.projects ?? [];
  return rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      name: typeof row.name === 'string' ? row.name : '',
      region_id: typeof row.region_id === 'string' ? row.region_id : null,
      org_id: typeof row.org_id === 'string' ? row.org_id : null,
    }))
    .filter((row) => row.id && row.name);
}

export async function listNeonOrganizations(
  accessToken: string,
): Promise<NeonOrganization[]> {
  const payload = (await neonJson('/users/me/organizations', accessToken)) as {
    organizations?: Array<{ id?: unknown; name?: unknown; handle?: unknown }>;
  } | null;
  const rows = payload?.organizations ?? [];
  return rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      name: typeof row.name === 'string' ? row.name : '',
      handle: typeof row.handle === 'string' ? row.handle : null,
    }))
    .filter((row) => row.id && row.name);
}

export async function createOrgScopedNeonKey(
  accessToken: string,
  orgId: string,
  keyName: string,
): Promise<NeonOrgScopedKey> {
  if (!orgId) {
    throw new Error('An org id is required to mint an org-scoped API key.');
  }
  const trimmedName = keyName.trim() || `app-builder-${Date.now()}`;
  const payload = (await neonJson(
    `/organizations/${encodeURIComponent(orgId)}/api_keys`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ key_name: trimmedName }),
    },
  )) as { id?: unknown; key?: unknown; name?: unknown } | null;

  const key = typeof payload?.key === 'string' ? payload.key : '';
  if (!key) {
    throw new Error('Org API key creation succeeded but no key token was returned.');
  }
  return {
    id: payload?.id != null ? String(payload.id) : '',
    name: typeof payload?.name === 'string' ? payload.name : trimmedName,
    key,
    orgId,
  };
}

export async function createNeonProject(
  accessToken: string,
  name: string,
  orgId?: string | null,
): Promise<NeonProject> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('A Neon project name is required.');
  }
  const projectBody: Record<string, unknown> = { name: trimmed };
  if (orgId) projectBody.org_id = orgId;
  const payload = (await neonJson('/projects', accessToken, {
    method: 'POST',
    body: JSON.stringify({ project: projectBody }),
  })) as { project?: Record<string, unknown> } | null;

  const project = payload?.project;
  if (!project || typeof project !== 'object') {
    throw new Error('Neon project create returned no project payload.');
  }
  const id = typeof project.id === 'string' ? project.id : null;
  const projectName = typeof project.name === 'string' ? project.name : trimmed;
  if (!id) {
    throw new Error('Neon project create returned no project id.');
  }
  return {
    id,
    name: projectName,
    region_id: typeof project.region_id === 'string' ? project.region_id : null,
    org_id: typeof project.org_id === 'string' ? project.org_id : null,
  };
}

export async function createProjectScopedNeonKey(
  accessToken: string,
  projectId: string,
  keyName: string,
): Promise<NeonProjectScopedKey> {
  if (!projectId) {
    throw new Error('A Neon project id is required to scope the API key.');
  }
  const trimmedName = keyName.trim() || `app-builder-${Date.now()}`;
  const payload = (await neonJson('/api_keys', accessToken, {
    method: 'POST',
    body: JSON.stringify({ key_name: trimmedName, project_ids: [projectId] }),
  })) as { id?: unknown; key?: unknown; name?: unknown } | null;

  const key = typeof payload?.key === 'string' ? payload.key : '';
  if (!key) {
    throw new Error('Neon API key creation succeeded but no key token was returned.');
  }
  return {
    id: payload?.id != null ? String(payload.id) : '',
    name: typeof payload?.name === 'string' ? payload.name : trimmedName,
    key,
    projectId,
  };
}

export interface NeonProvisionResult {
  project: NeonProject;
  apiKey: NeonProjectScopedKey | NeonOrgScopedKey;
  /** True when the returned key is org-wide (usable for any project in that org). */
  isOrgKey: boolean;
  orgId: string | null;
}

export async function provisionNeonProjectAndKey(
  accessToken: string,
  options: { projectName: string; orgId?: string | null; keyName?: string },
): Promise<NeonProvisionResult> {
  const orgId = options.orgId ?? null;
  const project = await createNeonProject(accessToken, options.projectName, orgId);
  const keyName = options.keyName ?? `${project.name}-app-builder`;

  if (orgId) {
    const apiKey = await createOrgScopedNeonKey(accessToken, orgId, keyName);
    return { project, apiKey, isOrgKey: true, orgId };
  }

  const apiKey = await createProjectScopedNeonKey(accessToken, project.id, keyName);
  return { project, apiKey, isOrgKey: false, orgId: null };
}
