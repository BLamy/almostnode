import { describe, expect, it, vi } from 'vitest';
import { ModuleGraphLoader } from '../src/module-graph-loader';
import { VirtualFS } from '../src/virtual-fs';

describe('ModuleGraphLoader', () => {
  it('does not deadlock service-worker module URLs on cyclic ESM graphs', async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/a.js', 'import "./b.js"; export const a = 1;\n');
    vfs.writeFileSync('/b.js', 'import "./a.js"; export const b = 1;\n');

    vi.stubGlobal('location', { origin: 'http://example.test' } as Location);

    try {
      const loader = new ModuleGraphLoader({
        vfs,
        runtimeId: 'test-runtime',
        builtinModules: {},
        console: console as unknown as Record<string, unknown>,
        process: {} as Record<string, unknown>,
        globalObject: { console, process: {}, Buffer } as unknown as Record<string, unknown>,
        requireCjs: () => ({}),
        createRequire: () => {
          const requireFn = (() => ({})) as ((id: string) => unknown) & { resolve?: (id: string) => string };
          requireFn.resolve = (id: string) => id;
          return requireFn;
        },
      }) as ModuleGraphLoader & {
        transportMode: 'service-worker';
        ensureBridgeReady: () => Promise<void>;
        getModuleUrl: (descriptor: unknown) => Promise<string>;
      };

      loader.transportMode = 'service-worker';
      loader.ensureBridgeReady = vi.fn().mockResolvedValue(undefined);

      const descriptor = loader.resolve('/a.js', '/a.js');
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for cyclic module URL')), 1000);
      });

      const url = await Promise.race([
        loader.getModuleUrl(descriptor),
        timeoutPromise,
      ]);

      expect(url).toContain('/__modules__/r/');
      expect(url).toContain(encodeURIComponent('test-runtime'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('prepends runtime globals to generated ESM source without mutating the host scope', async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync(
      '/entry.mjs',
      'export default [console === globalThis.console, process === globalThis.process, process === global.process];\n',
    );

    const hostConsole = globalThis.console;
    const hostProcess = globalThis.process as unknown;
    const loader = new ModuleGraphLoader({
      vfs,
      runtimeId: 'test-runtime',
      builtinModules: {},
      console: { log: vi.fn() } as unknown as Record<string, unknown>,
      process: { cwd: () => '/runtime' } as unknown as Record<string, unknown>,
      globalObject: {
        console: { log: vi.fn() },
        process: { cwd: () => '/runtime' },
        Buffer,
      } as unknown as Record<string, unknown>,
      requireCjs: () => ({}),
      createRequire: () => {
        const requireFn = (() => ({})) as ((id: string) => unknown) & { resolve?: (id: string) => string };
        requireFn.resolve = (id: string) => id;
        return requireFn;
      },
    }) as ModuleGraphLoader & {
      buildModuleSource: (descriptor: unknown) => Promise<string>;
    };

    const descriptor = loader.resolve('/entry.mjs', '/entry.mjs');
    const source = await loader.buildModuleSource(descriptor);

    expect(source).toContain('const __almostnode_hostGlobal = globalThis;');
    expect(source).toContain('const globalThis = __almostnode_global;');
    expect(source).toContain('const global = __almostnode_global;');
    expect(source).toContain('const console = __almostnode_global.console;');
    expect(source).toContain('const process = __almostnode_global.process;');
    expect(globalThis.console).toBe(hostConsole);
    expect(globalThis.process as unknown).toBe(hostProcess);
  });
});
