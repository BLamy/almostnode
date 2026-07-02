import { describe, it, expect } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { resolveMainEntry } from '../src/frameworks/electron-app';

// `electron <dir>` runs the main entry directly through the runtime. Many real
// apps set `pkg.main` to a build output that only exists after a separate
// build (electron-vite, vite-plugin-electron). resolveMainEntry maps those back
// to the conventional source entry so the app runs from a fresh clone.
describe('resolveMainEntry', () => {
  it('uses pkg.main verbatim when it exists', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/main.js', '// entry');
    expect(resolveMainEntry(vfs, '/app', { main: 'main.js' })).toBe('/app/main.js');
  });

  it('defaults to main.js when pkg.main is absent', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/main.js', '// entry');
    expect(resolveMainEntry(vfs, '/app', {})).toBe('/app/main.js');
  });

  it('falls back to electron-vite source when pkg.main points at an unbuilt out/', () => {
    const vfs = new VirtualFS();
    // electron-vite shape: main declared as build output, only source present.
    vfs.writeFileSync('/app/src/main/index.ts', '// main source');
    expect(
      resolveMainEntry(vfs, '/app', { main: './out/main/index.js' }),
    ).toBe('/app/src/main/index.ts');
  });

  it('falls back to vite-plugin-electron source under electron/', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/electron/main/index.ts', '// main source');
    expect(
      resolveMainEntry(vfs, '/app', { main: 'dist-electron/main/index.js' }),
    ).toBe('/app/electron/main/index.ts');
  });

  it('prefers the built output over source when both exist', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/out/main/index.js', '// built');
    vfs.writeFileSync('/app/src/main/index.ts', '// source');
    expect(
      resolveMainEntry(vfs, '/app', { main: './out/main/index.js' }),
    ).toBe('/app/out/main/index.js');
  });

  it('returns null when nothing runnable is found', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/package.json', '{}');
    expect(resolveMainEntry(vfs, '/app', { main: './out/main/index.js' })).toBeNull();
  });
});
