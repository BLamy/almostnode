import { afterEach, describe, expect, it, vi } from 'vitest';
import processShim, { configureBrowserProcess } from '../src/shims/node-process';

describe('browser process shim', () => {
  const originalProcess = globalThis.process;

  afterEach(() => {
    globalThis.process = originalProcess;
    delete (globalThis as typeof globalThis & {
      __almostnodeActiveProcess?: unknown;
    }).__almostnodeActiveProcess;
  });

  it('updates cwd, PWD, and chdir state for in-browser agent sessions', () => {
    configureBrowserProcess({
      cwd: '/workspace',
      env: {
        TEST_PROCESS_FLAG: 'enabled',
      },
    });

    expect(processShim.cwd()).toBe('/workspace');
    expect(processShim.env.PWD).toBe('/workspace');
    expect(processShim.env.TEST_PROCESS_FLAG).toBe('enabled');

    processShim.chdir('nested');
    expect(processShim.cwd()).toBe('/workspace/nested');
    expect(processShim.env.PWD).toBe('/workspace/nested');

    processShim.chdir('../again');
    expect(processShim.cwd()).toBe('/workspace/again');
    expect(processShim.env.PWD).toBe('/workspace/again');
  });

  it('exposes the stdin helpers interactive CLIs expect', () => {
    configureBrowserProcess({
      cwd: '/workspace',
    });

    expect(typeof processShim.stdin.setEncoding).toBe('function');
    expect(typeof processShim.stdin.pause).toBe('function');
    expect(typeof processShim.stdin.resume).toBe('function');
    expect(typeof processShim.stdin.read).toBe('function');
    expect(typeof processShim.stdin.setRawMode).toBe('function');
    expect(typeof processShim.stdin.ref).toBe('function');
    expect(typeof processShim.stdin.unref).toBe('function');
    expect(processShim.stdin.readable).toBe(true);
    expect(processShim.stdin.writable).toBe(false);
  });

  it('defaults to a Node-like linux/x64 identity instead of browser/wasm32', () => {
    configureBrowserProcess({
      cwd: '/workspace',
    });

    expect(processShim.platform).toBe('linux');
    expect(processShim.arch).toBe('x64');
    expect(processShim.argv0).toBe('node');
    expect(processShim.execPath).toBe('/usr/local/bin/node');
    expect(processShim.browser).toBe(false);
  });

  it('exposes a TTY-like shell environment for interactive CLIs', () => {
    configureBrowserProcess({
      cwd: '/workspace',
    });

    expect(processShim.env.HOME).toBe('/home/user');
    expect(processShim.env.USER).toBe('user');
    expect(processShim.env.SHELL).toBe('/bin/bash');
    expect(processShim.env.TERM).toBe('xterm-256color');
    expect(processShim.env.COLORTERM).toBe('truecolor');
    expect(processShim.env.FORCE_COLOR).toBe('3');
    expect(processShim.stdout.isTTY).toBe(true);
    expect(processShim.stderr.isTTY).toBe(true);
    expect(processShim.stdin.isTTY).toBe(true);
  });

  it('treats fallback process.exit like a normal CLI exit sentinel', () => {
    configureBrowserProcess({
      cwd: '/workspace',
    });
    globalThis.process = processShim as typeof globalThis.process;

    expect(() => processShim.exit(1)).toThrow('Process exited with code 1');
  });

  it('forwards imported process access to the active almostnode-managed process', () => {
    const setEncoding = vi.fn(() => runtimeProcess.stdin);
    const runtimeProcess = {
      __almostnodeProcessShim: true,
      env: {
        RUNTIME_ONLY: '1',
      },
      platform: 'linux',
      arch: 'x64',
      cwd: () => '/runtime',
      stdin: {
        isTTY: true,
        readable: true,
        writable: false,
        destroyed: false,
        setEncoding,
      },
    };

    globalThis.process = runtimeProcess as typeof globalThis.process;

    expect(processShim.cwd()).toBe('/runtime');
    expect(processShim.env.RUNTIME_ONLY).toBe('1');
    expect(processShim.platform).toBe('linux');
    expect(processShim.arch).toBe('x64');
    expect(processShim.stdin.isTTY).toBe(true);
    processShim.stdin.setEncoding('utf8');
    expect(setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('prefers the active almostnode process slot even when the global process is the browser proxy', () => {
    configureBrowserProcess({
      cwd: '/workspace',
    });

    const activeProcess = {
      __almostnodeProcessShim: true,
      env: {
        ACTIVE_ONLY: '1',
      },
      platform: 'linux',
      arch: 'x64',
      cwd: () => '/active',
      stdin: {
        isTTY: true,
        readable: true,
        writable: false,
        destroyed: false,
        setEncoding: vi.fn(),
      },
    };

    (globalThis as typeof globalThis & {
      __almostnodeActiveProcess?: typeof activeProcess;
    }).__almostnodeActiveProcess = activeProcess;

    expect(processShim.cwd()).toBe('/active');
    expect(processShim.env.ACTIVE_ONLY).toBe('1');
    expect(processShim.stdin.isTTY).toBe(true);
  });
});
