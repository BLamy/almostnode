import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import {
  buildNetlifyAuthorizeUrl,
  cancelPreparedNetlifyAuthPopup,
  createNetlifyTicket,
  DEFAULT_NETLIFY_WEB_UI_URL,
  deleteNetlifyAccessToken,
  exchangeNetlifyTicket,
  fetchNetlifyCurrentUser,
  normalizeNetlifyApiBaseUrl,
  normalizeNetlifyWebUiUrl,
  openNetlifyAuthWindow,
  readNetlifyAccessToken,
  waitForNetlifyTicketAccessToken,
  writeNetlifyAccessToken,
  getNetlifyTicket,
} from './netlify-auth';

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
  return err('netlify: command aborted\n', 130);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveStoredToken(vfs: VirtualFS, ctx: CommandContext): string | null {
  const env = envToRecord(ctx.env);
  const envToken = env.NETLIFY_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  return readNetlifyAccessToken(vfs);
}

function buildHelpText(): string {
  return (
    'netlify - Netlify auth integration for almostnode\n\n' +
    'Commands:\n' +
    '  login                        Start the browser-based Netlify login flow\n' +
    '  login --request <message>    Create an approval ticket for another human to authorize\n' +
    '  login --check <ticket>       Check a pending approval ticket and save the token if approved\n' +
    '  logout                       Remove the saved Netlify access token\n' +
    '  status                       Show current Netlify authentication status\n' +
    '  auth token                   Print the saved Netlify access token\n' +
    '  auth whoami                  Print the current Netlify account email\n' +
    '  auth status                  Show current Netlify authentication status\n\n' +
    'Common flags:\n' +
    '      --api-url <url>          Override the Netlify API base URL\n' +
    '      --web-ui <url>           Override the Netlify app URL used for authorization\n'
  );
}

function parseCommonFlags(args: string[]): {
  options: { apiUrl?: string; webUiUrl?: string };
  rest: string[];
  error?: string;
} {
  const options: { apiUrl?: string; webUiUrl?: string } = {};
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
    if (arg === '--web-ui') {
      const value = args[index + 1];
      if (!value) {
        return { options, rest: [], error: 'missing value for --web-ui' };
      }
      options.webUiUrl = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--web-ui=')) {
      options.webUiUrl = arg.slice('--web-ui='.length);
      index += 1;
      continue;
    }
    break;
  }

  return { options, rest: args.slice(index) };
}

function resolveCommonFlags(args: string[], ctx: CommandContext): {
  apiUrl: string;
  rest: string[];
  webUiUrl: string;
  error?: string;
} {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return {
      apiUrl: normalizeNetlifyApiBaseUrl(),
      webUiUrl: normalizeNetlifyWebUiUrl(DEFAULT_NETLIFY_WEB_UI_URL),
      rest: [],
      error: parsed.error,
    };
  }

  const env = envToRecord(ctx.env);
  return {
    apiUrl: normalizeNetlifyApiBaseUrl(parsed.options.apiUrl || env.NETLIFY_API_BASE_URL),
    webUiUrl: normalizeNetlifyWebUiUrl(parsed.options.webUiUrl || env.NETLIFY_WEB_UI_URL),
    rest: parsed.rest,
  };
}

function parseLoginFlags(args: string[], ctx: CommandContext): {
  options: {
    apiUrl: string;
    check?: string;
    request?: string;
    webUiUrl: string;
  };
  error?: string;
} {
  const common = resolveCommonFlags(args, ctx);
  if (common.error) {
    return { options: { apiUrl: common.apiUrl, webUiUrl: common.webUiUrl }, error: common.error };
  }

  let request: string | undefined;
  let check: string | undefined;
  let index = 0;
  const rest = common.rest;

  while (index < rest.length) {
    const arg = rest[index];
    if (arg === '--request') {
      const value = rest[index + 1];
      if (!value) {
        return {
          options: { apiUrl: common.apiUrl, webUiUrl: common.webUiUrl },
          error: 'missing value for --request',
        };
      }
      request = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--request=')) {
      request = arg.slice('--request='.length);
      index += 1;
      continue;
    }
    if (arg === '--check') {
      const value = rest[index + 1];
      if (!value) {
        return {
          options: { apiUrl: common.apiUrl, webUiUrl: common.webUiUrl },
          error: 'missing value for --check',
        };
      }
      check = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--check=')) {
      check = arg.slice('--check='.length);
      index += 1;
      continue;
    }

    return {
      options: { apiUrl: common.apiUrl, webUiUrl: common.webUiUrl, check, request },
      error: `unknown argument '${arg}'`,
    };
  }

  if (request && check) {
    return {
      options: { apiUrl: common.apiUrl, webUiUrl: common.webUiUrl, check, request },
      error: '`--request` and `--check` are mutually exclusive',
    };
  }

  return {
    options: {
      apiUrl: common.apiUrl,
      webUiUrl: common.webUiUrl,
      check,
      request,
    },
  };
}

async function persistAuthorizedToken(
  vfs: VirtualFS,
  apiUrl: string,
  accessToken: string,
  fallback?: {
    email?: string | null;
    userId?: string | null;
  },
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<{ email: string | null; name: string | null; userId: string | null }> {
  let currentUser;
  try {
    currentUser = await fetchNetlifyCurrentUser(apiUrl, accessToken);
  } catch {
    currentUser = {
      id: fallback?.userId ?? null,
      email: fallback?.email ?? null,
      name: null,
    };
  }

  writeNetlifyAccessToken(vfs, {
    accessToken,
    userId: currentUser.id,
    email: currentUser.email,
    name: currentUser.name,
  });
  await keychain?.persistCurrentState().catch(() => {});

  return {
    email: currentUser.email,
    name: currentUser.name,
    userId: currentUser.id,
  };
}

async function runLoginRequestCommand(
  args: string[],
  ctx: CommandContext,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify login: ${resolved.error}\n`);
  }

  const rest = resolved.rest;
  let message: string | undefined;

  if (rest[0] === '--request') {
    message = rest[1];
    if (!message) {
      return err('netlify login: missing value for --request\n');
    }
  } else if (rest[0]?.startsWith('--request=')) {
    message = rest[0].slice('--request='.length);
  } else {
    return err('netlify login: missing value for --request\n');
  }

  try {
    const ticket = await createNetlifyTicket(resolved.apiUrl, { message });
    const authUrl = buildNetlifyAuthorizeUrl(resolved.webUiUrl, ticket.id);
    return ok(
      `Ticket ID: ${ticket.id}\n` +
      `Authorize URL: ${authUrl}\n\n` +
      `After authorizing, run: netlify login --check ${ticket.id}\n` +
      'After approval, the login will be complete.\n',
    );
  } catch (error) {
    return err(`Failed to start Netlify login: ${formatErrorMessage(error)}\n`);
  }
}

async function runLoginCheckCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify login: ${resolved.error}\n`);
  }

  const rest = resolved.rest;
  let ticketId: string | undefined;
  if (rest[0] === '--check') {
    ticketId = rest[1];
  } else if (rest[0]?.startsWith('--check=')) {
    ticketId = rest[0].slice('--check='.length);
  }
  if (!ticketId) {
    return err('netlify login: missing value for --check\n');
  }

  try {
    const ticket = await getNetlifyTicket(resolved.apiUrl, ticketId);
    if (!ticket.authorized) {
      return ok('Status: pending\n');
    }

    const exchange = await exchangeNetlifyTicket(resolved.apiUrl, ticketId);
    const token = exchange.accessToken?.trim();
    if (!token) {
      return err('Could not retrieve Netlify access token.\n');
    }

    const user = await persistAuthorizedToken(
      vfs,
      resolved.apiUrl,
      token,
      {
        email: exchange.userEmail,
        userId: exchange.userId,
      },
      keychain,
    );

    return ok(
      `Status: authorized\n` +
      `Name: ${user.name ?? ''}\n` +
      `Email: ${user.email ?? ''}\n`,
    );
  } catch (error) {
    const message = formatErrorMessage(error);
    if (message === 'Authorization was denied or the login session expired.') {
      return ok('Status: denied\n');
    }
    return err(`netlify login: ${message}\n`);
  }
}

async function runLoginCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const loginFlags = parseLoginFlags(args, ctx);
  if (loginFlags.error) {
    cancelPreparedNetlifyAuthPopup();
    return err(`netlify login: ${loginFlags.error}\n`);
  }

  if (loginFlags.options.request) {
    return runLoginRequestCommand(
      [
        '--api-url', loginFlags.options.apiUrl,
        '--web-ui', loginFlags.options.webUiUrl,
        '--request', loginFlags.options.request,
      ],
      ctx,
    );
  }

  if (loginFlags.options.check) {
    return runLoginCheckCommand(
      [
        '--api-url', loginFlags.options.apiUrl,
        '--web-ui', loginFlags.options.webUiUrl,
        '--check', loginFlags.options.check,
      ],
      ctx,
      vfs,
      keychain,
    );
  }

  let ticket;
  try {
    ticket = await createNetlifyTicket(loginFlags.options.apiUrl);
  } catch (error) {
    cancelPreparedNetlifyAuthPopup();
    return err(`Failed to start Netlify login: ${formatErrorMessage(error)}\n`);
  }

  const authUrl = buildNetlifyAuthorizeUrl(loginFlags.options.webUiUrl, ticket.id);
  openNetlifyAuthWindow(authUrl);

  const outputPrefix =
    `Opening ${authUrl} ...\n` +
    'If a browser tab did not open, paste that URL into a browser manually.\n\n' +
    'Waiting for Netlify authentication...\n';

  let exchange;
  try {
    exchange = await waitForNetlifyTicketAccessToken(
      loginFlags.options.apiUrl,
      ticket.id,
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

  const token = exchange.accessToken?.trim();
  if (!token) {
    return err(`${outputPrefix}Netlify did not return an access token.\n`);
  }

  const user = await persistAuthorizedToken(
    vfs,
    loginFlags.options.apiUrl,
    token,
    {
      email: exchange.userEmail,
      userId: exchange.userId,
    },
    keychain,
  );

  if (user.email) {
    return ok(`${outputPrefix}Successfully logged in as ${user.email}\n`);
  }

  return ok(`${outputPrefix}Successfully logged in to Netlify.\n`);
}

async function runLogoutCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify logout: ${resolved.error}\n`);
  }

  const env = envToRecord(ctx.env);
  const removed = deleteNetlifyAccessToken(vfs);
  if (removed) {
    await keychain?.persistCurrentState().catch(() => {});
  }

  if (env.NETLIFY_AUTH_TOKEN?.trim()) {
    return ok(
      removed
        ? 'Removed saved Netlify login state. NETLIFY_AUTH_TOKEN is still set in the environment.\n'
        : 'NETLIFY_AUTH_TOKEN is still set in the environment. Unset it to log out completely.\n',
    );
  }

  if (removed) {
    return ok('Removed Netlify login state.\n');
  }

  return ok('Netlify is already logged out.\n');
}

async function runStatusCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify status: ${resolved.error}\n`);
  }

  const token = resolveStoredToken(vfs, ctx);
  if (!token) {
    return ok('Not logged in to Netlify. Run `netlify login` to authenticate.\n');
  }

  try {
    const user = await fetchNetlifyCurrentUser(resolved.apiUrl, token);
    if (user.email) {
      return ok(`Logged in to Netlify as ${user.email}\n`);
    }
    return ok('Logged in to Netlify\n');
  } catch (error) {
    return err(`Saved Netlify token is no longer valid: ${formatErrorMessage(error)}\n`);
  }
}

async function runTokenCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify auth token: ${resolved.error}\n`);
  }

  const token = resolveStoredToken(vfs, ctx);
  if (!token) {
    return err('Not authenticated. Run `netlify login` first.\n');
  }

  return ok(`${token}\n`);
}

async function runWhoamiCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`netlify auth whoami: ${resolved.error}\n`);
  }

  const token = resolveStoredToken(vfs, ctx);
  if (!token) {
    return err('Not authenticated. Run `netlify login` first.\n');
  }

  try {
    const user = await fetchNetlifyCurrentUser(resolved.apiUrl, token);
    if (user.email) {
      return ok(`${user.email}\n`);
    }
    return err('Authenticated but Netlify did not return an account email.\n');
  } catch (error) {
    return err(`netlify auth whoami: ${formatErrorMessage(error)}\n`);
  }
}

async function runAuthCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const [subcommand = 'status', ...rest] = args;

  switch (subcommand) {
    case 'status':
      return runStatusCommand(rest, ctx, vfs);
    case 'token':
      return runTokenCommand(rest, ctx, vfs);
    case 'whoami':
      return runWhoamiCommand(rest, ctx, vfs);
    default:
      return err(`netlify auth: unknown command '${subcommand}'\n`, 2);
  }
}

export async function runNetlifyCommand(
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
      case 'status':
        return runStatusCommand(rest, ctx, vfs);
      case 'auth':
        return runAuthCommand(rest, ctx, vfs);
      case 'version':
      case '--version':
        return ok('netlify v0.0.0-almostnode\n');
      default:
        return err(
          `netlify: unsupported command '${subcommand}'. Use \`netlify login\`, \`netlify status\`, or \`npx netlify <command>\` for the full CLI.\n`,
          2,
        );
    }
  } catch (error) {
    if (isAbortError(error) || signalAborted(ctx.signal)) {
      return abortResult();
    }
    return err(`netlify: ${formatErrorMessage(error)}\n`);
  }
}
