import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachProcessBridge,
  detachProcessBridge,
  exec,
  runBrowserCommand,
  withProcessBridgeScope,
  type BrowserProcessBridge,
} from '../src/shims/opencode-child-process';

describe('OpenCode browser process bridge', () => {
  afterEach(() => {
    detachProcessBridge();
  });

  it('restores the mounted process bridge after a nested helper scope exits', async () => {
    const mountedBridge: BrowserProcessBridge = {
      exec: vi.fn(async ({ cwd }) => ({
        stdout: `mounted:${cwd ?? 'missing'}\n`,
        stderr: '',
        code: 0,
      })),
    };
    const helperBridge: BrowserProcessBridge = {
      exec: vi.fn(async ({ cwd }) => ({
        stdout: `helper:${cwd ?? 'missing'}\n`,
        stderr: '',
        code: 0,
      })),
    };

    attachProcessBridge(mountedBridge);

    await expect(runBrowserCommand({
      command: 'pwd',
      cwd: '/workspace',
    })).resolves.toMatchObject({ stdout: 'mounted:/workspace\n', code: 0 });

    await expect(withProcessBridgeScope(
      helperBridge,
      () => runBrowserCommand({
        command: 'pwd',
        cwd: '/workspace/helper',
      }),
    )).resolves.toMatchObject({ stdout: 'helper:/workspace/helper\n', code: 0 });

    await expect(runBrowserCommand({
      command: 'pwd',
      cwd: '/workspace',
    })).resolves.toMatchObject({ stdout: 'mounted:/workspace\n', code: 0 });
  });

  it('supports promisified exec with an options object for hook-driven git commands', async () => {
    const mountedBridge: BrowserProcessBridge = {
      exec: vi.fn(async ({ command, args, cwd }) => ({
        stdout: `${command} ${args.join(' ')} @ ${cwd ?? 'missing'}\n`,
        stderr: '',
        code: 0,
      })),
    };

    attachProcessBridge(mountedBridge);

    const execAsync = promisify(
      exec as unknown as (
        command: string,
        options: { cwd?: string },
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => unknown,
    );

    await expect(execAsync('git status --short', { cwd: '/workspace/repo' })).resolves.toMatchObject({
      stdout: 'sh -c git status --short @ /workspace/repo\n',
      stderr: '',
    });
    expect(mountedBridge.exec).toHaveBeenCalledWith(expect.objectContaining({
      command: 'sh',
      args: ['-c', 'git status --short'],
      cwd: '/workspace/repo',
    }));
  });
});
