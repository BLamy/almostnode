import { createContainer, type TerminalSession } from '../index';
import { DEFAULT_FILE, DEFAULT_RUN_COMMAND, WORKSPACE_ROOT, seedWorkspace, getTemplateDefaults, type TemplateId } from './workspace-seed';
import { FixtureMarketplaceClient } from './fixture-extensions';
import { OpenVSXClient } from './open-vsx';
import { prunePersistedWorkbenchExtensions } from './persisted-extensions';
import { shouldRunWorkbenchCommandInteractively } from './terminal-command-routing';
import { VfsFileSystemProvider } from './vfs-file-system-provider';
import { createExtensionServiceOverrides, type ExtensionServiceOverrideBundle } from './extension-services';
import { FilesSidebarSurface, PreviewSurface, TerminalPanelSurface, ClaudeTerminalSurface, ConsolePanelElement, registerWorkbenchSurfaces, type RegisteredWorkbenchSurfaces } from './workbench-surfaces';
import { ClaudeAuthVault, type ClaudeAuthVaultState } from './claude-auth-vault';
import { initialize, getService, ICommandService, Menu } from '@codingame/monaco-vscode-api';
import { IConfigurationService, IEditorService, IPaneCompositePartService, IStatusbarService, IWorkbenchLayoutService, IWorkbenchThemeService } from '@codingame/monaco-vscode-api/services';
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
  template?: TemplateId;
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

const TERMINAL_THEME_DARK = {
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

const TERMINAL_THEME_LIGHT = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#d1480a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(209, 72, 10, 0.18)',
  selectionInactiveBackground: 'rgba(209, 72, 10, 0.12)',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#9a6700',
  blue: '#0550ae',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#7d5600',
  brightBlue: '#0969da',
  brightMagenta: '#6639ba',
  brightCyan: '#3192aa',
  brightWhite: '#8b949e',
};

/**
 * CSS overrides for light mode. Scoped to Monaco's `.vs` theme class so they
 * activate when the workbench color theme is light — independent of the OS
 * color scheme. The `.vs` class is added to `.monaco-workbench` by Monaco.
 */

/**
 * Layout overrides injected unconditionally — hides panel/sidebar titles
 * and removes padding so terminals fill their containers edge-to-edge.
 * These are injected via the style tag rather than settings so they apply
 * even when IndexedDB preserves stale settings from a previous session.
 */
const LAYOUT_OVERRIDES = `
/* Hide sidebar composite title and pane headers */
.part.sidebar .composite.title {
  display: none !important;
}
.part.sidebar .pane-header {
  display: none !important;
}
.part.sidebar .content {
  width: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* Keep the sidebar chrome aligned with the editor and let custom views stretch */
.part.sidebar {
  max-height: calc(100% - 12px) !important;
  height: calc(100% - 12px) !important;
  margin-top: 8px !important;
  margin-bottom: 4px !important;
}
.part.sidebar .content,
.part.sidebar .composite,
.part.sidebar .split-view-container,
.part.sidebar .split-view-view,
.part.sidebar .pane-body,
.part.sidebar .pane-body > .monaco-scrollable-element,
.part.sidebar .almostnode-claude-panel-host,
.part.sidebar .almostnode-files-tree-host {
  height: 100% !important;
  min-height: 0 !important;
}
.part.sidebar .almostnode-claude-panel-host,
.part.sidebar .almostnode-files-tree-host {
  display: flex !important;
  flex-direction: column !important;
}

/* Hide panel composite title and pane headers */
.part.panel.bottom .composite.title {
  display: none !important;
}
.part.panel.bottom .pane-header {
  display: none !important;
}
.part.panel.bottom .content {
  padding: 0 !important;
  margin: 0 !important;
}
`;

const LIGHT_MODE_OVERRIDES = `
.monaco-workbench.vs .chat-input-container {
  background-color: #ffffff !important;
}
.monaco-workbench.vs .chat-input-container .monaco-inputbox {
  background-color: #ffffff !important;
}
.monaco-workbench.vs {
  background-color: #f0f1f3 !important;
}
.monaco-workbench.vs .part.sidebar {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 2px 8px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .part.sidebar .monaco-list-row.selected,
.monaco-workbench.vs .part.sidebar .monaco-list-row.focused {
  background: linear-gradient(135deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02)) !important;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04) !important;
}
.monaco-workbench.vs .part.sidebar .monaco-list-row.focused.selected {
  background: linear-gradient(135deg, rgba(0,0,0,0.06), rgba(0,0,0,0.03)) !important;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05) !important;
}
.monaco-workbench.vs .part.sidebar .monaco-list:focus .monaco-list-row.selected {
  background: linear-gradient(135deg, rgba(0,0,0,0.07), rgba(0,0,0,0.04)) !important;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .part.sidebar .monaco-list:focus .monaco-list-row.focused {
  background: linear-gradient(135deg, rgba(0,0,0,0.07), rgba(0,0,0,0.04)) !important;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .part.sidebar .monaco-list-row:hover {
  background: linear-gradient(135deg, rgba(0,0,0,0.03), rgba(0,0,0,0.015)) !important;
}
.monaco-workbench.vs .part.editor {
  border-top: 1px solid rgba(0,0,0,0.08) !important;
  border-left: 1px solid rgba(0,0,0,0.05) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 2px 8px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .editor-actions {
  background-image: linear-gradient(to top, #d8d8dc 1px, transparent 1px) !important;
}
.monaco-workbench.vs .tabs-container {
  background-image: linear-gradient(to top, #d8d8dc 1px, transparent 1px) !important;
}
.monaco-workbench.vs .tab.active {
  box-shadow: inset -1px 0 0 0 #d8d8dc, inset 1px 0 0 0 #d8d8dc !important;
}
.monaco-workbench.vs .tab:not(.active) {
  box-shadow: inset 0 -1px 0 0 #d8d8dc !important;
}
.monaco-workbench.vs .tab.active:first-child {
  box-shadow: inset -1px 0 0 0 #d8d8dc !important;
}
.monaco-workbench.vs .tab:hover .label-name {
  text-shadow: 0 0 5px rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .monaco-hover {
  border: 1px solid rgba(0,0,0,0.08) !important;
  box-shadow: 0 4px 16px 0 rgba(0,0,0,0.08) !important;
}
.monaco-workbench.vs .part.panel.bottom {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 2px 8px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .part.activitybar {
  background: #f0f1f3 !important;
}
.monaco-workbench.vs .part.activitybar .composite-bar {
  background: #e4e5e8 !important;
  box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.7), inset 1px 0 0 0 rgba(255,255,255,0.4), inset 0 -1px 0 0 rgba(0,0,0,0.04), inset -1px 0 0 0 rgba(0,0,0,0.03), inset 0 1px 3px 0 rgba(255,255,255,0.3), 0 1px 4px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .part.activitybar .action-item .action-label img {
  filter: invert(1) !important;
}
.monaco-workbench.vs .part.activitybar .action-item.checked .action-label {
  background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6)) !important;
  box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.8), inset 1px 0 0 0 rgba(255,255,255,0.5), inset 0 -1px 0 0 rgba(0,0,0,0.04), inset -1px 0 0 0 rgba(0,0,0,0.03), inset 0 1px 2px 0 rgba(255,255,255,0.4), 0 1px 3px 0 rgba(0,0,0,0.08) !important;
}
.monaco-workbench.vs .part.titlebar {
  background-color: #f0f1f3 !important;
}
.monaco-workbench.vs .part.statusbar {
  background-color: #f0f1f3 !important;
}
.monaco-workbench.vs .part.statusbar:hover .statusbar-item-label {
  color: #555 !important;
}
.monaco-workbench.vs .part.statusbar:hover .codicon {
  color: #555 !important;
}
.monaco-workbench.vs .command-center-center {
  background: #e4e5e8 !important;
  box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.7), inset 1px 0 0 0 rgba(255,255,255,0.4), inset 0 -1px 0 0 rgba(0,0,0,0.04), inset -1px 0 0 0 rgba(0,0,0,0.03), inset 0 1px 3px 0 rgba(255,255,255,0.3), 0 1px 4px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .notification-toast {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 4px 12px 0 rgba(0,0,0,0.08) !important;
}
.monaco-workbench.vs .notifications-center {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 4px 12px 0 rgba(0,0,0,0.08) !important;
}
.monaco-workbench.vs .part.auxiliarybar {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 2px 8px 0 rgba(0,0,0,0.06) !important;
}
.monaco-workbench.vs .quick-input-widget {
  border-top: 1px solid rgba(0,0,0,0.06) !important;
  border-left: 1px solid rgba(0,0,0,0.04) !important;
  border-bottom: 1px solid rgba(0,0,0,0.02) !important;
  border-right: 1px solid rgba(0,0,0,0.02) !important;
  box-shadow: 0 8px 24px 0 rgba(0,0,0,0.1) !important;
}
.monaco-workbench.vs .quick-input-widget .monaco-list-row.focused {
  background: linear-gradient(135deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02)) !important;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04) !important;
}
.monaco-workbench.vs .letterpress {
  filter: brightness(1) drop-shadow(2px 2px 1px rgba(0,0,0,0.06)) drop-shadow(-2px -2px 1px rgba(255,255,255,0.4)) !important;
}
.monaco-workbench.vs * {
  border-color: transparent !important;
}
`;

function prefersLightMode(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: light)').matches === true;
}

function getTerminalTheme(): typeof TERMINAL_THEME_DARK {
  return prefersLightMode() ? TERMINAL_THEME_LIGHT : TERMINAL_THEME_DARK;
}

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
  readonly container = createContainer({
    basePath: import.meta.env.BASE_URL?.replace(/\/$/, '') || '',
  });
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
  private readonly templateId: TemplateId;

  constructor(private readonly options: WebIDEHostOptions) {
    this.templateId = options.template || 'vite';
    this.marketplaceMode = options.marketplaceMode || 'open-vsx';
    this.debugSections = Array.from(new Set((options.debugSections || []).map((section) => section.trim()).filter(Boolean)));
    this.filesSurface = new FilesSidebarSurface(this.container.vfs, WORKSPACE_ROOT, (path) => {
      void this.openWorkspaceFile(path);
    });
    this.previewSurface = new PreviewSurface({
      run: () => {
        void this.runPreviewCommand(getTemplateDefaults(this.templateId).runCommand);
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
      onResize: (id, cols, rows) => {
        const tab = this.terminalTabs.get(id);
        tab?.session.resize(cols, rows);
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
      onResize: (id, cols, rows) => {
        const tab = this.claudeTerminalTabs.get(id);
        tab?.session.resize(cols, rows);
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
      theme: getTerminalTheme(),
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
    if (tab.kind === 'claude') {
      // Filter out debug and install noise from Claude terminal
      const filtered = text
        .split('\n')
        .filter((line) => !line.startsWith('[almostnode DEBUG]'))
        .join('\n');
      if (!filtered) return;
      tab.terminal.write(normalizeTerminalOutput(filtered));
    } else {
      tab.terminal.write(normalizeTerminalOutput(text));
    }
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
    void this.runPreviewCommand(getTemplateDefaults(this.templateId).runCommand)
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

    this.updateTerminalStatus(tab, 'Preparing Claude Code...');
    try {
      await this.ensureClaudeCodeInstalled((message) => {
        this.updateTerminalStatus(tab, message);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install Claude Code';
      terminal.write(`Claude Code install failed: ${message}\r\n`);
      this.updateTerminalStatus(tab, 'Claude Code install failed');
      this.claudeSurface.hideLoading();
      this.printPrompt(tab);
      return tab;
    }

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
    const resolved = command || window.prompt('Command to run', getTemplateDefaults(this.templateId).runCommand) || '';
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

    // Inject custom-ui-style.stylesheet CSS from workspace settings
    this.injectCustomUiStylesheet();

    // Apply theme matching system color scheme preference
    await this.applyColorSchemePreference();
    this.listenForColorSchemeChanges();
  }

  private injectCustomUiStylesheet(): void {
    try {
      const settingsPath = `${WORKSPACE_ROOT}/.vscode/settings.json`;
      const raw = this.container.vfs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(raw as string);
      const stylesheet = settings['custom-ui-style.stylesheet'];
      if (!stylesheet || typeof stylesheet !== 'object') return;

      const cssRules: string[] = [];
      for (const [selector, properties] of Object.entries(stylesheet)) {
        if (!properties || typeof properties !== 'object') continue;
        const declarations = Object.entries(properties as Record<string, string>)
          .map(([prop, value]) => `  ${prop}: ${value};`)
          .join('\n');
        cssRules.push(`${selector} {\n${declarations}\n}`);
      }

      if (cssRules.length === 0) return;

      const style = document.createElement('style');
      style.id = 'almostnode-custom-ui-style';
      style.textContent = cssRules.join('\n\n') + '\n\n' + LAYOUT_OVERRIDES + '\n\n' + LIGHT_MODE_OVERRIDES;
      document.head.appendChild(style);
    } catch {
      // Settings file missing or malformed — skip custom UI styling
    }
  }

  private async applyColorSchemePreference(): Promise<void> {
    if (!prefersLightMode()) return;

    try {
      const themeService = await getService(IWorkbenchThemeService);
      await themeService.setColorTheme('Islands Light', undefined);
    } catch {
      // Theme switch failed — fall back to dark
    }
  }

  private listenForColorSchemeChanges(): void {
    // Listen for Monaco theme changes (user toggling via command palette / settings)
    // and update terminal themes to match
    void getService(IWorkbenchThemeService).then((themeService) => {
      themeService.onDidColorThemeChange((theme) => {
        const isLight = theme.type === 'light' || theme.type === 'hcLight';
        const terminalTheme = isLight ? TERMINAL_THEME_LIGHT : TERMINAL_THEME_DARK;

        for (const tab of this.terminalTabs.values()) {
          tab.terminal.options.theme = terminalTheme;
        }
      });
    });
  }

  private async ensureGitInitialized(): Promise<void> {
    if (this.container.vfs.existsSync('/project/.git')) return;
    await this.container.run('git init', { cwd: '/project' });
    await this.container.run('git add -A', { cwd: '/project' });
    await this.container.run('git commit -m "Initial commit"', { cwd: '/project' });
  }

  private async init(): Promise<void> {
    seedWorkspace(this.container, this.templateId);

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

    // Initialize git repo in the background (non-blocking)
    void this.ensureGitInitialized();
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
