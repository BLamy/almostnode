import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  StartInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutBucketWebsiteCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  GetRoleCredentialsCommand,
  ListAccountRolesCommand,
  ListAccountsCommand,
  LogoutCommand,
  SSOClient,
} from '@aws-sdk/client-sso';
import {
  AuthorizationPendingException,
  CreateTokenCommand,
  ExpiredTokenException,
  InvalidClientException,
  RegisterClientCommand,
  SlowDownException,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand,
} from '@aws-sdk/client-sso-oidc';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { HttpRequest, HttpResponse } from '@smithy/protocol-http';
import type { HttpHandlerOptions, RequestHandler } from '@smithy/types';
import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import {
  AWS_AUTH_PATH,
  AWS_CONFIG_PATH,
  type AwsAuthFile,
  type AwsConfigFile,
  type AwsOutputFormat,
  type AwsProfileConfig,
  type AwsRoleCredentialCache,
  type AwsSsoClientRegistration,
  type AwsSsoSessionConfig,
  type AwsSsoSessionToken,
  inspectAwsStoredState,
  isAwsTimestampValid,
  readAwsAuth,
  readAwsConfig,
  writeAwsAuth,
  writeAwsConfig,
} from './aws-storage';
import {
  basename,
  extname,
  relative,
  resolve as resolvePath,
} from './path';

const AWS_COMMAND_VERSION = 'aws-cli/0.1.0 almostnode';
const DEFAULT_OUTPUT: AwsOutputFormat = 'json';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_REGISTRATION_SCOPE = 'sso:account:access';
const DEFAULT_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const HEADER_BLOCKLIST = new Set(['host', 'content-length']);
const S3_URI_PREFIX = 's3://';
const S3_DELETE_BATCH_SIZE = 1000;
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const HELP_TEXT = `aws — AWS CLI shim for almostnode

Usage:
  aws help
  aws --version
  aws [--profile <name>] [--region <region>] [--output <json|text>] [--debug] <command> ...

Commands:
  configure sso-session --name <name> --start-url <url> --region <region> [--registration-scopes <scope1,scope2>]
  configure profile --name <name> --sso-session <session> --account-id <id> --role-name <name> [--region <region>] [--output <json|text>]
  configure list
  sso login [--sso-session <name>] [--use-device-code] [--no-browser]
  sso logout [--sso-session <name>]
  sso list-accounts [--sso-session <name>] [--max-results <n>]
  sso list-account-roles [--account-id <id>] [--sso-session <name>] [--max-results <n>]
  sso get-role-credentials [--account-id <id>] [--role-name <name>] [--sso-session <name>]
  sts get-caller-identity
  s3 cp <source> s3://<bucket>[/key] [--recursive] [--content-type <value>] [--cache-control <value>]
  s3 sync <directory> s3://<bucket>[/prefix] [--delete] [--content-type <value>] [--cache-control <value>]
  s3api create-bucket --bucket <name>
  s3api head-bucket --bucket <name>
  s3api list-buckets
  s3api list-objects-v2 --bucket <name> [--prefix <value>] [--max-keys <n>]
  s3api put-bucket-website --bucket <name> --website-configuration <json|file://path>
  s3api put-bucket-policy --bucket <name> --policy <json|file://path>
  s3api put-public-access-block --bucket <name> --public-access-block-configuration <json|file://path>
  s3api put-object --bucket <name> --key <key> --body <path> [--content-type <value>] [--cache-control <value>]
  s3api delete-object --bucket <name> --key <key>
  s3api delete-objects --bucket <name> --delete <json|file://path>
  ec2 describe-regions [--all-regions]
  ec2 describe-instances [--instance-id <id>]...
  ec2 start-instances [--instance-id <id>]...
`;

type MaybeKeychain = { persistCurrentState(): Promise<void> } | null | undefined;

interface AwsGlobalOptions {
  profile?: string;
  region?: string;
  output?: AwsOutputFormat;
  debug: boolean;
  help: boolean;
  version: boolean;
  commandArgs: string[];
}

interface AwsCommandState {
  cwd: string;
  env: Record<string, string>;
  globals: AwsGlobalOptions;
  config: AwsConfigFile;
  auth: AwsAuthFile;
  vfs: VirtualFS;
  keychain?: MaybeKeychain;
  debugMessages: string[];
}

interface AwsProfileRef {
  name: string;
  profile: AwsProfileConfig;
}

interface AwsSessionRef {
  name: string;
  session: AwsSsoSessionConfig;
}

interface AwsResolvedExecutionOptions {
  profileRef: AwsProfileRef | null;
  region: string;
  output: AwsOutputFormat;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface AwsCredentialsResolution {
  credentials: AwsCredentials;
  source: 'env' | 'sso';
}

interface AwsS3Location {
  bucket: string;
  key: string;
}

interface ParsedFlagResult {
  values: Record<string, unknown>;
  positionals: string[];
  error?: string;
}

interface FlagSpec {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'repeatable-string';
}

interface AwsCommandManifest {
  name: string;
  flags: FlagSpec[];
  parse: (
    parsed: ParsedFlagResult,
    state: AwsCommandState,
    execution: AwsResolvedExecutionOptions,
  ) => unknown;
  execute: (
    input: unknown,
    state: AwsCommandState,
    execution: AwsResolvedExecutionOptions,
  ) => Promise<unknown>;
}

export function ok(stdout: string, stderr = ''): JustBashExecResult {
  return { stdout, stderr, exitCode: 0 };
}

export function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function toEnvRecord(
  env: Map<string, string> | Record<string, string> | undefined,
): Record<string, string> {
  if (!env) {
    return {};
  }
  return env instanceof Map ? Object.fromEntries(env) : env;
}

function debugLog(state: AwsCommandState, message: string): void {
  if (state.globals.debug) {
    state.debugMessages.push(message);
  }
}

function appendDebugOutput(state: AwsCommandState, result: JustBashExecResult): JustBashExecResult {
  if (!state.globals.debug || state.debugMessages.length === 0) {
    return result;
  }
  return {
    ...result,
    stderr: result.stderr + state.debugMessages.map((line) => `[debug] ${line}\n`).join(''),
  };
}

function parseOutputFormat(value: string | undefined): AwsOutputFormat | undefined {
  if (!value) {
    return undefined;
  }
  return value === 'text' ? 'text' : value === 'json' ? 'json' : undefined;
}

export function parseAwsGlobalArgs(args: string[]): AwsGlobalOptions | { error: string } {
  const commandArgs: string[] = [];
  const options: AwsGlobalOptions = {
    debug: false,
    help: false,
    version: false,
    commandArgs,
  };
  const firstCommandIndex = args.findIndex((arg) => !arg.startsWith('--'));
  const treatOnlyLeadingFlagsAsGlobal = firstCommandIndex !== -1 && args[firstCommandIndex] === 'configure';

  for (let index = 0; index < args.length; index += 1) {
    if (treatOnlyLeadingFlagsAsGlobal && index >= firstCommandIndex) {
      commandArgs.push(...args.slice(index));
      break;
    }

    const arg = args[index];
    if (arg === '--profile') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'aws: missing value for --profile\n' };
      }
      options.profile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
      continue;
    }
    if (arg === '--region') {
      const value = args[index + 1];
      if (!value) {
        return { error: 'aws: missing value for --region\n' };
      }
      options.region = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--region=')) {
      options.region = arg.slice('--region='.length);
      continue;
    }
    if (arg === '--output') {
      const value = parseOutputFormat(args[index + 1]);
      if (!value) {
        return { error: 'aws: --output must be json or text\n' };
      }
      options.output = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      const value = parseOutputFormat(arg.slice('--output='.length));
      if (!value) {
        return { error: 'aws: --output must be json or text\n' };
      }
      options.output = value;
      continue;
    }
    if (arg === '--debug') {
      options.debug = true;
      continue;
    }
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--version') {
      options.version = true;
      continue;
    }
    commandArgs.push(arg);
  }

  return options;
}

function parseFlags(args: string[], specs: FlagSpec[]): ParsedFlagResult {
  const values: Record<string, unknown> = {};
  const positionals: string[] = [];
  const specMap = new Map(specs.map((spec) => [`--${spec.name}`, spec]));

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [flag, maybeInline] = arg.split('=', 2);
    const spec = specMap.get(flag);
    if (!spec) {
      return { values, positionals, error: `unknown flag '${arg}'` };
    }

    if (spec.kind === 'boolean') {
      if (maybeInline !== undefined && maybeInline !== 'true' && maybeInline !== 'false') {
        return { values, positionals, error: `flag '${flag}' does not take a value` };
      }
      values[spec.name] = maybeInline === undefined ? true : maybeInline !== 'false';
      continue;
    }

    const rawValue = maybeInline !== undefined ? maybeInline : args[index + 1];
    if (rawValue == null || rawValue === '') {
      return { values, positionals, error: `missing value for ${flag}` };
    }
    if (maybeInline === undefined) {
      index += 1;
    }

    if (spec.kind === 'number') {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed)) {
        return { values, positionals, error: `flag '${flag}' must be a number` };
      }
      values[spec.name] = parsed;
      continue;
    }

    if (spec.kind === 'repeatable-string') {
      const list = Array.isArray(values[spec.name]) ? values[spec.name] as string[] : [];
      list.push(rawValue);
      values[spec.name] = list;
      continue;
    }

    values[spec.name] = rawValue;
  }

  return { values, positionals };
}

function resolveVfsPath(state: AwsCommandState, targetPath: string): string {
  return resolvePath(state.cwd || '/', targetPath);
}

function readCliTextValue(state: AwsCommandState, rawValue: string, flagName: string): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    throw new Error(`${flagName} is required`);
  }

  if (!trimmed.startsWith('file://')) {
    return trimmed;
  }

  const referencedPath = resolveVfsPath(state, decodeURIComponent(trimmed.slice('file://'.length)));
  if (!state.vfs.existsSync(referencedPath)) {
    throw new Error(`${flagName} references a missing file: ${referencedPath}`);
  }

  const stats = state.vfs.statSync(referencedPath);
  if (!stats.isFile()) {
    throw new Error(`${flagName} references a directory instead of a file: ${referencedPath}`);
  }

  return state.vfs.readFileSync(referencedPath, 'utf8');
}

function parseCliJsonValue<T>(state: AwsCommandState, rawValue: string, flagName: string): T {
  const text = readCliTextValue(state, rawValue, flagName);

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${flagName} must be valid JSON or file://<path> JSON.`);
  }
}

function parseCliJsonText(state: AwsCommandState, rawValue: string, flagName: string): string {
  return JSON.stringify(parseCliJsonValue(state, rawValue, flagName));
}

function isS3Uri(value: string): boolean {
  return value.startsWith(S3_URI_PREFIX);
}

function parseS3Uri(value: string, label: string): AwsS3Location {
  if (!isS3Uri(value)) {
    throw new Error(`${label} must start with s3://`);
  }

  const remainder = value.slice(S3_URI_PREFIX.length);
  const slashIndex = remainder.indexOf('/');
  const bucket = (slashIndex === -1 ? remainder : remainder.slice(0, slashIndex)).trim();
  const key = slashIndex === -1 ? '' : remainder.slice(slashIndex + 1).replace(/^\/+/, '');

  if (!bucket) {
    throw new Error(`${label} must include a bucket name.`);
  }

  return { bucket, key };
}

function joinS3Key(prefix: string, suffix: string): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const normalizedSuffix = suffix.replace(/^\/+|\/+$/g, '');

  if (!normalizedPrefix) {
    return normalizedSuffix;
  }
  if (!normalizedSuffix) {
    return normalizedPrefix;
  }
  return `${normalizedPrefix}/${normalizedSuffix}`;
}

function inferContentType(filePath: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function listLocalFiles(state: AwsCommandState, sourceDirectory: string): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  const files: Array<{ absolutePath: string; relativePath: string }> = [];

  const walk = (currentPath: string): void => {
    for (const entry of state.vfs.readdirSync(currentPath).slice().sort()) {
      const entryPath = resolvePath(currentPath, entry);
      const stats = state.vfs.statSync(entryPath);
      if (stats.isDirectory()) {
        walk(entryPath);
        continue;
      }
      files.push({
        absolutePath: entryPath,
        relativePath: relative(sourceDirectory, entryPath).replace(/^\.\/?/, ''),
      });
    }
  };

  walk(sourceDirectory);
  return files;
}

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function serializeQuery(query: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}

function normalizeRequestBody(body: unknown): BodyInit | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return body as unknown as BodyInit;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body) as unknown as BodyInit;
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as BodyInit;
  }
  return body as BodyInit;
}

export class AlmostnodeAwsRequestHandler implements RequestHandler<HttpRequest, HttpResponse, HttpHandlerOptions> {
  metadata = { handlerProtocol: 'http/1.1' };

  constructor(private readonly onDebug?: (message: string) => void) {}

  async handle(request: HttpRequest, options?: HttpHandlerOptions): Promise<{ response: HttpResponse }> {
    const query = serializeQuery(request.query as Record<string, string | number | boolean | Array<string | number | boolean> | undefined>);
    const url = `${request.protocol}//${request.hostname}${request.port ? `:${request.port}` : ''}${request.path}${query}`;
    this.onDebug?.(`${request.method} ${url}`);

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers || {})) {
      if (value == null || HEADER_BLOCKLIST.has(name.toLowerCase())) {
        continue;
      }
      headers.set(name, value);
    }

    const response = await networkFetch(
      url,
      {
        method: request.method,
        headers,
        body: normalizeRequestBody(request.body),
        redirect: 'manual',
        signal: options?.abortSignal as AbortSignal | undefined,
      },
      getDefaultNetworkController(),
    );

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    this.onDebug?.(`<= ${response.status} ${response.statusText}`);

    return {
      response: new HttpResponse({
        statusCode: response.status,
        reason: response.statusText,
        headers: responseHeaders,
        body: new Uint8Array(await response.arrayBuffer()),
      }),
    };
  }

  destroy(): void {}
}

function createAwsRequestHandler(state: AwsCommandState): AlmostnodeAwsRequestHandler {
  return new AlmostnodeAwsRequestHandler((message) => debugLog(state, message));
}

function ensureOutputFormat(value: unknown): AwsOutputFormat {
  return value === 'text' ? 'text' : 'json';
}

function pruneOutput(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => pruneOutput(entry))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$metadata') {
        continue;
      }
      const pruned = pruneOutput(entry);
      if (pruned !== undefined) {
        result[key] = pruned;
      }
    }
    return result;
  }
  return value;
}

function formatScalar(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(pruneOutput(value));
}

function renderStructuredOutput(value: unknown, format: AwsOutputFormat): string {
  const normalized = pruneOutput(value);
  if (format === 'json') {
    return JSON.stringify(normalized ?? {}, null, 2) + '\n';
  }

  if (normalized == null) {
    return '\n';
  }
  if (Array.isArray(normalized)) {
    if (normalized.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
      return normalized
        .map((entry) => Object.values(entry as Record<string, unknown>).map(formatScalar).join('\t'))
        .join('\n') + '\n';
    }
    return normalized.map(formatScalar).join('\n') + '\n';
  }
  if (typeof normalized === 'object') {
    return Object.entries(normalized as Record<string, unknown>)
      .map(([key, entry]) => `${key}\t${formatScalar(entry)}`)
      .join('\n') + '\n';
  }
  return `${formatScalar(normalized)}\n`;
}

function saveConfig(state: AwsCommandState): Promise<void> {
  writeAwsConfig(state.vfs, state.config);
  return state.keychain?.persistCurrentState().catch(() => {}) ?? Promise.resolve();
}

function saveAuth(state: AwsCommandState): Promise<void> {
  writeAwsAuth(state.vfs, state.auth);
  return state.keychain?.persistCurrentState().catch(() => {}) ?? Promise.resolve();
}

function getEnvProfile(state: AwsCommandState): string | undefined {
  return state.globals.profile || state.env.AWS_PROFILE || undefined;
}

function resolveProfileName(state: AwsCommandState): string | null {
  const explicit = getEnvProfile(state);
  if (explicit) {
    return explicit;
  }
  if (state.config.defaultProfile && state.config.profiles[state.config.defaultProfile]) {
    return state.config.defaultProfile;
  }
  const profileNames = Object.keys(state.config.profiles);
  return profileNames.length === 1 ? profileNames[0] : null;
}

function resolveOptionalProfile(state: AwsCommandState): AwsProfileRef | null {
  const profileName = resolveProfileName(state);
  if (!profileName) {
    return null;
  }
  const profile = state.config.profiles[profileName];
  return profile ? { name: profileName, profile } : null;
}

function requireProfile(state: AwsCommandState): AwsProfileRef {
  const profileRef = resolveOptionalProfile(state);
  if (!profileRef) {
    throw new Error('No AWS profile configured. Run `aws configure profile ...` first.');
  }
  return profileRef;
}

function resolveRegion(state: AwsCommandState, profileRef: AwsProfileRef | null, sessionRef?: AwsSessionRef | null): string {
  return state.globals.region
    || state.env.AWS_REGION
    || state.env.AWS_DEFAULT_REGION
    || profileRef?.profile.region
    || sessionRef?.session.region
    || DEFAULT_REGION;
}

function resolveOutput(state: AwsCommandState, profileRef: AwsProfileRef | null): AwsOutputFormat {
  return state.globals.output
    || parseOutputFormat(state.env.AWS_DEFAULT_OUTPUT)
    || profileRef?.profile.output
    || DEFAULT_OUTPUT;
}

function buildExecutionOptions(state: AwsCommandState): AwsResolvedExecutionOptions {
  const profileRef = resolveOptionalProfile(state);
  const sessionRef = profileRef ? resolveSessionByName(state, profileRef.profile.ssoSession) : null;
  return {
    profileRef,
    region: resolveRegion(state, profileRef, sessionRef),
    output: resolveOutput(state, profileRef),
  };
}

function resolveSessionByName(state: AwsCommandState, name: string | null | undefined): AwsSessionRef | null {
  if (!name) {
    return null;
  }
  const session = state.config.ssoSessions[name];
  return session ? { name, session } : null;
}

function resolveSessionForCommand(
  state: AwsCommandState,
  explicitSessionName?: string | null,
): AwsSessionRef {
  if (explicitSessionName) {
    const sessionRef = resolveSessionByName(state, explicitSessionName);
    if (!sessionRef) {
      throw new Error(`AWS SSO session '${explicitSessionName}' is not configured.`);
    }
    return sessionRef;
  }

  const profileRef = resolveOptionalProfile(state);
  if (profileRef) {
    const sessionRef = resolveSessionByName(state, profileRef.profile.ssoSession);
    if (sessionRef) {
      return sessionRef;
    }
  }

  const sessionNames = Object.keys(state.config.ssoSessions);
  if (sessionNames.length === 0) {
    throw new Error(
      "AWS isn't configured yet. Open Keychain > AWS > Set up AWS, or run 'aws configure sso-session --name <name> --start-url <url> --region <region>'.",
    );
  }
  if (sessionNames.length === 1) {
    return { name: sessionNames[0], session: state.config.ssoSessions[sessionNames[0]] };
  }

  throw new Error('No AWS SSO session could be resolved. Pass `--sso-session <name>` or configure a default profile.');
}

function ensureStaticCredentials(env: Record<string, string>): AwsCredentials | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
  };
}

function buildLoginRequiredError(sessionName: string): Error {
  return new Error(`AWS SSO session '${sessionName}' is not authenticated. Run 'aws sso login --sso-session ${sessionName}'.`);
}

function createOidcClient(state: AwsCommandState, region: string): SSOOIDCClient {
  return new SSOOIDCClient({
    region,
    requestHandler: createAwsRequestHandler(state),
  });
}

function createSsoClient(state: AwsCommandState, region: string): SSOClient {
  return new SSOClient({
    region,
    requestHandler: createAwsRequestHandler(state),
  });
}

function isoFromEpochSeconds(seconds?: number): string {
  return new Date((seconds || 0) * 1000).toISOString();
}

function isoFromEpochMillis(value?: number): string {
  return new Date(value || 0).toISOString();
}

async function ensureClientRegistration(
  state: AwsCommandState,
  sessionRef: AwsSessionRef,
): Promise<AwsSsoClientRegistration> {
  const existing = state.auth.clients[sessionRef.name];
  if (
    existing
    && existing.region === sessionRef.session.region
    && existing.startUrl === sessionRef.session.startUrl
    && isAwsTimestampValid(existing.clientSecretExpiresAt, 0)
  ) {
    return existing;
  }

  const client = createOidcClient(state, sessionRef.session.region);
  const response = await client.send(new RegisterClientCommand({
    clientName: 'almostnode aws cli',
    clientType: 'public',
    scopes: sessionRef.session.registrationScopes,
  }));

  const registration: AwsSsoClientRegistration = {
    clientId: response.clientId || '',
    clientSecret: response.clientSecret || '',
    clientSecretExpiresAt: isoFromEpochSeconds(response.clientSecretExpiresAt),
    region: sessionRef.session.region,
    startUrl: sessionRef.session.startUrl,
    registrationScopes: sessionRef.session.registrationScopes,
  };

  if (!registration.clientId || !registration.clientSecret) {
    throw new Error(`AWS SSO registration for session '${sessionRef.name}' returned incomplete client credentials.`);
  }

  state.auth.clients[sessionRef.name] = registration;
  await saveAuth(state);
  return registration;
}

async function pollForDeviceToken(
  state: AwsCommandState,
  sessionRef: AwsSessionRef,
  registration: AwsSsoClientRegistration,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: string; issuedAt: string }> {
  const client = createOidcClient(state, sessionRef.session.region);
  const deadline = Date.now() + expiresInSeconds * 1000;
  let delayMs = Math.max(1, intervalSeconds) * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const response = await client.send(new CreateTokenCommand({
        clientId: registration.clientId,
        clientSecret: registration.clientSecret,
        grantType: DEFAULT_DEVICE_GRANT,
        deviceCode,
      }));
      if (!response.accessToken || !response.expiresIn) {
        throw new Error('AWS SSO token response did not include an access token.');
      }
      const issuedAt = new Date().toISOString();
      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken || undefined,
        issuedAt,
        expiresAt: new Date(Date.now() + response.expiresIn * 1000).toISOString(),
      };
    } catch (error) {
      if (error instanceof AuthorizationPendingException) {
        debugLog(state, 'authorization pending');
        continue;
      }
      if (error instanceof SlowDownException) {
        delayMs += 5000;
        debugLog(state, 'device authorization requested slow down');
        continue;
      }
      if (error instanceof ExpiredTokenException) {
        throw new Error('The AWS SSO device code expired before authorization completed.');
      }
      throw error;
    }
  }

  throw new Error('The AWS SSO device code expired before authorization completed.');
}

async function openDeviceAuthorizationWindow(url: string, userCode: string, noBrowser: boolean): Promise<void> {
  try {
    await navigator.clipboard.writeText(userCode);
  } catch {
    // clipboard access is best effort
  }

  if (noBrowser) {
    return;
  }

  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(
        `Your AWS SSO code is: ${userCode}\n\n(It has been copied to your clipboard)\n\nClick OK to continue.`,
      );
    }
  } catch {
    // ignore browser UI failures
  }

  try {
    window.open(url, '_blank');
  } catch {
    // ignore non-browser environments
  }
}

function clearSessionAuth(state: AwsCommandState, sessionName: string): void {
  delete state.auth.sessions[sessionName];
  for (const [profileName, cache] of Object.entries(state.auth.roleCredentials)) {
    if (cache.ssoSession === sessionName) {
      delete state.auth.roleCredentials[profileName];
    }
  }
}

async function ensureAccessToken(
  state: AwsCommandState,
  sessionRef: AwsSessionRef,
): Promise<AwsSsoSessionToken> {
  const existing = state.auth.sessions[sessionRef.name];
  if (existing && isAwsTimestampValid(existing.expiresAt)) {
    return existing;
  }

  if (!existing?.refreshToken) {
    clearSessionAuth(state, sessionRef.name);
    await saveAuth(state);
    throw buildLoginRequiredError(sessionRef.name);
  }

  const registration = state.auth.clients[sessionRef.name];
  if (!registration || !isAwsTimestampValid(registration.clientSecretExpiresAt, 0)) {
    clearSessionAuth(state, sessionRef.name);
    await saveAuth(state);
    throw buildLoginRequiredError(sessionRef.name);
  }

  try {
    const client = createOidcClient(state, sessionRef.session.region);
    const response = await client.send(new CreateTokenCommand({
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      grantType: 'refresh_token',
      refreshToken: existing.refreshToken,
      scope: sessionRef.session.registrationScopes,
    }));

    if (!response.accessToken || !response.expiresIn) {
      throw new Error('AWS SSO refresh did not return an access token.');
    }

    const refreshed: AwsSsoSessionToken = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken || existing.refreshToken,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + response.expiresIn * 1000).toISOString(),
      region: sessionRef.session.region,
      startUrl: sessionRef.session.startUrl,
      registrationScopes: sessionRef.session.registrationScopes,
    };

    state.auth.sessions[sessionRef.name] = refreshed;
    await saveAuth(state);
    return refreshed;
  } catch (error) {
    if (error instanceof InvalidClientException || error instanceof ExpiredTokenException) {
      clearSessionAuth(state, sessionRef.name);
      await saveAuth(state);
      throw buildLoginRequiredError(sessionRef.name);
    }
    throw error;
  }
}

async function resolveRoleCredentials(
  state: AwsCommandState,
  profileRef: AwsProfileRef,
  sessionRef: AwsSessionRef,
): Promise<AwsRoleCredentialCache> {
  const existing = state.auth.roleCredentials[profileRef.name];
  if (
    existing
    && existing.accountId === profileRef.profile.accountId
    && existing.roleName === profileRef.profile.roleName
    && existing.ssoSession === sessionRef.name
    && isAwsTimestampValid(existing.expiresAt)
  ) {
    return existing;
  }

  const sessionToken = await ensureAccessToken(state, sessionRef);
  const client = createSsoClient(state, sessionRef.session.region);
  const response = await client.send(new GetRoleCredentialsCommand({
    accessToken: sessionToken.accessToken,
    accountId: profileRef.profile.accountId,
    roleName: profileRef.profile.roleName,
  }));

  const roleCredentials = response.roleCredentials;
  if (!roleCredentials?.accessKeyId || !roleCredentials.secretAccessKey || !roleCredentials.sessionToken || !roleCredentials.expiration) {
    throw new Error(`AWS SSO did not return role credentials for profile '${profileRef.name}'.`);
  }

  const cache: AwsRoleCredentialCache = {
    accessKeyId: roleCredentials.accessKeyId,
    secretAccessKey: roleCredentials.secretAccessKey,
    sessionToken: roleCredentials.sessionToken,
    expiresAt: isoFromEpochMillis(roleCredentials.expiration),
    accountId: profileRef.profile.accountId,
    roleName: profileRef.profile.roleName,
    region: profileRef.profile.region || sessionRef.session.region,
    ssoSession: sessionRef.name,
  };

  state.auth.roleCredentials[profileRef.name] = cache;
  await saveAuth(state);
  return cache;
}

async function resolveAwsCredentials(
  state: AwsCommandState,
  profileRef: AwsProfileRef | null,
): Promise<AwsCredentialsResolution> {
  const envCredentials = ensureStaticCredentials(state.env);
  if (envCredentials) {
    return { credentials: envCredentials, source: 'env' };
  }

  if (!profileRef) {
    throw new Error('No AWS credentials available. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or configure an AWS profile.');
  }

  const sessionRef = resolveSessionByName(state, profileRef.profile.ssoSession);
  if (!sessionRef) {
    throw new Error(`AWS profile '${profileRef.name}' references unknown SSO session '${profileRef.profile.ssoSession}'.`);
  }

  const cached = await resolveRoleCredentials(state, profileRef, sessionRef);
  return {
    source: 'sso',
    credentials: {
      accessKeyId: cached.accessKeyId,
      secretAccessKey: cached.secretAccessKey,
      sessionToken: cached.sessionToken,
    },
  };
}

async function createAwsServiceClient<TClient>(
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
  factory: (config: {
    region: string;
    credentials: AwsCredentials;
    requestHandler: AlmostnodeAwsRequestHandler;
  }) => TClient,
): Promise<TClient> {
  const resolved = await resolveAwsCredentials(state, execution.profileRef);
  debugLog(state, `credentials source: ${resolved.source}`);
  return factory({
    region: execution.region,
    credentials: resolved.credentials,
    requestHandler: createAwsRequestHandler(state),
  });
}

async function withAwsServiceClient<T>(
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
  factory: (config: {
    region: string;
    credentials: AwsCredentials;
    requestHandler: AlmostnodeAwsRequestHandler;
  }) => { send: (command: any) => Promise<T> },
  command: unknown,
): Promise<T> {
  const client = await createAwsServiceClient(state, execution, factory);
  return client.send(command);
}

function buildConfigureListOutput(state: AwsCommandState): Record<string, unknown> {
  const summary = inspectAwsStoredState(state.vfs);
  const profiles = Object.entries(state.config.profiles).map(([name, profile]) => ({
    name,
    ssoSession: profile.ssoSession,
    accountId: profile.accountId,
    roleName: profile.roleName,
    region: profile.region || null,
    output: profile.output || DEFAULT_OUTPUT,
    hasValidRoleCredentials: Boolean(
      state.auth.roleCredentials[name]
      && isAwsTimestampValid(state.auth.roleCredentials[name].expiresAt),
    ),
  }));
  const ssoSessions = Object.entries(state.config.ssoSessions).map(([name, session]) => ({
    name,
    startUrl: session.startUrl,
    region: session.region,
    registrationScopes: session.registrationScopes,
    hasValidAccessToken: Boolean(
      state.auth.sessions[name]
      && isAwsTimestampValid(state.auth.sessions[name].expiresAt),
    ),
  }));
  return {
    defaultProfile: state.config.defaultProfile,
    profiles,
    ssoSessions,
    summary,
  };
}

function formatConfigureListText(output: ReturnType<typeof buildConfigureListOutput>): string {
  const lines: string[] = [];
  lines.push(`Default profile: ${output.defaultProfile || '(none)'}`);
  lines.push('SSO sessions:');
  if ((output.ssoSessions as Array<Record<string, unknown>>).length === 0) {
    lines.push('  (none)');
  } else {
    for (const session of output.ssoSessions as Array<Record<string, unknown>>) {
      lines.push(
        `  - ${session.name} (${session.region}) [${session.hasValidAccessToken ? 'authenticated' : 'login required'}]`,
      );
    }
  }
  lines.push('Profiles:');
  if ((output.profiles as Array<Record<string, unknown>>).length === 0) {
    lines.push('  (none)');
  } else {
    for (const profile of output.profiles as Array<Record<string, unknown>>) {
      lines.push(
        `  - ${profile.name} -> ${profile.ssoSession} ${profile.accountId}/${profile.roleName} [${profile.hasValidRoleCredentials ? 'credentials cached' : 'credentials missing'}]`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

async function runConfigureCommand(
  args: string[],
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
): Promise<JustBashExecResult> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return ok(`Usage: aws configure <sso-session|profile|list>\n`);
  }

  if (subcommand === 'list') {
    const output = buildConfigureListOutput(state);
    return execution.output === 'text'
      ? ok(formatConfigureListText(output))
      : ok(renderStructuredOutput(output, execution.output));
  }

  if (subcommand === 'sso-session') {
    const parsed = parseFlags(args.slice(1), [
      { name: 'name', kind: 'string' },
      { name: 'start-url', kind: 'string' },
      { name: 'region', kind: 'string' },
      { name: 'registration-scopes', kind: 'string' },
    ]);
    if (parsed.error) {
      return err(`aws configure sso-session: ${parsed.error}\n`);
    }
    const name = String(parsed.values['name'] || '').trim();
    const startUrl = String(parsed.values['start-url'] || '').trim();
    const region = String(parsed.values['region'] || '').trim();
    if (!name || !startUrl || !region) {
      return err('aws configure sso-session: --name, --start-url, and --region are required\n');
    }
    const registrationScopes = String(parsed.values['registration-scopes'] || DEFAULT_REGISTRATION_SCOPE)
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    state.config.ssoSessions[name] = {
      startUrl,
      region,
      registrationScopes: registrationScopes.length > 0 ? registrationScopes : [DEFAULT_REGISTRATION_SCOPE],
    };
    await saveConfig(state);
    return ok(renderStructuredOutput({
      configured: 'sso-session',
      name,
      startUrl,
      region,
      registrationScopes: state.config.ssoSessions[name].registrationScopes,
    }, execution.output));
  }

  if (subcommand === 'profile') {
    const parsed = parseFlags(args.slice(1), [
      { name: 'name', kind: 'string' },
      { name: 'sso-session', kind: 'string' },
      { name: 'account-id', kind: 'string' },
      { name: 'role-name', kind: 'string' },
      { name: 'region', kind: 'string' },
      { name: 'output', kind: 'string' },
    ]);
    if (parsed.error) {
      return err(`aws configure profile: ${parsed.error}\n`);
    }
    const name = String(parsed.values['name'] || '').trim();
    const ssoSession = String(parsed.values['sso-session'] || '').trim();
    const accountId = String(parsed.values['account-id'] || '').trim();
    const roleName = String(parsed.values['role-name'] || '').trim();
    if (!name || !ssoSession || !accountId || !roleName) {
      return err('aws configure profile: --name, --sso-session, --account-id, and --role-name are required\n');
    }
    if (!state.config.ssoSessions[ssoSession]) {
      return err(`aws configure profile: SSO session '${ssoSession}' is not configured\n`);
    }
    const output = parsed.values.output ? parseOutputFormat(String(parsed.values.output)) : undefined;
    if (parsed.values.output && !output) {
      return err('aws configure profile: --output must be json or text\n');
    }
    state.config.profiles[name] = {
      ssoSession,
      accountId,
      roleName,
      region: String(parsed.values.region || '').trim() || undefined,
      output,
    };
    if (!state.config.defaultProfile) {
      state.config.defaultProfile = name;
    }
    await saveConfig(state);
    return ok(renderStructuredOutput({
      configured: 'profile',
      name,
      ...state.config.profiles[name],
    }, execution.output));
  }

  return err(`aws configure: unknown subcommand '${subcommand}'\n`);
}

async function runSsoLogin(
  args: string[],
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
): Promise<JustBashExecResult> {
  const parsed = parseFlags(args, [
    { name: 'sso-session', kind: 'string' },
    { name: 'use-device-code', kind: 'boolean' },
    { name: 'no-browser', kind: 'boolean' },
  ]);
  if (parsed.error) {
    return err(`aws sso login: ${parsed.error}\n`);
  }

  const sessionRef = resolveSessionForCommand(
    state,
    typeof parsed.values['sso-session'] === 'string' ? String(parsed.values['sso-session']) : null,
  );
  const registration = await ensureClientRegistration(state, sessionRef);
  const client = createOidcClient(state, sessionRef.session.region);
  const deviceAuth = await client.send(new StartDeviceAuthorizationCommand({
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    startUrl: sessionRef.session.startUrl,
  }));

  if (!deviceAuth.deviceCode || !deviceAuth.userCode || !deviceAuth.verificationUri || !deviceAuth.expiresIn || !deviceAuth.interval) {
    throw new Error(`AWS SSO did not return a complete device authorization response for session '${sessionRef.name}'.`);
  }

  const verificationUrl = deviceAuth.verificationUriComplete || deviceAuth.verificationUri;
  await openDeviceAuthorizationWindow(
    verificationUrl,
    deviceAuth.userCode,
    Boolean(parsed.values['no-browser']),
  );

  const token = await pollForDeviceToken(
    state,
    sessionRef,
    registration,
    deviceAuth.deviceCode,
    deviceAuth.interval,
    deviceAuth.expiresIn,
  );

  state.auth.sessions[sessionRef.name] = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    issuedAt: token.issuedAt,
    region: sessionRef.session.region,
    startUrl: sessionRef.session.startUrl,
    registrationScopes: sessionRef.session.registrationScopes,
  };
  await saveAuth(state);

  const lines = [
    `Session: ${sessionRef.name}`,
    `Verification URL: ${verificationUrl}`,
    `User code: ${deviceAuth.userCode}`,
    'Authentication complete.',
  ];
  return ok(lines.join('\n') + '\n');
}

async function runSsoLogout(
  args: string[],
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
): Promise<JustBashExecResult> {
  const parsed = parseFlags(args, [{ name: 'sso-session', kind: 'string' }]);
  if (parsed.error) {
    return err(`aws sso logout: ${parsed.error}\n`);
  }

  const requested = typeof parsed.values['sso-session'] === 'string'
    ? resolveSessionForCommand(state, String(parsed.values['sso-session']))
    : null;
  const sessionNames = requested
    ? [requested.name]
    : Object.keys(state.auth.sessions).length > 0
      ? Object.keys(state.auth.sessions)
      : Object.keys(state.config.ssoSessions);

  for (const sessionName of sessionNames) {
    const sessionRef = resolveSessionByName(state, sessionName);
    const token = state.auth.sessions[sessionName];
    if (sessionRef && token?.accessToken) {
      try {
        const client = createSsoClient(state, sessionRef.session.region);
        await client.send(new LogoutCommand({ accessToken: token.accessToken }));
      } catch (error) {
        debugLog(state, `logout request for ${sessionName} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    clearSessionAuth(state, sessionName);
  }

  await saveAuth(state);
  return ok(`Logged out from ${sessionNames.length} AWS SSO session(s).\n`);
}

async function paginateSsoList<T>(
  state: AwsCommandState,
  sessionRef: AwsSessionRef,
  loadPage: (accessToken: string, nextToken?: string) => Promise<{ items: T[]; nextToken?: string }>,
): Promise<T[]> {
  const sessionToken = await ensureAccessToken(state, sessionRef);
  const items: T[] = [];
  let nextToken: string | undefined;

  do {
    const page = await loadPage(sessionToken.accessToken, nextToken);
    items.push(...page.items);
    nextToken = page.nextToken || undefined;
  } while (nextToken);

  return items;
}

async function runSsoCommand(
  args: string[],
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
): Promise<JustBashExecResult> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return ok(`Usage: aws sso <login|logout|list-accounts|list-account-roles|get-role-credentials>\n`);
  }

  if (subcommand === 'login') {
    return runSsoLogin(args.slice(1), state, execution);
  }
  if (subcommand === 'logout') {
    return runSsoLogout(args.slice(1), state, execution);
  }

  if (subcommand === 'list-accounts') {
    const parsed = parseFlags(args.slice(1), [
      { name: 'sso-session', kind: 'string' },
      { name: 'max-results', kind: 'number' },
    ]);
    if (parsed.error) {
      return err(`aws sso list-accounts: ${parsed.error}\n`);
    }
    const sessionRef = resolveSessionForCommand(
      state,
      typeof parsed.values['sso-session'] === 'string' ? String(parsed.values['sso-session']) : null,
    );
    const maxResults = typeof parsed.values['max-results'] === 'number'
      ? Number(parsed.values['max-results'])
      : undefined;
    const client = createSsoClient(state, sessionRef.session.region);
    const accounts = await paginateSsoList(state, sessionRef, async (accessToken, nextToken) => {
      const response = await client.send(new ListAccountsCommand({
        accessToken,
        nextToken,
        maxResults,
      }));
      return {
        items: response.accountList || [],
        nextToken: response.nextToken,
      };
    });
    return ok(renderStructuredOutput({ accountList: accounts }, execution.output));
  }

  if (subcommand === 'list-account-roles') {
    const parsed = parseFlags(args.slice(1), [
      { name: 'sso-session', kind: 'string' },
      { name: 'account-id', kind: 'string' },
      { name: 'max-results', kind: 'number' },
    ]);
    if (parsed.error) {
      return err(`aws sso list-account-roles: ${parsed.error}\n`);
    }
    const sessionRef = resolveSessionForCommand(
      state,
      typeof parsed.values['sso-session'] === 'string' ? String(parsed.values['sso-session']) : null,
    );
    const profileRef = resolveOptionalProfile(state);
    const accountId = String(parsed.values['account-id'] || profileRef?.profile.accountId || '').trim();
    if (!accountId) {
      return err('aws sso list-account-roles: --account-id is required when the current profile does not define one\n');
    }
    const maxResults = typeof parsed.values['max-results'] === 'number'
      ? Number(parsed.values['max-results'])
      : undefined;
    const client = createSsoClient(state, sessionRef.session.region);
    const roles = await paginateSsoList(state, sessionRef, async (accessToken, nextToken) => {
      const response = await client.send(new ListAccountRolesCommand({
        accessToken,
        accountId,
        nextToken,
        maxResults,
      }));
      return {
        items: response.roleList || [],
        nextToken: response.nextToken,
      };
    });
    return ok(renderStructuredOutput({ accountId, roleList: roles }, execution.output));
  }

  if (subcommand === 'get-role-credentials') {
    const parsed = parseFlags(args.slice(1), [
      { name: 'sso-session', kind: 'string' },
      { name: 'account-id', kind: 'string' },
      { name: 'role-name', kind: 'string' },
    ]);
    if (parsed.error) {
      return err(`aws sso get-role-credentials: ${parsed.error}\n`);
    }
    const profileRef = resolveOptionalProfile(state);
    const sessionRef = resolveSessionForCommand(
      state,
      typeof parsed.values['sso-session'] === 'string'
        ? String(parsed.values['sso-session'])
        : profileRef?.profile.ssoSession || null,
    );
    const accountId = String(parsed.values['account-id'] || profileRef?.profile.accountId || '').trim();
    const roleName = String(parsed.values['role-name'] || profileRef?.profile.roleName || '').trim();
    if (!accountId || !roleName) {
      return err('aws sso get-role-credentials: --account-id and --role-name are required when the current profile does not define them\n');
    }
    const sessionToken = await ensureAccessToken(state, sessionRef);
    const client = createSsoClient(state, sessionRef.session.region);
    const response = await client.send(new GetRoleCredentialsCommand({
      accessToken: sessionToken.accessToken,
      accountId,
      roleName,
    }));
    if (profileRef && profileRef.profile.accountId === accountId && profileRef.profile.roleName === roleName && profileRef.profile.ssoSession === sessionRef.name && response.roleCredentials?.expiration) {
      state.auth.roleCredentials[profileRef.name] = {
        accessKeyId: response.roleCredentials.accessKeyId || '',
        secretAccessKey: response.roleCredentials.secretAccessKey || '',
        sessionToken: response.roleCredentials.sessionToken || '',
        expiresAt: isoFromEpochMillis(response.roleCredentials.expiration),
        accountId,
        roleName,
        region: profileRef.profile.region || sessionRef.session.region,
        ssoSession: sessionRef.name,
      };
      await saveAuth(state);
    }
    return ok(renderStructuredOutput(response, execution.output));
  }

  return err(`aws sso: unknown subcommand '${subcommand}'\n`);
}

async function uploadLocalFileToS3(
  client: S3Client,
  state: AwsCommandState,
  sourcePath: string,
  bucket: string,
  key: string,
  options: {
    contentType?: string;
    cacheControl?: string;
  },
): Promise<void> {
  const body = state.vfs.readFileSync(sourcePath);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: options.contentType || inferContentType(sourcePath),
    CacheControl: options.cacheControl || undefined,
  }));
}

async function listS3Keys(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }));

    for (const entry of response.Contents || []) {
      if (entry.Key) {
        keys.push(entry.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function deleteS3Keys(
  client: S3Client,
  bucket: string,
  keys: string[],
): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }

  let deletedCount = 0;
  for (const chunk of chunkStrings(keys, S3_DELETE_BATCH_SIZE)) {
    const response = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((key) => ({ Key: key })),
        Quiet: true,
      },
    }));
    deletedCount += response.Deleted?.length ?? chunk.length;
  }

  return deletedCount;
}

const STS_OPERATIONS: Record<string, AwsCommandManifest> = {
  'get-caller-identity': {
    name: 'get-caller-identity',
    flags: [],
    parse: () => ({}),
    execute: async (_input, state, execution) => {
      return withAwsServiceClient(
        state,
        execution,
        (config) => new STSClient(config),
        new GetCallerIdentityCommand({}),
      );
    },
  },
};

const S3API_OPERATIONS: Record<string, AwsCommandManifest> = {
  'create-bucket': {
    name: 'create-bucket',
    flags: [{ name: 'bucket', kind: 'string' }],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const bucket = (input as { bucket: string }).bucket;
      if (!bucket) {
        throw new Error('aws s3api create-bucket: --bucket is required');
      }

      const response = await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new CreateBucketCommand({
          Bucket: bucket,
          CreateBucketConfiguration: execution.region !== 'us-east-1'
            ? { LocationConstraint: execution.region as any }
            : undefined,
        }),
      );

      return {
        bucket,
        region: execution.region,
        location: (response as { Location?: string }).Location || null,
      };
    },
  },
  'head-bucket': {
    name: 'head-bucket',
    flags: [{ name: 'bucket', kind: 'string' }],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const bucket = (input as { bucket: string }).bucket;
      if (!bucket) {
        throw new Error('aws s3api head-bucket: --bucket is required');
      }

      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new HeadBucketCommand({
          Bucket: bucket,
        }),
      );

      return { bucket, exists: true };
    },
  },
  'list-buckets': {
    name: 'list-buckets',
    flags: [],
    parse: () => ({}),
    execute: async (_input, state, execution) => {
      return withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new ListBucketsCommand({}),
      );
    },
  },
  'list-objects-v2': {
    name: 'list-objects-v2',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'prefix', kind: 'string' },
      { name: 'max-keys', kind: 'number' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      prefix: String(parsed.values.prefix || '').trim() || undefined,
      maxKeys: typeof parsed.values['max-keys'] === 'number' ? Number(parsed.values['max-keys']) : undefined,
    }),
    execute: async (input, state, execution) => {
      const { bucket, prefix, maxKeys } = input as { bucket: string; prefix?: string; maxKeys?: number };
      if (!bucket) {
        throw new Error('aws s3api list-objects-v2: --bucket is required');
      }
      return withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        }),
      );
    },
  },
  'put-bucket-website': {
    name: 'put-bucket-website',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'website-configuration', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      websiteConfiguration: String(parsed.values['website-configuration'] || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const { bucket, websiteConfiguration } = input as {
        bucket: string;
        websiteConfiguration: string;
      };
      if (!bucket) {
        throw new Error('aws s3api put-bucket-website: --bucket is required');
      }
      if (!websiteConfiguration) {
        throw new Error('aws s3api put-bucket-website: --website-configuration is required');
      }

      const parsedConfiguration = parseCliJsonValue<Record<string, unknown>>(
        state,
        websiteConfiguration,
        '--website-configuration',
      );
      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new PutBucketWebsiteCommand({
          Bucket: bucket,
          WebsiteConfiguration: parsedConfiguration,
        }),
      );

      return {
        bucket,
        configured: 'website',
      };
    },
  },
  'put-bucket-policy': {
    name: 'put-bucket-policy',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'policy', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      policy: String(parsed.values.policy || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const { bucket, policy } = input as { bucket: string; policy: string };
      if (!bucket) {
        throw new Error('aws s3api put-bucket-policy: --bucket is required');
      }
      if (!policy) {
        throw new Error('aws s3api put-bucket-policy: --policy is required');
      }

      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: parseCliJsonText(state, policy, '--policy'),
        }),
      );

      return {
        bucket,
        configured: 'policy',
      };
    },
  },
  'put-public-access-block': {
    name: 'put-public-access-block',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'public-access-block-configuration', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      configuration: String(parsed.values['public-access-block-configuration'] || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const { bucket, configuration } = input as { bucket: string; configuration: string };
      if (!bucket) {
        throw new Error('aws s3api put-public-access-block: --bucket is required');
      }
      if (!configuration) {
        throw new Error('aws s3api put-public-access-block: --public-access-block-configuration is required');
      }

      const parsedConfiguration = parseCliJsonValue<Record<string, unknown>>(
        state,
        configuration,
        '--public-access-block-configuration',
      );
      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new PutPublicAccessBlockCommand({
          Bucket: bucket,
          PublicAccessBlockConfiguration: parsedConfiguration as {
            BlockPublicAcls?: boolean;
            IgnorePublicAcls?: boolean;
            BlockPublicPolicy?: boolean;
            RestrictPublicBuckets?: boolean;
          },
        }),
      );

      return {
        bucket,
        configured: 'public-access-block',
      };
    },
  },
  'put-object': {
    name: 'put-object',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'key', kind: 'string' },
      { name: 'body', kind: 'string' },
      { name: 'content-type', kind: 'string' },
      { name: 'cache-control', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      key: String(parsed.values.key || '').trim(),
      body: String(parsed.values.body || '').trim(),
      contentType: String(parsed.values['content-type'] || '').trim() || undefined,
      cacheControl: String(parsed.values['cache-control'] || '').trim() || undefined,
    }),
    execute: async (input, state, execution) => {
      const {
        bucket,
        key,
        body,
        contentType,
        cacheControl,
      } = input as {
        bucket: string;
        key: string;
        body: string;
        contentType?: string;
        cacheControl?: string;
      };
      if (!bucket || !key || !body) {
        throw new Error('aws s3api put-object: --bucket, --key, and --body are required');
      }

      const sourcePath = resolveVfsPath(state, body);
      if (!state.vfs.existsSync(sourcePath)) {
        throw new Error(`aws s3api put-object: body path not found: ${sourcePath}`);
      }
      if (!state.vfs.statSync(sourcePath).isFile()) {
        throw new Error(`aws s3api put-object: --body must reference a file: ${sourcePath}`);
      }

      const response = await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: state.vfs.readFileSync(sourcePath),
          ContentType: contentType || inferContentType(sourcePath),
          CacheControl: cacheControl || undefined,
        }),
      );

      return {
        bucket,
        key,
        etag: (response as { ETag?: string }).ETag || null,
      };
    },
  },
  'delete-object': {
    name: 'delete-object',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'key', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      key: String(parsed.values.key || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const { bucket, key } = input as { bucket: string; key: string };
      if (!bucket || !key) {
        throw new Error('aws s3api delete-object: --bucket and --key are required');
      }

      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return {
        bucket,
        key,
        deleted: true,
      };
    },
  },
  'delete-objects': {
    name: 'delete-objects',
    flags: [
      { name: 'bucket', kind: 'string' },
      { name: 'delete', kind: 'string' },
    ],
    parse: (parsed) => ({
      bucket: String(parsed.values.bucket || '').trim(),
      deleteValue: String(parsed.values.delete || '').trim(),
    }),
    execute: async (input, state, execution) => {
      const { bucket, deleteValue } = input as { bucket: string; deleteValue: string };
      if (!bucket) {
        throw new Error('aws s3api delete-objects: --bucket is required');
      }
      if (!deleteValue) {
        throw new Error('aws s3api delete-objects: --delete is required');
      }

      const deleteRequest = parseCliJsonValue<{
        Objects?: Array<{ Key?: string; VersionId?: string }>;
        Quiet?: boolean;
      }>(state, deleteValue, '--delete');
      const objects = (deleteRequest.Objects || []).filter(
        (entry): entry is { Key: string; VersionId?: string } => Boolean(entry?.Key),
      );
      if (objects.length === 0) {
        throw new Error('aws s3api delete-objects: --delete must include at least one object key');
      }
      const normalizedDeleteRequest = {
        Objects: objects,
        Quiet: deleteRequest.Quiet,
      };
      await withAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: normalizedDeleteRequest,
        }),
      );

      return {
        bucket,
        deletedCount: objects.length,
      };
    },
  },
};

const S3_OPERATIONS: Record<string, AwsCommandManifest> = {
  cp: {
    name: 'cp',
    flags: [
      { name: 'recursive', kind: 'boolean' },
      { name: 'content-type', kind: 'string' },
      { name: 'cache-control', kind: 'string' },
    ],
    parse: (parsed) => ({
      source: parsed.positionals[0] || '',
      destination: parsed.positionals[1] || '',
      recursive: Boolean(parsed.values.recursive),
      contentType: String(parsed.values['content-type'] || '').trim() || undefined,
      cacheControl: String(parsed.values['cache-control'] || '').trim() || undefined,
    }),
    execute: async (input, state, execution) => {
      const {
        source,
        destination,
        recursive,
        contentType,
        cacheControl,
      } = input as {
        source: string;
        destination: string;
        recursive: boolean;
        contentType?: string;
        cacheControl?: string;
      };
      if (!source || !destination) {
        throw new Error('aws s3 cp: source and destination are required');
      }
      if (isS3Uri(source) || !isS3Uri(destination)) {
        throw new Error('aws s3 cp currently supports local-to-S3 uploads only.');
      }

      const sourcePath = resolveVfsPath(state, source);
      if (!state.vfs.existsSync(sourcePath)) {
        throw new Error(`aws s3 cp: source path not found: ${sourcePath}`);
      }

      const destinationRef = parseS3Uri(destination, 'destination');
      const destinationLooksLikePrefix = destination.endsWith('/');
      const sourceStats = state.vfs.statSync(sourcePath);
      const client = await createAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
      );

      if (sourceStats.isDirectory()) {
        if (!recursive) {
          throw new Error('aws s3 cp: directories require --recursive');
        }

        const files = listLocalFiles(state, sourcePath);
        for (const file of files) {
          await uploadLocalFileToS3(
            client,
            state,
            file.absolutePath,
            destinationRef.bucket,
            joinS3Key(destinationRef.key, file.relativePath),
            { contentType, cacheControl },
          );
        }

        return {
          operation: 'cp',
          source: sourcePath,
          bucket: destinationRef.bucket,
          prefix: destinationRef.key || '',
          uploadedCount: files.length,
        };
      }

      const key = !destinationRef.key || destinationLooksLikePrefix
        ? joinS3Key(destinationRef.key, basename(sourcePath))
        : destinationRef.key;
      await uploadLocalFileToS3(
        client,
        state,
        sourcePath,
        destinationRef.bucket,
        key,
        { contentType, cacheControl },
      );

      return {
        operation: 'cp',
        source: sourcePath,
        bucket: destinationRef.bucket,
        key,
        uploadedCount: 1,
      };
    },
  },
  sync: {
    name: 'sync',
    flags: [
      { name: 'delete', kind: 'boolean' },
      { name: 'content-type', kind: 'string' },
      { name: 'cache-control', kind: 'string' },
    ],
    parse: (parsed) => ({
      source: parsed.positionals[0] || '',
      destination: parsed.positionals[1] || '',
      deleteExtra: Boolean(parsed.values.delete),
      contentType: String(parsed.values['content-type'] || '').trim() || undefined,
      cacheControl: String(parsed.values['cache-control'] || '').trim() || undefined,
    }),
    execute: async (input, state, execution) => {
      const {
        source,
        destination,
        deleteExtra,
        contentType,
        cacheControl,
      } = input as {
        source: string;
        destination: string;
        deleteExtra: boolean;
        contentType?: string;
        cacheControl?: string;
      };
      if (!source || !destination) {
        throw new Error('aws s3 sync: source and destination are required');
      }
      if (isS3Uri(source) || !isS3Uri(destination)) {
        throw new Error('aws s3 sync currently supports local-to-S3 uploads only.');
      }

      const sourcePath = resolveVfsPath(state, source);
      if (!state.vfs.existsSync(sourcePath)) {
        throw new Error(`aws s3 sync: source path not found: ${sourcePath}`);
      }
      if (!state.vfs.statSync(sourcePath).isDirectory()) {
        throw new Error(`aws s3 sync: source must be a directory: ${sourcePath}`);
      }

      const destinationRef = parseS3Uri(destination, 'destination');
      const files = listLocalFiles(state, sourcePath);
      const client = await createAwsServiceClient(
        state,
        execution,
        (config) => new S3Client(config),
      );

      for (const file of files) {
        await uploadLocalFileToS3(
          client,
          state,
          file.absolutePath,
          destinationRef.bucket,
          joinS3Key(destinationRef.key, file.relativePath),
          { contentType, cacheControl },
        );
      }

      let deletedCount = 0;
      if (deleteExtra) {
        const localKeys = new Set(
          files.map((file) => joinS3Key(destinationRef.key, file.relativePath)),
        );
        const remoteKeys = await listS3Keys(client, destinationRef.bucket, destinationRef.key);
        const staleKeys = remoteKeys.filter((key) => !localKeys.has(key));
        deletedCount = await deleteS3Keys(client, destinationRef.bucket, staleKeys);
      }

      return {
        operation: 'sync',
        source: sourcePath,
        bucket: destinationRef.bucket,
        prefix: destinationRef.key || '',
        uploadedCount: files.length,
        deletedCount,
      };
    },
  },
};

const EC2_OPERATIONS: Record<string, AwsCommandManifest> = {
  'describe-regions': {
    name: 'describe-regions',
    flags: [{ name: 'all-regions', kind: 'boolean' }],
    parse: (parsed) => ({
      allRegions: Boolean(parsed.values['all-regions']),
    }),
    execute: async (input, state, execution) => {
      return withAwsServiceClient(
        state,
        execution,
        (config) => new EC2Client(config),
        new DescribeRegionsCommand({
          AllRegions: (input as { allRegions: boolean }).allRegions || undefined,
        }),
      );
    },
  },
  'describe-instances': {
    name: 'describe-instances',
    flags: [{ name: 'instance-id', kind: 'repeatable-string' }],
    parse: (parsed) => ({
      instanceIds: Array.isArray(parsed.values['instance-id']) ? parsed.values['instance-id'] as string[] : [],
    }),
    execute: async (input, state, execution) => {
      const instanceIds = (input as { instanceIds: string[] }).instanceIds;
      return withAwsServiceClient(
        state,
        execution,
        (config) => new EC2Client(config),
        new DescribeInstancesCommand({
          InstanceIds: instanceIds.length > 0 ? instanceIds : undefined,
        }),
      );
    },
  },
  'start-instances': {
    name: 'start-instances',
    flags: [{ name: 'instance-id', kind: 'repeatable-string' }],
    parse: (parsed) => ({
      instanceIds: Array.isArray(parsed.values['instance-id']) ? parsed.values['instance-id'] as string[] : [],
    }),
    execute: async (input, state, execution) => {
      const instanceIds = (input as { instanceIds: string[] }).instanceIds;
      if (instanceIds.length === 0) {
        throw new Error('aws ec2 start-instances: at least one --instance-id is required');
      }
      return withAwsServiceClient(
        state,
        execution,
        (config) => new EC2Client(config),
        new StartInstancesCommand({
          InstanceIds: instanceIds,
        }),
      );
    },
  },
};

async function runServiceGroup(
  groupName: string,
  args: string[],
  manifests: Record<string, AwsCommandManifest>,
  state: AwsCommandState,
  execution: AwsResolvedExecutionOptions,
): Promise<JustBashExecResult> {
  const subcommand = args[0];
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return ok(`Usage: aws ${groupName} <${Object.keys(manifests).join('|')}>\n`);
  }

  const manifest = manifests[subcommand];
  if (!manifest) {
    return err(`aws ${groupName}: unknown subcommand '${subcommand}'\n`);
  }

  const parsed = parseFlags(args.slice(1), manifest.flags);
  if (parsed.error) {
    return err(`aws ${groupName} ${subcommand}: ${parsed.error}\n`);
  }

  const input = manifest.parse(parsed, state, execution);
  const output = await manifest.execute(input, state, execution);
  return ok(renderStructuredOutput(output, execution.output));
}

function formatAwsError(error: unknown, state: AwsCommandState): string {
  const message = error instanceof Error ? error.message : String(error);
  if (state.globals.debug && error instanceof Error && error.stack) {
    return `${message}\n${error.stack}\n`;
  }
  return `${message}\n`;
}

export async function runAwsCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: MaybeKeychain,
): Promise<JustBashExecResult> {
  const parsedGlobals = parseAwsGlobalArgs(args);
  if ('error' in parsedGlobals) {
    return err(parsedGlobals.error);
  }

  const state: AwsCommandState = {
    cwd: ctx.cwd || '/',
    env: toEnvRecord(ctx.env),
    globals: parsedGlobals,
    config: readAwsConfig(vfs),
    auth: readAwsAuth(vfs),
    vfs,
    keychain,
    debugMessages: [],
  };

  try {
    if (parsedGlobals.version) {
      return appendDebugOutput(state, ok(`${AWS_COMMAND_VERSION}\n`));
    }

    if (parsedGlobals.help || parsedGlobals.commandArgs.length === 0 || parsedGlobals.commandArgs[0] === 'help') {
      return appendDebugOutput(state, ok(HELP_TEXT));
    }

    const execution = buildExecutionOptions(state);
    const [command, ...rest] = parsedGlobals.commandArgs;

    let result: JustBashExecResult;
    switch (command) {
      case 'configure':
        result = await runConfigureCommand(rest, state, execution);
        break;
      case 'sso':
        result = await runSsoCommand(rest, state, execution);
        break;
      case 'sts':
        result = await runServiceGroup('sts', rest, STS_OPERATIONS, state, execution);
        break;
      case 's3':
        result = await runServiceGroup('s3', rest, S3_OPERATIONS, state, execution);
        break;
      case 's3api':
        result = await runServiceGroup('s3api', rest, S3API_OPERATIONS, state, execution);
        break;
      case 'ec2':
        result = await runServiceGroup('ec2', rest, EC2_OPERATIONS, state, execution);
        break;
      default:
        result = err(`aws: unknown command '${command}'\n`);
        break;
    }

    return appendDebugOutput(state, result);
  } catch (error) {
    return appendDebugOutput(state, err(formatAwsError(error, state)));
  }
}

export {
  AWS_AUTH_PATH,
  AWS_CONFIG_PATH,
  inspectAwsStoredState,
};
