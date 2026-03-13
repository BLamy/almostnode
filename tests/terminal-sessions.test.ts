// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/index';

describe('terminal sessions', () => {
  it('persists cwd and env per session without leaking across sessions', async () => {
    const container = createContainer();
    container.vfs.mkdirSync('/project/a', { recursive: true });
    container.vfs.mkdirSync('/project/b', { recursive: true });

    const sessionA = container.createTerminalSession({ cwd: '/project' });
    const sessionB = container.createTerminalSession({ cwd: '/project' });

    await sessionA.run('cd /project/a; export FOO=alpha');
    await sessionB.run('cd /project/b; export FOO=beta');

    const resultA = await sessionA.run('pwd; echo $FOO');
    const resultB = await sessionB.run('pwd; echo $FOO');

    expect(sessionA.getState().cwd).toBe('/project/a');
    expect(sessionB.getState().cwd).toBe('/project/b');
    expect(resultA.stdout).toContain('/project/a');
    expect(resultA.stdout).toContain('alpha');
    expect(resultB.stdout).toContain('/project/b');
    expect(resultB.stdout).toContain('beta');

    await sessionA.run('unset FOO');
    expect(sessionA.getState().env.FOO).toBeUndefined();
    expect(sessionB.getState().env.FOO).toBe('beta');
  });

  it('routes interactive stdin to the owning session only', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/interactive.js', `
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  const text = String(chunk).replace(/[\\r\\n]+/g, '');
  if (!text) return;
  console.log(process.argv[2] + ':' + text);
  process.exit(0);
});
`);

    const firstOutput: string[] = [];
    const secondOutput: string[] = [];
    const first = container.createTerminalSession({ cwd: '/' });
    const second = container.createTerminalSession({ cwd: '/' });

    const firstRun = first.run('node /interactive.js first', {
      onStdout: (chunk) => firstOutput.push(chunk),
    });
    const secondRun = second.run('node /interactive.js second', {
      onStdout: (chunk) => secondOutput.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    first.sendInput('alpha\r');
    second.sendInput('beta\r');

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    expect(firstOutput.join('')).toContain('first:alpha');
    expect(firstOutput.join('')).not.toContain('second:beta');
    expect(secondOutput.join('')).toContain('second:beta');
    expect(secondOutput.join('')).not.toContain('first:alpha');
  });

  it('keeps explicitly interactive sessions alive until they are aborted', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/quiet-interactive.js', `
console.log('ready');
setInterval(() => {}, 1000);
`);

    const session = container.createTerminalSession({ cwd: '/' });
    const runPromise = session.run('node /quiet-interactive.js', {
      interactive: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    const settled = await Promise.race([
      runPromise.then(() => 'done'),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 100)),
    ]);

    expect(session.getState().running).toBe(true);
    expect(settled).toBe('waiting');

    session.abort();
    const result = await runPromise;
    expect(result.exitCode).toBe(130);
    expect(result.stdout).toContain('ready');
  });

  it('lets interactive node commands exit once stdin is no longer active', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/one-shot-interactive.js', `
console.log('done');
`);

    const session = container.createTerminalSession({ cwd: '/' });
    const result = await session.run('node /one-shot-interactive.js', {
      interactive: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('done');
    expect(session.getState().running).toBe(false);
  });

  it('keeps nested child_process exec calls bound to the launching session', async () => {
    const container = createContainer();
    container.vfs.mkdirSync('/project/a', { recursive: true });
    container.vfs.mkdirSync('/project/b', { recursive: true });
    container.vfs.writeFileSync('/nested-exec.js', `
const { exec } = require('child_process');
exec('pwd', (error, stdout) => {
  if (error) {
    console.error(error.message);
    process.exit(1);
    return;
  }
  console.log(process.argv[2] + ':' + stdout.trim());
  process.exit(0);
});
`);

    const first = container.createTerminalSession({ cwd: '/project/a' });
    const second = container.createTerminalSession({ cwd: '/project/b' });

    const [firstResult, secondResult] = await Promise.all([
      first.run('node /nested-exec.js first'),
      second.run('node /nested-exec.js second'),
    ]);

    expect(firstResult.exitCode).toBe(0);
    expect(secondResult.exitCode).toBe(0);
    expect(firstResult.stdout).toContain('first:/project/a');
    expect(secondResult.stdout).toContain('second:/project/b');
  });

  it('keeps legacy container.run stateless across calls', async () => {
    const container = createContainer();
    container.vfs.mkdirSync('/project/a', { recursive: true });

    const first = await container.run('cd /project/a; export FOO=legacy; pwd; echo $FOO', { cwd: '/' });
    const second = await container.run('pwd; echo ${FOO:-missing}', { cwd: '/' });

    expect(first.stdout).toContain('/project/a');
    expect(first.stdout).toContain('legacy');
    expect(second.stdout).toContain('/\nmissing');
  });

  it('aborting one session does not affect a parallel session', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/wait.js', `
// Keep alive with periodic output so idle detection doesn't kill us
const iv = setInterval(() => process.stdout.write(''), 50);
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  clearInterval(iv);
  console.log('got:' + String(chunk).trim());
  process.exit(0);
});
`);

    const sessionA = container.createTerminalSession({ cwd: '/' });
    const sessionB = container.createTerminalSession({ cwd: '/' });

    const outputB: string[] = [];
    const runA = sessionA.run('node /wait.js');
    const runB = sessionB.run('node /wait.js', {
      onStdout: (chunk) => outputB.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    sessionA.abort();

    const resultA = await runA;
    expect(resultA.exitCode).toBe(130);

    sessionB.sendInput('alive\r');
    const resultB = await runB;
    expect(resultB.exitCode).toBe(0);
    expect(outputB.join('')).toContain('got:alive');
  });

  it('streams onStdout for bash built-in commands (ls, echo, cat)', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/project/hello.txt', 'world');

    const session = container.createTerminalSession({ cwd: '/project' });
    const lsChunks: string[] = [];
    const lsResult = await session.run('ls', {
      onStdout: (text) => lsChunks.push(text),
    });
    expect(lsResult.stdout).toContain('hello.txt');
    expect(lsChunks.join('')).toContain('hello.txt');

    const echoChunks: string[] = [];
    const echoResult = await session.run('echo hello world', {
      onStdout: (text) => echoChunks.push(text),
    });
    expect(echoResult.stdout).toContain('hello world');
    expect(echoChunks.join('')).toContain('hello world');
  });

  it('spawn data events fire before close when running nested commands', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/project/hello.txt', 'world');
    container.vfs.writeFileSync('/spawn-ls.js', `
const { spawn } = require('child_process');
const child = spawn('ls', ['/project']);
let stdout = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.on('close', (code) => {
  console.log('SPAWN_STDOUT:' + stdout.trim());
  process.exit(code || 0);
});
`);

    const session = container.createTerminalSession({ cwd: '/' });
    const result = await session.run('node /spawn-ls.js');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('SPAWN_STDOUT:hello.txt');
  });

  it('dispose aborts running command and rejects subsequent runs', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/hang.js', `
// Keep alive with periodic output so idle detection doesn't kill us
const iv = setInterval(() => process.stdout.write(''), 50);
process.stdin.setRawMode(true);
process.stdin.on('data', () => {});
`);

    const session = container.createTerminalSession({ cwd: '/' });
    const runPromise = session.run('node /hang.js');

    await new Promise((resolve) => setTimeout(resolve, 80));
    session.dispose();

    const result = await runPromise;
    expect(result.exitCode).toBe(130);

    await expect(session.run('echo hello')).rejects.toThrow('disposed');
  });
});
