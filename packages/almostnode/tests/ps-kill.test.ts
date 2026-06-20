// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/index';

describe('ps and kill shell commands', () => {
  it('kill terminates an interactive node execution by its ps pid', async () => {
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
    expect(session.getState().running).toBe(true);

    const psSession = container.createTerminalSession({ cwd: '/' });
    const ps = await psSession.run('ps');
    expect(ps.exitCode).toBe(0);
    const match = ps.stdout.match(/^\s*(\d+) \?\s+S\+\s+node \[interactive\]/m);
    expect(match).not.toBeNull();
    const pid = match![1];

    const kill = await psSession.run(`kill ${pid}`);
    expect(kill.exitCode).toBe(0);
    expect(kill.stderr).toBe('');

    const result = await runPromise;
    expect(result.stdout).toContain('ready');

    const psAfter = await psSession.run('ps');
    expect(psAfter.stdout).not.toContain('node [interactive]');
  });

  it('kill accepts signal flags and keeps pids stable across ps runs', async () => {
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

    const psSession = container.createTerminalSession({ cwd: '/' });
    const first = await psSession.run('ps');
    const second = await psSession.run('ps');
    const pidOf = (out: string) =>
      out.match(/^\s*(\d+) \?\s+S\+\s+node \[interactive\]/m)?.[1];
    const pid = pidOf(first.stdout);
    expect(pid).toBeDefined();
    expect(pidOf(second.stdout)).toBe(pid);

    const kill = await psSession.run(`kill -9 ${pid}`);
    expect(kill.exitCode).toBe(0);
    await runPromise;
  });

  it('kill reports missing processes and refuses pid 1', async () => {
    const container = createContainer();
    const session = container.createTerminalSession({ cwd: '/' });

    const missing = await session.run('kill 31337');
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('No such process');

    const initPid = await session.run('kill 1');
    expect(initPid.exitCode).toBe(1);
    expect(initPid.stderr).toContain('Operation not permitted');

    const usage = await session.run('kill');
    expect(usage.exitCode).toBe(1);
    expect(usage.stderr).toContain('usage');
  });
});
