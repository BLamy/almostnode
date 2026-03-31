import { describe, expect, it } from 'vitest';
import { createContainer } from '../src';

describe('Claude command environment', () => {
  it('preserves HOME and USER when launching the Claude package via npx', async () => {
    const originalHome = process.env.HOME;
    const originalUser = process.env.USER;

    process.env.HOME = '/home/user';
    process.env.USER = 'user';

    const container = createContainer();

    try {
      container.vfs.mkdirSync('/node_modules/@anthropic-ai/claude-code', { recursive: true });
      container.vfs.writeFileSync(
        '/node_modules/@anthropic-ai/claude-code/package.json',
        JSON.stringify({
          name: '@anthropic-ai/claude-code',
          bin: {
            claude: './cli.js',
          },
        }),
      );
      container.vfs.writeFileSync(
        '/node_modules/@anthropic-ai/claude-code/cli.js',
        [
          "const fs = require('fs');",
          "const path = require('path');",
          "const configPath = path.join(process.env.HOME || '/', '.claude.json');",
          "console.log(JSON.stringify({",
          "  home: process.env.HOME || null,",
          "  user: process.env.USER || null,",
          "  configPath,",
          "  hasConfig: fs.existsSync(configPath),",
          "}));",
        ].join('\n'),
      );
      container.vfs.writeFileSync('/home/user/.claude.json', '{"oauthAccount":{"emailAddress":"demo@example.com"}}');

      const result = await container.run('npx @anthropic-ai/claude-code');
      const parsed = JSON.parse(result.stdout.trim()) as {
        home: string | null;
        user: string | null;
        configPath: string;
        hasConfig: boolean;
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.home).toBe('/home/user');
      expect(parsed.user).toBe('user');
      expect(parsed.configPath).toBe('/home/user/.claude.json');
      expect(parsed.hasConfig).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }

      if (originalUser === undefined) {
        delete process.env.USER;
      } else {
        process.env.USER = originalUser;
      }
    }
  });

  it('launches the Claude package from /project so project rules are discoverable', async () => {
    const container = createContainer({ cwd: '/project' });

    container.vfs.mkdirSync('/project/node_modules/@anthropic-ai/claude-code', { recursive: true });
    container.vfs.writeFileSync('/project/CLAUDE.md', '# project rules\n');
    container.vfs.writeFileSync(
      '/project/node_modules/@anthropic-ai/claude-code/package.json',
      JSON.stringify({
        name: '@anthropic-ai/claude-code',
        bin: {
          claude: './cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      '/project/node_modules/@anthropic-ai/claude-code/cli.js',
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "let dir = process.cwd();",
        "let found = null;",
        "while (true) {",
        "  const candidate = path.join(dir, 'CLAUDE.md');",
        "  if (fs.existsSync(candidate)) {",
        "    found = candidate;",
        "    break;",
        "  }",
        "  const parent = path.dirname(dir);",
        "  if (parent === dir) break;",
        "  dir = parent;",
        "}",
        "console.log(JSON.stringify({ cwd: process.cwd(), found }));",
      ].join('\n'),
    );

    const result = await container.run('npx @anthropic-ai/claude-code');
    const parsed = JSON.parse(result.stdout.trim()) as {
      cwd: string;
      found: string | null;
    };

    expect(result.exitCode).toBe(0);
    expect(parsed.cwd).toBe('/project');
    expect(parsed.found).toBe('/project/CLAUDE.md');
  });

  it('reads Claude history transcripts one JSON line at a time', async () => {
    const container = createContainer();

    container.vfs.writeFileSync(
      '/project/history.jsonl',
      [
        JSON.stringify({
          type: 'file-history-snapshot',
          messageId: 'm1',
          snapshot: { messageId: 'm1', trackedFileBackups: {}, timestamp: '2026-03-29T18:31:32.024Z' },
          isSnapshotUpdate: false,
        }),
        JSON.stringify({
          parentUuid: null,
          isSidechain: false,
          promptId: 'p1',
          type: 'user',
          message: { role: 'user', content: 'hey' },
          uuid: 'm1',
          timestamp: '2026-03-29T18:31:32.024Z',
        }),
        JSON.stringify({
          parentUuid: 'm1',
          isSidechain: false,
          type: 'assistant',
          uuid: 'm2',
          timestamp: '2026-03-29T18:31:37.292Z',
          message: {
            model: 'claude-opus-4-6',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hey! How can I help you today?' }],
          },
        }),
      ].join('\n'),
    );

    container.vfs.writeFileSync(
      '/project/read-history.js',
      [
        "const fs = require('fs/promises');",
        '',
        '(async () => {',
        "  const transcript = await fs.readFile('/project/history.jsonl');",
        '  const parsed = [];',
        '  let offset = 0;',
        '',
        '  while (offset < transcript.length) {',
        '    let newlineIndex = transcript.indexOf(10, offset);',
        '    if (newlineIndex === -1) newlineIndex = transcript.length;',
        '',
        "    const line = transcript.toString('utf8', offset, newlineIndex).trim();",
        '    offset = newlineIndex + 1;',
        '',
        '    if (line) parsed.push(JSON.parse(line));',
        '  }',
        '',
        '  console.log(JSON.stringify(parsed.map(entry => entry.type)));',
        '})().catch((error) => {',
        "  console.error(error && error.stack ? error.stack : String(error));",
        '  process.exit(1);',
        '});',
      ].join('\n'),
    );

    const result = await container.run('node /project/read-history.js');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([
      'file-history-snapshot',
      'user',
      'assistant',
    ]);
  });
});
