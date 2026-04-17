import type { ExecResult as JustBashExecResult } from 'just-bash';
import { getDefaultNetworkController, networkFetch } from '../network';
import type { ShellCommandContext } from '../shell-commands';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';
import {
  DEFAULT_INFISICAL_DOMAIN,
  deleteInfisicalAuth,
  INFISICAL_AUTH_PATH,
  INFISICAL_CONFIG_PATH,
  isInfisicalAccessTokenValid,
  normalizeInfisicalDomain,
  readInfisicalAuth,
  readInfisicalConfig,
  readInfisicalWorkspaceConfig,
  type InfisicalAuthFile,
  type InfisicalConfigFile,
  type InfisicalVaultBackend,
  writeInfisicalAuth,
  writeInfisicalConfig,
  writeInfisicalWorkspaceConfig,
} from './infisical-auth';
import { hiddenPrompt, PromptAbortError, selectPrompt } from './tty-prompt';

type InfisicalCtx = Pick<
  ShellCommandContext,
  'cwd' | 'env' | 'signal' | 'writeStdout' | 'writeStderr' | 'onInput' | 'onKeypress'
>;

const INFISICAL_INIT_DEFAULT_ENV = 'dev';
const INFISICAL_DESKTOP_AUTH_TIMEOUT_MS = 180_000;
const DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY = Symbol.for(
  'almostnode.desktopOAuthLoopback',
);
const DESKTOP_INFISICAL_SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Infisical authentication complete</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Infisical authentication complete</h1>
      <p>You can close this window and return to almostnode.</p>
    </main>
  </body>
</html>`;

interface InfisicalLoginResponse {
  accessToken?: string;
  accessTokenMaxTTL?: number;
  expiresIn?: number;
  tokenType?: string;
}

interface LoginOptions {
  clientId?: string;
  clientSecret?: string;
  domain: string;
  email?: string;
  interactive: boolean;
  method?: string;
  organizationId?: string;
  organizationSlug?: string;
  password?: string;
  plain: boolean;
  silent: boolean;
}

interface DesktopOAuthLoopbackBridge {
  createSession(input?: {
    allowedOrigins?: string[];
    callbackPath?: string;
    captureBody?: boolean;
    matchAnyPath?: boolean;
    preferredPort?: number;
  }): Promise<{
    redirectUri: string;
    sessionId: string;
  }>;
  openExternal(input: { sessionId: string; url: string }): Promise<{ opened: true }>;
  waitForCallback(input: {
    sessionId: string;
    successHtml?: string;
    timeoutMs?: number;
  }): Promise<{
    callbackUrl: string;
    requestBody?: string | null;
    requestHeaders?: Record<string, string> | null;
    requestMethod?: string | null;
  }>;
}

interface InfisicalBrowserLoginPayload {
  accessToken: string;
  email: string | null;
  privateKey: string | null;
  refreshToken: string | null;
}

interface ParsedSecretsFlags {
  options: {
    domain: string | null;
    environment: string | null;
    expandSecretReferences: boolean;
    includeImports: boolean;
    plain: boolean;
    projectId: string | null;
    recursive: boolean;
    secretPath: string;
    silent: boolean;
    type: 'personal' | 'shared';
  };
  positionals: string[];
  error?: string;
}

interface ResolvedSecretsContext {
  domain: string;
  environment: string;
  projectId: string;
  secretPath: string;
  token: string;
  type: 'personal' | 'shared';
}

interface InfisicalSecretRecord {
  id?: string;
  _id?: string;
  environment?: string;
  secretComment?: string;
  secretKey?: string;
  secretMetadata?: Array<{
    isEncrypted?: boolean;
    key?: string;
    value?: string;
  }>;
  secretPath?: string;
  secretReminderNote?: string;
  secretReminderRepeatDays?: number;
  secretValue?: string;
  skipMultilineEncoding?: boolean;
  type?: string;
  updatedAt?: string;
  workspace?: string;
}

interface InfisicalSecretsListResponse {
  secrets?: InfisicalSecretRecord[];
}

interface InfisicalSecretResponse {
  secret?: InfisicalSecretRecord;
}

interface InfisicalProjectsResponse {
  projects?: Array<{
    environments?: Array<{
      id?: string;
      name?: string;
      slug?: string;
    }>;
    id?: string;
    name?: string;
    slug?: string;
  }>;
}

class InfisicalApiError extends Error {
  status: number;

  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.name = 'InfisicalApiError';
    this.status = status;
  }
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString();
}

function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function abortResult(): JustBashExecResult {
  return err('infisical: command aborted\n', 130);
}

function normalizeSecretPath(value: string | null | undefined): string {
  const trimmed = value?.trim() || '/';
  const normalized = trimmed.startsWith('/')
    ? trimmed
    : `/${trimmed}`;
  const collapsed = normalized.replace(/\/+/g, '/');
  if (collapsed === '/') {
    return '/';
  }
  return collapsed.replace(/\/+$/g, '') || '/';
}

function parseBooleanFlagValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return null;
}

function getDesktopOAuthLoopbackBridge(): DesktopOAuthLoopbackBridge | null {
  const candidate = (
    globalThis as typeof globalThis & {
      [DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY]?: DesktopOAuthLoopbackBridge;
    }
  )[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY];

  if (!candidate) {
    return null;
  }
  if (
    typeof candidate.createSession !== 'function'
    || typeof candidate.openExternal !== 'function'
    || typeof candidate.waitForCallback !== 'function'
  ) {
    return null;
  }
  return candidate;
}

async function persistKeychainState(
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<void> {
  await keychain?.persistCurrentState().catch(() => {});
}

function buildHelpText(): string {
  return (
    'infisical - Infisical browser auth and secrets integration for almostnode\n\n' +
    'Commands:\n' +
    '  login                        Start Infisical browser login (default user flow)\n' +
    '  logout                       Remove the saved Infisical session\n' +
    '  status                       Show current Infisical authentication status\n' +
    '  whoami                       Print the current Infisical identity when available\n' +
    '  init                         Link the current workspace to an Infisical project\n' +
    '  secrets                      List secrets for the linked project or --projectId\n' +
    '  secrets get <name...>        Read one or more secrets\n' +
    '  secrets set <KEY=value...>   Create or update one or more secrets\n' +
    '  secrets delete <name...>     Delete one or more secrets\n' +
    '  auth token                   Print the current access token\n' +
    '  auth status                  Alias for `infisical status`\n' +
    '  auth whoami                  Alias for `infisical whoami`\n' +
    '  vault                        Show the configured local vault mode\n' +
    '  vault set <auto|file>        Update the local vault preference\n\n' +
    'Notes:\n' +
    '  `infisical login` follows Infisical\'s browser-based user flow. When the\n' +
    '  desktop runtime is available, a localhost listener captures the credentials\n' +
    '  automatically. Otherwise the browser will show a token that can be pasted\n' +
    '  into the terminal at the prompt.\n\n' +
    '  Universal Auth is still supported for automation with:\n' +
    '    infisical login --method=universal-auth --client-id <id> --client-secret <secret>\n'
  );
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

function extractApiErrorMessage(
  status: number,
  statusText: string,
  parsed: unknown,
  bodyText: string,
): string {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0];
      if (typeof first === 'string' && first.trim()) {
        return first.trim();
      }
      if (
        first
        && typeof first === 'object'
        && typeof (first as Record<string, unknown>).message === 'string'
      ) {
        return ((first as Record<string, unknown>).message as string).trim();
      }
    }
  }

  return bodyText.trim() || `${status} ${statusText}`;
}

async function infisicalApiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json');
  }

  const response = await runtimeFetch(url, {
    ...init,
    headers,
  });
  const text = await response.text().catch(() => '');

  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new InfisicalApiError(
      response.status,
      extractApiErrorMessage(response.status, response.statusText, parsed, text),
    );
  }

  if (parsed === null) {
    return {} as T;
  }

  return parsed as T;
}

async function loginWithUniversalAuth(options: {
  clientId: string;
  clientSecret: string;
  domain: string;
  organizationSlug?: string | null;
}): Promise<InfisicalLoginResponse> {
  const body: Record<string, string> = {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  };
  if (options.organizationSlug) {
    body.organizationSlug = options.organizationSlug;
  }

  return infisicalApiRequest<InfisicalLoginResponse>(
    `${options.domain}/api/v1/auth/universal-auth/login`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

function parseLoginFlags(args: string[]): {
  options: LoginOptions;
  error?: string;
} {
  const options: LoginOptions = {
    domain: '',
    interactive: false,
    plain: false,
    silent: false,
  };

  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (!arg) {
      index += 1;
      continue;
    }

    if (arg === '--plain') {
      options.plain = true;
      index += 1;
      continue;
    }
    if (arg === '--silent') {
      options.silent = true;
      index += 1;
      continue;
    }
    if (arg === '--interactive' || arg === '-i') {
      options.interactive = true;
      index += 1;
      continue;
    }
    if (arg === '--method') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --method' };
      }
      options.method = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--method=')) {
      options.method = arg.slice('--method='.length);
      index += 1;
      continue;
    }
    if (arg === '--client-id') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --client-id' };
      }
      options.clientId = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--client-id=')) {
      options.clientId = arg.slice('--client-id='.length);
      index += 1;
      continue;
    }
    if (arg === '--client-secret') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --client-secret' };
      }
      options.clientSecret = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--client-secret=')) {
      options.clientSecret = arg.slice('--client-secret='.length);
      index += 1;
      continue;
    }
    if (arg === '--organization-slug') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --organization-slug' };
      }
      options.organizationSlug = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--organization-slug=')) {
      options.organizationSlug = arg.slice('--organization-slug='.length);
      index += 1;
      continue;
    }
    if (arg === '--domain') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --domain' };
      }
      options.domain = normalizeInfisicalDomain(value);
      index += 2;
      continue;
    }
    if (arg.startsWith('--domain=')) {
      options.domain = normalizeInfisicalDomain(arg.slice('--domain='.length));
      index += 1;
      continue;
    }
    if (arg === '--email') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --email' };
      }
      options.email = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--email=')) {
      options.email = arg.slice('--email='.length);
      index += 1;
      continue;
    }
    if (arg === '--password') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --password' };
      }
      options.password = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--password=')) {
      options.password = arg.slice('--password='.length);
      index += 1;
      continue;
    }
    if (arg === '--organization-id') {
      const value = args[index + 1];
      if (!value) {
        return { options, error: 'missing value for --organization-id' };
      }
      options.organizationId = value;
      index += 2;
      continue;
    }
    if (arg.startsWith('--organization-id=')) {
      options.organizationId = arg.slice('--organization-id='.length);
      index += 1;
      continue;
    }

    return { options, error: `unknown argument '${arg}'` };
  }

  return { options };
}

function parseSecretsFlags(
  args: string[],
): ParsedSecretsFlags {
  const options: ParsedSecretsFlags['options'] = {
    domain: null,
    environment: null,
    expandSecretReferences: true,
    includeImports: true,
    plain: false,
    projectId: null,
    recursive: false,
    secretPath: '/',
    silent: false,
    type: 'shared',
  };
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--plain') {
      options.plain = true;
      continue;
    }
    if (arg === '--silent') {
      options.silent = true;
      continue;
    }
    if (arg === '--recursive') {
      options.recursive = true;
      continue;
    }
    if (arg.startsWith('--recursive=')) {
      const value = parseBooleanFlagValue(arg.slice('--recursive='.length));
      if (value === null) {
        return { options, positionals, error: `invalid value for --recursive: ${arg.slice('--recursive='.length)}` };
      }
      options.recursive = value;
      continue;
    }
    if (arg === '--expand') {
      if (next && !next.startsWith('-')) {
        const value = parseBooleanFlagValue(next);
        if (value !== null) {
          options.expandSecretReferences = value;
          index += 1;
          continue;
        }
      }
      options.expandSecretReferences = true;
      continue;
    }
    if (arg.startsWith('--expand=')) {
      const value = parseBooleanFlagValue(arg.slice('--expand='.length));
      if (value === null) {
        return { options, positionals, error: `invalid value for --expand: ${arg.slice('--expand='.length)}` };
      }
      options.expandSecretReferences = value;
      continue;
    }
    if (arg === '--no-expand') {
      options.expandSecretReferences = false;
      continue;
    }
    if (arg === '--include-imports') {
      if (next && !next.startsWith('-')) {
        const value = parseBooleanFlagValue(next);
        if (value !== null) {
          options.includeImports = value;
          index += 1;
          continue;
        }
      }
      options.includeImports = true;
      continue;
    }
    if (arg.startsWith('--include-imports=')) {
      const value = parseBooleanFlagValue(arg.slice('--include-imports='.length));
      if (value === null) {
        return { options, positionals, error: `invalid value for --include-imports: ${arg.slice('--include-imports='.length)}` };
      }
      options.includeImports = value;
      continue;
    }
    if (arg === '--env' || arg === '--environment') {
      if (!next) {
        return { options, positionals, error: `missing value for ${arg}` };
      }
      options.environment = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      options.environment = arg.slice('--env='.length).trim();
      continue;
    }
    if (arg.startsWith('--environment=')) {
      options.environment = arg.slice('--environment='.length).trim();
      continue;
    }
    if (arg === '--projectId' || arg === '--project-id') {
      if (!next) {
        return { options, positionals, error: `missing value for ${arg}` };
      }
      options.projectId = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--projectId=')) {
      options.projectId = arg.slice('--projectId='.length).trim();
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      options.projectId = arg.slice('--project-id='.length).trim();
      continue;
    }
    if (arg === '--path') {
      if (!next) {
        return { options, positionals, error: 'missing value for --path' };
      }
      options.secretPath = normalizeSecretPath(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--path=')) {
      options.secretPath = normalizeSecretPath(arg.slice('--path='.length));
      continue;
    }
    if (arg === '--type') {
      if (!next) {
        return { options, positionals, error: 'missing value for --type' };
      }
      if (next !== 'shared' && next !== 'personal') {
        return { options, positionals, error: `unsupported secret type '${next}'` };
      }
      options.type = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--type=')) {
      const type = arg.slice('--type='.length);
      if (type !== 'shared' && type !== 'personal') {
        return { options, positionals, error: `unsupported secret type '${type}'` };
      }
      options.type = type;
      continue;
    }
    if (arg === '--domain') {
      if (!next) {
        return { options, positionals, error: 'missing value for --domain' };
      }
      options.domain = normalizeInfisicalDomain(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--domain=')) {
      options.domain = normalizeInfisicalDomain(arg.slice('--domain='.length));
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}

function parseInitFlags(args: string[]): {
  options: {
    domain: string | null;
    environment: string | null;
    projectId: string | null;
  };
  error?: string;
} {
  const options = {
    domain: null as string | null,
    environment: null as string | null,
    projectId: null as string | null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--projectId' || arg === '--project-id') {
      if (!next) {
        return { options, error: `missing value for ${arg}` };
      }
      options.projectId = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--projectId=')) {
      options.projectId = arg.slice('--projectId='.length).trim();
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      options.projectId = arg.slice('--project-id='.length).trim();
      continue;
    }
    if (arg === '--env' || arg === '--environment') {
      if (!next) {
        return { options, error: `missing value for ${arg}` };
      }
      options.environment = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      options.environment = arg.slice('--env='.length).trim();
      continue;
    }
    if (arg.startsWith('--environment=')) {
      options.environment = arg.slice('--environment='.length).trim();
      continue;
    }
    if (arg === '--domain') {
      if (!next) {
        return { options, error: 'missing value for --domain' };
      }
      options.domain = normalizeInfisicalDomain(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--domain=')) {
      options.domain = normalizeInfisicalDomain(arg.slice('--domain='.length));
      continue;
    }

    return { options, error: `unknown argument '${arg}'` };
  }

  return { options };
}

function buildUserLoginUrl(domain: string, callbackPort: string): string {
  const loginUrl = new URL(`${domain}/login`);
  loginUrl.searchParams.set('callback_port', callbackPort);
  return loginUrl.toString();
}

function normalizeBrowserLoginPayload(rawBody: string): InfisicalBrowserLoginPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('Infisical browser login returned malformed JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Infisical browser login did not return a credential payload.');
  }

  const record = parsed as Record<string, unknown>;
  const accessToken = coerceString(record.JTWToken)
    || coerceString(record.token)
    || coerceString(record.accessToken);
  if (!accessToken) {
    throw new Error('Infisical browser login did not return an access token.');
  }

  return {
    accessToken,
    email: coerceString(record.email),
    privateKey: coerceString(record.privateKey),
    refreshToken: coerceString(record.RefreshToken)
      || coerceString(record.refreshToken),
  };
}

function resolveCommandDomain(
  vfs: VirtualFS,
  ctx: InfisicalCtx,
  explicitDomain?: string | null,
): string {
  const env = envToRecord(ctx.env);
  const config = readInfisicalConfig(vfs);
  const auth = readInfisicalAuth(vfs);
  return normalizeInfisicalDomain(
    explicitDomain
    || env.INFISICAL_API_URL
    || auth.domain
    || config.domain
    || DEFAULT_INFISICAL_DOMAIN,
  );
}

function resolveStoredOrEnvToken(vfs: VirtualFS, ctx: InfisicalCtx): {
  source: 'env' | 'stored' | 'none';
  token: string | null;
} {
  const env = envToRecord(ctx.env);
  const envToken = env.INFISICAL_TOKEN?.trim();
  if (envToken) {
    return { source: 'env', token: envToken };
  }

  const stored = readInfisicalAuth(vfs);
  if (isInfisicalAccessTokenValid(stored)) {
    return { source: 'stored', token: stored.accessToken };
  }

  return { source: 'none', token: null };
}

function formatLoggedOutStatus(config: InfisicalConfigFile, auth: InfisicalAuthFile): string {
  const lastExpiry = formatDateTime(auth.expiresAt);
  const lastEmail = auth.email || config.loggedInUserEmail;
  const hasMachineIdentity = Boolean(
    config.machineIdentity?.clientId && config.machineIdentity?.clientSecret,
  );
  const lines = [
    'Infisical status: not authenticated',
    `Domain: ${config.domain}`,
    lastEmail ? `Previous user: ${lastEmail}` : null,
    lastExpiry ? `Previous token expired: ${lastExpiry}` : null,
    hasMachineIdentity
      ? 'Run `infisical login` for browser auth or `infisical login --method=universal-auth` to use the saved machine identity.'
      : 'Run `infisical login` to start the browser login flow.',
  ].filter(Boolean) as string[];

  return `${lines.join('\n')}\n`;
}

const INFISICAL_US_URL = 'https://app.infisical.com';
const INFISICAL_EU_URL = 'https://eu.infisical.com';
const INFISICAL_PASTE_PROMPT_DELAY_MS = 5_000;
const INFISICAL_WELCOME_DELAY_MS = 1_000;
const ANSI_BOLD_GREEN = '\u001b[1;32m';
const ANSI_BOLD = '\u001b[1m';
const ANSI_RESET = '\u001b[0m';

function decodePastedBase64Token(raw: string): InfisicalBrowserLoginPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Pasted token is empty.');
  }

  let decoded: string;
  try {
    decoded = atob(trimmed);
  } catch {
    throw new Error('Pasted token is not valid base64.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Pasted token did not decode to JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Pasted token did not contain a credential payload.');
  }

  const record = parsed as Record<string, unknown>;
  const accessToken = coerceString(record.JTWToken)
    || coerceString(record.token)
    || coerceString(record.accessToken);
  if (!accessToken) {
    throw new Error('Pasted token did not include an access token.');
  }

  return {
    accessToken,
    email: coerceString(record.email),
    privateKey: coerceString(record.privateKey),
    refreshToken: coerceString(record.RefreshToken)
      || coerceString(record.refreshToken),
  };
}

async function promptHostingOption(
  ctx: InfisicalCtx,
  fallbackDomain: string,
): Promise<string | null> {
  if (!ctx.onKeypress) {
    return fallbackDomain;
  }

  try {
    const choice = await selectPrompt<'us' | 'eu' | 'self'>({
      ctx: ctx as ShellCommandContext,
      label: 'Select your hosting option',
      defaultIndex: fallbackDomain === INFISICAL_EU_URL ? 1 : 0,
      items: [
        { label: 'Infisical Cloud (US Region)', value: 'us' },
        { label: 'Infisical Cloud (EU Region)', value: 'eu' },
        { label: 'Self-Hosting or Dedicated Instance', value: 'self' },
      ],
    });

    if (choice === 'us') return INFISICAL_US_URL;
    if (choice === 'eu') return INFISICAL_EU_URL;

    const { textPrompt } = await import('./tty-prompt');
    const raw = await textPrompt({
      ctx: ctx as ShellCommandContext,
      label: 'Domain',
      defaultValue: 'Example - https://my-self-hosted-instance.com',
    });
    const normalized = normalizeInfisicalDomain(raw.trim());
    if (!normalized || normalized === 'Example - https://my-self-hosted-instance.com') {
      ctx.writeStderr?.('infisical login: no domain entered.\n');
      return null;
    }
    return normalized;
  } catch (error) {
    if (error instanceof PromptAbortError) {
      return null;
    }
    throw error;
  }
}

async function waitForPastedToken(
  ctx: InfisicalCtx,
  abort: AbortController,
): Promise<InfisicalBrowserLoginPayload | null> {
  if (!ctx.onKeypress) {
    return new Promise((resolve) => {
      abort.signal.addEventListener('abort', () => resolve(null), { once: true });
    });
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, INFISICAL_PASTE_PROMPT_DELAY_MS);
    abort.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  if (abort.signal.aborted) return null;

  ctx.writeStderr?.(
    '\n\nOnce login is completed via browser, the CLI should be authenticated automatically.\n'
    + 'However, if browser fails to communicate with the CLI, please paste the token from the browser below.\n\n',
  );

  const scopedCtx: InfisicalCtx = { ...ctx, signal: abort.signal };

  while (!abort.signal.aborted) {
    let pasted: string;
    try {
      pasted = await hiddenPrompt({
        ctx: scopedCtx as ShellCommandContext,
        label: 'Paste your browser token here: ',
      });
    } catch (error) {
      if (error instanceof PromptAbortError) return null;
      throw error;
    }

    if (!pasted.trim()) {
      continue;
    }

    try {
      return decodePastedBase64Token(pasted);
    } catch (error) {
      ctx.writeStderr?.(`${formatErrorMessage(error)} Please try again.\n`);
    }
  }

  return null;
}

async function waitForLoopbackCredentials(
  bridge: DesktopOAuthLoopbackBridge,
  sessionId: string,
  abort: AbortController,
): Promise<InfisicalBrowserLoginPayload | null> {
  try {
    const callback = await bridge.waitForCallback({
      sessionId,
      successHtml: DESKTOP_INFISICAL_SUCCESS_HTML,
      timeoutMs: INFISICAL_DESKTOP_AUTH_TIMEOUT_MS,
    });
    if (abort.signal.aborted) return null;
    return normalizeBrowserLoginPayload(callback.requestBody || '');
  } catch (error) {
    if (abort.signal.aborted) return null;
    throw error;
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function runUserLogin(
  options: LoginOptions,
  ctx: InfisicalCtx,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  if (options.interactive || options.email || options.password || options.organizationId) {
    return err(
      'infisical login: direct user credential entry is not implemented in almostnode.\n'
      + 'Use the default browser login flow instead.\n',
    );
  }

  const currentConfig = readInfisicalConfig(vfs);
  const currentAuth = readInfisicalAuth(vfs);

  let domain: string;
  if (options.domain) {
    domain = options.domain;
  } else if (ctx.onKeypress && !options.silent && !options.plain) {
    const selected = await promptHostingOption(
      ctx,
      resolveCommandDomain(vfs, ctx, null),
    );
    if (!selected) {
      return abortResult();
    }
    domain = selected;
  } else {
    domain = resolveCommandDomain(vfs, ctx, null);
  }

  if (
    currentAuth.method === 'user'
    && currentAuth.domain === domain
    && isInfisicalAccessTokenValid(currentAuth)
  ) {
    if (options.plain) return ok(`${currentAuth.accessToken}\n`);
    if (options.silent) return ok('');

    return ok(
      [
        'Already authenticated with Infisical.',
        currentAuth.email ? `Email: ${currentAuth.email}` : null,
        `Domain: ${domain}`,
        currentAuth.expiresAt ? `Token expires: ${formatDateTime(currentAuth.expiresAt)}` : null,
      ].filter(Boolean).join('\n') + '\n',
    );
  }

  if (typeof window === 'undefined') {
    return err('Infisical browser login requires a browser environment.\n');
  }

  const bridge = getDesktopOAuthLoopbackBridge();

  let session: Awaited<ReturnType<DesktopOAuthLoopbackBridge['createSession']>> | null = null;
  // Infisical's login page requires a non-zero callback_port to render the
  // browser-auth UI (with a token-copy fallback when the callback fails).
  // When we don't have a desktop loopback listener we use a fixed placeholder
  // port; the browser-side post will fail and the user pastes the token instead.
  let callbackPort = '55118';

  if (bridge) {
    try {
      session = await bridge.createSession({
        allowedOrigins: [domain],
        callbackPath: '/',
        captureBody: true,
        matchAnyPath: true,
      });
      const bridgePort = new URL(session.redirectUri).port;
      if (bridgePort) callbackPort = bridgePort;
    } catch (error) {
      ctx.writeStderr?.(
        `Desktop loopback listener failed (${formatErrorMessage(error)}); falling back to token paste.\n`,
      );
      session = null;
    }
  }

  const authUrl = buildUserLoginUrl(domain, callbackPort);
  let openedViaBridge = false;
  if (bridge && session) {
    try {
      await bridge.openExternal({ sessionId: session.sessionId, url: authUrl });
      openedViaBridge = true;
    } catch {
      openedViaBridge = false;
    }
  }
  if (!openedViaBridge) {
    try {
      window.open(authUrl, '_blank');
    } catch {
      // Fall through; user can open the URL manually from the printed hint.
    }
  }

  ctx.writeStderr?.(
    '\n\nPlease proceed to your browser to complete the login process.\n'
    + `If the browser doesn't open automatically, please open this address in your browser: ${authUrl} \n`,
  );

  const raceAbort = new AbortController();
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => raceAbort.abort(), { once: true });
  }

  const loopbackPromise: Promise<InfisicalBrowserLoginPayload | null> = bridge && session
    ? waitForLoopbackCredentials(bridge, session.sessionId, raceAbort)
    : new Promise((resolve) => {
      raceAbort.signal.addEventListener('abort', () => resolve(null), { once: true });
    });

  const pastePromise = waitForPastedToken(ctx, raceAbort);

  let payload: InfisicalBrowserLoginPayload | null = null;
  try {
    payload = await Promise.race([loopbackPromise, pastePromise]);
  } catch (error) {
    raceAbort.abort();
    if (signalAborted(ctx.signal)) return abortResult();
    return err(`infisical login: ${formatErrorMessage(error)}\n`);
  }
  raceAbort.abort();

  if (!payload) {
    if (signalAborted(ctx.signal)) return abortResult();
    return err('infisical login: authentication was cancelled.\n');
  }

  writeInfisicalConfig(vfs, {
    ...currentConfig,
    domain,
    domains: Array.from(new Set([...(currentConfig.domains || []), domain])),
    loggedInUserEmail: payload.email,
  });
  writeInfisicalAuth(vfs, {
    version: 2,
    accessToken: payload.accessToken,
    email: payload.email,
    refreshToken: payload.refreshToken,
    privateKey: payload.privateKey,
    tokenType: 'Bearer',
    expiresAt: null,
    issuedAt: null,
    domain,
    method: 'user',
    clientId: null,
    organizationSlug: null,
  });
  await persistKeychainState(keychain);

  const savedAuth = readInfisicalAuth(vfs);
  if (options.plain) return ok(`${savedAuth.accessToken}\n`);
  if (options.silent) return ok('');

  ctx.writeStderr?.('\n\nBrowser login successful\n');
  await delay(INFISICAL_WELCOME_DELAY_MS, ctx.signal);

  const emailLabel = payload.email || 'your account';
  const successLines = [
    `${ANSI_BOLD_GREEN}>>>> Welcome to Infisical! You are now logged in as ${emailLabel} <<<< ${ANSI_RESET}`,
    '',
    `${ANSI_BOLD}Quick links${ANSI_RESET}`,
    '- Learn to inject secrets into your application at https://infisical.com/docs/cli/usage',
    '- Stuck? Join our slack for quick support https://infisical.com/slack',
    '',
  ];

  if (ctx.writeStdout) {
    ctx.writeStdout(`${successLines.join('\n')}\n`);
    return ok('');
  }
  return ok(`${successLines.join('\n')}\n`);
}

async function runUniversalAuthLogin(
  options: LoginOptions,
  ctx: InfisicalCtx,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const env = envToRecord(ctx.env);
  const currentConfig = readInfisicalConfig(vfs);
  const method = (
    options.method
    || env.INFISICAL_AUTH_METHOD
    || (options.clientId || options.clientSecret ? 'universal-auth' : undefined)
  )?.trim().toLowerCase();

  if (method !== 'universal-auth') {
    return err(`infisical login: unsupported authentication method '${method || ''}'\n`);
  }

  const clientId = (
    options.clientId
    || env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID
    || currentConfig.machineIdentity?.clientId
    || ''
  ).trim();
  const clientSecret = (
    options.clientSecret
    || env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
    || currentConfig.machineIdentity?.clientSecret
    || ''
  ).trim();
  const organizationSlug = (
    options.organizationSlug
    || env.INFISICAL_AUTH_ORGANIZATION_SLUG
    || currentConfig.machineIdentity?.organizationSlug
    || ''
  ).trim() || null;
  const domain = resolveCommandDomain(vfs, ctx, options.domain);

  if (!clientId || !clientSecret) {
    return err(
      'infisical login: Universal Auth requires both --client-id and --client-secret.\n',
    );
  }

  const existingAuth = readInfisicalAuth(vfs);
  if (
    existingAuth.method === 'universal-auth'
    && isInfisicalAccessTokenValid(existingAuth)
    && existingAuth.domain === domain
    && existingAuth.clientId === clientId
    && existingAuth.organizationSlug === organizationSlug
  ) {
    if (options.plain) {
      return ok(`${existingAuth.accessToken}\n`);
    }
    if (options.silent) {
      return ok('');
    }

    return ok(
      [
        'Already authenticated with Infisical Universal Auth.',
        `Domain: ${domain}`,
        `Client ID: ${maskIdentifier(clientId)}`,
        organizationSlug ? `Organization slug: ${organizationSlug}` : null,
        existingAuth.expiresAt ? `Token expires: ${formatDateTime(existingAuth.expiresAt)}` : null,
      ].filter(Boolean).join('\n') + '\n',
    );
  }

  try {
    const payload = await loginWithUniversalAuth({
      clientId,
      clientSecret,
      domain,
      organizationSlug,
    });
    const accessToken = payload.accessToken?.trim();
    if (!accessToken) {
      return err('infisical login: Infisical did not return an access token.\n');
    }

    writeInfisicalConfig(vfs, {
      ...currentConfig,
      domain,
      domains: Array.from(new Set([...(currentConfig.domains || []), domain])),
      machineIdentity: {
        method: 'universal-auth',
        clientId,
        clientSecret,
        organizationSlug,
      },
    });
    writeInfisicalAuth(vfs, {
      version: 2,
      accessToken,
      email: null,
      refreshToken: null,
      privateKey: null,
      tokenType: payload.tokenType || 'Bearer',
      expiresAt: typeof payload.expiresIn === 'number' && Number.isFinite(payload.expiresIn)
        ? new Date(Date.now() + payload.expiresIn * 1000).toISOString()
        : null,
      issuedAt: new Date().toISOString(),
      domain,
      method: 'universal-auth',
      clientId,
      organizationSlug,
    });
    await persistKeychainState(keychain);

    if (options.plain) {
      return ok(`${accessToken}\n`);
    }
    if (options.silent) {
      return ok('');
    }

    return ok(
      [
        'Authenticated with Infisical Universal Auth.',
        `Domain: ${domain}`,
        `Client ID: ${maskIdentifier(clientId)}`,
        organizationSlug ? `Organization slug: ${organizationSlug}` : null,
        'Run `infisical auth token` if you need the raw access token.',
      ].filter(Boolean).join('\n') + '\n',
    );
  } catch (error) {
    return err(`infisical login: ${formatErrorMessage(error)}\n`);
  }
}

async function runLoginCommand(
  args: string[],
  ctx: InfisicalCtx,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const parsed = parseLoginFlags(args);
  if (parsed.error) {
    return err(`infisical login: ${parsed.error}\n`);
  }

  const env = envToRecord(ctx.env);
  const method = (
    parsed.options.method
    || env.INFISICAL_AUTH_METHOD
    || (parsed.options.clientId || parsed.options.clientSecret ? 'universal-auth' : 'user')
  ).trim().toLowerCase();

  if (method === 'universal-auth') {
    return runUniversalAuthLogin(parsed.options, ctx, vfs, keychain);
  }
  if (method === 'user') {
    return runUserLogin(parsed.options, ctx, vfs, keychain);
  }

  return err(`infisical login: unsupported authentication method '${method}'\n`);
}

async function runLogoutCommand(
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const auth = readInfisicalAuth(vfs);
  const config = readInfisicalConfig(vfs);
  const removed = deleteInfisicalAuth(vfs);

  if (removed && auth.method === 'user' && config.loggedInUserEmail) {
    writeInfisicalConfig(vfs, {
      ...config,
      loggedInUserEmail: null,
    });
  }
  if (removed) {
    await persistKeychainState(keychain);
  }

  return ok(
    removed
      ? 'Logged out of Infisical.\n'
      : 'No stored Infisical session was found.\n',
  );
}

function runStatusCommand(ctx: InfisicalCtx, vfs: VirtualFS): JustBashExecResult {
  const resolvedToken = resolveStoredOrEnvToken(vfs, ctx);
  if (resolvedToken.source === 'env') {
    return ok(
      'Infisical status: authenticated via INFISICAL_TOKEN\n' +
      'The access token is being supplied by the current command environment.\n',
    );
  }

  const auth = readInfisicalAuth(vfs);
  const config = readInfisicalConfig(vfs);
  if (!isInfisicalAccessTokenValid(auth)) {
    return ok(formatLoggedOutStatus(config, auth));
  }

  return ok(
    [
      'Infisical status: authenticated',
      `Domain: ${auth.domain || config.domain}`,
      auth.method === 'user'
        ? 'Method: browser login'
        : `Method: ${auth.method || 'universal-auth'}`,
      auth.email || config.loggedInUserEmail
        ? `Email: ${auth.email || config.loggedInUserEmail}`
        : null,
      auth.clientId || config.machineIdentity?.clientId
        ? `Client ID: ${maskIdentifier(auth.clientId || config.machineIdentity?.clientId)}`
        : null,
      auth.organizationSlug || config.machineIdentity?.organizationSlug
        ? `Organization slug: ${auth.organizationSlug || config.machineIdentity?.organizationSlug}`
        : null,
      auth.expiresAt ? `Token expires: ${formatDateTime(auth.expiresAt)}` : null,
    ].filter(Boolean).join('\n') + '\n',
  );
}

function runAuthTokenCommand(ctx: InfisicalCtx, vfs: VirtualFS): JustBashExecResult {
  const resolved = resolveStoredOrEnvToken(vfs, ctx);
  if (resolved.token) {
    return ok(`${resolved.token}\n`);
  }

  return err(
    'infisical auth token: no valid access token is available.\n' +
    'Run `infisical login` first or set `INFISICAL_TOKEN`.\n',
  );
}

function runWhoamiCommand(ctx: InfisicalCtx, vfs: VirtualFS): JustBashExecResult {
  const resolved = resolveStoredOrEnvToken(vfs, ctx);
  if (resolved.source === 'env') {
    return ok('Authenticated via INFISICAL_TOKEN\n');
  }

  const auth = readInfisicalAuth(vfs);
  const email = auth.email || readInfisicalConfig(vfs).loggedInUserEmail;
  if (!resolved.token) {
    return err('infisical whoami: not authenticated\n');
  }
  if (!email) {
    return ok('Authenticated with Infisical\n');
  }

  return ok(`${email}\n`);
}

function runVaultCommand(args: string[], vfs: VirtualFS): JustBashExecResult {
  const config = readInfisicalConfig(vfs);
  if (args.length === 0) {
    return ok(
      'Vaults are used to securely store your login details locally. Available vaults:\n' +
      '- auto (automatically select native vault on system)\n' +
      '- file (encrypted file vault)\n\n' +
      `You are currently using [${config.vaultBackendType}] vault to store your login credentials\n`,
    );
  }

  if (args[0] !== 'set') {
    return err(`infisical vault: unknown subcommand '${args[0]}'\n`);
  }

  const nextVault = args[1];
  if (!nextVault) {
    return err('infisical vault set: missing vault name\n');
  }
  if (nextVault !== 'auto' && nextVault !== 'file') {
    return err(`infisical vault set: unsupported vault '${nextVault}'\n`);
  }
  if (args.length > 2) {
    return err(`infisical vault set: unknown argument '${args[2]}'\n`);
  }

  writeInfisicalConfig(vfs, {
    ...config,
    vaultBackendType: nextVault as InfisicalVaultBackend,
  });

  return ok(
    `Switched Infisical vault preference to [${nextVault}]. Existing credentials stay in place until the next login.\n`,
  );
}

function resolveSecretsContext(
  parsed: ParsedSecretsFlags,
  ctx: InfisicalCtx,
  vfs: VirtualFS,
): ResolvedSecretsContext | { error: string } {
  const workspace = readInfisicalWorkspaceConfig(vfs, ctx.cwd || '/');
  const token = resolveStoredOrEnvToken(vfs, ctx).token;
  if (!token) {
    return {
      error: 'Not authenticated. Run `infisical login` first or set `INFISICAL_TOKEN`.',
    };
  }

  const projectId = parsed.options.projectId || workspace?.workspaceId || null;
  if (!projectId) {
    return {
      error: 'No Infisical project is linked. Run `infisical init` or pass `--projectId <id>`.',
    };
  }

  return {
    domain: resolveCommandDomain(vfs, ctx, parsed.options.domain),
    environment: parsed.options.environment || workspace?.defaultEnvironment || INFISICAL_INIT_DEFAULT_ENV,
    projectId,
    secretPath: normalizeSecretPath(parsed.options.secretPath),
    token,
    type: parsed.options.type,
  };
}

function formatListedSecrets(
  secrets: InfisicalSecretRecord[],
  plain: boolean,
): string {
  if (secrets.length === 0) {
    return 'No secrets found.\n';
  }

  if (plain) {
    return `${secrets.map((secret) => secret.secretValue || '').join('\n')}\n`;
  }

  return `${secrets.map((secret) => `${secret.secretKey || ''}=${secret.secretValue || ''}`).join('\n')}\n`;
}

function formatResolvedSecrets(
  secrets: InfisicalSecretRecord[],
  plain: boolean,
): string {
  if (plain) {
    return `${secrets.map((secret) => secret.secretValue || '').join('\n')}\n`;
  }

  return `${secrets.map((secret) => `${secret.secretKey || ''}=${secret.secretValue || ''}`).join('\n')}\n`;
}

function formatSetResults(
  results: Array<{ action: 'created' | 'updated'; key: string }>,
): string {
  return `${results.map((result) => `${result.action.toUpperCase()} ${result.key}`).join('\n')}\n`;
}

function formatDeleteResults(keys: string[]): string {
  return `${keys.map((key) => `DELETED ${key}`).join('\n')}\n`;
}

async function listSecrets(
  context: ResolvedSecretsContext,
  options: ParsedSecretsFlags['options'],
): Promise<InfisicalSecretRecord[]> {
  const url = new URL(`${context.domain}/api/v4/secrets`);
  url.searchParams.set('projectId', context.projectId);
  url.searchParams.set('environment', context.environment);
  url.searchParams.set('secretPath', context.secretPath);
  url.searchParams.set('expandSecretReferences', String(options.expandSecretReferences));
  url.searchParams.set('includeImports', String(options.includeImports));
  url.searchParams.set('recursive', String(options.recursive));
  url.searchParams.set('viewSecretValue', 'true');
  if (context.type === 'personal') {
    url.searchParams.set('includePersonalOverrides', 'true');
  }

  const response = await infisicalApiRequest<InfisicalSecretsListResponse>(
    url.toString(),
    {
      headers: {
        authorization: `Bearer ${context.token}`,
      },
    },
  );

  return Array.isArray(response.secrets) ? response.secrets : [];
}

async function getSecret(
  context: ResolvedSecretsContext,
  name: string,
  options: ParsedSecretsFlags['options'],
): Promise<InfisicalSecretRecord> {
  const url = new URL(`${context.domain}/api/v4/secrets/${encodeURIComponent(name)}`);
  url.searchParams.set('projectId', context.projectId);
  url.searchParams.set('environment', context.environment);
  url.searchParams.set('secretPath', context.secretPath);
  url.searchParams.set('type', context.type);
  url.searchParams.set('expandSecretReferences', String(options.expandSecretReferences));
  url.searchParams.set('includeImports', String(options.includeImports));
  url.searchParams.set('viewSecretValue', 'true');

  const response = await infisicalApiRequest<InfisicalSecretResponse>(
    url.toString(),
    {
      headers: {
        authorization: `Bearer ${context.token}`,
      },
    },
  );

  if (!response.secret) {
    throw new Error(`Infisical did not return secret ${name}.`);
  }
  return response.secret;
}

function parseSecretAssignments(
  args: string[],
  ctx: InfisicalCtx,
  vfs: VirtualFS,
): Array<{ key: string; value: string }> {
  return args.map((entry) => {
    const equalsIndex = entry.indexOf('=');
    if (equalsIndex <= 0) {
      throw new Error(`invalid secret assignment '${entry}'. Expected KEY=value.`);
    }

    const key = entry.slice(0, equalsIndex).trim();
    let value = entry.slice(equalsIndex + 1);
    if (!key) {
      throw new Error(`invalid secret assignment '${entry}'. Expected KEY=value.`);
    }

    if (value.startsWith('\\@')) {
      value = value.slice(1);
    } else if (value.startsWith('@')) {
      const filePath = path.resolve(ctx.cwd || '/', value.slice(1));
      if (!vfs.existsSync(filePath)) {
        throw new Error(`secret source file not found: ${filePath}`);
      }
      value = String(vfs.readFileSync(filePath, 'utf8'));
    }

    return { key, value };
  });
}

async function upsertSecret(
  context: ResolvedSecretsContext,
  assignment: { key: string; value: string },
): Promise<'created' | 'updated'> {
  const url = `${context.domain}/api/v4/secrets/${encodeURIComponent(assignment.key)}`;
  const body = {
    environment: context.environment,
    projectId: context.projectId,
    secretPath: context.secretPath,
    secretValue: assignment.value,
    type: context.type,
  };

  try {
    await infisicalApiRequest<InfisicalSecretResponse>(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${context.token}`,
      },
      body: JSON.stringify(body),
    });
    return 'updated';
  } catch (error) {
    if (!(error instanceof InfisicalApiError) || error.status !== 404) {
      throw error;
    }
  }

  await infisicalApiRequest<InfisicalSecretResponse>(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${context.token}`,
    },
    body: JSON.stringify(body),
  });
  return 'created';
}

async function deleteSecret(
  context: ResolvedSecretsContext,
  key: string,
): Promise<void> {
  await infisicalApiRequest<InfisicalSecretResponse>(
    `${context.domain}/api/v4/secrets/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${context.token}`,
      },
      body: JSON.stringify({
        environment: context.environment,
        projectId: context.projectId,
        secretPath: context.secretPath,
        type: context.type,
      }),
    },
  );
}

async function runSecretsCommand(
  args: string[],
  ctx: InfisicalCtx,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case undefined:
    case 'list': {
      const parsed = parseSecretsFlags(rest);
      if (parsed.error) {
        return err(`infisical secrets: ${parsed.error}\n`);
      }
      const context = resolveSecretsContext(parsed, ctx, vfs);
      if ('error' in context) {
        return err(`infisical secrets: ${context.error}\n`);
      }

      try {
        const secrets = await listSecrets(context, parsed.options);
        return ok(formatListedSecrets(secrets, parsed.options.plain));
      } catch (error) {
        return err(`infisical secrets: ${formatErrorMessage(error)}\n`);
      }
    }
    case 'get': {
      const parsed = parseSecretsFlags(rest);
      if (parsed.error) {
        return err(`infisical secrets get: ${parsed.error}\n`);
      }
      if (parsed.positionals.length === 0) {
        return err('infisical secrets get: at least one secret name is required\n');
      }
      const context = resolveSecretsContext(parsed, ctx, vfs);
      if ('error' in context) {
        return err(`infisical secrets get: ${context.error}\n`);
      }

      try {
        const secrets = await Promise.all(
          parsed.positionals.map((name) => getSecret(context, name, parsed.options)),
        );
        return ok(formatResolvedSecrets(secrets, parsed.options.plain));
      } catch (error) {
        return err(`infisical secrets get: ${formatErrorMessage(error)}\n`);
      }
    }
    case 'set': {
      const parsed = parseSecretsFlags(rest);
      if (parsed.error) {
        return err(`infisical secrets set: ${parsed.error}\n`);
      }
      if (parsed.positionals.length === 0) {
        return err('infisical secrets set: at least one KEY=value assignment is required\n');
      }
      const context = resolveSecretsContext(parsed, ctx, vfs);
      if ('error' in context) {
        return err(`infisical secrets set: ${context.error}\n`);
      }

      try {
        const assignments = parseSecretAssignments(parsed.positionals, ctx, vfs);
        const results: Array<{ action: 'created' | 'updated'; key: string }> = [];
        for (const assignment of assignments) {
          const action = await upsertSecret(context, assignment);
          results.push({ action, key: assignment.key });
        }
        return ok(formatSetResults(results));
      } catch (error) {
        return err(`infisical secrets set: ${formatErrorMessage(error)}\n`);
      }
    }
    case 'delete':
    case 'rm': {
      const parsed = parseSecretsFlags(rest);
      if (parsed.error) {
        return err(`infisical secrets delete: ${parsed.error}\n`);
      }
      if (parsed.positionals.length === 0) {
        return err('infisical secrets delete: at least one secret name is required\n');
      }
      const context = resolveSecretsContext(parsed, ctx, vfs);
      if ('error' in context) {
        return err(`infisical secrets delete: ${context.error}\n`);
      }

      try {
        for (const key of parsed.positionals) {
          await deleteSecret(context, key);
        }
        return ok(formatDeleteResults(parsed.positionals));
      } catch (error) {
        return err(`infisical secrets delete: ${formatErrorMessage(error)}\n`);
      }
    }
    default:
      return err(`infisical secrets: unknown subcommand '${subcommand}'\n`, 2);
  }
}

async function chooseProjectInteractively(
  domain: string,
  token: string,
): Promise<{ environment: string; projectId: string; projectLabel: string }> {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
    throw new Error(
      'No project is linked. Re-run `infisical init --projectId <id>` from a browser runtime, or provide --projectId explicitly.',
    );
  }

  const response = await infisicalApiRequest<InfisicalProjectsResponse>(
    `${domain}/api/v1/projects?type=secret-manager`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
  const projects = Array.isArray(response.projects)
    ? response.projects.filter((project) => Boolean(project.id && project.name))
    : [];

  if (projects.length === 0) {
    throw new Error('No accessible Infisical secret-manager projects were returned for this account.');
  }

  const promptBody = projects
    .map((project, index) => {
      const environments = Array.isArray(project.environments)
        ? project.environments
          .map((entry) => entry.slug || entry.name)
          .filter(Boolean)
          .join(', ')
        : '';
      return `${index + 1}. ${project.name} (${project.slug || project.id})${environments ? ` [${environments}]` : ''}`;
    })
    .join('\n');

  const rawSelection = window.prompt(
    `Choose an Infisical project by number:\n\n${promptBody}`,
    '1',
  );
  if (!rawSelection?.trim()) {
    throw new Error('No project was selected.');
  }

  const selectedIndex = Number(rawSelection.trim());
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > projects.length) {
    throw new Error(`Project selection must be a number between 1 and ${projects.length}.`);
  }

  const project = projects[selectedIndex - 1];
  const defaultEnvironment = Array.isArray(project.environments) && project.environments.length > 0
    ? project.environments[0]?.slug || project.environments[0]?.name || INFISICAL_INIT_DEFAULT_ENV
    : INFISICAL_INIT_DEFAULT_ENV;
  const environmentPrompt = window.prompt(
    `Environment slug for ${project.name}:`,
    defaultEnvironment,
  );
  const environment = environmentPrompt?.trim() || defaultEnvironment;

  return {
    environment,
    projectId: project.id?.trim() || '',
    projectLabel: project.name?.trim() || project.id?.trim() || 'selected project',
  };
}

async function runInitCommand(
  args: string[],
  ctx: InfisicalCtx,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseInitFlags(args);
  if (parsed.error) {
    return err(`infisical init: ${parsed.error}\n`);
  }

  const domain = resolveCommandDomain(vfs, ctx, parsed.options.domain);
  let projectId = parsed.options.projectId;
  let environment = parsed.options.environment?.trim() || '';
  let projectLabel = projectId || 'selected project';

  if (!projectId) {
    const token = resolveStoredOrEnvToken(vfs, ctx).token;
    if (!token) {
      return err('infisical init: authenticate first with `infisical login`\n');
    }

    try {
      const selected = await chooseProjectInteractively(domain, token);
      projectId = selected.projectId;
      environment = environment || selected.environment;
      projectLabel = selected.projectLabel;
    } catch (error) {
      return err(`infisical init: ${formatErrorMessage(error)}\n`);
    }
  }

  if (!projectId) {
    return err('infisical init: missing project id\n');
  }

  const filePath = writeInfisicalWorkspaceConfig(vfs, ctx.cwd || '/', {
    defaultEnvironment: environment || INFISICAL_INIT_DEFAULT_ENV,
    workspaceId: projectId,
  });

  return ok(
    [
      `Linked this workspace to Infisical project ${projectLabel}.`,
      `Project ID: ${projectId}`,
      `Default environment: ${environment || INFISICAL_INIT_DEFAULT_ENV}`,
      `Config file: ${filePath}`,
    ].join('\n') + '\n',
  );
}

export async function runInfisicalCommand(
  args: string[],
  ctx: InfisicalCtx,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const [subcommand = 'status', ...rest] = args;

  if (subcommand === '--help' || subcommand === 'help') {
    return ok(buildHelpText());
  }
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  switch (subcommand) {
    case 'login':
      return runLoginCommand(rest, ctx, vfs, keychain);
    case 'logout':
      return runLogoutCommand(vfs, keychain);
    case 'status':
      return runStatusCommand(ctx, vfs);
    case 'whoami':
    case 'me':
      return runWhoamiCommand(ctx, vfs);
    case 'init':
      return runInitCommand(rest, ctx, vfs);
    case 'secrets':
      return runSecretsCommand(rest, ctx, vfs);
    case 'auth': {
      const [authCommand = 'status', ...authRest] = rest;
      switch (authCommand) {
        case 'login':
          return runLoginCommand(authRest, ctx, vfs, keychain);
        case 'logout':
          if (authRest.length > 0) {
            return err(`infisical auth logout: unknown argument '${authRest[0]}'\n`);
          }
          return runLogoutCommand(vfs, keychain);
        case 'status':
          if (authRest.length > 0) {
            return err(`infisical auth status: unknown argument '${authRest[0]}'\n`);
          }
          return runStatusCommand(ctx, vfs);
        case 'token':
          if (authRest.length > 0) {
            return err(`infisical auth token: unknown argument '${authRest[0]}'\n`);
          }
          return runAuthTokenCommand(ctx, vfs);
        case 'whoami':
          if (authRest.length > 0) {
            return err(`infisical auth whoami: unknown argument '${authRest[0]}'\n`);
          }
          return runWhoamiCommand(ctx, vfs);
        default:
          return err(`infisical auth: unknown subcommand '${authCommand}'\n`);
      }
    }
    case 'vault':
      return runVaultCommand(rest, vfs);
    default:
      return err(
        `infisical: unsupported command '${subcommand}'.\n` +
        'Run `infisical --help` for the supported auth, init, and secrets commands.\n',
      );
  }
}

export {
  DEFAULT_INFISICAL_DOMAIN,
  INFISICAL_AUTH_PATH,
  INFISICAL_CONFIG_PATH,
};
