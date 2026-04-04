import fs from 'node:fs';
import path from 'node:path';
import { ALMOSTNODE_BRIDGE_COMMAND_NAME, getAlmostnodeBridgeCliPath } from './almostnode-command-bridge';

const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const SETTINGS_RELATIVE_PATH = path.join('.claude', 'settings.local.json');
const HOOK_RELATIVE_PATH = path.join('.claude', 'hooks', 'almostnode-route-bash.mjs');

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createBridgePermissionRule(cliPath: string): string {
  return `Bash(${cliPath}:*)`;
}

function getHookScriptSource(cliPath: string): string {
  return `#!/usr/bin/env node
import fs from 'node:fs';

const CLI_PATH = ${JSON.stringify(cliPath)};
const BRIDGE_COMMAND_NAME = ${JSON.stringify(ALMOSTNODE_BRIDGE_COMMAND_NAME)};
const HOST_COMMAND_PREFIXES = [
  /^almostnode-bridge(?:\\s|$)/,
  /^claude(?:\\s|$)/,
  /^codex(?:\\s|$)/,
  /^opencode(?:\\s|$)/,
  /^cursor-cli(?:\\s|$)/,
  /^brew(?:\\s|$)/,
  /^open(?:\\s|$)/,
  /^almostnode-lsp-bridge(?:\\s|$)/,
  /^oxfmt(?:\\s|$)/,
  /^oxlint(?:\\s|$)/,
  /^pbcopy(?:\\s|$)/,
  /^pbpaste(?:\\s|$)/,
];

function shellEscape(value) {
  return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
}

function shouldProxyCommand(command) {
  const normalized = String(command || '').trim();
  if (!normalized) return false;
  return !HOST_COMMAND_PREFIXES.some((pattern) => pattern.test(normalized));
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  const payload = JSON.parse(raw);
  if (payload.tool_name !== 'Bash') {
    return;
  }

  const toolInput = payload.tool_input && typeof payload.tool_input === 'object'
    ? payload.tool_input
    : {};
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const cwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : '';
  const runInBackground = toolInput.run_in_background === true;

  if (!shouldProxyCommand(command)) {
    return;
  }

  const commandBase64 = Buffer.from(command, 'utf8').toString('base64');
  const rewritten = [
    shellEscape(CLI_PATH),
    'exec',
    cwd ? '--cwd ' + shellEscape(cwd) : '',
    runInBackground ? '--background' : '',
    '--command-base64 ' + shellEscape(commandBase64),
  ].filter(Boolean).join(' ');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Route Bash through the almostnode desktop VFS bridge',
      updatedInput: {
        ...toolInput,
        command: rewritten,
      },
    },
  }));
}

main();
`;
}

export function mergeAlmostnodeClaudeSettings(
  existing: Record<string, unknown> | null | undefined,
  cliPath: string,
): Record<string, unknown> {
  const next = isRecord(existing) ? { ...existing } : {};
  if (typeof next.$schema !== 'string' || !next.$schema.trim()) {
    next.$schema = SETTINGS_SCHEMA;
  }

  const permissions = isRecord(next.permissions) ? { ...next.permissions } : {};
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : [];
  const bridgeRule = createBridgePermissionRule(cliPath);
  if (!allow.includes(bridgeRule)) {
    allow.push(bridgeRule);
  }
  permissions.allow = allow;
  next.permissions = permissions;

  const hooks = isRecord(next.hooks) ? { ...next.hooks } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];

  let matcherGroupFound = false;
  for (const entry of preToolUse) {
    if (!isRecord(entry) || entry.matcher !== 'Bash') {
      continue;
    }

    const hookEntries = Array.isArray(entry.hooks) ? [...entry.hooks] : [];
    if (!hookEntries.some((hook) => isRecord(hook) && hook.type === 'command' && hook.command === HOOK_RELATIVE_PATH)) {
      hookEntries.push({ type: 'command', command: HOOK_RELATIVE_PATH });
    }
    entry.hooks = hookEntries;
    matcherGroupFound = true;
    break;
  }

  if (!matcherGroupFound) {
    preToolUse.push({
      matcher: 'Bash',
      hooks: [
        {
          type: 'command',
          command: HOOK_RELATIVE_PATH,
        },
      ],
    });
  }

  hooks.PreToolUse = preToolUse;
  next.hooks = hooks;

  return next;
}

export async function ensureAlmostnodeClaudeBridgeFiles(projectDirectory: string): Promise<void> {
  const cliPath = getAlmostnodeBridgeCliPath();
  const settingsPath = path.join(projectDirectory, SETTINGS_RELATIVE_PATH);
  const hookPath = path.join(projectDirectory, HOOK_RELATIVE_PATH);

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(hookPath), { recursive: true });

  let existingSettings: Record<string, unknown> | null = null;
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = await fs.promises.readFile(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      existingSettings = isRecord(parsed) ? parsed : {};
    } catch {
      existingSettings = {};
    }
  }

  const nextSettings = mergeAlmostnodeClaudeSettings(existingSettings, cliPath);
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  await fs.promises.writeFile(hookPath, getHookScriptSource(cliPath), { encoding: 'utf8', mode: 0o755 });
  await fs.promises.chmod(hookPath, 0o755);
}
