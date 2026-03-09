import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { DisposableStore, type IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import {
  EditorInputCapabilities,
  SimpleEditorInput,
  SimpleEditorPane,
  ViewContainerLocation,
  registerCustomView,
  registerEditorPane,
} from '@codingame/monaco-vscode-workbench-service-override';
import type { IEditorGroup } from '@codingame/monaco-vscode-api/services';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { VirtualFS } from '../virtual-fs';

const PREVIEW_EDITOR_TYPE_ID = 'almostnode.editor.preview';
const PREVIEW_EDITOR_RESOURCE = URI.from({
  scheme: 'almostnode-preview',
  path: '/workspace',
});
const FILES_VIEW_ID = 'almostnode.sidebar.files';
const TERMINAL_VIEW_ID = 'almostnode.panel.terminal';

interface PreviewSurfaceCommands {
  run(): void;
  refresh(): void;
}

export interface RegisteredWorkbenchSurfaces {
  previewInput: SimpleEditorInput;
  filesViewId: string;
  terminalViewId: string;
  dispose(): void;
}

export class FilesSidebarSurface {
  private readonly root = document.createElement('div');
  private readonly refresh = () => this.render();

  constructor(
    private readonly vfs: VirtualFS,
    private readonly workspaceRoot: string,
    private readonly openFile: (path: string) => void,
  ) {
    this.root.id = 'webideFilesTree';
    this.root.className = 'almostnode-files-tree';

    this.vfs.on('change', this.refresh);
    this.vfs.on('delete', this.refresh);
    this.render();
  }

  attach(container: HTMLElement): IDisposable {
    container.classList.add('almostnode-files-tree-host');
    container.appendChild(this.root);
    return {
      dispose: () => {
        if (this.root.parentElement === container) {
          container.removeChild(this.root);
        }
      },
    };
  }

  private render(): void {
    try {
      this.root.replaceChildren(this.renderDirectory(this.workspaceRoot, 0));
    } catch {
      const empty = document.createElement('div');
      empty.className = 'almostnode-files-tree__empty';
      empty.textContent = 'Waiting for the workspace tree...';
      this.root.replaceChildren(empty);
    }
  }

  private renderDirectory(path: string, depth: number): HTMLElement {
    const details = document.createElement('details');
    details.className = 'almostnode-files-tree__directory';
    details.open = depth < 2;

    const summary = document.createElement('summary');
    summary.className = 'almostnode-files-tree__summary';
    summary.textContent = path === this.workspaceRoot ? 'project' : this.nameOf(path);
    details.appendChild(summary);

    const children = document.createElement('div');
    children.className = 'almostnode-files-tree__children';

    const entries = this.vfs.readdirSync(path).sort((left, right) => {
      const leftPath = this.joinPath(path, left);
      const rightPath = this.joinPath(path, right);
      const leftIsDirectory = this.vfs.statSync(leftPath).isDirectory();
      const rightIsDirectory = this.vfs.statSync(rightPath).isDirectory();

      if (leftIsDirectory !== rightIsDirectory) {
        return leftIsDirectory ? -1 : 1;
      }

      return left.localeCompare(right);
    });

    for (const entry of entries) {
      const fullPath = this.joinPath(path, entry);
      const stats = this.vfs.statSync(fullPath);
      if (stats.isDirectory()) {
        children.appendChild(this.renderDirectory(fullPath, depth + 1));
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'almostnode-files-tree__file';
      button.textContent = entry;
      button.addEventListener('click', () => {
        this.openFile(fullPath);
      });
      children.appendChild(button);
    }

    details.appendChild(children);
    return details;
  }

  private joinPath(parent: string, child: string): string {
    return parent === '/' ? `/${child}` : `${parent}/${child}`;
  }

  private nameOf(path: string): string {
    return path.split('/').filter(Boolean).pop() || path;
  }
}

export class PreviewSurface {
  private readonly root = document.createElement('div');
  private readonly toolbar = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly actions = document.createElement('div');
  private readonly runButton = document.createElement('button');
  private readonly refreshButton = document.createElement('button');
  private readonly body = document.createElement('div');
  private readonly emptyState = document.createElement('div');
  private readonly iframe = document.createElement('iframe');
  private currentUrl: string | null = null;

  constructor(commands: PreviewSurfaceCommands) {
    this.root.className = 'almostnode-preview-surface';
    this.root.tabIndex = -1;

    this.toolbar.className = 'almostnode-preview-surface__toolbar';

    this.status.className = 'almostnode-preview-surface__status';
    this.status.id = 'webidePreviewStatus';
    this.status.textContent = 'Waiting for a preview server';

    this.actions.className = 'almostnode-preview-surface__actions';

    this.runButton.type = 'button';
    this.runButton.className = 'almostnode-preview-surface__button';
    this.runButton.textContent = 'Run';
    this.runButton.addEventListener('click', () => {
      commands.run();
    });

    this.refreshButton.type = 'button';
    this.refreshButton.className = 'almostnode-preview-surface__button';
    this.refreshButton.textContent = 'Refresh';
    this.refreshButton.addEventListener('click', () => {
      commands.refresh();
    });

    this.actions.append(this.runButton, this.refreshButton);
    this.toolbar.append(this.status, this.actions);

    this.body.className = 'almostnode-preview-surface__body';

    this.emptyState.className = 'almostnode-preview-surface__empty';
    this.emptyState.textContent = 'Run the workspace to start a preview server.';
    this.emptyState.style.display = 'grid';

    this.iframe.id = 'webidePreview';
    this.iframe.className = 'almostnode-preview-surface__frame';
    this.iframe.title = 'Preview';
    this.iframe.hidden = true;
    this.iframe.style.display = 'none';

    this.body.append(this.emptyState, this.iframe);
    this.root.append(this.toolbar, this.body);
  }

  attach(container: HTMLElement): IDisposable {
    container.classList.add('almostnode-preview-editor-host');
    container.appendChild(this.root);
    return {
      dispose: () => {
        if (this.root.parentElement === container) {
          container.removeChild(this.root);
        }
      },
    };
  }

  setStatus(text: string): void {
    this.status.textContent = text;
    if (!this.currentUrl) {
      this.emptyState.textContent = text;
    }
  }

  setUrl(url: string): void {
    this.currentUrl = url;
    this.status.textContent = url;
    this.emptyState.hidden = true;
    this.emptyState.style.display = 'none';
    this.iframe.hidden = false;
    this.iframe.style.display = 'block';
    this.iframe.src = url;
  }

  clear(text: string): void {
    this.currentUrl = null;
    this.status.textContent = text;
    this.emptyState.textContent = text;
    this.emptyState.hidden = false;
    this.emptyState.style.display = 'grid';
    this.iframe.hidden = true;
    this.iframe.style.display = 'none';
    this.iframe.removeAttribute('src');
  }

  reload(): void {
    if (!this.currentUrl) {
      return;
    }

    this.iframe.src = this.currentUrl;
  }

  focus(): void {
    if (!this.iframe.hidden) {
      this.iframe.focus();
      return;
    }

    this.root.focus();
  }
}

export class TerminalPanelSurface {
  private readonly root = document.createElement('div');
  private readonly statusRow = document.createElement('div');
  private readonly tabs = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly actions = document.createElement('div');
  private readonly newTabButton = document.createElement('button');
  private readonly body = document.createElement('div');
  private readonly resizeObserver: ResizeObserver;
  private opened = false;
  private activeTabId: string | null = null;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly tabBodies = new Map<string, HTMLDivElement>();
  private readonly tabStatuses = new Map<string, string>();
  private readonly terminals = new Map<string, { terminal: Terminal; fitAddon: FitAddon }>();

  constructor(
    private readonly callbacks: {
      onCreateTab: () => void;
      onCloseTab: (id: string) => void;
      onSelectTab: (id: string) => void;
    },
  ) {
    this.root.className = 'almostnode-terminal-surface';
    this.statusRow.className = 'almostnode-terminal-surface__status-row';
    this.tabs.className = 'almostnode-terminal-surface__tabs';
    this.actions.className = 'almostnode-terminal-surface__actions';

    this.status.className = 'almostnode-terminal-surface__status';
    this.status.id = 'webideTerminalStatus';
    this.status.textContent = 'Idle';

    this.newTabButton.type = 'button';
    this.newTabButton.className = 'almostnode-terminal-surface__new-tab';
    this.newTabButton.textContent = '+';
    this.newTabButton.setAttribute('aria-label', 'New terminal');
    this.newTabButton.addEventListener('click', () => {
      this.callbacks.onCreateTab();
    });

    this.body.className = 'almostnode-terminal-surface__body';

    this.actions.append(this.newTabButton);
    this.statusRow.append(this.tabs, this.status, this.actions);
    this.root.append(this.statusRow, this.body);

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.body);
  }

  attach(container: HTMLElement): IDisposable {
    container.classList.add('almostnode-terminal-panel-host');
    container.appendChild(this.root);

    if (!this.opened) {
      for (const [tabId, { terminal }] of this.terminals.entries()) {
        const body = this.tabBodies.get(tabId);
        if (body) {
          terminal.open(body);
        }
      }
      this.opened = true;
    }

    this.fit();

    return {
      dispose: () => {
        if (this.root.parentElement === container) {
          container.removeChild(this.root);
        }
      },
    };
  }

  updateStatus(text: string): void {
    if (!this.activeTabId) {
      this.status.textContent = text;
      return;
    }
    this.updateTabStatus(this.activeTabId, text);
  }

  focus(): void {
    const active = this.activeTabId ? this.terminals.get(this.activeTabId) : null;
    active?.terminal.focus();
  }

  addTab(tab: {
    id: string;
    title: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    closable: boolean;
  }): void {
    if (this.tabButtons.has(tab.id)) {
      this.updateTabTitle(tab.id, tab.title);
      return;
    }

    tab.terminal.loadAddon(tab.fitAddon);
    this.terminals.set(tab.id, { terminal: tab.terminal, fitAddon: tab.fitAddon });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'almostnode-terminal-surface__tab';
    button.dataset.terminalId = tab.id;
    button.addEventListener('click', () => {
      this.callbacks.onSelectTab(tab.id);
    });

    const label = document.createElement('span');
    label.className = 'almostnode-terminal-surface__tab-label';
    label.textContent = tab.title;
    button.appendChild(label);

    if (tab.closable) {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'almostnode-terminal-surface__tab-close';
      closeButton.textContent = 'x';
      closeButton.setAttribute('aria-label', `Close ${tab.title}`);
      closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onCloseTab(tab.id);
      });
      button.appendChild(closeButton);
    }

    const body = document.createElement('div');
    body.className = 'almostnode-terminal-surface__terminal';
    body.dataset.terminalId = tab.id;
    body.hidden = true;
    body.style.display = 'none';

    this.tabButtons.set(tab.id, button);
    this.tabBodies.set(tab.id, body);
    this.tabStatuses.set(tab.id, 'Idle');
    this.tabs.appendChild(button);
    this.body.appendChild(body);

    if (this.opened) {
      tab.terminal.open(body);
    }
  }

  removeTab(id: string): void {
    this.tabButtons.get(id)?.remove();
    this.tabBodies.get(id)?.remove();
    this.tabButtons.delete(id);
    this.tabBodies.delete(id);
    this.tabStatuses.delete(id);
    this.terminals.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
      this.status.textContent = 'Idle';
    }
  }

  updateTabTitle(id: string, title: string): void {
    const button = this.tabButtons.get(id);
    const label = button?.querySelector('.almostnode-terminal-surface__tab-label');
    if (label) {
      label.textContent = title;
    }
  }

  updateTabStatus(id: string, text: string): void {
    this.tabStatuses.set(id, text);
    if (this.activeTabId === id) {
      this.status.textContent = text;
    }
  }

  setActiveTab(id: string): void {
    this.activeTabId = id;
    for (const [tabId, button] of this.tabButtons.entries()) {
      button.classList.toggle('is-active', tabId === id);
    }
    for (const [tabId, body] of this.tabBodies.entries()) {
      const isActive = tabId === id;
      body.hidden = !isActive;
      body.style.display = isActive ? 'block' : 'none';
      if (isActive) {
        body.id = 'webideTerminal';
      } else if (body.id === 'webideTerminal') {
        body.removeAttribute('id');
      }
    }
    this.status.textContent = this.tabStatuses.get(id) || 'Idle';
    this.fit();
  }

  private fit(): void {
    if (!this.opened || !this.activeTabId) {
      return;
    }
    const activeBody = this.tabBodies.get(this.activeTabId);
    const activeTerminal = this.terminals.get(this.activeTabId);
    if (!activeBody || !activeTerminal) {
      return;
    }
    if (activeBody.clientWidth === 0 || activeBody.clientHeight === 0) {
      return;
    }

    activeTerminal.fitAddon.fit();
  }
}

export function registerWorkbenchSurfaces(options: {
  filesSurface: FilesSidebarSurface;
  previewSurface: PreviewSurface;
  terminalSurface: TerminalPanelSurface;
}): RegisteredWorkbenchSurfaces {
  class PreviewEditorInput extends SimpleEditorInput {
    readonly typeId = PREVIEW_EDITOR_TYPE_ID;

    constructor() {
      super(PREVIEW_EDITOR_RESOURCE);
      this.setName('Preview');
      this.setTitle({
        short: 'Preview',
        medium: 'Preview',
        long: 'Almostnode Preview',
      });
      this.setDescription('Live workspace preview');
      this.addCapability(EditorInputCapabilities.Singleton);
    }
  }

  class PreviewEditorPane extends SimpleEditorPane {
    constructor(group: IEditorGroup) {
      super(PREVIEW_EDITOR_TYPE_ID, group);
    }

    initialize(): HTMLElement {
      const element = document.createElement('div');
      element.className = 'almostnode-preview-editor-pane';
      return element;
    }

    override focus(): void {
      options.previewSurface.focus();
    }

    async renderInput(): Promise<IDisposable> {
      return options.previewSurface.attach(this.container);
    }
  }

  const previewInput = new PreviewEditorInput();
  const disposables = new DisposableStore();

  disposables.add(registerEditorPane(PREVIEW_EDITOR_TYPE_ID, 'Preview', PreviewEditorPane, [PreviewEditorInput]));
  disposables.add(
    registerCustomView({
      id: FILES_VIEW_ID,
      name: 'Files',
      location: ViewContainerLocation.Sidebar,
      default: true,
      renderBody: (container) => options.filesSurface.attach(container),
    }),
  );
  disposables.add(
    registerCustomView({
      id: TERMINAL_VIEW_ID,
      name: 'Terminal',
      location: ViewContainerLocation.Panel,
      renderBody: (container) => options.terminalSurface.attach(container),
    }),
  );

  return {
    previewInput,
    filesViewId: FILES_VIEW_ID,
    terminalViewId: TERMINAL_VIEW_ID,
    dispose: () => disposables.dispose(),
  };
}
