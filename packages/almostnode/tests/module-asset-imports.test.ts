import { describe, it, expect, vi } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { ModuleGraphLoader } from '../src/module-graph-loader';

// Minimal handle over the (partly private) loader for assertions.
interface LoaderHandle {
  resolve: (specifier: string, fromPath: string) => { format: string; resolvedPath: string; id: string };
  buildModuleSource: (descriptor: unknown) => Promise<string>;
  resolveDescriptorById: (id: string) => unknown;
}

// vite/webpack asset imports (`?asset`/`?url`/`?raw` + bare asset files) resolve
// to synthetic modules so first-party source (e.g. an electron-vite main that
// does `import icon from '../resources/icon.png?asset'`) runs through the
// runtime instead of failing to resolve a missing file.

function makeLoader(vfs: VirtualFS) {
  return new ModuleGraphLoader({
    vfs,
    runtimeId: 'asset-test',
    builtinModules: {},
    console: { log: vi.fn() } as unknown as Record<string, unknown>,
    process: { cwd: () => '/app' } as unknown as Record<string, unknown>,
    globalObject: {
      console: { log: vi.fn() },
      process: { cwd: () => '/app' },
      Buffer,
    } as unknown as Record<string, unknown>,
    requireCjs: () => ({}),
    createRequire: () => {
      const requireFn = (() => ({})) as ((id: string) => unknown) & {
        resolve?: (id: string) => string;
      };
      requireFn.resolve = (id: string) => id;
      return requireFn;
    },
  }) as unknown as LoaderHandle;
}

describe('asset imports through the module graph', () => {
  it('resolves `?asset` to an asset module exporting the file path', async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/resources/icon.png', 'PNGDATA');
    const loader = makeLoader(vfs);

    // Mirrors the electron-vite template: `import icon from '../../resources/icon.png?asset'`
    const descriptor = loader.resolve('../../resources/icon.png?asset', '/app/src/main/index.ts');
    expect(descriptor.format).toBe('asset');
    expect(descriptor.resolvedPath).toBe('/app/resources/icon.png');
    expect(descriptor.id).toBe('/app/resources/icon.png?asset');

    const source = await loader.buildModuleSource(descriptor);
    expect(source).toBe('export default "/app/resources/icon.png";\n');
  });

  it('treats `?url` and `?inline` the same as `?asset`', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/a.svg', '<svg/>');
    const loader = makeLoader(vfs);

    expect(loader.resolve('./a.svg?url', '/app/x.ts').format).toBe('asset');
    expect(loader.resolve('./a.svg?inline', '/app/x.ts').format).toBe('asset');
  });

  it('resolves `?raw` to a module exporting the file text', async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/shader.glsl', 'void main() {}');
    const loader = makeLoader(vfs);

    const descriptor = loader.resolve('./shader.glsl?raw', '/app/x.ts');
    expect(descriptor.format).toBe('raw');
    expect(descriptor.id).toBe('/app/shader.glsl?raw');

    const source = await loader.buildModuleSource(descriptor);
    expect(source).toBe('export default "void main() {}";\n');
  });

  it('treats a bare import of an asset-extension file as an asset', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/logo.svg', '<svg/>');
    const loader = makeLoader(vfs);

    const descriptor = loader.resolve('./logo.svg', '/app/App.tsx');
    expect(descriptor.format).toBe('asset');
    expect(descriptor.resolvedPath).toBe('/app/logo.svg');
  });

  it('does not claim unrelated queries (e.g. ?worker) as asset imports', () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/app/w.js', 'export default 1;');
    const loader = makeLoader(vfs);
    // `?worker` isn't an asset kind, so it's left to normal resolution (which
    // doesn't strip queries) — asserting the boundary, not adopting the case.
    expect(() => loader.resolve('./w.js?worker', '/app/x.ts')).toThrow();
  });

  it('round-trips asset ids through resolveDescriptorById (SW transport)', () => {
    const vfs = new VirtualFS();
    const loader = makeLoader(vfs);

    const asset = loader.resolveDescriptorById('/app/resources/icon.png?asset') as {
      format: string;
      resolvedPath: string;
    };
    expect(asset.format).toBe('asset');
    expect(asset.resolvedPath).toBe('/app/resources/icon.png');

    const raw = loader.resolveDescriptorById('/app/shader.glsl?raw') as {
      format: string;
      resolvedPath: string;
    };
    expect(raw.format).toBe('raw');
    expect(raw.resolvedPath).toBe('/app/shader.glsl');
  });
});
