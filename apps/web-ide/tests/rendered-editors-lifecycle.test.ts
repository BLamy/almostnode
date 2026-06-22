import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { VirtualFS } from '@agent-wasm/core';

type EditorPaneCtor = new (group: unknown) => {
  container: HTMLElement;
  input: unknown;
  renderInput(): Promise<{ dispose(): void }>;
};

const registeredPanes = new Map<string, EditorPaneCtor>();

vi.mock('@codingame/monaco-vscode-api/vscode/vs/base/common/uri', () => ({
  URI: {
    from: (value: unknown) => value,
  },
}));

vi.mock('@codingame/monaco-vscode-workbench-service-override', () => ({
  SimpleEditorInput: class {
    resource: unknown;

    constructor(resource?: unknown) {
      this.resource = resource;
    }

    setName() {}
    setTitle() {}
    setDescription() {}
  },
  SimpleEditorPane: class {
    container = document.createElement('div');
    input: unknown;

    constructor() {}
  },
  registerEditorPane(typeId: string, _name: string, ctor: EditorPaneCtor) {
    registeredPanes.set(typeId, ctor);
    return { dispose() {} };
  },
}));

vi.mock('@visual-json/react', () => ({
  JsonEditor: () => null,
}));

vi.mock('@brett_lamy/docstream', () => ({
  GitbookStreamdown: () => null,
}));

vi.mock('@brett_lamy/docstream-editor', () => ({
  GitbookEditor: () => null,
}));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render() {},
    unmount() {},
  }),
}));

let renderedEditors: typeof import('../src/features/rendered-editors');

beforeAll(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
  });

  renderedEditors = await import('../src/features/rendered-editors');
});

async function renderRegisteredPane(typeId: string, input: unknown) {
  const Pane = registeredPanes.get(typeId);
  if (!Pane) {
    throw new Error(`Expected ${typeId} to be registered.`);
  }

  const pane = new Pane({});
  pane.input = input;
  const disposable = await pane.renderInput();
  return { pane, disposable };
}

describe('rendered editor lifecycle', () => {
  it('disposes Markdown and JSON VFS change listeners through VirtualFS.off', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });
    vfs.writeFileSync('/project/README.md', '# Hello\n');
    vfs.writeFileSync('/project/data.json', '{"ok":true}\n');
    const offSpy = vi.spyOn(vfs, 'off');

    const registered = renderedEditors.registerRenderedEditors({
      getVfs: () => vfs,
      openFileAsText: () => {},
    });

    const markdown = await renderRegisteredPane(
      'almostnode.editor.markdown',
      registered.factories.createMarkdownInput('/project/README.md'),
    );
    const json = await renderRegisteredPane(
      'almostnode.editor.json',
      registered.factories.createJsonInput('/project/data.json'),
    );

    markdown.disposable.dispose();
    json.disposable.dispose();

    expect(offSpy).toHaveBeenCalledWith('change', expect.any(Function));
    expect(offSpy).toHaveBeenCalledTimes(2);
    registered.dispose();
  });

  it('makes the Markdown editor body fill and shrink inside the workbench pane', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });
    vfs.writeFileSync('/project/README.md', '# Hello\n');

    const registered = renderedEditors.registerRenderedEditors({
      getVfs: () => vfs,
      openFileAsText: () => {},
    });

    const { pane, disposable } = await renderRegisteredPane(
      'almostnode.editor.markdown',
      registered.factories.createMarkdownInput('/project/README.md'),
    );

    const body = pane.container.querySelector('.almostnode-markdown-pane') as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body?.style.flex).not.toBe('');
    expect(body?.style.minHeight).toBe('0');

    disposable.dispose();
    registered.dispose();
  });
});
