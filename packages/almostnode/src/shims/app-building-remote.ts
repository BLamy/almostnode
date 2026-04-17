import { getDefaultNetworkController, networkFetch } from '../network';
import { getFlyAuthorizationHeader } from './fly-auth';

const FLY_MACHINES_API_BASE = 'https://api.machines.dev/v1';
const FLY_LOGS_API_BASE = 'https://api.fly.io';
const INFISICAL_API_BASE = 'https://app.infisical.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const DEFAULT_APP_BUILDING_IMAGE_REF = 'ghcr.io/replayio/app-building:latest';

export interface AppBuildingMachineState {
  machineId: string;
  instanceId: string | null;
  volumeId: string | null;
  region: string;
}

export interface AppBuildingWorkerStatus {
  state: 'starting' | 'idle' | 'processing' | 'stopping' | 'stopped';
  containerName: string;
  pushBranch: string;
  pendingTasks: number;
  tasksProcessed: number;
  totalCost: number;
  iteration: number;
  detachRequested: boolean;
  revision: string;
  lastActivityAt: string;
  /** Detected dev-server port inside the container, exposed via /preview/. */
  previewPort?: number | null;
  /** ISO timestamp of when the dev-server port was last detected. */
  previewDetectedAt?: string | null;
}

export interface AppBuildingOffsetBatch {
  items: string[];
  nextOffset: number;
}

interface FlyVolumeInfo {
  id: string;
  attached_machine_id: string | null;
}

export interface FlyMachineInfo {
  id: string;
  instance_id?: string | null;
  state?: string;
  region?: string;
}

interface FlyIpAssignment {
  address?: string;
  type?: string;
  region?: string | null;
  ip?: string;
  shared?: boolean;
}

interface FlyIpAssignmentsPayload {
  ips?: FlyIpAssignment[];
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runtimeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = getDefaultNetworkController();
  if (controller) {
    return networkFetch(input, init, controller);
  }
  return fetch(input, init);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { timeoutMs: _timeoutMs, signal, ...rest } = init;
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return await runtimeFetch(input, {
      ...rest,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  init: FetchOptions,
  label: string,
): Promise<T> {
  const response = await fetchWithTimeout(input, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} failed (${response.status}): ${body || response.statusText}`);
  }
  return await response.json() as T;
}

async function flyFetchJson<T>(
  path: string,
  token: string,
  init: FetchOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', getFlyAuthorizationHeader(token));
  headers.set('content-type', 'application/json');
  return fetchJson<T>(
    `${FLY_MACHINES_API_BASE}${path}`,
    {
      ...init,
      headers,
    },
    `Fly API ${init.method ?? 'GET'} ${path}`,
  );
}

async function flyFetchText(
  path: string,
  token: string,
  init: FetchOptions = {},
): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set('authorization', getFlyAuthorizationHeader(token));
  headers.set('content-type', 'application/json');
  const response = await fetchWithTimeout(`${FLY_MACHINES_API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Fly API ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body || response.statusText}`);
  }
  return response.text();
}

export async function infisicalLogin(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const payload = await fetchJson<{ accessToken: string }>(
    `${INFISICAL_API_BASE}/api/v1/auth/universal-auth/login`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ clientId, clientSecret }),
    },
    'Infisical login',
  );
  if (!payload.accessToken) {
    throw new Error('Infisical login did not return an access token.');
  }
  return payload.accessToken;
}

export function workerHeaders(instanceId: string | null): Record<string, string> {
  if (!instanceId) {
    return {};
  }
  return {
    'fly-force-instance-id': instanceId,
  };
}

async function createVolume(
  appName: string,
  token: string,
  volumeName: string,
  region: string,
): Promise<string> {
  const payload = await flyFetchJson<{ id: string }>(
    `/apps/${appName}/volumes`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name: volumeName,
        region,
        size_gb: 50,
        encrypted: true,
        require_unique_zone: false,
      }),
    },
  );
  return payload.id;
}

export async function listFlyVolumes(
  appName: string,
  token: string,
): Promise<FlyVolumeInfo[]> {
  return flyFetchJson<FlyVolumeInfo[]>(
    `/apps/${appName}/volumes`,
    token,
  );
}

async function listFlyIpAssignments(
  appName: string,
  token: string,
): Promise<FlyIpAssignment[]> {
  const payload = await flyFetchJson<FlyIpAssignment[] | FlyIpAssignmentsPayload>(
    `/apps/${appName}/ip_assignments`,
    token,
  );
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.ips)) {
    return payload.ips;
  }
  return [];
}

async function allocateFlyIpAssignment(
  appName: string,
  token: string,
  type: 'shared_v4' | 'v6',
): Promise<void> {
  await flyFetchJson<unknown>(
    `/apps/${appName}/ip_assignments`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ type }),
    },
  );
}

function isDuplicateIpAssignmentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('already')
    || message.includes('exists')
    || message.includes('assigned')
  );
}

function hasSharedV4Ip(assignments: FlyIpAssignment[]): boolean {
  return assignments.some((assignment) => (
    assignment.type === 'shared_v4'
    || assignment.type === 'public (shared)'
    || assignment.shared === true
  ));
}

function hasV6Ip(assignments: FlyIpAssignment[]): boolean {
  return assignments.some((assignment) => (
    assignment.type === 'v6'
    || assignment.type === 'public'
    || assignment.address?.includes(':')
    || assignment.ip?.includes(':')
  ));
}

async function infisicalFetch(
  path: string,
  token: string,
  init: FetchOptions = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return fetchWithTimeout(`${INFISICAL_API_BASE}${path}`, {
    ...init,
    headers,
  });
}

async function ensureInfisicalFolder(
  token: string,
  projectId: string,
  environment: string,
  folderPath: string,
): Promise<void> {
  const segments = folderPath.split('/').filter(Boolean);
  let parentPath = '/';

  for (const segment of segments) {
    const response = await infisicalFetch('/api/v2/folders', token, {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        environment,
        name: segment,
        path: parentPath,
      }),
    });

    if (response.ok || response.status === 400) {
      parentPath += `${segment}/`;
      continue;
    }

    const body = await response.text().catch(() => '');
    throw new Error(
      `Infisical create folder ${parentPath}${segment} failed (${response.status}): ${body || response.statusText}`,
    );
  }
}

async function upsertInfisicalSecret(options: {
  token: string;
  projectId: string;
  environment: string;
  secretPath: string;
  name: string;
  value: string;
}): Promise<void> {
  const {
    token,
    projectId,
    environment,
    secretPath,
    name,
    value,
  } = options;
  const pathname = `/api/v4/secrets/${encodeURIComponent(name)}`;
  const body = JSON.stringify({
    projectId,
    environment,
    secretPath,
    secretValue: value,
    type: 'shared',
  });

  const createResponse = await infisicalFetch(pathname, token, {
    method: 'POST',
    body,
  });
  if (createResponse.ok) {
    return;
  }

  if (createResponse.status === 400) {
    const patchResponse = await infisicalFetch(pathname, token, {
      method: 'PATCH',
      body,
    });
    if (patchResponse.ok) {
      return;
    }
    const patchBody = await patchResponse.text().catch(() => '');
    throw new Error(`Infisical PATCH ${name} failed (${patchResponse.status}): ${patchBody || patchResponse.statusText}`);
  }

  if (createResponse.status === 404) {
    await ensureInfisicalFolder(token, projectId, environment, secretPath);
    const retryResponse = await infisicalFetch(pathname, token, {
      method: 'POST',
      body,
    });
    if (retryResponse.ok) {
      return;
    }
    if (retryResponse.status === 400) {
      const patchResponse = await infisicalFetch(pathname, token, {
        method: 'PATCH',
        body,
      });
      if (patchResponse.ok) {
        return;
      }
      const patchBody = await patchResponse.text().catch(() => '');
      throw new Error(`Infisical PATCH ${name} after folder creation failed (${patchResponse.status}): ${patchBody || patchResponse.statusText}`);
    }
    const retryBody = await retryResponse.text().catch(() => '');
    throw new Error(`Infisical POST ${name} after folder creation failed (${retryResponse.status}): ${retryBody || retryResponse.statusText}`);
  }

  const responseBody = await createResponse.text().catch(() => '');
  throw new Error(`Infisical POST ${name} failed (${createResponse.status}): ${responseBody || createResponse.statusText}`);
}

export async function setInfisicalGlobalSecret(options: {
  token: string;
  projectId: string;
  environment: string;
  name: string;
  value: string;
}): Promise<void> {
  return upsertInfisicalSecret({
    ...options,
    secretPath: '/global/',
  });
}

async function ensureFlyPublicIpAssignments(
  appName: string,
  token: string,
): Promise<void> {
  const assignments = await listFlyIpAssignments(appName, token);

  if (!hasSharedV4Ip(assignments)) {
    await allocateFlyIpAssignment(appName, token, 'shared_v4').catch((error) => {
      if (!isDuplicateIpAssignmentError(error)) {
        throw error;
      }
    });
  }

  if (!hasV6Ip(assignments)) {
    await allocateFlyIpAssignment(appName, token, 'v6').catch((error) => {
      if (!isDuplicateIpAssignmentError(error)) {
        throw error;
      }
    });
  }
}

export async function destroyFlyMachine(
  appName: string,
  token: string,
  machineId: string,
  volumeId?: string | null,
): Promise<void> {
  await flyFetchText(`/apps/${appName}/machines/${machineId}?force=true`, token, {
    method: 'DELETE',
  }).catch(() => '');

  if (volumeId) {
    await flyFetchText(`/apps/${appName}/volumes/${volumeId}`, token, {
      method: 'DELETE',
    }).catch(() => '');
  }
}

export async function createAppBuildingMachine(options: {
  appName: string;
  token: string;
  imageRef: string;
  env: Record<string, string>;
  machineName: string;
}): Promise<AppBuildingMachineState> {
  const regions = ['dfw', 'iad', 'ord', 'sjc'];
  const volumeName = `app_${options.machineName.replace(/-/g, '_')}`.slice(0, 30);
  let cleanupPromise: Promise<unknown> | null = null;

  await ensureFlyPublicIpAssignments(options.appName, options.token);

  for (const region of regions) {
    const volumeId = await createVolume(
      options.appName,
      options.token,
      volumeName,
      region,
    );

    if (!cleanupPromise) {
      cleanupPromise = listFlyVolumes(options.appName, options.token).then(async (volumes) => {
        await Promise.all(
          volumes.map(async (volume) => {
            if (volume.id === volumeId || volume.attached_machine_id) {
              return;
            }
            await flyFetchText(`/apps/${options.appName}/volumes/${volume.id}`, options.token, {
              method: 'DELETE',
            }).catch(() => '');
          }),
        );
      });
    }

    try {
      const payload = await flyFetchJson<{ id: string; instance_id?: string | null }>(
        `/apps/${options.appName}/machines`,
        options.token,
        {
          method: 'POST',
          body: JSON.stringify({
            name: options.machineName,
            region,
            config: {
              image: options.imageRef,
              env: options.env,
              auto_destroy: true,
              restart: { policy: 'on-failure', max_retries: 3 },
              guest: {
                cpu_kind: 'performance',
                cpus: 16,
                memory_mb: 32768,
              },
              mounts: [{ volume: volumeId, path: '/app' }],
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
          }),
        },
      );
      await cleanupPromise;
      return {
        machineId: payload.id,
        instanceId: typeof payload.instance_id === 'string' && payload.instance_id.trim()
          ? payload.instance_id.trim()
          : null,
        volumeId,
        region,
      };
    } catch (error) {
      await flyFetchText(`/apps/${options.appName}/volumes/${volumeId}`, options.token, {
        method: 'DELETE',
      }).catch(() => '');

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('412') || message.toLowerCase().includes('insufficient')) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Unable to provision a Fly machine for ${options.appName}.`);
}

export async function getFlyMachine(
  appName: string,
  token: string,
  machineId: string,
): Promise<FlyMachineInfo> {
  return flyFetchJson<FlyMachineInfo>(
    `/apps/${appName}/machines/${machineId}`,
    token,
  );
}

export async function waitForFlyMachineStarted(
  appName: string,
  token: string,
  machineId: string,
  timeoutMs = 180_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await flyFetchText(
        `/apps/${appName}/machines/${machineId}/wait?state=started&timeout=60`,
        token,
      );
      return;
    } catch {
      await delay(5_000);
    }
  }

  throw new Error(`Machine ${machineId} did not reach the started state.`);
}

export async function waitForWorkerReady(
  baseUrl: string,
  instanceId: string | null,
  timeoutMs = 180_000,
): Promise<AppBuildingWorkerStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchAppBuildingStatus(baseUrl, instanceId);
    } catch {
      await delay(2_000);
    }
  }

  throw new Error(`Worker at ${baseUrl} did not become ready.`);
}

export async function fetchAppBuildingStatus(
  baseUrl: string,
  instanceId: string | null,
): Promise<AppBuildingWorkerStatus> {
  return fetchJson<AppBuildingWorkerStatus>(
    `${baseUrl.replace(/\/+$/, '')}/status`,
    {
      headers: workerHeaders(instanceId),
    },
    'Worker status',
  );
}

export async function fetchAppBuildingLogs(
  baseUrl: string,
  instanceId: string | null,
  offset = 0,
): Promise<AppBuildingOffsetBatch> {
  return fetchJson<AppBuildingOffsetBatch>(
    `${baseUrl.replace(/\/+$/, '')}/logs?offset=${offset}`,
    {
      headers: workerHeaders(instanceId),
    },
    'Worker logs',
  );
}

export interface FlyLogsEntry {
  instance?: string;
  level?: string;
  message?: string;
  region?: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

export interface FlyLogsPage {
  entries: FlyLogsEntry[];
  nextToken: string;
}

export async function fetchFlyLogsPage(
  appName: string,
  token: string,
  options: {
    nextToken?: string;
    startTime?: string | null;
    region?: string | null;
    instanceId?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<FlyLogsPage> {
  const url = new URL(
    `${FLY_LOGS_API_BASE}/api/v1/apps/${encodeURIComponent(appName)}/logs`,
  );
  url.searchParams.set('next_token', options.nextToken ?? '');
  if (options.startTime) {
    url.searchParams.set('start_time', options.startTime);
  }
  if (options.region) {
    url.searchParams.set('region', options.region);
  }
  if (options.instanceId) {
    url.searchParams.set('instance', options.instanceId);
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      authorization: getFlyAuthorizationHeader(token),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Fly logs GET /api/v1/apps/${appName}/logs failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const payload = await response.json() as {
    data?: Array<{ attributes?: FlyLogsEntry }>;
    meta?: { next_token?: string };
  };
  return {
    entries: (payload.data || [])
      .map((entry) => entry.attributes)
      .filter((entry): entry is FlyLogsEntry => Boolean(entry)),
    nextToken: payload.meta?.next_token || '',
  };
}

/**
 * Fetch logs for an app-building machine using either an opaque Fly cursor
 * (`next_token`) or a `start_time` ISO anchor. `machineId` is passed as the
 * `instance` query param (Fly's logs API actually filters by machine ID, not
 * instance_id). When a machine filter is set, region is forced null — machine
 * IDs are globally unique.
 */
export async function fetchFlyLogsSince(
  appName: string,
  token: string,
  options: {
    machineId?: string | null;
    cursor?: string | null;
    startTime?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<FlyLogsPage> {
  return fetchFlyLogsPage(appName, token, {
    nextToken: options.cursor || '',
    startTime: options.cursor ? null : options.startTime || null,
    instanceId: options.machineId || null,
    region: null,
    signal: options.signal,
  });
}

export async function pollFlyLogs(
  appName: string,
  token: string,
  options: {
    region?: string | null;
    instanceId?: string | null;
    maxAttempts?: number;
    maxPages?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<FlyLogsEntry[]> {
  const maxAttempts = options.maxAttempts ?? 6;
  const maxPages = options.maxPages ?? 32;
  const initialDelay = options.initialDelayMs ?? 400;
  const maxDelay = options.maxDelayMs ?? 2_000;

  const entries: FlyLogsEntry[] = [];
  let nextToken = '';
  let waitFor = initialDelay;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let pagesThisAttempt = 0;
    while (pagesThisAttempt < maxPages) {
      const page = await fetchFlyLogsPage(appName, token, {
        nextToken,
        region: options.region,
        instanceId: options.instanceId,
      });
      pagesThisAttempt += 1;

      if (page.nextToken && page.nextToken !== nextToken) {
        nextToken = page.nextToken;
      }

      if (page.entries.length === 0) {
        break;
      }
      entries.push(...page.entries);
      if (!page.nextToken || page.nextToken === nextToken) {
        // Advanced or exhausted this burst; keep draining while entries arrive.
        if (page.entries.length < 50) {
          break;
        }
      }
    }

    if (entries.length > 0) {
      return entries;
    }

    await delay(waitFor);
    waitFor = Math.min(waitFor * 2, maxDelay);
  }

  return entries;
}

export function formatFlyLogEntry(entry: FlyLogsEntry): string {
  const prefix = [
    entry.timestamp || '',
    entry.region ? `[${entry.region}]` : '',
    entry.instance ? `[${entry.instance}]` : '',
    entry.level ? `${entry.level}:` : '',
  ].filter(Boolean).join(' ');
  const message = entry.message || '';
  return prefix ? `${prefix} ${message}`.trimEnd() : message;
}

/**
 * A single subtask extracted from an add-task.ts invocation in the worker logs.
 * Subtasks use the convention `"Name: description"` — the name becomes the card
 * title, the full string is the card prompt.
 */
export interface ParsedAddTaskSubtask {
  /** Full subtask string, including the "Name:" prefix. */
  raw: string;
  /** Portion before the first colon — used as the card title. */
  name: string;
  /** Portion after the first colon — used as the card description. */
  description: string;
  /** Skill file the parent task is attached to (e.g. skills/tasks/build/writeApp.md). */
  skill: string;
  /** Optional app name associated with the task. */
  app: string | null;
}

/**
 * Parse an `add-task.ts` tool invocation out of a Fly log message. The worker
 * emits lines shaped like:
 *   [2026-04-17T01:23:15Z] {"type":"tool","tool":"$ npx tsx /repo/scripts/add-task.ts <<'EOF'\n[...]\nEOF"}
 * Returns all subtasks across all tasks in the HEREDOC, or `null` if the line
 * isn't an add-task invocation.
 */
export function parseAddTaskLogMessage(
  message: string,
): ParsedAddTaskSubtask[] | null {
  const jsonStart = message.indexOf('{"type":"tool"');
  if (jsonStart < 0) return null;

  let payload: { type?: unknown; tool?: unknown };
  try {
    payload = JSON.parse(message.slice(jsonStart)) as typeof payload;
  } catch {
    return null;
  }
  if (payload.type !== 'tool' || typeof payload.tool !== 'string') return null;
  if (!/\badd-task\.ts\b/.test(payload.tool)) return null;

  const heredocMatch = payload.tool.match(/<<'EOF'\s*\n([\s\S]*?)\nEOF\b/);
  if (!heredocMatch) return null;

  let tasks: unknown;
  try {
    tasks = JSON.parse(heredocMatch[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(tasks)) return null;

  const result: ParsedAddTaskSubtask[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const task = raw as { skill?: unknown; app?: unknown; subtasks?: unknown };
    if (typeof task.skill !== 'string') continue;
    if (!Array.isArray(task.subtasks)) continue;
    const app = typeof task.app === 'string' ? task.app : null;
    for (const sub of task.subtasks) {
      if (typeof sub !== 'string') continue;
      const trimmed = sub.trim();
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(':');
      const name = colonIndex > 0 ? trimmed.slice(0, colonIndex).trim() : trimmed;
      const description = colonIndex > 0 ? trimmed.slice(colonIndex + 1).trim() : '';
      result.push({ raw: trimmed, name, description, skill: task.skill, app });
    }
  }

  return result.length > 0 ? result : null;
}

export const DEFAULT_FLY_LOG_BUFFER_LIMIT = 500;

/**
 * Merge a fresh Fly logs page into an existing ring buffer, dedup by formatted
 * string (effectively (timestamp, instance, message) tuple after formatting),
 * and return the delta + bounded buffer + advanced timestamp.
 */
export function mergeFlyLogDelta(
  existingBuffer: readonly string[],
  entries: readonly FlyLogsEntry[],
  options: {
    lastTimestamp?: string | null;
    bufferLimit?: number;
  } = {},
): {
  newFormatted: string[];
  mergedBuffer: string[];
  latestTimestamp: string | null;
} {
  const limit = options.bufferLimit ?? DEFAULT_FLY_LOG_BUFFER_LIMIT;
  const seen = new Set(existingBuffer);
  const newFormatted: string[] = [];
  let latestTimestamp = options.lastTimestamp ?? null;

  for (const entry of entries) {
    const formatted = formatFlyLogEntry(entry);
    if (seen.has(formatted)) continue;
    seen.add(formatted);
    newFormatted.push(formatted);
    if (
      entry.timestamp
      && (!latestTimestamp || entry.timestamp > latestTimestamp)
    ) {
      latestTimestamp = entry.timestamp;
    }
  }

  const mergedBuffer = [...existingBuffer, ...newFormatted].slice(-limit);
  return { newFormatted, mergedBuffer, latestTimestamp };
}

export async function fetchAppBuildingEvents(
  baseUrl: string,
  instanceId: string | null,
  offset = 0,
): Promise<AppBuildingOffsetBatch> {
  return fetchJson<AppBuildingOffsetBatch>(
    `${baseUrl.replace(/\/+$/, '')}/events?offset=${offset}`,
    {
      headers: workerHeaders(instanceId),
    },
    'Worker events',
  );
}

export async function postAppBuildingMessage(
  baseUrl: string,
  instanceId: string | null,
  prompt: string,
): Promise<void> {
  await fetchJson<{ ok: boolean }>(
    `${baseUrl.replace(/\/+$/, '')}/message`,
    {
      method: 'POST',
      headers: {
        ...workerHeaders(instanceId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    },
    'Worker message',
  );
}

export async function postAppBuildingStop(
  baseUrl: string,
  instanceId: string | null,
): Promise<void> {
  await fetchJson<{ stopping: boolean }>(
    `${baseUrl.replace(/\/+$/, '')}/stop`,
    {
      method: 'POST',
      headers: {
        ...workerHeaders(instanceId),
        'content-type': 'application/json',
      },
    },
    'Worker stop',
  );
}
