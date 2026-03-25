import { app } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ALMOSTNODE_BRIDGE_COMMAND_NAME = 'almostnode-bridge';
export const ALMOSTNODE_BRIDGE_SHELL_COMMAND_NAME = 'almostnode-shell';

export const BRIDGED_COMMAND_NAMES = [
  'bun',
  'find',
  'grep',
  'ls',
  'next',
  'node',
  'npm',
  'npx',
  'playwright',
  'playwright-cli',
  'pnpm',
  'pwd',
  'rg',
  'tsx',
  'tsc',
  'vite',
  'vitest',
  'yarn',
] as const;

const SHELL_PROXY_BYPASS_PREFIXES = [
  'claude',
  'codex',
  'opencode',
  'cursor-cli',
  'brew',
  'open',
  'pbcopy',
  'pbpaste',
] as const;

export function shouldProxyShellWrapperCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  // Keep multiline scripts on the real host shell. Commands like
  // `cat <<'EOF' ... EOF` rely on heredoc/stdin semantics that the bridge
  // path does not emulate correctly, while project mirroring still syncs the
  // resulting file changes back into the VFS.
  if (/[\r\n]/.test(trimmed)) {
    return false;
  }

  const firstToken = trimmed.split(/\s+/, 1)[0] ?? '';
  return !SHELL_PROXY_BYPASS_PREFIXES.some((prefix) => firstToken.startsWith(prefix));
}

interface BridgeExecRequest {
  command: string;
  cwd: string | null;
  projectDirectory: string | null;
  background: boolean;
}

interface BridgeServerState {
  cliPath: string;
  origin: string;
  server: Server;
  stateFilePath: string;
  token: string;
}

export interface AlmostnodeBridgeServerSetupOptions {
  invokeRenderer: (windowId: number, operation: string, params: Record<string, unknown>) => Promise<unknown>;
  resolveProjectWindowId: (cwd: string | null, projectDirectory: string | null) => number | null;
}

let bridgeServerState: BridgeServerState | null = null;

function getBridgeStateFilePath(): string {
  return path.join(app.getPath('userData'), 'almostnode-bridge-state.json');
}

export function getAlmostnodeBridgeCliPath(): string {
  return path.join(app.getPath('home'), '.local', 'bin', ALMOSTNODE_BRIDGE_COMMAND_NAME);
}

export function getAlmostnodeBridgeShellPath(): string {
  return path.join(app.getPath('home'), '.local', 'bin', ALMOSTNODE_BRIDGE_SHELL_COMMAND_NAME);
}

export function getAlmostnodeBridgeShimDirectoryPath(): string {
  return path.join(app.getPath('userData'), 'almostnode-shell-shims');
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function normalizeOptionalDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function normalizeExecRequest(payload: unknown): BridgeExecRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid bridge payload.');
  }

  const record = payload as Record<string, unknown>;
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (!command) {
    throw new Error('Bridge payload is missing a command.');
  }

  return {
    command,
    cwd: normalizeOptionalDirectory(record.cwd),
    projectDirectory: normalizeOptionalDirectory(record.projectDirectory),
    background: record.background === true,
  };
}

function getCliScriptSource(stateFilePath: string): string {
  return `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';

const COMMAND_NAME = ${JSON.stringify(ALMOSTNODE_BRIDGE_COMMAND_NAME)};
const STATE_FILE_PATH = ${JSON.stringify(stateFilePath)};

function printUsage() {
  process.stderr.write(
    \`Usage:
  \${COMMAND_NAME} exec [--cwd PATH] [--project-dir PATH] [--background] [--command TEXT | --command-base64 BASE64 | -- COMMAND...]
\`,
  );
}

function fail(message) {
  process.stderr.write(String(message) + '\\n');
  process.exit(1);
}

function parseExecArgs(argv) {
  let cwd = process.cwd();
  let projectDirectory = null;
  let background = false;
  let command = '';

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--cwd') {
      index += 1;
      if (index >= argv.length) fail('--cwd requires a value');
      cwd = argv[index];
      continue;
    }
    if (value === '--project-dir') {
      index += 1;
      if (index >= argv.length) fail('--project-dir requires a value');
      projectDirectory = argv[index];
      continue;
    }
    if (value === '--background') {
      background = true;
      continue;
    }
    if (value === '--command') {
      index += 1;
      if (index >= argv.length) fail('--command requires a value');
      command = argv[index];
      continue;
    }
    if (value === '--command-base64') {
      index += 1;
      if (index >= argv.length) fail('--command-base64 requires a value');
      command = Buffer.from(argv[index], 'base64').toString('utf8');
      continue;
    }
    if (value === '--') {
      command = argv.slice(index + 1).join(' ');
      break;
    }

    command = argv.slice(index).join(' ');
    break;
  }

  if (!command.trim()) {
    fail('No command provided.');
  }

  return { command, cwd, projectDirectory, background };
}

function readBridgeState() {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
  } catch (error) {
    fail(\`Unable to read \${COMMAND_NAME} state. Is almostnode desktop running? (\${error instanceof Error ? error.message : String(error)})\`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('State file is not an object.');
    }
    const origin = typeof parsed.origin === 'string' ? parsed.origin.trim() : '';
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    if (!origin || !token) {
      throw new Error('State file is missing required fields.');
    }
    return { origin, token };
  } catch (error) {
    fail(\`Invalid \${COMMAND_NAME} state file: \${error instanceof Error ? error.message : String(error)}\`);
  }
}

function requestJson(urlString, token, payload) {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        path: url.pathname,
        method: 'POST',
        headers: {
          authorization: \`Bearer \${token}\`,
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (error) {
            reject(new Error(\`Invalid bridge response: \${error instanceof Error ? error.message : String(error)}\`));
            return;
          }

          if ((response.statusCode || 500) >= 400) {
            const message = typeof parsed.error === 'string' ? parsed.error : \`Bridge request failed with status \${response.statusCode}\`;
            reject(new Error(message));
            return;
          }

          resolve(parsed);
        });
      },
    );

    request.on('error', (error) => {
      reject(new Error(\`Unable to reach almostnode desktop bridge: \${error instanceof Error ? error.message : String(error)}\`));
    });

    request.write(body);
    request.end();
  });
}

async function main() {
  const [, , commandName, ...rest] = process.argv;
  if (!commandName || commandName === '--help' || commandName === '-h') {
    printUsage();
    process.exit(commandName ? 0 : 1);
  }

  if (commandName !== 'exec') {
    fail(\`Unknown command: \${commandName}\`);
  }

  const payload = parseExecArgs(rest);
  const state = readBridgeState();

  try {
    const response = await requestJson(new URL('/v1/exec', state.origin).toString(), state.token, payload);
    const stdout = typeof response.stdout === 'string' ? response.stdout : '';
    const stderr = typeof response.stderr === 'string' ? response.stderr : '';
    const exitCode = typeof response.exitCode === 'number' && Number.isFinite(response.exitCode)
      ? Math.trunc(response.exitCode)
      : 1;

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main();
`;
}

function getShellWrapperSource(cliPath: string): string {
  const bypassCasePattern = SHELL_PROXY_BYPASS_PREFIXES.map((prefix) => `${prefix}*`).join('|');
  return `#!/bin/sh
BRIDGE_CLI=${JSON.stringify(cliPath)}
REAL_SHELL="\${ALMOSTNODE_REAL_SHELL:-/bin/zsh}"
PROJECT_DIR="\${ALMOSTNODE_BRIDGE_PROJECT_DIR:-}"

should_proxy_command() {
  case "$1" in
    "" ) return 1 ;;
    *'
'* ) return 1 ;;
    ${bypassCasePattern} )
      return 1
      ;;
    * )
      return 0
      ;;
  esac
}

extract_command() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -c)
        shift
        printf '%s' "$1"
        return 0
        ;;
      -*c*)
        shift
        printf '%s' "$1"
        return 0
        ;;
      --)
        break
        ;;
    esac
    shift
  done
  return 1
}

COMMAND="$(extract_command "$@")"
if [ -n "$COMMAND" ] && should_proxy_command "$COMMAND"; then
  if [ -n "$PROJECT_DIR" ]; then
    exec "$BRIDGE_CLI" exec --project-dir "$PROJECT_DIR" --cwd "$PWD" --command "$COMMAND"
  fi
  exec "$BRIDGE_CLI" exec --cwd "$PWD" --command "$COMMAND"
fi

exec "$REAL_SHELL" "$@"
`;
}

function getCommandShimSource(cliPath: string): string {
  return `#!/bin/sh
BRIDGE_CLI=${JSON.stringify(cliPath)}
PROJECT_DIR="\${ALMOSTNODE_BRIDGE_PROJECT_DIR:-}"
COMMAND_NAME="$(basename "$0")"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

COMMAND="$(shell_quote "$COMMAND_NAME")"
for ARG in "$@"; do
  COMMAND="$COMMAND $(shell_quote "$ARG")"
done

if [ -n "$PROJECT_DIR" ]; then
  exec "$BRIDGE_CLI" exec --project-dir "$PROJECT_DIR" --cwd "$PWD" --command "$COMMAND"
fi
exec "$BRIDGE_CLI" exec --cwd "$PWD" --command "$COMMAND"
`;
}

async function installCliScript(stateFilePath: string): Promise<string> {
  const cliPath = getAlmostnodeBridgeCliPath();
  await fs.promises.mkdir(path.dirname(cliPath), { recursive: true });
  await fs.promises.writeFile(cliPath, getCliScriptSource(stateFilePath), { encoding: 'utf8', mode: 0o755 });
  await fs.promises.chmod(cliPath, 0o755);
  return cliPath;
}

async function installShellWrapper(cliPath: string): Promise<string> {
  const shellPath = getAlmostnodeBridgeShellPath();
  await fs.promises.mkdir(path.dirname(shellPath), { recursive: true });
  await fs.promises.writeFile(shellPath, getShellWrapperSource(cliPath), { encoding: 'utf8', mode: 0o755 });
  await fs.promises.chmod(shellPath, 0o755);
  return shellPath;
}

async function installCommandShims(cliPath: string): Promise<string> {
  const shimDirectory = getAlmostnodeBridgeShimDirectoryPath();
  await fs.promises.mkdir(shimDirectory, { recursive: true });

  await Promise.all(BRIDGED_COMMAND_NAMES.map(async (commandName) => {
    const shimPath = path.join(shimDirectory, commandName);
    await fs.promises.writeFile(shimPath, getCommandShimSource(cliPath), { encoding: 'utf8', mode: 0o755 });
    await fs.promises.chmod(shimPath, 0o755);
  }));

  return shimDirectory;
}

async function writeBridgeState(state: Pick<BridgeServerState, 'origin' | 'stateFilePath' | 'token'>): Promise<void> {
  await fs.promises.mkdir(path.dirname(state.stateFilePath), { recursive: true });
  await fs.promises.writeFile(
    state.stateFilePath,
    JSON.stringify({ origin: state.origin, token: state.token }, null, 2),
    'utf8',
  );
}

export async function setupAlmostnodeCommandBridgeServer(
  options: AlmostnodeBridgeServerSetupOptions,
): Promise<{ cliPath: string; origin: string }> {
  if (bridgeServerState) {
    return {
      cliPath: bridgeServerState.cliPath,
      origin: bridgeServerState.origin,
    };
  }

  const stateFilePath = getBridgeStateFilePath();
  const cliPath = await installCliScript(stateFilePath);
  await installShellWrapper(cliPath);
  await installCommandShims(cliPath);
  const token = randomUUID();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/v1/exec') {
      writeJsonResponse(response, 404, { error: 'Not found.' });
      return;
    }

    const authorization = request.headers.authorization ?? '';
    if (authorization !== `Bearer ${token}`) {
      writeJsonResponse(response, 401, { error: 'Unauthorized bridge request.' });
      return;
    }

    try {
      const payload = normalizeExecRequest(await readJsonBody(request));
      const projectWindowId = options.resolveProjectWindowId(payload.cwd, payload.projectDirectory);
      if (projectWindowId === null) {
        writeJsonResponse(response, 404, {
          error: 'No open almostnode project window matched this working directory.',
        });
        return;
      }

      const result = await options.invokeRenderer(projectWindowId, 'run-command', payload as unknown as Record<string, unknown>);
      if (!result || typeof result !== 'object') {
        writeJsonResponse(response, 500, { error: 'Renderer returned an invalid bridge response.' });
        return;
      }

      writeJsonResponse(response, 200, result as Record<string, unknown>);
    } catch (error) {
      writeJsonResponse(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const origin = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine almostnode bridge address.'));
        return;
      }
      resolve(`http://127.0.0.1:${(address as AddressInfo).port}`);
    });
  });

  bridgeServerState = {
    cliPath,
    origin,
    server,
    stateFilePath,
    token,
  };
  await writeBridgeState(bridgeServerState);

  return { cliPath, origin };
}

export async function stopAlmostnodeCommandBridgeServer(): Promise<void> {
  if (!bridgeServerState) {
    return;
  }

  const state = bridgeServerState;
  bridgeServerState = null;

  await new Promise<void>((resolve, reject) => {
    state.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  try {
    await fs.promises.rm(state.stateFilePath, { force: true });
  } catch {
    // Ignore stale state cleanup errors.
  }
}
