import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { VirtualFS } from 'almostnode';
import { VfsFileSystemProvider } from '../src/features/vfs-file-system-provider';

vi.mock('@codingame/monaco-vscode-api/vscode/vs/base/common/uri', () => ({
  URI: {
    from: (value: unknown) => value,
    file: (path: string) => ({ path, toString: () => path }),
  },
}));
vi.mock('@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle', () => ({
  DisposableStore: class {
    add<T>(value: T): T {
      return value;
    }
  },
  toDisposable: (fn: () => void) => ({ dispose: fn }),
}));
vi.mock('@codingame/monaco-vscode-workbench-service-override', () => ({
  EditorInputCapabilities: {},
  SimpleEditorInput: class {},
  SimpleEditorPane: class {},
  ViewContainerLocation: {},
  registerCustomView() {},
  registerEditorPane() {},
}));
vi.mock('@codingame/monaco-vscode-api/services', () => ({}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {},
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {},
}));

let FilesSidebarSurface: typeof import('../src/webide/workbench-surfaces').FilesSidebarSurface;

beforeAll(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLDetailsElement: dom.window.HTMLDetailsElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    SVGSVGElement: dom.window.SVGSVGElement,
    Node: dom.window.Node,
    confirm: () => true,
  });
  globalThis.window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }) as typeof window.requestAnimationFrame;
  globalThis.window.cancelAnimationFrame = ((handle: number) => {
    clearTimeout(handle);
  }) as typeof window.cancelAnimationFrame;

  ({ FilesSidebarSurface } = await import('../src/webide/workbench-surfaces'));
});

async function waitForUiFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitForNodeModulesFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe('Web IDE change coalescing', () => {
  it('coalesces repeated file-tree refreshes into one render per frame', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });

    const surface = new FilesSidebarSurface(vfs, '/project', () => {});
    const renderSpy = vi.spyOn(surface as any, 'render');

    vfs.writeFileSync('/project/a.ts', 'export const a = 1;');
    vfs.writeFileSync('/project/b.ts', 'export const b = 2;');
    vfs.writeFileSync('/project/c.ts', 'export const c = 3;');

    expect(renderSpy).not.toHaveBeenCalled();
    await waitForUiFlush();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces VFS provider events into a single emission batch', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });

    const provider = new VfsFileSystemProvider(vfs, '/project');
    const batches: string[][] = [];
    const disposable = provider.onDidChangeFile((changes) => {
      batches.push(changes.map((change) => change.resource.path).sort());
    });

    vfs.writeFileSync('/project/a.ts', 'export const a = 1;');
    vfs.writeFileSync('/project/b.ts', 'export const b = 2;');
    vfs.writeFileSync('/project/a.ts', 'export const a = 3;');

    await waitForUiFlush();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(['/project/a.ts', '/project/b.ts']);
    disposable.dispose();
  });

  it('debounces node_modules tree refreshes until the install burst settles', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });

    const surface = new FilesSidebarSurface(vfs, '/project', () => {});
    const renderSpy = vi.spyOn(surface as any, 'render');

    vfs.writeFileSync('/project/node_modules/pkg-a/index.js', 'export const a = 1;');
    await new Promise((resolve) => setTimeout(resolve, 10));
    vfs.writeFileSync('/project/node_modules/pkg-b/index.js', 'export const b = 2;');
    await new Promise((resolve) => setTimeout(resolve, 10));
    vfs.writeFileSync('/project/node_modules/pkg-c/index.js', 'export const c = 3;');

    await waitForUiFlush();
    expect(renderSpy).not.toHaveBeenCalled();

    await waitForNodeModulesFlush();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses node_modules provider events into one directory-level update', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });

    const provider = new VfsFileSystemProvider(vfs, '/project');
    const batches: string[][] = [];
    const disposable = provider.onDidChangeFile((changes) => {
      batches.push(changes.map((change) => change.resource.path).sort());
    });

    vfs.writeFileSync('/project/node_modules/pkg-a/index.js', 'export const a = 1;');
    await new Promise((resolve) => setTimeout(resolve, 10));
    vfs.writeFileSync('/project/node_modules/pkg-b/index.js', 'export const b = 2;');
    await new Promise((resolve) => setTimeout(resolve, 10));
    vfs.writeFileSync('/project/node_modules/pkg-a/package.json', '{"name":"pkg-a"}');

    await waitForUiFlush();
    expect(batches).toHaveLength(0);

    await waitForNodeModulesFlush();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(['/project/node_modules']);
    disposable.dispose();
  });
});
