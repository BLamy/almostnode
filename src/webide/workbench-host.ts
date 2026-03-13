import { createContainer, type TerminalSession } from '../index';
import { DEFAULT_FILE, DEFAULT_RUN_COMMAND, WORKSPACE_ROOT, seedWorkspace } from './workspace-seed';
import { FixtureMarketplaceClient } from './fixture-extensions';
import { OpenVSXClient } from './open-vsx';
import { prunePersistedWorkbenchExtensions } from './persisted-extensions';
import { shouldRunWorkbenchCommandInteractively } from './terminal-command-routing';
import { VfsFileSystemProvider } from './vfs-file-system-provider';
import { createExtensionServiceOverrides, type ExtensionServiceOverrideBundle } from './extension-services';
import { FilesSidebarSurface, PreviewSurface, TerminalPanelSurface, ClaudeTerminalSurface, ConsolePanelElement, registerWorkbenchSurfaces, type RegisteredWorkbenchSurfaces } from './workbench-surfaces';
import { ClaudeAuthVault, type ClaudeAuthVaultState } from './claude-auth-vault';
import { initialize, getService, ICommandService, Menu } from '@codingame/monaco-vscode-api';
import { IEditorService, IPaneCompositePartService, IStatusbarService, IWorkbenchLayoutService } from '@codingame/monaco-vscode-api/services';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import {
  StatusbarAlignment,
  type IStatusbarEntry,
  type IStatusbarEntryAccessor,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/statusbar/browser/statusbar';
import { EnablementState } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement';
import { ISearchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service';
import { QueryType } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search';
import { SIDE_GROUP } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getWorkbenchServiceOverride, { Parts, ViewContainerLocation, setPartVisibility } from '@codingame/monaco-vscode-workbench-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import { createIndexedDBProviders, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override';
import * as monaco from 'monaco-editor';
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-javascript-default-extension';
import '@codingame/monaco-vscode-json-default-extension';
import '@codingame/monaco-vscode-typescript-basics-default-extension';
import '@codingame/monaco-vscode-html-default-extension';
import '@codingame/monaco-vscode-css-default-extension';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._configuration';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._editorPane';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._fileEditorFactory';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileActions.contribution';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileCommands';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensions.contribution';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export type ReturnTypeOfCreateContainer = ReturnType<typeof createContainer>;

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (_workerId: string, label: string) => Worker | Promise<Worker> | undefined;
      getWorkerUrl?: (_workerId: string, label: string) => string | undefined;
      getWorkerOptions?: (_workerId: string, label: string) => WorkerOptions | undefined;
    };
    __almostnodeWebIDE?: unknown;
  }
}

type MarketplaceMode = 'open-vsx' | 'fixtures';

const WORKBENCH_WORKERS = {
  editorWorkerService: {
    options: { type: 'module' as const, name: 'editorWorkerService' },
    url: new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url).href,
  },
  TextMateWorker: {
    options: { type: 'module' as const, name: 'TextMateWorker' },
    url: new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url).href,
  },
  extensionHostWorkerMain: {
    options: { type: 'module' as const, name: 'extensionHostWorkerMain' },
    url: new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url).href,
  },
} satisfies Record<string, { options: WorkerOptions; url: string }>;

export interface WebIDEHostElements {
  workbench: HTMLElement;
}

export interface WebIDEHostOptions {
  elements: WebIDEHostElements;
  marketplaceMode?: MarketplaceMode;
  debugSections?: string[];
}

const PRELOADED_WORKBENCH_LANGUAGES: Array<Parameters<typeof monaco.languages.register>[0]> = [
  { id: 'javascript' },
  { id: 'javascriptreact' },
  { id: 'typescript' },
  { id: 'typescriptreact' },
];

function normalizeTerminalOutput(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

function registerWorkbenchLanguages(): void {
  const registered = new Set(monaco.languages.getLanguages().map((language) => language.id));

  for (const language of PRELOADED_WORKBENCH_LANGUAGES) {
    if (registered.has(language.id)) {
      continue;
    }

    monaco.languages.register(language);
    registered.add(language.id);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  let timeoutId = 0;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function inferWorkbenchLanguageId(path: string): string | null {
  const normalized = path.toLowerCase();

  if (normalized.endsWith('.tsx')) return 'typescriptreact';
  if (normalized.endsWith('.ts') || normalized.endsWith('.cts') || normalized.endsWith('.mts')) return 'typescript';
  if (normalized.endsWith('.jsx')) return 'javascriptreact';
  if (
    normalized.endsWith('.js')
    || normalized.endsWith('.cjs')
    || normalized.endsWith('.mjs')
    || normalized.endsWith('.es6')
  ) {
    return 'javascript';
  }
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.jsonc')) return 'jsonc';
  if (normalized.endsWith('.html') || normalized.endsWith('.htm') || normalized.endsWith('.xhtml')) return 'html';
  if (normalized.endsWith('.css')) return 'css';

  return null;
}

const TERMINAL_THEME = {
  background: '#0e1218',
  foreground: '#dce5f3',
  cursor: '#ff7a59',
  cursorAccent: '#0e1218',
  selectionBackground: 'rgba(255, 122, 89, 0.34)',
  selectionInactiveBackground: 'rgba(255, 122, 89, 0.24)',
  black: '#1e2630',
  red: '#f47067',
  green: '#8ddb8c',
  yellow: '#f69d50',
  blue: '#6cb6ff',
  magenta: '#dcbdfb',
  cyan: '#76e3ea',
  white: '#adbac7',
  brightBlack: '#444c56',
  brightRed: '#ff938a',
  brightGreen: '#b4f1b4',
  brightYellow: '#f5c67a',
  brightBlue: '#96d0ff',
  brightMagenta: '#eedcfe',
  brightCyan: '#b3f0f5',
  brightWhite: '#ffffff',
};

interface TerminalTabState {
  id: string;
  title: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  session: TerminalSession;
  currentLine: string;
  history: string[];
  historyIndex: number;
  runningAbortController: AbortController | null;
  closable: boolean;
  kind: 'user' | 'preview' | 'claude';
}

export class WebIDEHost {
  readonly container = createContainer();
  private readonly marketplaceMode: MarketplaceMode;
  private readonly debugSections: string[];
  private readonly filesSurface: FilesSidebarSurface;
  private readonly previewSurface: PreviewSurface;
  private readonly terminalSurface: TerminalPanelSurface;
  private readonly claudeSurface: ClaudeTerminalSurface;
  private readonly workbenchSurfaces: RegisteredWorkbenchSurfaces;
  private readonly terminalTabs = new Map<string, TerminalTabState>();
  private activeTerminalTabId: string | null = null;
  private previewTerminalTabId: string | null = null;
  private terminalCounter = 0;
  private readonly claudeTerminalTabs = new Map<string, TerminalTabState>();
  private activeClaudeTabId: string | null = null;
  private claudeTerminalCounter = 0;
  private previewStartRequested = false;
  private previewPort: number | null = null;
  private previewUrl: string | null = null;
  private readonly consolePanel = new ConsolePanelElement();
  private readonly consoleTabId = 'console-panel';
  private consoleMessageCount = 0;
  private extensionServices: ExtensionServiceOverrideBundle | null = null;
  private readonly claudeAuthVault: ClaudeAuthVault;
  private claudeAuthStatusEntry: IStatusbarEntryAccessor | null = null;
  private claudeCodeInstallPromise: Promise<void> | null = null;

  constructor(private readonly options: WebIDEHostOptions) {
    this.marketplaceMode = options.marketplaceMode || 'open-vsx';
    this.debugSections = Array.from(new Set((options.debugSections || []).map((section) => section.trim()).filter(Boolean)));
    this.filesSurface = new FilesSidebarSurface(this.container.vfs, WORKSPACE_ROOT, (path) => {
      void this.openWorkspaceFile(path);
    });
    this.previewSurface = new PreviewSurface({
      run: () => {
        void this.runPreviewCommand(DEFAULT_RUN_COMMAND);
      },
      refresh: () => this.refreshPreview(),
    });
    this.terminalSurface = new TerminalPanelSurface({
      onCreateTab: () => {
        this.createUserTerminalTab(true);
      },
      onCloseTab: (id) => {
        this.closeTerminalTab(id);
      },
      onSelectTab: (id) => {
        this.setActiveTerminalTab(id);
      },
    });
    this.claudeSurface = new ClaudeTerminalSurface({
      onCreateTab: () => {
        void this.createClaudeTerminalTab(true);
      },
      onCloseTab: (id) => {
        this.closeClaudeTerminalTab(id);
      },
      onSelectTab: (id) => {
        this.setActiveClaudeTab(id);
      },
    });
    this.workbenchSurfaces = registerWorkbenchSurfaces({
      filesSurface: this.filesSurface,
      previewSurface: this.previewSurface,
      terminalSurface: this.terminalSurface,
      claudeSurface: this.claudeSurface,
    });
    this.claudeAuthVault = new ClaudeAuthVault({
      vfs: this.container.vfs,
      overlayRoot: options.elements.workbench.parentElement ?? options.elements.workbench,
      onStateChange: (state) => {
        this.updateClaudeAuthStatusEntry(state);
      },
    });
  }

  static async bootstrap(options: WebIDEHostOptions): Promise<WebIDEHost> {
    const host = new WebIDEHost(options);
    await host.init();
    return host;
  }

  private get workbench(): HTMLElement {
    return this.options.elements.workbench;
  }

  get terminal(): Terminal {
    return this.requireActiveTerminalTab().terminal;
  }

  private createTerminalInstance(): { terminal: Terminal; fitAddon: FitAddon } {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fitAddon = new FitAddon();
    return { terminal, fitAddon };
  }

  private requireActiveTerminalTab(): TerminalTabState {
    const tab = this.activeTerminalTabId ? this.terminalTabs.get(this.activeTerminalTabId) : null;
    if (!tab) {
      throw new Error('No active terminal tab');
    }
    return tab;
  }

  private printPrompt(tab: TerminalTabState): void {
    tab.terminal.write('\r\n$ ');
  }

  private writeTerminal(tab: TerminalTabState, text: string): void {
    if (!text) return;
    tab.terminal.write(normalizeTerminalOutput(text));
  }

  private updateTerminalStatus(tab: TerminalTabState, text: string): void {
    if (tab.kind === 'claude') {
      this.claudeSurface.updateTabStatus(tab.id, text);
    } else {
      this.terminalSurface.updateTabStatus(tab.id, text);
    }
  }

  private updatePreviewStatus(text: string): void {
    this.previewSurface.setStatus(text);
  }

  private ensurePreviewServerRunning(): void {
    if (this.previewUrl || this.previewStartRequested) {
      return;
    }

    this.previewStartRequested = true;
    void this.runPreviewCommand(DEFAULT_RUN_COMMAND)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.updatePreviewStatus(message);
      })
      .finally(() => {
        if (!this.previewUrl) {
          this.previewStartRequested = false;
        }
      });
  }

  private createTerminalTab(kind: 'user' | 'preview', title: string, focus: boolean, closable: boolean): TerminalTabState {
    const id = `${kind}-${crypto.randomUUID()}`;
    const { terminal, fitAddon } = this.createTerminalInstance();
    const tab: TerminalTabState = {
      id,
      title,
      terminal,
      fitAddon,
      session: this.container.createTerminalSession({
        cwd: WORKSPACE_ROOT,
      }),
      currentLine: '',
      history: [],
      historyIndex: -1,
      runningAbortController: null,
      closable,
      kind,
    };
    this.terminalTabs.set(id, tab);
    this.terminalSurface.addTab({
      id,
      title,
      terminal,
      fitAddon,
      closable,
    });
    this.bindTerminal(tab);
    if (kind === 'preview') {
      this.previewTerminalTabId = id;
    }
    if (focus || !this.activeTerminalTabId) {
      this.setActiveTerminalTab(id);
    }
    terminal.write(kind === 'preview' ? 'almostnode preview terminal' : 'almostnode webide terminal');
    if (kind === 'user' && this.terminalCounter === 1 && this.debugSections.length > 0) {
      terminal.write(`\r\n[almostnode debug] enabled: ${this.debugSections.join(', ')}`);
    }
    this.printPrompt(tab);
    return tab;
  }

  private createUserTerminalTab(focus: boolean): TerminalTabState {
    this.terminalCounter += 1;
    return this.createTerminalTab('user', `Terminal ${this.terminalCounter}`, focus, true);
  }

  private getPreviewTerminalTab(): TerminalTabState {
    const existing = this.previewTerminalTabId ? this.terminalTabs.get(this.previewTerminalTabId) : null;
    if (existing) {
      return existing;
    }
    return this.createTerminalTab('preview', 'Preview', false, false);
  }

  private setActiveTerminalTab(id: string): void {
    if (!this.terminalTabs.has(id)) {
      return;
    }
    this.activeTerminalTabId = id;
    this.terminalSurface.setActiveTab(id);
  }

  private closeTerminalTab(id: string): void {
    const tab = this.terminalTabs.get(id);
    if (!tab || tab.kind === 'preview') {
      return;
    }

    tab.runningAbortController?.abort();
    this.terminalTabs.delete(id);
    this.terminalSurface.removeTab(id);
    tab.terminal.dispose();
    tab.session.dispose();

    if (this.activeTerminalTabId === id) {
      const nextTab = this.terminalTabs.values().next().value as TerminalTabState | undefined;
      if (nextTab) {
        this.setActiveTerminalTab(nextTab.id);
      } else {
        this.createUserTerminalTab(true);
      }
    }
  }

  private async createClaudeTerminalTab(focus: boolean): Promise<TerminalTabState> {
    this.claudeTerminalCounter += 1;
    const id = `claude-${crypto.randomUUID()}`;
    const { terminal, fitAddon } = this.createTerminalInstance();
    const tab: TerminalTabState = {
      id,
      title: `Claude ${this.claudeTerminalCounter}`,
      terminal,
      fitAddon,
      session: this.container.createTerminalSession({
        cwd: WORKSPACE_ROOT,
      }),
      currentLine: '',
      history: [],
      historyIndex: -1,
      runningAbortController: null,
      closable: true,
      kind: 'claude',
    };
    this.claudeTerminalTabs.set(id, tab);
    this.claudeSurface.addTab({
      id,
      title: tab.title,
      terminal,
      fitAddon,
      closable: true,
    });
    this.bindTerminal(tab);
    if (focus || !this.activeClaudeTabId) {
      this.setActiveClaudeTab(id);
    }

    this.claudeSurface.showLoading();
    const state = this.claudeAuthVault.getState();
    if (state.hasStoredVault && !state.hasLiveCredentials) {
      try {
        await this.claudeAuthVault.handlePrimaryAction();
      } catch {
        terminal.write('Claude auth unlock failed. You can retry from the status bar.\r\n');
        this.claudeSurface.hideLoading();
        this.printPrompt(tab);
        return tab;
      }
    }

    terminal.write('Preparing Claude Code...\r\n');
    this.updateTerminalStatus(tab, 'Preparing Claude Code...');
    try {
      await this.ensureClaudeCodeInstalled((message) => {
        terminal.write(`${message}\r\n`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install Claude Code';
      terminal.write(`Claude Code install failed: ${message}\r\n`);
      this.updateTerminalStatus(tab, 'Claude Code install failed');
      this.claudeSurface.hideLoading();
      this.printPrompt(tab);
      return tab;
    }

    terminal.write('Starting Claude Code...\r\n');
    this.updateTerminalStatus(tab, 'Starting Claude Code...');
    void this.runCommand(tab, 'npx @anthropic-ai/claude-code').then(() => {
      this.claudeSurface.hideLoading();
    });

    // Hide loading after a short delay once output starts flowing
    await delay(2000);
    this.claudeSurface.hideLoading();

    return tab;
  }

  private setActiveClaudeTab(id: string): void {
    if (!this.claudeTerminalTabs.has(id)) {
      return;
    }
    this.activeClaudeTabId = id;
    this.claudeSurface.setActiveTab(id);
  }

  private closeClaudeTerminalTab(id: string): void {
    const tab = this.claudeTerminalTabs.get(id);
    if (!tab) {
      return;
    }

    tab.runningAbortController?.abort();
    this.claudeTerminalTabs.delete(id);
    this.claudeSurface.removeTab(id);
    tab.terminal.dispose();
    tab.session.dispose();

    if (this.activeClaudeTabId === id) {
      const nextTab = this.claudeTerminalTabs.values().next().value as TerminalTabState | undefined;
      if (nextTab) {
        this.setActiveClaudeTab(nextTab.id);
      } else {
        this.activeClaudeTabId = null;
      }
    }
  }

  async revealClaudePanel(focus: boolean): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.SIDEBAR_PART, true);
    await paneCompositeService.openPaneComposite(this.workbenchSurfaces.claudeViewId, ViewContainerLocation.Sidebar, focus);
    if (this.claudeTerminalTabs.size === 0) {
      await this.createClaudeTerminalTab(focus);
    }
    if (focus) {
      this.claudeSurface.focus();
    }
  }

  private async runCommand(
    tab: TerminalTabState,
    command: string,
    options?: { echoCommand?: boolean },
  ): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) {
      this.printPrompt(tab);
      return;
    }

    if (options?.echoCommand) {
      tab.terminal.write(trimmed);
      tab.terminal.write('\r\n');
    }

    if (!await this.claudeAuthVault.prepareForCommand(trimmed)) {
      this.updateTerminalStatus(tab, 'Claude auth unlock required');
      this.writeTerminal(tab, 'Claude auth unlock is required before running this command.\n');
      this.printPrompt(tab);
      return;
    }

    if (tab.runningAbortController) {
      throw new Error(`${tab.title} is already running a command`);
    }

    tab.runningAbortController = new AbortController();
    this.updateTerminalStatus(tab, `Running: ${trimmed}`);

    try {
      const result = await tab.session.run(trimmed, {
        signal: tab.runningAbortController.signal,
        onStdout: (text) => this.writeTerminal(tab, text),
        onStderr: (text) => this.writeTerminal(tab, text),
        interactive: shouldRunWorkbenchCommandInteractively(trimmed, tab.kind),
      });
      this.updateTerminalStatus(tab, `Exited ${result.exitCode}`);
    } finally {
      tab.runningAbortController = null;
      this.printPrompt(tab);
    }
  }

  async executeHostCommand(command?: string): Promise<void> {
    const resolved = command || window.prompt('Command to run', DEFAULT_RUN_COMMAND) || '';
    await this.runCommand(this.requireActiveTerminalTab(), resolved, { echoCommand: true });
  }

  private async runPreviewCommand(command: string): Promise<void> {
    await this.runCommand(this.getPreviewTerminalTab(), command);
  }

  async unlockClaudeAuth(): Promise<void> {
    await this.claudeAuthVault.handlePrimaryAction();
  }

  forgetClaudeAuth(): void {
    this.claudeAuthVault.forgetSavedVault();
  }

  getClaudeAuthState(): ClaudeAuthVaultState {
    return this.claudeAuthVault.getState();
  }

  private async openWorkspaceFile(path: string): Promise<void> {
    const editorService = await getService(IEditorService);
    const languageId = inferWorkbenchLanguageId(path);

    await editorService.openEditor({
      resource: URI.file(path),
      options: {
        pinned: true,
      },
    });

    if (!languageId) {
      return;
    }

    const modelReference = await monaco.editor.createModelReference(URI.file(path));
    try {
      const model = monaco.editor.getModel(URI.file(path));
      if (model && model.getLanguageId() !== languageId) {
        monaco.editor.setModelLanguage(model, languageId);
      }
    } finally {
      modelReference.dispose();
    }
  }

  private async revealPreviewEditor(): Promise<void> {
    const editorService = await getService(IEditorService);
    const existing = this.workbenchSurfaces.previewInput.resource
      ? editorService.findEditors(this.workbenchSurfaces.previewInput.resource).find((identifier) => {
          return identifier.editor.matches(this.workbenchSurfaces.previewInput);
        })
      : undefined;

    await editorService.openEditor(
      this.workbenchSurfaces.previewInput,
      {
        pinned: true,
      },
      existing?.groupId ?? SIDE_GROUP,
    );
  }

  private async revealTerminalPanel(focus: boolean): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.PANEL_PART, true);
    await paneCompositeService.openPaneComposite(this.workbenchSurfaces.terminalViewId, ViewContainerLocation.Panel, focus);
    if (focus) {
      this.terminalSurface.focus();
    }
  }

  async openPreview(): Promise<void> {
    await this.revealPreviewEditor();

    if (!this.previewUrl) {
      this.ensurePreviewServerRunning();

      const start = Date.now();
      while (!this.previewUrl && Date.now() - start < 15000) {
        await delay(100);
      }
    }

    if (this.previewUrl) {
      this.previewSurface.focus();
      return;
    }

    throw new Error('Preview server did not become ready in time.');
  }

  refreshPreview(): void {
    if (!this.previewUrl) {
      return;
    }

    this.consolePanel.clear();
    this.consoleMessageCount = 0;
    this.terminalSurface.updateTabStatus(this.consoleTabId, '');
    this.previewSurface.reload();
  }

  async focusTerminal(): Promise<void> {
    await this.revealTerminalPanel(true);
  }

  async executeWorkbenchCommand(command: string, ...args: unknown[]): Promise<unknown> {
    const commandService = await getService(ICommandService);
    return commandService.executeCommand(command, ...args);
  }

  async searchMarketplace(query: string): Promise<string[]> {
    if (!this.extensionServices) {
      return [];
    }

    const pager = await withTimeout(
      this.extensionServices.galleryService.query({
        text: query,
        pageSize: 20,
      }),
      `Marketplace search timed out for "${query}".`,
    );
    return pager.firstPage.map((extension) => extension.identifier.id);
  }

  async installExtension(extensionId: string): Promise<void> {
    if (!this.extensionServices) {
      throw new Error('Extension services are not initialized.');
    }

    const [extension] = await withTimeout(
      this.extensionServices.galleryService.getExtensions([{ id: extensionId }]),
      `Timed out while resolving extension ${extensionId}.`,
    );
    if (!extension) {
      throw new Error(`Extension ${extensionId} was not found in the marketplace.`);
    }

    await withTimeout(
      this.extensionServices.managementService.installFromGallery(extension),
      `Timed out while installing extension ${extensionId}.`,
    );
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    if (!this.extensionServices) {
      throw new Error('Extension services are not initialized.');
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      `Timed out while listing installed extensions for ${extensionId}.`,
    );
    const extension = installed.find((candidate) => candidate.identifier.id === extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} is not installed.`);
    }

    await withTimeout(
      this.extensionServices.enablementService.setEnablement(
        [extension],
        enabled ? EnablementState.EnabledGlobally : EnablementState.DisabledGlobally,
      ),
      `Timed out while updating enablement for ${extensionId}.`,
    );
  }

  async uninstallExtension(extensionId: string): Promise<void> {
    if (!this.extensionServices) {
      throw new Error('Extension services are not initialized.');
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      `Timed out while listing installed extensions for ${extensionId}.`,
    );
    const extension = installed.find((candidate) => candidate.identifier.id === extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} is not installed.`);
    }

    await withTimeout(
      this.extensionServices.managementService.uninstall(extension),
      `Timed out while uninstalling extension ${extensionId}.`,
    );
  }

  async listInstalledExtensions(): Promise<Array<{ id: string; enabled: boolean }>> {
    if (!this.extensionServices) {
      return [];
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      'Timed out while listing installed extensions.',
    );
    return installed.map((extension) => ({
      id: extension.identifier.id,
      enabled: this.extensionServices?.enablementService.isEnabled(extension) ?? false,
    }));
  }

  async searchWorkspaceText(pattern: string): Promise<string[]> {
    const searchService = await getService(ISearchService);
    const start = Date.now();

    while (!searchService.schemeHasFileSearchProvider('file') && Date.now() - start < 5000) {
      await delay(100);
    }

    let lastError: unknown = null;
    while (Date.now() - start < 5000) {
      try {
        const results = await searchService.textSearch({
          type: QueryType.Text,
          folderQueries: [{ folder: URI.file(WORKSPACE_ROOT) }],
          contentPattern: {
            pattern,
            isCaseSensitive: false,
          },
          previewOptions: {
            matchLines: 1,
            charsPerLine: 120,
          },
          maxResults: 50,
        });

        return results.results.map((result) => result.resource.path);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Search provider not initialized')) {
          throw error;
        }
        await delay(100);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Search provider did not initialize for pattern "${pattern}".`);
  }

  private bindTerminal(tab: TerminalTabState): void {
    tab.terminal.onData((data) => {
      // Interactive CLIs need raw input passthrough while they own the terminal.
      if (tab.runningAbortController) {
        if (data === '\u0003') {
          tab.runningAbortController.abort();
          tab.session.sendInput(data);
          tab.terminal.write('^C');
          return;
        }

        tab.session.sendInput(data);
        return;
      }

      if (data === '\u0003') {
        tab.currentLine = '';
        this.printPrompt(tab);
        return;
      }

      if (data === '\r') {
        const command = tab.currentLine;
        tab.currentLine = '';
        tab.historyIndex = -1;
        if (command.trim()) {
          tab.history.unshift(command);
        }
        tab.terminal.write('\r\n');
        void this.runCommand(tab, command);
        return;
      }

      if (data === '\u007F') {
        if (tab.currentLine.length > 0) {
          tab.currentLine = tab.currentLine.slice(0, -1);
          tab.terminal.write('\b \b');
        }
        return;
      }

      if (data === '\u001b[A') {
        if (tab.history.length === 0) return;
        tab.historyIndex = Math.min(tab.historyIndex + 1, tab.history.length - 1);
        this.replaceTerminalLine(tab, tab.history[tab.historyIndex] || '');
        return;
      }

      if (data === '\u001b[B') {
        if (tab.history.length === 0) return;
        tab.historyIndex = Math.max(tab.historyIndex - 1, -1);
        this.replaceTerminalLine(tab, tab.historyIndex >= 0 ? tab.history[tab.historyIndex] || '' : '');
        return;
      }

      if (data >= ' ') {
        tab.currentLine += data;
        tab.terminal.write(data);
      }
    });
  }

  private replaceTerminalLine(tab: TerminalTabState, nextValue: string): void {
    while (tab.currentLine.length > 0) {
      tab.terminal.write('\b \b');
      tab.currentLine = tab.currentLine.slice(0, -1);
    }

    tab.currentLine = nextValue;
    if (nextValue) {
      tab.terminal.write(nextValue);
    }
  }

  private installWorkerEnvironment(): void {
    window.MonacoEnvironment = {
      getWorkerUrl: (_workerId: string, label: string) => {
        return WORKBENCH_WORKERS[label as keyof typeof WORKBENCH_WORKERS]?.url;
      },
      getWorkerOptions: (_workerId: string, label: string) => {
        return WORKBENCH_WORKERS[label as keyof typeof WORKBENCH_WORKERS]?.options;
      },
    };
  }

  private buildClaudeAuthStatusEntry(state = this.claudeAuthVault.getState()): IStatusbarEntry {
    if (state.busy) {
      return {
        name: 'Claude Auth',
        text: '$(sync~spin) Claude Auth',
        ariaLabel: 'Claude auth action in progress',
        tooltip: 'Claude auth vault action in progress',
        command: 'almostnode.claudeAuth.primary',
      };
    }

    if (!state.supported) {
      return {
        name: 'Claude Auth',
        text: '$(shield) Claude Auth',
        ariaLabel: 'Claude auth vault unavailable',
        tooltip: 'Passkey-backed Claude auth vault is unavailable in this browser.',
      };
    }

    if (state.hasStoredVault && !state.hasLiveCredentials) {
      return {
        name: 'Claude Auth',
        text: '$(lock) Claude Auth',
        ariaLabel: 'Unlock saved Claude auth',
        tooltip: 'Unlock the saved Claude auth vault for this browser.',
        command: 'almostnode.claudeAuth.primary',
      };
    }

    if (state.hasLiveCredentials && !state.hasStoredVault) {
      return {
        name: 'Claude Auth',
        text: '$(key) Save Claude',
        ariaLabel: 'Save Claude auth',
        tooltip: 'Save the current Claude auth file for this browser with a passkey.',
        command: 'almostnode.claudeAuth.primary',
      };
    }

    return {
      name: 'Claude Auth',
      text: state.hasStoredVault ? '$(shield) Claude Saved' : '$(shield) Claude Auth',
      ariaLabel: state.hasStoredVault ? 'Claude auth is saved for this browser' : 'Claude auth vault',
      tooltip: state.hasStoredVault
        ? 'Claude auth is available for this browser.'
        : 'No Claude auth has been saved for this browser.',
      command: state.hasStoredVault ? 'almostnode.claudeAuth.primary' : undefined,
    };
  }

  private updateClaudeAuthStatusEntry(state = this.claudeAuthVault.getState()): void {
    this.claudeAuthStatusEntry?.update(this.buildClaudeAuthStatusEntry(state));
  }

  private async registerStatusbarEntries(): Promise<void> {
    const statusbarService = await getService(IStatusbarService);
    statusbarService.addEntry(
      {
        name: 'Run',
        text: '$(play) Run',
        ariaLabel: 'Run workspace command',
        tooltip: 'Run a workspace command',
        command: 'almostnode.run',
      },
      'almostnode.status.run',
      StatusbarAlignment.LEFT,
      { primary: 1000, secondary: 1000 },
    );

    statusbarService.addEntry(
      {
        name: 'Preview',
        text: '$(globe) Preview',
        ariaLabel: 'Open preview',
        tooltip: 'Open the preview tab',
        command: 'almostnode.preview.open',
      },
      'almostnode.status.preview',
      StatusbarAlignment.LEFT,
      { primary: 999, secondary: 999 },
    );

    statusbarService.addEntry(
      {
        name: 'Terminal',
        text: '$(terminal) Terminal',
        ariaLabel: 'Focus terminal',
        tooltip: 'Focus the terminal panel',
        command: 'almostnode.terminal.focus',
      },
      'almostnode.status.terminal',
      StatusbarAlignment.LEFT,
      { primary: 998, secondary: 998 },
    );

    statusbarService.addEntry(
      {
        name: 'Claude Code',
        text: '$(sparkle) Claude Code',
        ariaLabel: 'Open Claude Code',
        tooltip: 'Open the Claude Code panel',
        command: 'almostnode.claude.open',
      },
      'almostnode.status.claude',
      StatusbarAlignment.LEFT,
      { primary: 997, secondary: 997 },
    );

    this.claudeAuthStatusEntry = statusbarService.addEntry(
      this.buildClaudeAuthStatusEntry(),
      'almostnode.status.claudeAuth',
      StatusbarAlignment.LEFT,
      { primary: 996, secondary: 996 },
    );
  }

  private resolveMarketplaceClient() {
    if (this.marketplaceMode === 'fixtures') {
      return {
        client: new FixtureMarketplaceClient(),
        baseUrl: 'https://fixtures.almostnode.invalid',
      };
    }

    return {
      client: new OpenVSXClient(),
      baseUrl: 'https://open-vsx.org',
    };
  }

  private async initWorkbench(): Promise<void> {
    const userDataProvider = await createIndexedDBProviders();
    await prunePersistedWorkbenchExtensions(userDataProvider);
    registerWorkbenchLanguages();

    const provider = new VfsFileSystemProvider(this.container.vfs, WORKSPACE_ROOT);
    registerFileSystemOverlay(1, provider);

    const { client, baseUrl } = this.resolveMarketplaceClient();
    const extensionOverrides = createExtensionServiceOverrides(client, baseUrl);
    this.extensionServices = extensionOverrides;

    await initialize(
      {
        ...getConfigurationServiceOverride(),
        ...getKeybindingsServiceOverride(),
        ...getLanguagesServiceOverride(),
        ...getSearchServiceOverride(),
        ...getThemeServiceOverride(),
        ...getTextmateServiceOverride(),
        ...getWorkbenchServiceOverride(),
        ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
        ...extensionOverrides.overrides,
      },
      this.workbench,
      {
        workspaceProvider: {
          workspace: {
            folderUri: URI.file(WORKSPACE_ROOT),
          },
          trusted: true,
          open: async () => false,
        },
        additionalTrustedDomains: ['https://open-vsx.org'],
        enableWorkspaceTrust: true,
        defaultLayout: {
          force: true,
          views: [
            { id: this.workbenchSurfaces.claudeViewId },
            { id: this.workbenchSurfaces.filesViewId },
            { id: this.workbenchSurfaces.terminalViewId },
          ],
        },
        configurationDefaults: {
          'workbench.startupEditor': 'none',
          'editor.minimap.enabled': false,
          'files.autoSave': 'afterDelay',
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
        },
        productConfiguration: {
          nameShort: 'almostnode',
          nameLong: 'almostnode webide',
          applicationName: 'almostnode-webide',
          extensionsGallery: {
            serviceUrl: `${baseUrl}/vscode/gallery`,
            controlUrl: `${baseUrl}/vscode/item`,
            extensionUrlTemplate: `${baseUrl}/vscode/gallery/{publisher}/{name}/latest`,
            resourceUrlTemplate: `${baseUrl}/vscode/unpkg/{publisher}/{name}/{version}/{path}`,
            nlsBaseUrl: `${baseUrl}/vscode/unpkg`,
          },
        },
        commands: [
          {
            id: 'almostnode.run',
            label: 'Almostnode: Run Command',
            menu: Menu.CommandPalette,
            handler: (...args: unknown[]) => this.executeHostCommand(typeof args[0] === 'string' ? args[0] : undefined),
          },
          {
            id: 'almostnode.preview.open',
            label: 'Almostnode: Open Preview',
            menu: Menu.CommandPalette,
            handler: () => this.openPreview(),
          },
          {
            id: 'almostnode.preview.refresh',
            label: 'Almostnode: Refresh Preview',
            menu: Menu.CommandPalette,
            handler: () => this.refreshPreview(),
          },
          {
            id: 'almostnode.terminal.focus',
            label: 'Almostnode: Focus Terminal',
            menu: Menu.CommandPalette,
            handler: () => this.focusTerminal(),
          },
          {
            id: 'almostnode.claude.open',
            label: 'Almostnode: Open Claude Code',
            menu: Menu.CommandPalette,
            handler: () => this.revealClaudePanel(true),
          },
          {
            id: 'almostnode.claudeAuth.primary',
            label: 'Almostnode: Unlock Claude Auth',
            handler: () => this.unlockClaudeAuth(),
          },
          {
            id: 'almostnode.claudeAuth.unlock',
            label: 'Almostnode: Unlock Claude Auth',
            menu: Menu.CommandPalette,
            handler: () => this.unlockClaudeAuth(),
          },
          {
            id: 'almostnode.claudeAuth.forget',
            label: 'Almostnode: Forget Claude Auth',
            menu: Menu.CommandPalette,
            handler: () => this.forgetClaudeAuth(),
          },
        ],
      },
    );

    await this.registerStatusbarEntries();

    const paneCompositeService = await getService(IPaneCompositePartService);
    const editorService = await getService(IEditorService);

    // Open Claude Code panel in the primary sidebar by default
    setPartVisibility(Parts.SIDEBAR_PART, true);
    await paneCompositeService.openPaneComposite(this.workbenchSurfaces.claudeViewId, ViewContainerLocation.Sidebar, false);

    // Open preview as the only editor (no default source file)
    await editorService.openEditor(
      this.workbenchSurfaces.previewInput,
      {
        pinned: true,
        preserveFocus: true,
      },
    );

    // Keep terminal collapsed by default
    setPartVisibility(Parts.PANEL_PART, false);

    // Set sidebar to 600px initial width
    const layoutService = await getService(IWorkbenchLayoutService);
    const currentSize = layoutService.getSize(Parts.SIDEBAR_PART);
    layoutService.setSize(Parts.SIDEBAR_PART, { width: 600, height: currentSize.height });
  }

  private async init(): Promise<void> {
    seedWorkspace(this.container);

    this.installWorkerEnvironment();
    const initialTab = this.createUserTerminalTab(false);
    await this.claudeAuthVault.init();
    this.updatePreviewStatus('Waiting for a preview server');
    this.updateTerminalStatus(initialTab, 'Idle');

    // Add Console tab as a custom (non-terminal) tab in the terminal panel
    this.terminalSurface.addCustomTab({
      id: this.consoleTabId,
      title: 'Console',
      element: this.consolePanel.root,
      closable: false,
    });

    // Listen for console messages from the preview iframe
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'almostnode-console') return;
      const { level, args, timestamp } = event.data;
      if (!level || !Array.isArray(args)) return;
      this.consolePanel.addEntry(level, args, timestamp || Date.now());
      this.consoleMessageCount++;
      this.terminalSurface.updateTabStatus(this.consoleTabId, `${this.consoleMessageCount} messages`);
    });

    this.container.on('server-ready', (_port: unknown, url: unknown) => {
      if (typeof _port !== 'number' || typeof url !== 'string') {
        return;
      }
      this.previewPort = _port;
      this.previewUrl = `${url}/`;
      this.previewStartRequested = false;
      this.previewSurface.setUrl(this.previewUrl);

      const iframe = this.previewSurface.getIframe();
      const registerHMRTarget = () => {
        if (iframe.contentWindow && this.previewPort !== null) {
          this.container.setHMRTargetForPort(this.previewPort, iframe.contentWindow);
        }
      };
      iframe.addEventListener('load', registerHMRTarget, { once: true });
      // Also register immediately if iframe is already loaded
      registerHMRTarget();

      const previewTab = this.previewTerminalTabId ? this.terminalTabs.get(this.previewTerminalTabId) : null;
      if (previewTab) {
        this.updateTerminalStatus(previewTab, `Preview ready: ${this.previewUrl}`);
      }
    });

    this.container.on('server-unregistered', (port: unknown) => {
      if (typeof port !== 'number' || port !== this.previewPort) {
        return;
      }

      this.previewPort = null;
      this.previewUrl = null;
      this.previewStartRequested = false;
      this.previewSurface.clear('Preview server stopped. Run the workspace to start it again.');
      const previewTab = this.previewTerminalTabId ? this.terminalTabs.get(this.previewTerminalTabId) : null;
      if (previewTab) {
        this.updateTerminalStatus(previewTab, 'Preview server stopped');
      }
    });

    try {
      await this.container.serverBridge.initServiceWorker();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to initialize service worker';
      this.updatePreviewStatus(message);
    }

    await this.initWorkbench();
    this.ensurePreviewServerRunning();
    window.__almostnodeWebIDE = this;

    // Show Claude loading splash immediately so it's visible during WebAuthn
    this.claudeSurface.showLoading();

    // Auto-start Claude Code: if there's a stored API key, prompt WebAuthn
    // to unlock it, then start a Claude Code session
    const claudeState = this.claudeAuthVault.getState();
    if (claudeState.hasStoredVault && !claudeState.hasLiveCredentials) {
      this.claudeAuthVault.handlePrimaryAction().then(() => {
        void this.revealClaudePanel(false);
      }).catch(() => {
        // Auth unlock declined/failed — still reveal the panel so user can retry
        void this.revealClaudePanel(false);
      });
    } else {
      // No stored vault or already unlocked — just open the Claude panel
      void this.revealClaudePanel(false);
    }
  }

  private async ensureClaudeCodeInstalled(onProgress?: (message: string) => void): Promise<void> {
    if (this.container.vfs.existsSync('/node_modules/@anthropic-ai/claude-code/package.json')) {
      return;
    }

    if (!this.claudeCodeInstallPromise) {
      this.claudeCodeInstallPromise = this.container.npm.install('@anthropic-ai/claude-code', {
        save: true,
        onProgress: (message) => {
          console.log(`[claude-code] ${message}`);
          onProgress?.(message);
        },
      }).then(() => undefined).catch((error) => {
        this.claudeCodeInstallPromise = null;
        throw error;
      });
    }

    await this.claudeCodeInstallPromise;
  }
}
