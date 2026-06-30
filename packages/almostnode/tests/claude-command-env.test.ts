import { describe, expect, it } from 'vitest';
import { createContainer } from '../src';

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

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

  it('routes claude-wrapper through the pinned browser-safe Claude package and forwards args', async () => {
    const container = createContainer({ cwd: '/project' });

    container.vfs.mkdirSync('/project/node_modules/@anthropic-ai/claude-code', { recursive: true });
    container.vfs.writeFileSync(
      '/project/node_modules/@anthropic-ai/claude-code/package.json',
      JSON.stringify({
        name: '@anthropic-ai/claude-code',
        bin: {
          'claude-code': './cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      '/project/node_modules/@anthropic-ai/claude-code/cli.js',
      [
        'Object.defineProperty(globalThis, Symbol.for("undici.globalDispatcher.1"), {',
        '  value: { ok: true },',
        '  configurable: false,',
        '});',
        'console.log(JSON.stringify({',
        '  argv: process.argv.slice(2),',
        '  cwd: process.cwd(),',
        '  noFlicker: process.env.CLAUDE_CODE_NO_FLICKER || null,',
        '}));',
      ].join('\n'),
    );

    const result = await container.run(
      '/usr/local/bin/claude-wrapper --plugin-dir "/project/.claude-plugin" --resume "session-1"',
    );
    const parsed = JSON.parse(result.stdout.trim()) as {
      argv: string[];
      cwd: string;
      noFlicker: string | null;
    };

    expect(result.exitCode).toBe(0);
    expect(parsed.argv).toEqual([
      '--plugin-dir',
      '/project/.claude-plugin',
      '--resume',
      'session-1',
    ]);
    expect(parsed.cwd).toBe('/project');
    expect(parsed.noFlicker).toBe('1');
  });

  it('lets npx package CLIs exit from an unawaited async main', async () => {
    const container = createContainer({ cwd: '/project' });
    const packageDir = '/project/node_modules/@earendil-works/pi-coding-agent';

    container.vfs.mkdirSync(`${packageDir}/dist`, { recursive: true });
    container.vfs.writeFileSync(
      `${packageDir}/package.json`,
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0-test',
        type: 'module',
        bin: {
          pi: './dist/cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      `${packageDir}/dist/cli.js`,
      [
        "import { EnvHttpProxyAgent, getGlobalDispatcher, install, setGlobalDispatcher } from 'undici';",
        "import process from 'node:process';",
        '',
        'setGlobalDispatcher(new EnvHttpProxyAgent({ bodyTimeout: 300000 }));',
        'install();',
        '',
        'async function main(args) {',
        '  await Promise.resolve();',
        "  if (args.includes('--version')) {",
        "    if (!getGlobalDispatcher()) throw new Error('missing undici dispatcher');",
        "    console.log('0.0.0-pi-fixture');",
        '    process.exit(0);',
        "    console.error('process.exit returned');",
        '    process.exit(1);',
        '  }',
        "  console.error('missing version flag');",
        '  process.exit(1);',
        '}',
        '',
        'main(process.argv.slice(2)).catch((error) => {',
        "  if (!error || !String(error.message || error).startsWith('Process exited with code')) {",
        '    throw error;',
        '  }',
        '});',
      ].join('\n'),
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Timed out waiting for npx async process.exit'));
      }, 4000);
    });

    const result = await Promise.race([
      container.run('npx @earendil-works/pi-coding-agent --version'),
      timeoutPromise,
    ]);
    if (timeoutId) clearTimeout(timeoutId);

    expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(0);
    expect(result.stdout.trim()).toBe('0.0.0-pi-fixture');
    expect(result.stderr).toBe('');
  });

  it('lets npx package TUIs probe process.kill during startup', async () => {
    const container = createContainer({ cwd: '/project' });
    const packageDir = '/project/node_modules/@earendil-works/pi-coding-agent';

    container.vfs.mkdirSync(`${packageDir}/dist`, { recursive: true });
    container.vfs.writeFileSync(
      `${packageDir}/package.json`,
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0-test',
        type: 'module',
        bin: {
          pi: './dist/cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      `${packageDir}/dist/cli.js`,
      [
        "import process from 'node:process';",
        '',
        'console.log(JSON.stringify({',
        "  killType: typeof process.kill,",
        '  selfProbe: process.kill(process.pid, 0),',
        "  groupSignal: process.kill(0, 'SIGTSTP'),",
        '}));',
      ].join('\n'),
    );

    const result = await container.run('npx @earendil-works/pi-coding-agent');
    const parsed = JSON.parse(result.stdout.trim()) as {
      killType: string;
      selfProbe: boolean;
      groupSignal: boolean;
    };

    expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(0);
    expect(parsed).toEqual({
      killType: 'function',
      selfProbe: true,
      groupSignal: true,
    });
    expect(result.stderr).toBe('');
  });

  it('marks interactive npx package CLIs as long-running node processes', async () => {
    const container = createContainer({ cwd: '/project' });
    const packageDir = '/project/node_modules/@earendil-works/pi-coding-agent';

    container.vfs.mkdirSync(`${packageDir}/dist`, { recursive: true });
    container.vfs.writeFileSync(
      `${packageDir}/package.json`,
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0-test',
        type: 'module',
        bin: {
          pi: './dist/cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      `${packageDir}/dist/cli.js`,
      [
        "import process from 'node:process';",
        '',
        'console.log(JSON.stringify({',
        '  longIdle: process.env.ALMOSTNODE_LONG_NODE_IDLE,',
        '  npxExec: process.env.ALMOSTNODE_NPX_EXEC,',
        '  stdinTty: process.stdin.isTTY,',
        '}));',
        'process.exit(0);',
      ].join('\n'),
    );

    const session = container.createTerminalSession({ cwd: '/project' });
    const result = await session.run('npx @earendil-works/pi-coding-agent', {
      interactive: true,
    });
    const parsed = JSON.parse(result.stdout.trim()) as {
      longIdle: string;
      npxExec: string;
      stdinTty: boolean;
    };

    expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(0);
    expect(parsed).toEqual({
      longIdle: '1',
      npxExec: '1',
      stdinTty: true,
    });
    expect(result.stderr).toBe('');
  });

  it('keeps Pi-style npx package TUIs alive for slash-command input', async () => {
    const container = createContainer({ cwd: '/project' });
    const packageDir = '/project/node_modules/@earendil-works/pi-coding-agent';

    container.vfs.mkdirSync(`${packageDir}/dist`, { recursive: true });
    container.vfs.writeFileSync(
      `${packageDir}/package.json`,
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0-test',
        type: 'module',
        bin: {
          pi: './dist/cli.js',
        },
      }),
    );
    container.vfs.writeFileSync(
      `${packageDir}/dist/cli.js`,
      [
        "import process from 'node:process';",
        '',
        "console.log('Pi ready');",
        'process.stdin.setRawMode(true);',
        'const onData = (chunk) => {',
        '  const text = String(chunk);',
        "  console.log('PI_INPUT:' + text.replace(/[\\r\\n]+/g, ''));",
        "  if (text.includes('/login')) {",
        "    process.stdin.off('data', onData);",
        '    process.stdin.setRawMode(false);',
        '  }',
        '};',
        "process.stdin.on('data', onData);",
      ].join('\n'),
    );

    const output: string[] = [];
    const session = container.createTerminalSession({ cwd: '/project' });
    const runPromise = session.run('npx @earendil-works/pi-coding-agent', {
      interactive: true,
      onStdout: (chunk) => output.push(chunk),
    });

    await waitFor(() => output.join('').includes('Pi ready'));

    const settledBeforeInput = await Promise.race([
      runPromise.then(() => 'settled'),
      new Promise<'running'>((resolve) => setTimeout(() => resolve('running'), 500)),
    ]);

    expect(settledBeforeInput).toBe('running');
    expect(session.getState().running).toBe(true);

    session.sendInput('/login\r');
    const result = await runPromise;
    const combined = output.join('');

    expect(result.exitCode, JSON.stringify(result, null, 2)).toBe(0);
    expect(combined).toContain('PI_INPUT:/login');
    expect(result.stderr).toBe('');
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
