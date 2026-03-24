import { describe, expect, it } from 'vitest';
import { mergeAlmostnodeClaudeSettings } from './claude-project-hooks';

describe('mergeAlmostnodeClaudeSettings', () => {
  const cliPath = '/Users/demo/.local/bin/almostnode-bridge';

  it('adds the bridge permission rule and bash hook when missing', () => {
    const result = mergeAlmostnodeClaudeSettings({}, cliPath);
    const permissions = result.permissions as Record<string, unknown>;
    const hooks = result.hooks as Record<string, unknown>;
    const preToolUse = hooks.PreToolUse as Array<Record<string, unknown>>;

    expect(result.$schema).toBe('https://json.schemastore.org/claude-code-settings.json');
    expect(permissions.allow).toContain(`Bash(${cliPath}:*)`);
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0].matcher).toBe('Bash');
  });

  it('preserves existing settings and avoids duplicate entries', () => {
    const existing = {
      permissions: {
        allow: [`Bash(${cliPath}:*)`, 'Bash(git:*)'],
      },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: '.claude/hooks/almostnode-route-bash.mjs' },
            ],
          },
        ],
      },
    };

    const result = mergeAlmostnodeClaudeSettings(existing, cliPath);
    const permissions = result.permissions as Record<string, unknown>;
    const hooks = result.hooks as Record<string, unknown>;
    const preToolUse = hooks.PreToolUse as Array<Record<string, unknown>>;
    const allow = permissions.allow as string[];

    expect(allow.filter((entry) => entry === `Bash(${cliPath}:*)`)).toHaveLength(1);
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0].hooks).toHaveLength(1);
  });
});
