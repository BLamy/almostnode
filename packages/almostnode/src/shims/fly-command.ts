import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import {
  cancelPreparedFlyAuthPopup,
  deleteFlyAccessToken,
  fetchFlyCurrentUser,
  normalizeFlyApiBaseUrl,
  openFlyAuthWindow,
  readFlyAccessToken,
  startFlyCliSession,
  waitForFlyCliSessionToken,
  writeFlyAccessToken,
} from './fly-auth';

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

function resolveFlyToken(vfs: VirtualFS, ctx: CommandContext): string | null {
  const env = envToRecord(ctx.env);
  const envToken = env.FLY_ACCESS_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  return readFlyAccessToken(vfs);
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
    'fly - Fly.io auth integration for almostnode\n\n' +
    'Commands:\n' +
    '  login                        Start the browser-based Fly login flow\n' +
    '  logout                       Remove the saved Fly access token\n' +
    '  auth login                   Start the browser-based Fly login flow\n' +
    '  auth logout                  Remove the saved Fly access token\n' +
    '  auth token                   Print the saved Fly access token\n' +
    '  auth whoami                  Print the current Fly account email\n' +
    '  auth status                  Show current Fly authentication status\n\n' +
    'Common flags:\n' +
    '      --api-url <url>          Override the Fly API base URL\n'
  );
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

  const token = resolveFlyToken(vfs, ctx);
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

  const token = resolveFlyToken(vfs, ctx);
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

  const token = resolveFlyToken(vfs, ctx);
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
