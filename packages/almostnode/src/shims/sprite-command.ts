import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';
import {
  createSprite,
  deleteSprite,
  getSprite,
  listSprites,
  runSpriteExec,
  writeSpriteFile,
} from './sprite-api';
import {
  DEFAULT_SPRITES_API_URL,
  deleteSpriteConfig,
  deleteSpriteLocalContext,
  inferSpriteOrgFromToken,
  listConfiguredSpriteOrgs,
  readSpriteConfig,
  rememberSpriteSelection,
  removeSpriteOrg,
  resolveSpriteSelection,
  storeSpriteToken,
  writeSpriteLocalContext,
  writeSpriteConfig,
} from './sprite-storage';

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

function normalizePath(input: string): string {
  if (!input) {
    return '/';
  }
  const normalized = input.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolvePath(cwd: string, target: string): string {
  return normalizePath(
    path.isAbsolute(target)
      ? path.normalize(target)
      : path.resolve(cwd || '/', target),
  );
}

function quote(value: string): string {
  if (/^[A-Za-z0-9._/:=-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function abortResult(): JustBashExecResult {
  return err('sprite: command aborted\n', 130);
}

function parseCommonFlags(args: string[]): {
  options: { org?: string; sprite?: string; apiUrl?: string };
  rest: string[];
  error?: string;
} {
  const options: { org?: string; sprite?: string; apiUrl?: string } = {};
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '-o' || arg === '--org') {
      const value = args[index + 1];
      if (!value) {
        return { options, rest: [], error: 'missing value for --org' };
      }
      options.org = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--org=')) {
      options.org = arg.slice('--org='.length);
      index += 1;
      continue;
    }
    if (arg === '-s' || arg === '--sprite') {
      const value = args[index + 1];
      if (!value) {
        return { options, rest: [], error: 'missing value for --sprite' };
      }
      options.sprite = value;
      index += 2;
      continue;
    }
    if (arg?.startsWith('--sprite=')) {
      options.sprite = arg.slice('--sprite='.length);
      index += 1;
      continue;
    }
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

function parseEnvAssignments(values: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const value of values) {
    for (const pair of value.split(',')) {
      const index = pair.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const key = pair.slice(0, index).trim();
      const rawValue = pair.slice(index + 1);
      if (!key) {
        continue;
      }
      env[key] = rawValue;
    }
  }
  return env;
}

function formatSpritesList(
  sprites: Awaited<ReturnType<typeof listSprites>>,
): string {
  if (sprites.sprites.length === 0) {
    return 'No sprites found.\n';
  }

  const lines = sprites.sprites.map((sprite) => {
    const parts = [sprite.name];
    if (sprite.status) {
      parts.push(`(${sprite.status})`);
    }
    if (sprite.url) {
      parts.push(sprite.url);
    }
    return parts.join(' ');
  });
  return `${lines.join('\n')}\n`;
}

function requireAuth(selection: ReturnType<typeof resolveSpriteSelection>): string | null {
  if (!selection.token) {
    return 'Not authenticated. Run `sprite login` or `sprite auth setup --token <token>` first.\n';
  }
  if (!selection.org) {
    return 'No organization is selected. Run `sprite login` or `sprite use --org <org> <sprite>` first.\n';
  }
  return null;
}

function requireSpriteName(selection: ReturnType<typeof resolveSpriteSelection>, explicit?: string | null): string | null {
  return explicit?.trim() || selection.sprite || null;
}

function isSpriteNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Sprite not found:');
}

function sanitizeSpriteName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function shouldSkipDeployPath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  return segments.some((segment) => (
    segment === '.git'
    || segment === 'node_modules'
    || segment === '.sprites'
    || segment === '.sprite'
  ));
}

async function uploadDirectoryToSprite(
  vfs: VirtualFS,
  options: {
    sourcePath: string;
    remotePath: string;
    apiUrl: string;
    token: string;
    spriteName: string;
    signal?: AbortSignal;
  },
): Promise<{ files: number; bytes: number }> {
  const entries = vfs.readdirSync(options.sourcePath).sort((left, right) => left.localeCompare(right));
  let files = 0;
  let bytes = 0;

  for (const entry of entries) {
    if (signalAborted(options.signal)) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const fullPath = resolvePath(options.sourcePath, entry);
    const relativePath = path.relative(options.sourcePath, fullPath).replace(/\\/g, '/');
    if (shouldSkipDeployPath(relativePath)) {
      continue;
    }

    const stats = vfs.statSync(fullPath);
    const remoteEntryPath = normalizePath(path.join(options.remotePath, entry));
    if (stats.isDirectory()) {
      const nested = await uploadDirectoryToSprite(vfs, {
        ...options,
        sourcePath: fullPath,
        remotePath: remoteEntryPath,
      });
      files += nested.files;
      bytes += nested.bytes;
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const raw = vfs.readFileSync(fullPath);
    await writeSpriteFile(
      options.apiUrl,
      options.token,
      options.spriteName,
      remoteEntryPath,
      raw,
      {
        mode: stats.mode & 0o777,
        mkdirParents: true,
      },
    );
    files += 1;
    bytes += raw.length;
  }

  return { files, bytes };
}

async function uploadExecFiles(
  vfs: VirtualFS,
  options: {
    cwd: string;
    apiUrl: string;
    token: string;
    spriteName: string;
    mappings: string[];
    signal?: AbortSignal;
  },
): Promise<void> {
  for (const mapping of options.mappings) {
    if (signalAborted(options.signal)) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const separator = mapping.indexOf(':');
    if (separator <= 0 || separator === mapping.length - 1) {
      throw new Error(`Invalid --file mapping: ${mapping}`);
    }

    const source = mapping.slice(0, separator);
    const destination = mapping.slice(separator + 1);
    const sourcePath = resolvePath(options.cwd, source);
    const stats = vfs.statSync(sourcePath);
    if (!stats.isFile()) {
      throw new Error(`--file source must be a file: ${source}`);
    }

    await writeSpriteFile(
      options.apiUrl,
      options.token,
      options.spriteName,
      destination,
      vfs.readFileSync(sourcePath),
      {
        mode: stats.mode & 0o777,
        mkdirParents: true,
      },
    );
  }
}

async function runLoginCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite login: ${parsed.error}\n`);
  }

  let apiUrl = parsed.options.apiUrl || DEFAULT_SPRITES_API_URL;
  const accountUrl = 'https://sprites.dev/account';
  if (!parsed.options.apiUrl && parsed.rest[0]?.startsWith('http')) {
    apiUrl = parsed.rest[0];
  }
  const loginUrl = accountUrl;
  const existingEnv = envToRecord(ctx.env);

  let pastedToken = existingEnv.SPRITE_TOKEN?.trim() || existingEnv.SPRITES_TOKEN?.trim() || '';
  if (!pastedToken) {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
      return err(
        'sprite login requires a browser prompt in almostnode.\n' +
        'Open https://sprites.dev/account, create a token, then use `sprite auth setup --token <token>`.\n',
      );
    }

    try {
      window.open(loginUrl, '_blank');
    } catch {
      // Ignore popup failures; the prompt below still works.
    }

    pastedToken = window.prompt(
      'Open https://sprites.dev/account, create a Sprites API token, then paste the full token here.',
      '',
    )?.trim() || '';
  }

  if (!pastedToken) {
    return err(
      'sprite login cancelled.\n' +
      'Open https://sprites.dev/account to create a token, then retry.\n',
    );
  }

  const org = parsed.options.org || inferSpriteOrgFromToken(pastedToken);
  if (!org) {
    return err(
      'Could not determine the organization from that token.\n' +
      'Retry with `sprite login --org <org>` or `sprite auth setup --token <token>`.\n',
    );
  }

  storeSpriteToken(vfs, {
    apiUrl,
    org,
    token: pastedToken,
  });
  await keychain?.persistCurrentState().catch(() => {});

  return ok(
    `Authenticated to Fly.io Sprites for org ${org}.\n` +
    `Stored credentials in ~/.sprites/sprites.json.\n`,
  );
}

async function runAuthCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const subcommand = args[0];
  if (subcommand !== 'setup') {
    return err(
      'Usage: sprite auth setup --token <token>\n',
    );
  }

  const rest = args.slice(1);
  let token = '';
  let org = '';
  let apiUrl = DEFAULT_SPRITES_API_URL;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--token') {
      token = rest[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg?.startsWith('--token=')) {
      token = arg.slice('--token='.length);
      continue;
    }
    if (arg === '--org') {
      org = rest[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg?.startsWith('--org=')) {
      org = arg.slice('--org='.length);
      continue;
    }
    if (arg === '--api-url') {
      apiUrl = rest[index + 1] || apiUrl;
      index += 1;
      continue;
    }
    if (arg?.startsWith('--api-url=')) {
      apiUrl = arg.slice('--api-url='.length);
    }
  }

  token = token.trim();
  org = org.trim() || inferSpriteOrgFromToken(token) || '';

  if (!token) {
    return err('sprite auth setup: --token is required\n');
  }
  if (!org) {
    return err('sprite auth setup: specify --org or use a token that includes the org slug\n');
  }

  storeSpriteToken(vfs, { apiUrl, org, token });
  await keychain?.persistCurrentState().catch(() => {});
  return ok(`Configured Sprites authentication for org ${org}.\n`);
}

async function runOrgCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'auth':
      return runLoginCommand(args.slice(1), _ctx, vfs, keychain);
    case 'list': {
      const config = readSpriteConfig(vfs);
      const currentUrl = config.current_selection.url || DEFAULT_SPRITES_API_URL;
      const orgs = listConfiguredSpriteOrgs(vfs, currentUrl);
      if (orgs.length === 0) {
        return ok('No Sprites organizations are configured.\n');
      }
      const lines = ['Configured organizations:'];
      for (const org of orgs) {
        lines.push(`  ${org.org}${org.current ? ' (current)' : ''}`);
      }
      return ok(`${lines.join('\n')}\n`);
    }
    case 'logout': {
      const parsed = parseCommonFlags(args.slice(1));
      if (parsed.error) {
        return err(`sprite org logout: ${parsed.error}\n`);
      }
      const removed = parsed.options.org || parsed.options.apiUrl
        ? removeSpriteOrg(vfs, {
          apiUrl: parsed.options.apiUrl,
          org: parsed.options.org,
        })
        : deleteSpriteConfig(vfs);
      if (!removed) {
        return ok('No Sprites credentials were removed.\n');
      }
      await keychain?.persistCurrentState().catch(() => {});
      return ok(
        parsed.options.org
          ? `Removed Sprites credentials for ${parsed.options.org}.\n`
          : 'Removed all Sprites credentials.\n',
      );
    }
    case 'keyring': {
      const action = args[1];
      if (action === 'disable') {
        const config = readSpriteConfig(vfs);
        for (const urlEntry of Object.values(config.urls)) {
          for (const orgEntry of Object.values(urlEntry.orgs)) {
            orgEntry.use_keyring = false;
          }
        }
        writeSpriteConfig(vfs, config);
        await keychain?.persistCurrentState().catch(() => {});
        return ok(
          'System keyring integration is disabled in almostnode.\n' +
          'Sprites credentials remain in ~/.sprites/sprites.json and can be protected by the passkey keychain.\n',
        );
      }
      if (action === 'enable') {
        return err(
          'sprite org keyring enable is not supported in almostnode.\n' +
          'Use the built-in passkey keychain to protect ~/.sprites/sprites.json instead.\n',
        );
      }
      return err('Usage: sprite org keyring <disable|enable>\n');
    }
    default:
      return err(
        'Usage: sprite org <auth|list|logout|keyring>\n',
      );
  }
}

async function runLogoutCommand(
  _args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const deleted = deleteSpriteConfig(vfs);
  await keychain?.persistCurrentState().catch(() => {});
  return ok(deleted ? 'Logged out of Sprites.\n' : 'No Sprites credentials were configured.\n');
}

async function runCreateCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite create: ${parsed.error}\n`);
  }

  const spriteName = parsed.rest[0] || parsed.options.sprite;
  if (!spriteName) {
    return err('Usage: sprite create [-o <org>] [sprite-name]\n');
  }

  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, parsed.options);
  const authError = requireAuth(selection);
  if (authError) {
    return err(authError);
  }

  const created = await createSprite(selection.apiUrl, selection.token!, spriteName);
  rememberSpriteSelection(vfs, selection.apiUrl, selection.org);

  const lines = [`Created sprite ${created.name}.`];
  if (created.url) {
    lines.push(created.url);
  }
  lines.push(`Use ${quote(`sprite use ${created.name}`)} to make it the local default.`);
  return ok(`${lines.join('\n')}\n`);
}

async function runListCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite list: ${parsed.error}\n`);
  }

  let prefix = '';
  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--prefix') {
      prefix = parsed.rest[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg?.startsWith('--prefix=')) {
      prefix = arg.slice('--prefix='.length);
    }
  }

  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, parsed.options);
  const authError = requireAuth(selection);
  if (authError) {
    return err(authError);
  }

  const sprites = await listSprites(selection.apiUrl, selection.token!, { prefix });
  return ok(formatSpritesList(sprites));
}

async function runDestroyCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite destroy: ${parsed.error}\n`);
  }

  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, parsed.options);
  const authError = requireAuth(selection);
  if (authError) {
    return err(authError);
  }

  const spriteName = parsed.rest[0] || requireSpriteName(selection, parsed.options.sprite);
  if (!spriteName) {
    return err('Usage: sprite destroy [-s <sprite>] [sprite-name]\n');
  }

  await deleteSprite(selection.apiUrl, selection.token!, spriteName);
  if (selection.localContext?.sprite === spriteName) {
    deleteSpriteLocalContext(vfs, ctx.cwd);
  }
  return ok(`Destroyed sprite ${spriteName}.\n`);
}

async function runUseCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite use: ${parsed.error}\n`);
  }

  let unset = false;
  const positionals: string[] = [];
  for (const arg of parsed.rest) {
    if (arg === '--unset') {
      unset = true;
      continue;
    }
    positionals.push(arg);
  }

  if (unset) {
    const deleted = deleteSpriteLocalContext(vfs, ctx.cwd);
    return ok(deleted ? 'Removed local .sprite context.\n' : 'No local .sprite context was set.\n');
  }

  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, parsed.options);
  const spriteName = positionals[0] || parsed.options.sprite;
  const organization = parsed.options.org || selection.org || undefined;

  if (!spriteName) {
    return err('Usage: sprite use [--org <org>] [sprite-name]\n');
  }

  writeSpriteLocalContext(vfs, ctx.cwd, {
    organization,
    sprite: spriteName,
  });
  if (organization) {
    rememberSpriteSelection(vfs, parsed.options.apiUrl || selection.apiUrl, organization);
  }
  return ok(
    `Using sprite ${spriteName}${organization ? ` for org ${organization}` : ''} in ${ctx.cwd}.\n`,
  );
}

async function runExecCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite exec: ${parsed.error}\n`);
  }

  let cwdOverride: string | undefined;
  let tty = false;
  const envValues: string[] = [];
  const fileMappings: string[] = [];
  const command: string[] = [];

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (command.length > 0) {
      command.push(arg);
      continue;
    }
    if (arg === '--') {
      command.push(...parsed.rest.slice(index + 1));
      break;
    }
    if (arg === '--dir') {
      cwdOverride = parsed.rest[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--dir=')) {
      cwdOverride = arg.slice('--dir='.length);
      continue;
    }
    if (arg === '--tty' || arg === '-tty') {
      tty = true;
      continue;
    }
    if (arg === '--env') {
      envValues.push(parsed.rest[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg?.startsWith('--env=')) {
      envValues.push(arg.slice('--env='.length));
      continue;
    }
    if (arg === '--file') {
      fileMappings.push(parsed.rest[index + 1] || '');
      index += 1;
      continue;
    }
    if (arg?.startsWith('--file=')) {
      fileMappings.push(arg.slice('--file='.length));
      continue;
    }
    command.push(arg);
  }

  if (command.length === 0) {
    return err('Usage: sprite exec [-s <sprite>] [--dir <path>] [--env KEY=value] <command> [args...]\n');
  }

  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, parsed.options);
  const authError = requireAuth(selection);
  if (authError) {
    return err(authError);
  }

  const spriteName = requireSpriteName(selection, parsed.options.sprite);
  if (!spriteName) {
    return err('sprite exec: no sprite selected. Use -s <sprite> or run `sprite use <sprite>` first.\n');
  }

  try {
    await uploadExecFiles(vfs, {
      cwd: ctx.cwd,
      apiUrl: selection.apiUrl,
      token: selection.token!,
      spriteName,
      mappings: fileMappings,
      signal: ctx.signal,
    });
  } catch (error) {
    return err(`sprite exec: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  const result = await runSpriteExec({
    apiUrl: selection.apiUrl,
    token: selection.token!,
    spriteName,
    command,
    cwd: cwdOverride,
    env: parseEnvAssignments(envValues),
    tty,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

async function runDeployCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseCommonFlags(args);
  if (parsed.error) {
    return err(`sprite deploy: ${parsed.error}\n`);
  }

  let remoteDir: string | undefined;
  let skipInstall = false;
  let postCommand: string | undefined;
  let sourceArg = '.';

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--dir') {
      remoteDir = parsed.rest[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--dir=')) {
      remoteDir = arg.slice('--dir='.length);
      continue;
    }
    if (arg === '--skip-install' || arg === '--no-install') {
      skipInstall = true;
      continue;
    }
    if (arg === '--command') {
      postCommand = parsed.rest[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith('--command=')) {
      postCommand = arg.slice('--command='.length);
      continue;
    }
    sourceArg = arg;
  }

  const sourcePath = resolvePath(ctx.cwd, sourceArg);
  if (!vfs.existsSync(sourcePath)) {
    return err(`sprite deploy: source path not found: ${sourceArg}\n`);
  }
  if (!vfs.statSync(sourcePath).isDirectory()) {
    return err(`sprite deploy: source must be a directory: ${sourceArg}\n`);
  }

  const inferredName = sanitizeSpriteName(path.basename(sourcePath)) || 'app';
  const env = envToRecord(ctx.env);
  const selection = resolveSpriteSelection(vfs, ctx.cwd, env, {
    ...parsed.options,
    sprite: parsed.options.sprite || inferredName,
  });
  const authError = requireAuth(selection);
  if (authError) {
    return err(authError);
  }

  const spriteName = requireSpriteName(selection, parsed.options.sprite || inferredName);
  if (!spriteName) {
    return err('sprite deploy: could not determine a sprite name.\n');
  }

  let spriteInfo = null as Awaited<ReturnType<typeof getSprite>> | null;
  let created = false;
  try {
    spriteInfo = await getSprite(selection.apiUrl, selection.token!, spriteName);
  } catch (error) {
    if (!isSpriteNotFoundError(error)) {
      return err(`sprite deploy: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (!spriteInfo) {
    spriteInfo = await createSprite(selection.apiUrl, selection.token!, spriteName);
    created = true;
  }

  const remoteRoot = normalizePath(
    remoteDir?.trim() || `/home/sprite/${sanitizeSpriteName(path.basename(sourcePath)) || 'app'}`,
  );

  let uploadSummary;
  try {
    uploadSummary = await uploadDirectoryToSprite(vfs, {
      sourcePath,
      remotePath: remoteRoot,
      apiUrl: selection.apiUrl,
      token: selection.token!,
      spriteName,
      signal: ctx.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return abortResult();
    }
    return err(`sprite deploy: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  let installResult: Awaited<ReturnType<typeof runSpriteExec>> | null = null;
  if (!skipInstall && vfs.existsSync(resolvePath(sourcePath, 'package.json'))) {
    installResult = await runSpriteExec({
      apiUrl: selection.apiUrl,
      token: selection.token!,
      spriteName,
      command: ['npm', 'install'],
      cwd: remoteRoot,
    });
    if (installResult.exitCode !== 0) {
      return {
        stdout: installResult.stdout,
        stderr: `sprite deploy: remote npm install failed\n${installResult.stderr}`,
        exitCode: installResult.exitCode,
      };
    }
  }

  let postResult: Awaited<ReturnType<typeof runSpriteExec>> | null = null;
  if (postCommand?.trim()) {
    postResult = await runSpriteExec({
      apiUrl: selection.apiUrl,
      token: selection.token!,
      spriteName,
      command: ['sh', '-lc', postCommand.trim()],
      cwd: remoteRoot,
    });
    if (postResult.exitCode !== 0) {
      return {
        stdout: postResult.stdout,
        stderr: `sprite deploy: remote command failed\n${postResult.stderr}`,
        exitCode: postResult.exitCode,
      };
    }
  }

  writeSpriteLocalContext(vfs, sourcePath, {
    organization: selection.org || undefined,
    sprite: spriteName,
  });
  rememberSpriteSelection(vfs, selection.apiUrl, selection.org);

  const lines = [
    `${created ? 'Created' : 'Updated'} sprite ${spriteName}.`,
    `Uploaded ${uploadSummary.files} files (${uploadSummary.bytes} bytes) to ${remoteRoot}.`,
  ];
  if (installResult) {
    lines.push('Ran npm install on the remote sprite.');
  }
  if (postResult) {
    lines.push(`Ran remote command: ${postCommand}`);
  }
  if (spriteInfo?.url) {
    lines.push(`URL: ${spriteInfo.url}`);
  }
  lines.push(`Console: sprite console -s ${spriteName}`);
  return ok(`${lines.join('\n')}\n`);
}

function buildHelpText(): string {
  return (
    'sprite - Fly.io Sprites integration for almostnode\n\n' +
    'Commands:\n' +
    '  login                          Open Sprites account and save a token\n' +
    '  logout                         Remove saved Sprites credentials\n' +
    '  auth setup --token <token>     Configure Sprites credentials from a token\n' +
    '  org <auth|list|logout>         Manage saved org credentials\n' +
    '  create <name>                  Create a sprite\n' +
    '  list                           List sprites for the selected org\n' +
    '  destroy <name>                 Destroy a sprite\n' +
    '  use <name>                     Save a local .sprite context\n' +
    '  exec <command> [args...]       Run a command in a sprite\n' +
    '  console                        Open a sprite console from the web IDE terminal\n' +
    '  deploy [path]                  Upload a project directory to a sprite\n\n' +
    'Common flags:\n' +
    '  -o, --org <name>               Select the configured Sprites organization\n' +
    '  -s, --sprite <name>            Select the target sprite\n' +
    '      --api-url <url>            Override the Sprites API URL\n'
  );
}

export async function runSpriteCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  try {
    const parsed = parseCommonFlags(args);
    if (parsed.error) {
      return err(`sprite: ${parsed.error}\n`);
    }

    const [subcommand, ...rest] = parsed.rest;
    const effectiveArgs = [...Object.entries(parsed.options).flatMap(([key, value]) => {
      if (!value) {
        return [];
      }
      if (key === 'org') return ['--org', value];
      if (key === 'sprite') return ['--sprite', value];
      if (key === 'apiUrl') return ['--api-url', value];
      return [];
    }), ...rest];

    switch (subcommand) {
      case undefined:
      case 'help':
      case '--help':
        return ok(buildHelpText());
      case 'login':
        return runLoginCommand(effectiveArgs, ctx, vfs, keychain);
      case 'logout':
        return runLogoutCommand(effectiveArgs, ctx, vfs, keychain);
      case 'auth':
        return runAuthCommand(effectiveArgs, ctx, vfs, keychain);
      case 'org':
        return runOrgCommand(effectiveArgs, ctx, vfs, keychain);
      case 'create':
        return runCreateCommand(effectiveArgs, ctx, vfs);
      case 'list':
      case 'ls':
        return runListCommand(effectiveArgs, ctx, vfs);
      case 'destroy':
      case 'rm':
        return runDestroyCommand(effectiveArgs, ctx, vfs);
      case 'use':
        return runUseCommand(effectiveArgs, ctx, vfs);
      case 'exec':
      case 'x':
        return runExecCommand(effectiveArgs, ctx, vfs);
      case 'deploy':
        return runDeployCommand(effectiveArgs, ctx, vfs);
      case 'console':
        return err(
          'sprite console is handled by the web IDE terminal and opens a dedicated interactive tab.\n' +
          'If you are not in the web IDE, use `sprite exec` or `sprite deploy` instead.\n',
        );
      default:
        return err(`sprite: unknown command '${subcommand}'\n`, 2);
    }
  } catch (error) {
    if (signalAborted(ctx.signal)) {
      return abortResult();
    }
    return err(`sprite: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
