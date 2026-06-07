import {
  getFlyAuthorizationHeader,
} from '../../../../packages/almostnode/src/shims/fly-auth';
import type { ExtractedCredentials } from './standalone-credentials';
import type { AppBuilderSelections } from './service-pickers';

export const DEFAULT_APP_BUILDING_IMAGE = 'ghcr.io/replayio/app-building:latest';
export const DEFAULT_APP_BUILDING_REPO_URL = 'https://github.com/replayio/app-building.git';
export const FLY_MACHINES_BASE_URL = 'https://api.machines.dev/v1';

export interface AppBuildingMachineState {
  machineId: string;
  instanceId: string | null;
  volumeId: string | null;
  region: string;
}

export interface LaunchTrace {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface LaunchFlyMachineInput {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  machineName: string;
  imageRef?: string;
  /** Extra env vars merged on top of the credential/selection-derived ones. */
  extraEnv?: Record<string, string>;
}

function buildWorkerEnv(
  credentials: ExtractedCredentials,
  selections: AppBuilderSelections,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {
    // The app-building worker's entrypoint requires REPO_URL (or NO_REPO=1).
    // Default to the canonical replayio/app-building repo; overridable via extraEnv.
    REPO_URL: DEFAULT_APP_BUILDING_REPO_URL,
  };

  const put = (key: string, value: string | null | undefined) => {
    if (value && value.trim()) env[key] = value.trim();
  };

  put('FLY_APP', selections.flyApp);
  put('FLY_API_TOKEN', credentials.FLY_API_TOKEN);
  // The worker entrypoint requires INFISICAL_TOKEN (a bearer). In practice that's either
  // the short-lived OAuth access_token from `infisical login` or a token minted from the
  // Universal Auth client pair. We ship the access token when available and keep the UA
  // pair around so the worker can also re-mint inside the container if it prefers.
  put('INFISICAL_TOKEN', credentials.INFISICAL_ACCESS_TOKEN);
  put('INFISICAL_ACCESS_TOKEN', credentials.INFISICAL_ACCESS_TOKEN);
  put('INFISICAL_CLIENT_ID', credentials.INFISICAL_CLIENT_ID);
  put('INFISICAL_CLIENT_SECRET', credentials.INFISICAL_CLIENT_SECRET);
  put('INFISICAL_DOMAIN', credentials.INFISICAL_DOMAIN);
  put('INFISICAL_PROJECT_ID', selections.infisicalProjectId);
  put('INFISICAL_ENVIRONMENT', selections.infisicalEnvironment);
  put('NETLIFY_AUTH_TOKEN', credentials.NETLIFY_AUTH_TOKEN);
  put('NETLIFY_ACCOUNT_SLUG', selections.netlifyAccountSlug);
  put('NEON_API_KEY', selections.neonApiKey ?? credentials.NEON_API_KEY);
  put('NEON_PROJECT_ID', selections.neonProjectId);
  put('NEON_ORG_ID', selections.neonOrgId);
  put('GITHUB_TOKEN', credentials.GITHUB_TOKEN);
  put('RECORD_REPLAY_API_KEY', credentials.RECORD_REPLAY_API_KEY);
  put('ANTHROPIC_API_KEY', credentials.ANTHROPIC_API_KEY);

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && value.trim()) env[key] = value;
    }
  }

  return env;
}

async function flyFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', getFlyAuthorizationHeader(token));
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(`${FLY_MACHINES_BASE_URL}${path}`, { ...init, headers });
}

async function readFlyError(response: Response, step: string): Promise<string> {
  const text = await response.text().catch(() => '');
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    detail = parsed.error || parsed.message || text;
  } catch {
    // fall through
  }
  return `${step} failed (${response.status}): ${detail || response.statusText}`;
}

export interface MachineGuestConfig {
  cpu_kind: 'shared' | 'performance';
  cpus: number;
  memory_mb: number;
}

export const DEFAULT_GUEST: MachineGuestConfig = {
  cpu_kind: 'shared',
  cpus: 1,
  memory_mb: 1024,
};

export interface LaunchResult {
  machine: AppBuildingMachineState;
  trace: LaunchTrace[];
}

export async function launchAppBuildingFlyMachine(input: {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  machineName: string;
  imageRef?: string;
  extraEnv?: Record<string, string>;
  guest?: MachineGuestConfig;
  region?: string;
  useVolume?: boolean;
  onTrace?: (event: LaunchTrace) => void;
}): Promise<LaunchResult> {
  const { credentials, selections, machineName } = input;
  const trace: LaunchTrace[] = [];
  const record = (event: LaunchTrace) => {
    trace.push(event);
    input.onTrace?.(event);
  };

  if (!selections.flyApp) {
    throw new Error('Pick a Fly app on the sign-in page before launching workers.');
  }
  const token = credentials.FLY_API_TOKEN;
  if (!token) {
    throw new Error('FLY_API_TOKEN is missing. Sign in to Fly and refresh.');
  }

  const appName = selections.flyApp;
  const region = input.region || 'dfw';
  const guest = input.guest || DEFAULT_GUEST;
  const imageRef = input.imageRef || DEFAULT_APP_BUILDING_IMAGE;
  const env = buildWorkerEnv(credentials, selections, input.extraEnv);
  const useVolume = input.useVolume === true;

  let volumeId: string | null = null;

  try {
    if (useVolume) {
      const volumeName = `app_${machineName.replace(/-/g, '_')}`.slice(0, 30);
      record({ step: `Creating volume ${volumeName} in ${region}`, ok: true });
      const volumeResp = await flyFetch(`/apps/${appName}/volumes`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: volumeName,
          region,
          size_gb: 10,
          encrypted: true,
        }),
      });
      if (!volumeResp.ok) {
        const message = await readFlyError(volumeResp, 'Volume create');
        record({ step: 'Volume create', ok: false, detail: message });
        throw new Error(message);
      }
      const volumeJson = (await volumeResp.json()) as { id?: string };
      volumeId = typeof volumeJson.id === 'string' ? volumeJson.id : null;
      record({ step: `Volume created (${volumeId ?? 'no id'})`, ok: true });
    }

    record({ step: `POST /apps/${appName}/machines (${region}, ${guest.cpu_kind} ${guest.cpus}c/${guest.memory_mb}MB)`, ok: true });
    const body: Record<string, unknown> = {
      name: machineName,
      region,
      config: {
        image: imageRef,
        env,
        auto_destroy: true,
        restart: { policy: 'on-failure', max_retries: 3 },
        guest,
        services: [
          {
            internal_port: 3000,
            protocol: 'tcp',
            autostart: false,
            autostop: 'off',
            ports: [{ port: 443, handlers: ['tls', 'http'] }],
          },
        ],
      },
    };
    if (volumeId) {
      (body.config as Record<string, unknown>).mounts = [
        { volume: volumeId, path: '/app' },
      ];
    }

    const machineResp = await flyFetch(`/apps/${appName}/machines`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!machineResp.ok) {
      const message = await readFlyError(machineResp, 'Machine create');
      record({ step: 'Machine create', ok: false, detail: message });
      // Clean up the volume we created. If that deletion also fails we surface both.
      if (volumeId) {
        const del = await flyFetch(`/apps/${appName}/volumes/${volumeId}`, token, {
          method: 'DELETE',
        }).catch((error) => {
          record({
            step: 'Volume cleanup after machine failure',
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        if (del && !del.ok) {
          record({
            step: 'Volume cleanup after machine failure',
            ok: false,
            detail: await readFlyError(del, 'Volume delete'),
          });
        } else if (del && del.ok) {
          record({ step: `Volume ${volumeId} deleted after rollback`, ok: true });
        }
      }
      throw new Error(message);
    }

    const machineJson = (await machineResp.json()) as {
      id?: string;
      instance_id?: string | null;
    };
    record({ step: `Machine ${machineJson.id ?? 'unknown'} created`, ok: true });
    return {
      machine: {
        machineId: machineJson.id ?? '',
        instanceId:
          typeof machineJson.instance_id === 'string' && machineJson.instance_id.trim()
            ? machineJson.instance_id.trim()
            : null,
        volumeId,
        region,
      },
      trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!trace.some((t) => !t.ok && t.detail === message)) {
      record({ step: 'Launch aborted', ok: false, detail: message });
    }
    throw error;
  }
}

export function sanitizeMachineName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || `app-${Date.now().toString(36)}`;
}
