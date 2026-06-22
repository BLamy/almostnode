import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import {
  SimpleEditorInput,
  SimpleEditorPane,
  registerEditorPane,
} from '@codingame/monaco-vscode-workbench-service-override';
import type { IEditorGroup } from '@codingame/monaco-vscode-api/services';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { JsonEditor } from '@visual-json/react';
import type { VirtualFS } from '@agent-wasm/core';
import { GitbookEditor, GitbookStreamdown } from './docstream';
import './gitbook-editor/gitbook-editor.css';
import './rendered-editors.css';

const MARKDOWN_EDITOR_TYPE_ID = 'almostnode.editor.markdown';
const JSON_EDITOR_TYPE_ID = 'almostnode.editor.json';

function createToolbar(onEditAsText: () => void): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'almostnode-rendered-toolbar';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'almostnode-rendered-toolbar__button';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>' +
    '<span>Edit as Text</span>';
  btn.addEventListener('click', onEditAsText);

  toolbar.appendChild(btn);
  return toolbar;
}

// --- Markdown ---

export class MarkdownEditorInput extends SimpleEditorInput {
  readonly typeId = MARKDOWN_EDITOR_TYPE_ID;
  readonly filePath: string;

  constructor(filePath: string) {
    super(
      URI.from({ scheme: 'almostnode-markdown', path: filePath }),
    );
    const name = filePath.split('/').pop() || filePath;
    this.filePath = filePath;
    this.setName(name);
    this.setTitle({ short: name, medium: name, long: `Markdown: ${filePath}` });
    this.setDescription('Rendered markdown preview');
  }
}

const MARKDOWN_SAVE_DEBOUNCE_MS = 400;

class MarkdownEditorPane extends SimpleEditorPane {
  private root: Root | null = null;
  private vfsListener: ((path: string) => void) | null = null;

  constructor(
    group: IEditorGroup,
    private readonly getVfs: () => VirtualFS,
    private readonly openFileAsText: (path: string) => void,
    private readonly isReadOnly: () => boolean,
  ) {
    super(MARKDOWN_EDITOR_TYPE_ID, group);
  }

  initialize(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
    return el;
  }

  async renderInput(): Promise<IDisposable> {
    const input = this.input as MarkdownEditorInput;
    const filePath = input.filePath;
    // Resolve the VFS at render time — the active session (and its VFS)
    // can change between renders.
    const vfs = this.getVfs();
    const editable = !this.isReadOnly();

    // Clear previous content
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // Toolbar
    const toolbar = createToolbar(() => this.openFileAsText(filePath));
    this.container.appendChild(toolbar);

    // Content area
    const contentDiv = document.createElement('div');
    contentDiv.className = 'almostnode-markdown-pane gb-editor-host';
    contentDiv.style.flex = '1';
    contentDiv.style.minHeight = '0';
    this.container.appendChild(contentDiv);

    // React rendering
    this.root = createRoot(contentDiv);

    // Write-through save loop: edits debounce-save to the VFS; the VFS change
    // event from our own write is suppressed by comparing against the last
    // content we wrote (the editor additionally ignores echoed props itself).
    let lastWritten: string | null = null;
    let pendingMarkdown: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const flushSave = () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (pendingMarkdown === null) return;
      const md = pendingMarkdown;
      pendingMarkdown = null;
      lastWritten = md;
      try {
        vfs.writeFileSync(filePath, md);
      } catch (err) {
        console.error(`[rendered-editors] Failed to save ${filePath}:`, err);
      }
    };

    const handleChange = (md: string) => {
      pendingMarkdown = md;
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, MARKDOWN_SAVE_DEBOUNCE_MS);
    };

    const readContent = (): string => {
      try {
        return vfs.readFileSync(filePath, 'utf8') as string;
      } catch {
        return '';
      }
    };

    const renderEditor = (markdown: string) => {
      this.root?.render(
        editable
          ? createElement(GitbookEditor, {
              markdown,
              onChange: handleChange,
            })
          : createElement(GitbookStreamdown, {
              className: 'almostnode-markdown-preview',
              markdown,
            }),
      );
    };

    renderEditor(readContent());

    // External VFS changes re-render; our own debounced writes are skipped.
    this.vfsListener = (changedPath: string) => {
      if (changedPath !== filePath) return;
      const content = readContent();
      if (content === lastWritten || content === pendingMarkdown) return;
      renderEditor(content);
    };
    vfs.on('change', this.vfsListener);

    return {
      dispose: () => {
        flushSave();
        if (this.vfsListener) {
          vfs.off('change', this.vfsListener);
          this.vfsListener = null;
        }
        this.root?.unmount();
        this.root = null;
      },
    };
  }
}

// --- JSON ---

export class JsonEditorInput extends SimpleEditorInput {
  readonly typeId = JSON_EDITOR_TYPE_ID;
  readonly filePath: string;

  constructor(filePath: string) {
    super(
      URI.from({ scheme: 'almostnode-json', path: filePath }),
    );
    const name = filePath.split('/').pop() || filePath;
    this.filePath = filePath;
    this.setName(name);
    this.setTitle({ short: name, medium: name, long: `JSON: ${filePath}` });
    this.setDescription('Visual JSON viewer');
  }
}

class JsonEditorPane extends SimpleEditorPane {
  private root: Root | null = null;
  private vfsListener: ((path: string) => void) | null = null;

  constructor(
    group: IEditorGroup,
    private readonly getVfs: () => VirtualFS,
    private readonly openFileAsText: (path: string) => void,
  ) {
    super(JSON_EDITOR_TYPE_ID, group);
  }

  initialize(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
    return el;
  }

  async renderInput(): Promise<IDisposable> {
    const input = this.input as JsonEditorInput;
    const filePath = input.filePath;
    // Resolve the VFS at render time — the active session (and its VFS)
    // can change between renders.
    const vfs = this.getVfs();

    // Clear previous content
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // Toolbar
    const toolbar = createToolbar(() => this.openFileAsText(filePath));
    this.container.appendChild(toolbar);

    // Content area
    const contentDiv = document.createElement('div');
    contentDiv.className = 'almostnode-json-pane';
    contentDiv.style.flex = '1';
    this.container.appendChild(contentDiv);

    // React rendering
    this.root = createRoot(contentDiv);

    const renderJson = () => {
      let value: unknown = null;
      let parseError = '';
      try {
        const raw = vfs.readFileSync(filePath, 'utf8') as string;
        value = JSON.parse(raw);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }

      if (parseError) {
        this.root?.render(
          createElement('div', {
            style: { padding: '16px', color: 'var(--vscode-errorForeground, #f48771)' },
          }, `Invalid JSON: ${parseError}`),
        );
      } else {
        this.root?.render(
          createElement(JsonEditor, {
            value: value as import('@visual-json/core').JsonValue,
            readOnly: true,
            height: '100%',
            width: '100%',
          }),
        );
      }
    };

    renderJson();

    // Live update on VFS changes
    this.vfsListener = (changedPath: string) => {
      if (changedPath === filePath) {
        renderJson();
      }
    };
    vfs.on('change', this.vfsListener);

    return {
      dispose: () => {
        if (this.vfsListener) {
          vfs.off('change', this.vfsListener);
          this.vfsListener = null;
        }
        this.root?.unmount();
        this.root = null;
      },
    };
  }
}

// --- Registration ---

export interface RenderedEditorFactories {
  createMarkdownInput(filePath: string): MarkdownEditorInput;
  createJsonInput(filePath: string): JsonEditorInput;
}

export function registerRenderedEditors(options: {
  getVfs: () => VirtualFS;
  openFileAsText: (path: string) => void;
  /** Active session is a read-only repo base — mount the editor non-editable. */
  isReadOnly?: () => boolean;
}): { factories: RenderedEditorFactories; dispose: () => void } {
  const isReadOnly = options.isReadOnly ?? (() => false);
  const mdDisposable = registerEditorPane(
    MARKDOWN_EDITOR_TYPE_ID,
    'Markdown Editor',
    class extends MarkdownEditorPane {
      constructor(group: IEditorGroup) {
        super(group, options.getVfs, options.openFileAsText, isReadOnly);
      }
    },
    [MarkdownEditorInput],
  );

  const jsonDisposable = registerEditorPane(
    JSON_EDITOR_TYPE_ID,
    'JSON Viewer',
    class extends JsonEditorPane {
      constructor(group: IEditorGroup) {
        super(group, options.getVfs, options.openFileAsText);
      }
    },
    [JsonEditorInput],
  );

  return {
    factories: {
      createMarkdownInput: (filePath: string) => new MarkdownEditorInput(filePath),
      createJsonInput: (filePath: string) => new JsonEditorInput(filePath),
    },
    dispose: () => {
      mdDisposable.dispose();
      jsonDisposable.dispose();
    },
  };
}
