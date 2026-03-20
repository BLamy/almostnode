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
import { Streamdown } from 'streamdown';
import { JsonEditor } from '@visual-json/react';
import type { VirtualFS } from '../virtual-fs';
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

class MarkdownEditorPane extends SimpleEditorPane {
  private root: Root | null = null;
  private vfsListener: ((path: string) => void) | null = null;

  constructor(
    group: IEditorGroup,
    private readonly vfs: VirtualFS,
    private readonly openFileAsText: (path: string) => void,
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

    // Clear previous content
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    // Toolbar
    const toolbar = createToolbar(() => this.openFileAsText(filePath));
    this.container.appendChild(toolbar);

    // Content area
    const contentDiv = document.createElement('div');
    contentDiv.className = 'almostnode-markdown-pane';
    this.container.appendChild(contentDiv);

    // React rendering
    this.root = createRoot(contentDiv);

    const renderMarkdown = () => {
      let content = '';
      try {
        content = this.vfs.readFileSync(filePath, 'utf8') as string;
      } catch {
        content = '*File not found*';
      }
      this.root?.render(
        createElement(Streamdown, { mode: 'static', lineNumbers: true }, content),
      );
    };

    renderMarkdown();

    // Live update on VFS changes
    this.vfsListener = (changedPath: string) => {
      if (changedPath === filePath) {
        renderMarkdown();
      }
    };
    this.vfs.on('change', this.vfsListener);

    return {
      dispose: () => {
        if (this.vfsListener) {
          this.vfs.removeListener('change', this.vfsListener);
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
    private readonly vfs: VirtualFS,
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
        const raw = this.vfs.readFileSync(filePath, 'utf8') as string;
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
    this.vfs.on('change', this.vfsListener);

    return {
      dispose: () => {
        if (this.vfsListener) {
          this.vfs.removeListener('change', this.vfsListener);
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
  vfs: VirtualFS;
  openFileAsText: (path: string) => void;
}): { factories: RenderedEditorFactories; dispose: () => void } {
  const mdDisposable = registerEditorPane(
    MARKDOWN_EDITOR_TYPE_ID,
    'Markdown Preview',
    class extends MarkdownEditorPane {
      constructor(group: IEditorGroup) {
        super(group, options.vfs, options.openFileAsText);
      }
    },
    [MarkdownEditorInput],
  );

  const jsonDisposable = registerEditorPane(
    JSON_EDITOR_TYPE_ID,
    'JSON Viewer',
    class extends JsonEditorPane {
      constructor(group: IEditorGroup) {
        super(group, options.vfs, options.openFileAsText);
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
