import { describe, expect, it } from 'vitest';
import {
  augmentClaudeLaunchCommand,
  matchesClaudeLaunchCommand,
  matchesOpenCodeLaunchCommand,
  matchesShadcnLaunchCommand,
  parseOpenCodeLaunchCommand,
  shouldRunWorkbenchCommandInteractively,
} from '../src/features/terminal-command-routing';

describe('webide terminal command routing', () => {
  it('matches OpenCode launch commands across wrappers', () => {
    expect(matchesOpenCodeLaunchCommand('npx opencode-ai')).toBe(true);
    expect(matchesOpenCodeLaunchCommand('env FOO=bar npm exec -- opencode')).toBe(true);
    expect(matchesOpenCodeLaunchCommand('time ./node_modules/.bin/opencode-ai help')).toBe(true);
  });

  it('parses OpenCode resume flags across wrappers', () => {
    expect(parseOpenCodeLaunchCommand('npx opencode-ai --continue --session ses_123')).toEqual({
      continue: true,
      sessionID: 'ses_123',
    });
    expect(parseOpenCodeLaunchCommand('env FOO=bar npm exec -- opencode -c -s ses_456')).toEqual({
      continue: true,
      sessionID: 'ses_456',
    });
  });

  it('matches Claude launch commands across wrappers', () => {
    expect(matchesClaudeLaunchCommand('npx @anthropic-ai/claude-code')).toBe(true);
    expect(matchesClaudeLaunchCommand('/usr/local/bin/claude-wrapper --plugin-dir /project/.claude-plugin')).toBe(true);
    expect(matchesClaudeLaunchCommand('env FOO=bar npm exec -- claude')).toBe(true);
    expect(matchesClaudeLaunchCommand('time ./node_modules/.bin/claude --help')).toBe(true);
  });

  it('appends one Claude IDE MCP config to launcher commands', () => {
    const augmented = augmentClaudeLaunchCommand(
      '/usr/local/bin/claude-wrapper --plugin-dir /project/.claude-plugin',
      '{"mcpServers":{"ide":{"type":"sse-ide","url":"http://localhost/__virtual__/43127/sse","ideName":"almostnode Web IDE"}}}',
      (value) => `'${value}'`,
    );

    expect(augmented).toContain("--mcp-config '{\"mcpServers\":{\"ide\":{\"type\":\"sse-ide\",\"url\":\"http://localhost/__virtual__/43127/sse\",\"ideName\":\"almostnode Web IDE\"}}}'");
    expect(augmentClaudeLaunchCommand(augmented, '{"ignored":true}', (value) => `'${value}'`)).toBe(augmented);
  });

  it('augments typed Claude commands without disturbing chained segments', () => {
    expect(
      augmentClaudeLaunchCommand(
        'echo preflight && npx @anthropic-ai/claude-code --resume abc123',
        '{"mcpServers":{"ide":{"type":"sse-ide","url":"http://localhost/__virtual__/43127/sse","ideName":"almostnode Web IDE"}}}',
        (value) => `'${value}'`,
      ),
    ).toBe(
      "echo preflight && npx @anthropic-ai/claude-code --resume abc123 --mcp-config '{\"mcpServers\":{\"ide\":{\"type\":\"sse-ide\",\"url\":\"http://localhost/__virtual__/43127/sse\",\"ideName\":\"almostnode Web IDE\"}}}'",
    );
  });

  it('matches shadcn launch commands across wrappers', () => {
    expect(matchesShadcnLaunchCommand('npx shadcn@latest add dropdown-menu')).toBe(true);
    expect(matchesShadcnLaunchCommand('npm exec -- shadcn add card')).toBe(true);
    expect(matchesShadcnLaunchCommand('command ./node_modules/.bin/shadcn init')).toBe(true);
  });

  it('treats shadcn and OpenCode as interactive in the regular workbench terminal', () => {
    expect(shouldRunWorkbenchCommandInteractively('npx shadcn@latest add dropdown-menu', 'user')).toBe(true);
    expect(shouldRunWorkbenchCommandInteractively('npx opencode-ai', 'user')).toBe(true);
    expect(shouldRunWorkbenchCommandInteractively('/usr/local/bin/claude-wrapper --plugin-dir /project/.claude-plugin', 'user')).toBe(true);
    expect(shouldRunWorkbenchCommandInteractively('npm run dev', 'user')).toBe(false);
    expect(shouldRunWorkbenchCommandInteractively('npx shadcn@latest add dropdown-menu', 'preview')).toBe(false);
    expect(shouldRunWorkbenchCommandInteractively('printf "hello"', 'agent')).toBe(true);
  });
});
