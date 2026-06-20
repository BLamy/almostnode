/**
 * Regression tests for the fs-shim surface Go WASM binaries rely on
 * (wasm_exec.js drives all I/O through globalThis.fs). tsgo-wasm hung or
 * reported "no inputs found" because of gaps here:
 *  - fs.writeSync(1|2) threw EBADF, wedging the Go scheduler
 *  - stat/lstat/fstat callbacks were never invoked on error, parking goroutines
 *  - fs.constants lacked O_DIRECTORY and openSync refused directories,
 *    so directory walks silently returned empty
 *  - VFS stat modes lacked S_IFREG/S_IFDIR type bits
 */

import { describe, expect, it } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { createFsShim } from '../src/shims/fs';

function setup() {
  const vfs = new VirtualFS();
  vfs.mkdirSync('/project/src', { recursive: true });
  vfs.writeFileSync('/project/src/main.ts', 'const x = 1;\n');
  const stdout: string[] = [];
  const stderr: string[] = [];
  const decoder = new TextDecoder();
  const shim = createFsShim(vfs, () => '/project', {
    writeStdout: (data) => stdout.push(decoder.decode(data)),
    writeStderr: (data) => stderr.push(decoder.decode(data)),
  });
  return { vfs, shim, stdout, stderr };
}

describe('fs shim Go WASM compatibility', () => {
  it('routes writeSync on fds 1/2 to the runtime stdio', () => {
    const { shim, stdout, stderr } = setup();
    const bytes = new TextEncoder().encode('hello\n');
    expect(shim.writeSync(1, bytes, 0, bytes.length, null)).toBe(bytes.length);
    expect(shim.writeSync(2, 'oops\n')).toBe(5);
    expect(stdout.join('')).toBe('hello\n');
    expect(stderr.join('')).toBe('oops\n');
  });

  it('treats std fds as char devices for fstat and EOF for read', () => {
    const { shim } = setup();
    expect(shim.fstatSync(1).isCharacterDevice()).toBe(true);
    const buf = new Uint8Array(8);
    expect(shim.readSync(0, buf, 0, 8, null)).toBe(0);
  });

  it('invokes stat/lstat/fstat callbacks with the error on failure', async () => {
    const { shim } = setup();
    const results = await Promise.all([
      new Promise<Error | null>((resolve) => shim.stat('/missing', (err) => resolve(err))),
      new Promise<Error | null>((resolve) => shim.lstat('/missing', (err) => resolve(err))),
      new Promise<Error | null>((resolve) => shim.fstat(99, (err) => resolve(err))),
    ]);
    for (const err of results) {
      expect(err).toBeInstanceOf(Error);
    }
    expect((results[0] as Error & { code?: string }).code).toBe('ENOENT');
    expect((results[2] as Error & { code?: string }).code).toBe('EBADF');
  });

  it('exposes O_DIRECTORY and opens directories read-only', () => {
    const { shim } = setup();
    expect(shim.constants.O_DIRECTORY).toBeGreaterThan(0);
    const fd = shim.openSync('/project/src', shim.constants.O_RDONLY | shim.constants.O_DIRECTORY);
    expect(shim.fstatSync(fd).isDirectory()).toBe(true);
    shim.closeSync(fd);
  });

  it('rejects O_DIRECTORY opens of regular files with ENOTDIR', () => {
    const { shim } = setup();
    expect(() =>
      shim.openSync('/project/src/main.ts', shim.constants.O_DIRECTORY),
    ).toThrowError(/ENOTDIR/);
  });

  it('reports node-style type bits in stat modes', () => {
    const { vfs } = setup();
    expect(vfs.statSync('/project/src/main.ts').mode & 0o170000).toBe(0o100000);
    expect(vfs.statSync('/project/src').mode & 0o170000).toBe(0o40000);
  });

  it('supports callback-style open/read/write/close on regular files', async () => {
    const { shim } = setup();
    const fd = await new Promise<number>((resolve, reject) =>
      shim.open('/project/src/main.ts', 0, 0, (err, fd) => (err ? reject(err) : resolve(fd!))),
    );
    const buf = new Uint8Array(12);
    const bytesRead = await new Promise<number>((resolve, reject) =>
      shim.read(fd, buf, 0, 12, null, (err, n) => (err ? reject(err) : resolve(n!))),
    );
    expect(bytesRead).toBe(12);
    expect(new TextDecoder().decode(buf)).toBe('const x = 1;');
    await new Promise<void>((resolve, reject) =>
      shim.close(fd, (err) => (err ? reject(err) : resolve())),
    );
  });
});
