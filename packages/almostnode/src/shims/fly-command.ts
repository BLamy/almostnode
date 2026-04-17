import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import {
  cancelPreparedFlyAuthPopup,
  deleteFlyAccessToken,
  fetchFlyCurrentUser,
  getFlyAuthorizationHeader,
  normalizeFlyApiBaseUrl,
  openFlyAuthWindow,
  readFlyAccessToken,
  readFlyAppName,
  startFlyCliSession,
  waitForFlyCliSessionToken,
  writeFlyAccessToken,
} from './fly-auth';

const DEFAULT_FLY_MACHINES_API_BASE_URL = 'https://api.machines.dev/v1';
const APP_BUILDING_CONFIG_PATH = '/__almostnode/keychain/app-building-config.json';
const DEFAULT_FLY_LOG_LINES = 200;

interface FlyAppBuildingDefaults {
  flyAppName: string | null;
  flyApiToken: string | null;
}

interface FlyMachineRecord {
  id?: string;
  instance_id?: string | null;
  name?: string;
  state?: string;
  region?: string;
  private_ip?: string;
  created_at?: string;
  updated_at?: string;
  image_ref?: string;
  config?: {
    image?: string;
  };
}

interface FlyMachineListOptions {
  app: string;
  json: boolean;
}

interface FlyMachineStatusOptions extends FlyMachineListOptions {
  machineId: string;
}

interface FlyLogsEntry {
  instance?: string;
  level?: string;
  message?: string;
  region?: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

interface FlyLogsPage {
  entries: FlyLogsEntry[];
  nextToken: string;
}

interface FlyLogsOptions extends FlyMachineListOptions {
  lines: number;
  machineId: string | null;
  region: string | null;
}

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function envToRecord(
  env: Map<string, string> | Record<string, string> | undefined,
): Record<string, string> {
  if (!env) {
    return {};
  }
  if (env instanceof Map) {
    return Object.fromEntries(env);
  }
  return env;
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function abortResult(): JustBashExecResult {
  return err('fly: command aborted\n', 130);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAppBuildingFlyDefaults(vfs: VirtualFS): FlyAppBuildingDefaults {
  if (!vfs.existsSync(APP_BUILDING_CONFIG_PATH)) {
    return {
      flyAppName: null,
      flyApiToken: null,
    };
  }

  try {
    const raw = vfs.readFileSync(APP_BUILDING_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      flyAppName?: unknown;
      flyApiToken?: unknown;
    };
    return {
      flyAppName: typeof parsed.flyAppName === 'string' && parsed.flyAppName.trim()
        ? parsed.flyAppName.trim()
        : null,
      flyApiToken: typeof parsed.flyApiToken === 'string' && parsed.flyApiToken.trim()
        ? parsed.flyApiToken.trim()
        : null,
    };
  } catch {
    return {
      flyAppName: null,
      flyApiToken: null,
    };
  }
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

async function fetchFlyJson<T>(
  baseUrl: string,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', getFlyAuthorizationHeader(token));
  if (!headers.has('content-type') && init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const response = await runtimeFetch(
    `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
    {
      ...init,
      headers,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${body || response.statusText}`);
  }

  return await response.json() as T;
}

function parseCommonFlags(args: string[]): {
  options: { apiUrl?: string };
  rest: string[];
  error?: string;
} {
  const options: { apiUrl?: string } = {};
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--api-url') {
      const value = args[index + 1];
      if (!value) {
        return { options, rest: [], error: 'missing value for --api-url' };
      }
      options.apiUrl = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--api-url=')) {
      options.apiUrl = arg.slice('--api-url='.length);
      index += 1;
      continue;
    }
    break;
  }

  return { options, rest: args.slice(index) };
}

function resolveApiUrl(args: string[], ctx: CommandContext): {
  apiUrl: string;
  rest: string[];
  error?: string;
} {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return {
      apiUrl: normalizeFlyApiBaseUrl(),
      rest: [],
      error: parsed.error,
    };
  }

  const env = envToRecord(ctx.env);
  return {
    apiUrl: normalizeFlyApiBaseUrl(parsed.options.apiUrl || env.FLY_API_BASE_URL),
    rest: parsed.rest,
  };
}

function resolveStoredFlyToken(vfs: VirtualFS, ctx: CommandContext): string | null {
  const env = envToRecord(ctx.env);
  const envToken = env.FLY_ACCESS_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  return readFlyAccessToken(vfs);
}

function resolveFlyCommandToken(vfs: VirtualFS, ctx: CommandContext): string | null {
  const env = envToRecord(ctx.env);
  const envToken = env.FLY_ACCESS_TOKEN?.trim() || env.FLY_API_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const defaults = readAppBuildingFlyDefaults(vfs);
  if (defaults.flyApiToken) {
    return defaults.flyApiToken;
  }

  return readFlyAccessToken(vfs);
}

function resolveFlyCommandApp(
  vfs: VirtualFS,
  ctx: CommandContext,
  explicitApp?: string,
): string | null {
  const normalizedExplicit = explicitApp?.trim();
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const env = envToRecord(ctx.env);
  const envApp = env.FLY_APP_NAME?.trim() || env.FLY_APP?.trim();
  if (envApp) {
    return envApp;
  }

  const flyConfigApp = readFlyAppName(vfs);
  if (flyConfigApp) {
    return flyConfigApp;
  }

  return readAppBuildingFlyDefaults(vfs).flyAppName;
}

function buildSessionName(ctx: CommandContext): string {
  const env = envToRecord(ctx.env);
  const preferredName = env.HOSTNAME?.trim()
    || env.USER?.trim()
    || (typeof window !== 'undefined' && window.location?.hostname)
    || 'almostnode';
  return preferredName;
}

function buildHelpText(): string {
  return (
    'fly - Fly.io auth and machine tools for almostnode\n\n' +
    'Commands:\n' +
    '  login                        Start the browser-based Fly login flow\n' +
    '  logout                       Remove the saved Fly access token\n' +
    '  list                         List Fly Machines for the current Fly app\n' +
    '  machine list                 List Fly Machines for the current Fly app\n' +
    '  machine status <machine-id>  Show a Fly Machine status snapshot\n' +
    '  logs [machine-id]            Fetch recent Fly logs for the app or one machine\n' +
    '  auth login                   Start the browser-based Fly login flow\n' +
    '  auth logout                  Remove the saved Fly access token\n' +
    '  auth token                   Print the saved Fly access token\n' +
    '  auth whoami                  Print the current Fly account email\n' +
    '  auth status                  Show current Fly authentication status\n\n' +
    'Common flags:\n' +
    '      --api-url <url>          Override the Fly API base URL\n' +
    '  -a, --app <name>             Override the Fly app name for machine/log commands\n'
  );
}

function truncateValue(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return value.slice(0, maxWidth);
  }
  return `${value.slice(0, maxWidth - 1)}…`;
}

function renderTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, columnIndex) => (
    allRows.reduce((max, row) => Math.max(max, row[columnIndex]?.length ?? 0), 0)
  ));

  return `${allRows.map((row) => (
    row.map((cell, columnIndex) => cell.padEnd(widths[columnIndex] || 0)).join('  ').trimEnd()
  )).join('\n')}\n`;
}

function machineImage(machine: FlyMachineRecord): string {
  return machine.config?.image || machine.image_ref || '';
}

function machineDisplayName(machine: FlyMachineRecord): string {
  return machine.name || machine.id || '';
}

function machineInstanceId(machine: FlyMachineRecord): string | null {
  return typeof machine.instance_id === 'string' && machine.instance_id.trim()
    ? machine.instance_id.trim()
    : null;
}

function formatMachineList(machines: FlyMachineRecord[]): string {
  if (machines.length === 0) {
    return 'No Fly Machines found.\n';
  }

  const rows = machines.map((machine) => [
    machine.id || '',
    machineInstanceId(machine) || '',
    machineDisplayName(machine),
    machine.state || '',
    machine.region || '',
    truncateValue(machineImage(machine), 44),
  ]);

  return renderTable(
    ['MACHINE ID', 'INSTANCE ID', 'NAME', 'STATE', 'REGION', 'IMAGE'],
    rows,
  );
}

function formatMachineStatus(appName: string, machine: FlyMachineRecord): string {
  const lines = [
    `App: ${appName}`,
    `Machine ID: ${machine.id || '(unknown)'}`,
    `Instance ID: ${machineInstanceId(machine) || '(unknown)'}`,
    `Name: ${machineDisplayName(machine) || '(unknown)'}`,
    `State: ${machine.state || '(unknown)'}`,
    `Region: ${machine.region || '(unknown)'}`,
  ];

  if (machine.private_ip) {
    lines.push(`Private IP: ${machine.private_ip}`);
  }
  const image = machineImage(machine);
  if (image) {
    lines.push(`Image: ${image}`);
  }
  if (machine.created_at) {
    lines.push(`Created: ${machine.created_at}`);
  }
  if (machine.updated_at) {
    lines.push(`Updated: ${machine.updated_at}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatLogEntry(entry: FlyLogsEntry): string {
  const prefix = [
    entry.timestamp || '',
    entry.region ? `[${entry.region}]` : '',
    entry.instance ? `[${entry.instance}]` : '',
    entry.level ? `${entry.level}:` : '',
  ].filter(Boolean).join(' ');
  const message = entry.message || '';
  return prefix ? `${prefix} ${message}`.trimEnd() : message;
}

function parseMachineListArgs(args: string[]): {
  options?: FlyMachineListOptions;
  error?: string;
} {
  let app: string | undefined;
  let json = false;
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--app' || arg === '-a') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'missing value for --app' };
      }
      app = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--app=')) {
      app = arg.slice('--app='.length);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      index += 1;
      continue;
    }
    return { error: `unknown argument '${arg}'` };
  }

  return {
    options: {
      app: app || '',
      json,
    },
  };
}

function parseMachineStatusArgs(args: string[]): {
  options?: FlyMachineStatusOptions;
  error?: string;
} {
  let app: string | undefined;
  let json = false;
  let machineId = '';
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--app' || arg === '-a') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'missing value for --app' };
      }
      app = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--app=')) {
      app = arg.slice('--app='.length);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `unknown argument '${arg}'` };
    }
    if (machineId) {
      return { error: `unexpected argument '${arg}'` };
    }
    machineId = arg;
    index += 1;
  }

  if (!machineId) {
    return { error: 'usage: fly machine status <machine-id>' };
  }

  return {
    options: {
      app: app || '',
      json,
      machineId,
    },
  };
}

function parseLogsArgs(args: string[]): {
  options?: FlyLogsOptions;
  error?: string;
} {
  let app: string | undefined;
  let json = false;
  let lines = DEFAULT_FLY_LOG_LINES;
  let machineId: string | null = null;
  let region: string | null = null;
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--app' || arg === '-a') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'missing value for --app' };
      }
      app = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--app=')) {
      app = arg.slice('--app='.length);
      index += 1;
      continue;
    }
    if (arg === '--machine' || arg === '--instance') {
      const value = args[index + 1];
      if (!value) {
        return { error: `missing value for ${arg}` };
      }
      machineId = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--machine=')) {
      machineId = arg.slice('--machine='.length);
      index += 1;
      continue;
    }
    if (arg.startsWith('--instance=')) {
      machineId = arg.slice('--instance='.length);
      index += 1;
      continue;
    }
    if (arg === '--region' || arg === '-r') {
      const value = args[index + 1];
      if (!value) {
        return { error: `missing value for ${arg}` };
      }
      region = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--region=')) {
      region = arg.slice('--region='.length);
      index += 1;
      continue;
    }
    if (arg === '--lines') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'missing value for --lines' };
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { error: '--lines must be a positive integer' };
      }
      lines = parsed;
      index += 2;
      continue;
    }
    if (arg.startsWith('--lines=')) {
      const parsed = Number.parseInt(arg.slice('--lines='.length), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { error: '--lines must be a positive integer' };
      }
      lines = parsed;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `unknown argument '${arg}'` };
    }
    if (machineId) {
      return { error: `unexpected argument '${arg}'` };
    }
    machineId = arg;
    index += 1;
  }

  return {
    options: {
      app: app || '',
      json,
      lines,
      machineId,
      region,
    },
  };
}

async function listFlyMachines(
  appName: string,
  token: string,
): Promise<FlyMachineRecord[]> {
  return fetchFlyJson<FlyMachineRecord[]>(
    DEFAULT_FLY_MACHINES_API_BASE_URL,
    `/apps/${encodeURIComponent(appName)}/machines`,
    token,
  );
}

async function getFlyMachine(
  appName: string,
  machineId: string,
  token: string,
): Promise<FlyMachineRecord> {
  return fetchFlyJson<FlyMachineRecord>(
    DEFAULT_FLY_MACHINES_API_BASE_URL,
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
    token,
  );
}

async function fetchFlyLogsPage(
  apiUrl: string,
  appName: string,
  token: string,
  options: {
    nextToken?: string;
    region?: string | null;
    instanceId?: string | null;
  },
): Promise<FlyLogsPage> {
  const url = new URL(
    `${normalizeFlyApiBaseUrl(apiUrl)}/api/v1/apps/${encodeURIComponent(appName)}/logs`,
  );

  url.searchParams.set('next_token', options.nextToken ?? '');
  if (options.region) {
    url.searchParams.set('region', options.region);
  }
  if (options.instanceId) {
    url.searchParams.set('instance', options.instanceId);
  }

  const response = await runtimeFetch(url.toString(), {
    headers: {
      authorization: getFlyAuthorizationHeader(token),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET /api/v1/apps/${appName}/logs failed (${response.status}): ${body || response.statusText}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBufferedFlyLogs(
  apiUrl: string,
  appName: string,
  token: string,
  options: {
    region?: string | null;
    instanceId?: string | null;
  },
): Promise<FlyLogsEntry[]> {
  const MAX_ATTEMPTS = 6;
  const MAX_PAGES = 32;
  const INITIAL_DELAY = 400;
  const MAX_DELAY = 2_000;

  const entries: FlyLogsEntry[] = [];
  let nextToken = '';
  let waitFor = INITIAL_DELAY;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let pagesThisAttempt = 0;
    while (pagesThisAttempt < MAX_PAGES) {
      const page = await fetchFlyLogsPage(apiUrl, appName, token, {
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
        if (page.entries.length < 50) {
          break;
        }
      }
    }

    if (entries.length > 0) {
      return entries;
    }

    await sleep(waitFor);
    waitFor = Math.min(waitFor * 2, MAX_DELAY);
  }

  return entries;
}

async function runListCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly list: ${resolved.error}\n`);
  }

  const parsed = parseMachineListArgs(resolved.rest);
  if (parsed.error || !parsed.options) {
    return err(`fly list: ${parsed.error || 'invalid arguments'}\n`);
  }

  const token = resolveFlyCommandToken(vfs, ctx);
  if (!token) {
    return err('No Fly token configured. Run `fly auth login` or save Fly app builder credentials first.\n');
  }

  const appName = resolveFlyCommandApp(vfs, ctx, parsed.options.app);
  if (!appName) {
    return err('No Fly app configured. Pass `--app <name>` or save an app name in the App Builder setup.\n');
  }

  try {
    const machines = await listFlyMachines(appName, token);
    if (parsed.options.json) {
      return ok(`${JSON.stringify(machines, null, 2)}\n`);
    }
    return ok(formatMachineList(machines));
  } catch (error) {
    return err(`fly list: ${formatErrorMessage(error)}\n`);
  }
}

async function runMachineStatusCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly machine status: ${resolved.error}\n`);
  }

  const parsed = parseMachineStatusArgs(resolved.rest);
  if (parsed.error || !parsed.options) {
    return err(`fly machine status: ${parsed.error || 'invalid arguments'}\n`);
  }

  const token = resolveFlyCommandToken(vfs, ctx);
  if (!token) {
    return err('No Fly token configured. Run `fly auth login` or save Fly app builder credentials first.\n');
  }

  const appName = resolveFlyCommandApp(vfs, ctx, parsed.options.app);
  if (!appName) {
    return err('No Fly app configured. Pass `--app <name>` or save an app name in the App Builder setup.\n');
  }

  try {
    const machine = await getFlyMachine(appName, parsed.options.machineId, token);
    if (parsed.options.json) {
      return ok(`${JSON.stringify(machine, null, 2)}\n`);
    }
    return ok(formatMachineStatus(appName, machine));
  } catch (error) {
    return err(`fly machine status: ${formatErrorMessage(error)}\n`);
  }
}

async function runLogsCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly logs: ${resolved.error}\n`);
  }

  const parsed = parseLogsArgs(resolved.rest);
  if (parsed.error || !parsed.options) {
    return err(`fly logs: ${parsed.error || 'invalid arguments'}\n`);
  }

  const token = resolveFlyCommandToken(vfs, ctx);
  if (!token) {
    return err('No Fly token configured. Run `fly auth login` or save Fly app builder credentials first.\n');
  }

  const appName = resolveFlyCommandApp(vfs, ctx, parsed.options.app);
  if (!appName) {
    return err('No Fly app configured. Pass `--app <name>` or save an app name in the App Builder setup.\n');
  }

  try {
    // Fly's logs API `instance` param takes a machine ID (not the instance_id from
    // Machines API). When filtering by machine, region is forced empty — machine IDs
    // are globally unique, and a region filter would hide logs from other regions.
    const instanceId = parsed.options.machineId || null;
    const region = instanceId ? null : parsed.options.region;

    const entries = await fetchBufferedFlyLogs(
      resolved.apiUrl,
      appName,
      token,
      {
        region,
        instanceId,
      },
    );

    const limitedEntries = entries.slice(-parsed.options.lines);
    if (parsed.options.json) {
      return ok(`${JSON.stringify(limitedEntries, null, 2)}\n`);
    }

    if (limitedEntries.length === 0) {
      return ok('No logs found.\n');
    }

    return ok(`${limitedEntries.map(formatLogEntry).join('\n')}\n`);
  } catch (error) {
    return err(`fly logs: ${formatErrorMessage(error)}\n`);
  }
}

async function runMachineCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return runListCommand(rest, ctx, vfs);
    case 'status':
      return runMachineStatusCommand(rest, ctx, vfs);
    default:
      return err(`fly machine: unknown command '${subcommand || ''}'\n`, 2);
  }
}

async function runLoginCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    cancelPreparedFlyAuthPopup();
    return err(`fly login: ${resolved.error}\n`);
  }

  let session;
  try {
    session = await startFlyCliSession(
      resolved.apiUrl,
      buildSessionName(ctx),
      {
        signup: false,
        target: 'auth',
      },
    );
  } catch (error) {
    cancelPreparedFlyAuthPopup();
    return err(`Failed to start Fly login: ${formatErrorMessage(error)}\n`);
  }

  if (!session.authUrl) {
    cancelPreparedFlyAuthPopup();
    return err('Fly login did not return an authentication URL.\n');
  }

  openFlyAuthWindow(session.authUrl);

  const outputPrefix =
    `Opening ${session.authUrl} ...\n` +
    'If a browser tab did not open, paste that URL into a browser manually.\n\n' +
    'Waiting for Fly authentication...\n';

  let accessToken: string;
  try {
    accessToken = await waitForFlyCliSessionToken(
      resolved.apiUrl,
      session.id,
      {
        signal: ctx.signal,
      },
    );
  } catch (error) {
    if (isAbortError(error) || signalAborted(ctx.signal)) {
      return abortResult();
    }
    return err(`${outputPrefix}${formatErrorMessage(error)}\n`);
  }

  writeFlyAccessToken(vfs, accessToken);
  await keychain?.persistCurrentState().catch(() => {});

  try {
    const user = await fetchFlyCurrentUser(resolved.apiUrl, accessToken);
    if (user.email) {
      return ok(`${outputPrefix}Successfully logged in as ${user.email}\n`);
    }
  } catch {
    // A fresh token was issued and persisted already. Keep the login successful.
  }

  return ok(`${outputPrefix}Successfully logged in to Fly.io.\n`);
}

async function runLogoutCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly logout: ${resolved.error}\n`);
  }

  const removed = deleteFlyAccessToken(vfs);
  if (removed) {
    await keychain?.persistCurrentState().catch(() => {});
    return ok('Removed Fly.io login state.\n');
  }

  return ok('Fly.io is already logged out.\n');
}

async function runTokenCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly auth token: ${resolved.error}\n`);
  }

  const token = resolveStoredFlyToken(vfs, ctx);
  if (!token) {
    return err('Not authenticated. Run `fly auth login` first.\n');
  }

  return ok(`${token}\n`);
}

async function runWhoamiCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly auth whoami: ${resolved.error}\n`);
  }

  const token = resolveStoredFlyToken(vfs, ctx);
  if (!token) {
    return err('Not authenticated. Run `fly auth login` first.\n');
  }

  try {
    const user = await fetchFlyCurrentUser(resolved.apiUrl, token);
    if (user.email) {
      return ok(`${user.email}\n`);
    }
    return err('Authenticated but Fly did not return an account email.\n');
  } catch (error) {
    return err(`fly auth whoami: ${formatErrorMessage(error)}\n`);
  }
}

async function runStatusCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveApiUrl(args, ctx);
  if (resolved.error) {
    return err(`fly auth status: ${resolved.error}\n`);
  }

  const token = resolveStoredFlyToken(vfs, ctx);
  if (!token) {
    return ok('Not logged in to Fly.io. Run `fly auth login` to authenticate.\n');
  }

  try {
    const user = await fetchFlyCurrentUser(resolved.apiUrl, token);
    return ok(
      user.email
        ? `Logged in to Fly.io as ${user.email}\n`
        : 'Logged in to Fly.io\n',
    );
  } catch (error) {
    return err(`Saved Fly token is no longer valid: ${formatErrorMessage(error)}\n`);
  }
}

async function runAuthCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const [subcommand = 'status', ...rest] = args;

  switch (subcommand) {
    case 'login':
      return runLoginCommand(rest, ctx, vfs, keychain);
    case 'logout':
      return runLogoutCommand(rest, ctx, vfs, keychain);
    case 'token':
      return runTokenCommand(rest, ctx, vfs);
    case 'whoami':
      return runWhoamiCommand(rest, ctx, vfs);
    case 'status':
      return runStatusCommand(rest, ctx, vfs);
    default:
      return err(`fly auth: unknown command '${subcommand}'\n`, 2);
  }
}

export async function runFlyCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  try {
    const [subcommand, ...rest] = args;

    switch (subcommand) {
      case undefined:
      case 'help':
      case '--help':
        return ok(buildHelpText());
      case 'login':
        return runLoginCommand(rest, ctx, vfs, keychain);
      case 'logout':
        return runLogoutCommand(rest, ctx, vfs, keychain);
      case 'list':
        return runListCommand(rest, ctx, vfs);
      case 'logs':
        return runLogsCommand(rest, ctx, vfs);
      case 'machine':
      case 'machines':
        return runMachineCommand(rest, ctx, vfs);
      case 'auth':
        return runAuthCommand(rest, ctx, vfs, keychain);
      case 'version':
      case '--version':
        return ok('fly v0.0.0-almostnode\n');
      default:
        return err(`fly: unknown command '${subcommand}'\n`, 2);
    }
  } catch (error) {
    if (isAbortError(error) || signalAborted(ctx.signal)) {
      return abortResult();
    }
    return err(`fly: ${formatErrorMessage(error)}\n`);
  }
}
