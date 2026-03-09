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
});
