import { createContainer, type RunResult, type WorkspaceSearchProvider } from 'almostnode';
import {
  DEFAULT_FILE,
  DEFAULT_RUN_COMMAND,
  WORKSPACE_ROOT,
  WORKSPACE_TESTS_ROOT,
  WORKSPACE_TEST_E2E_ROOT,
  WORKSPACE_TEST_METADATA_PATH,
  seedWorkspace,
  seedReferenceApp,
  getTemplateDefaults,
  type TemplateId,
} from '../features/workspace-seed';
import type { ReferenceAppFiles } from '../features/reference-app-loader';
import { FixtureMarketplaceClient } from '../extensions/fixture-extensions';
import { OpenVSXClient } from '../extensions/open-vsx';
import { prunePersistedWorkbenchExtensions } from '../features/persisted-extensions';
import { shouldRunWorkbenchCommandInteractively } from '../features/terminal-command-routing';
import { VfsFileSystemProvider } from '../features/vfs-file-system-provider';
import type { DesktopBridge } from '../desktop/bridge';
import { HostTerminalSession } from '../desktop/host-terminal-session';
import { loadProjectFilesIntoVfs, type SerializedFile } from '../desktop/project-snapshot';
import { createExtensionServiceOverrides, type ExtensionServiceOverrideBundle } from '../extensions/extension-services';
import { FilesSidebarSurface, PreviewSurface, TerminalPanelSurface, ClaudeTerminalSurface, ConsolePanelElement, DatabaseSidebarSurface, DatabaseBrowserSurface, KeychainSidebarSurface, TestsSidebarSurface, registerWorkbenchSurfaces, type RegisteredWorkbenchSurfaces } from './workbench-surfaces';
import { MarkdownEditorInput, JsonEditorInput } from '../features/rendered-editors';
import { Keychain, type KeychainState, CLAUDE_AUTH_CREDENTIALS_PATH, CLAUDE_AUTH_CONFIG_PATH, CLAUDE_LEGACY_CONFIG_PATH } from '../features/keychain';
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
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import { createIndexedDBProviders, registerFileSystemOverlay } from '@codingame/monaco-vscode-files-service-override';
import * as monaco from 'monaco-editor';
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-javascript-default-extension';
import '@codingame/monaco-vscode-json-default-extension';
import '@codingame/monaco-vscode-typescript-basics-default-extension';
import '@codingame/monaco-vscode-html-default-extension';
import '@codingame/monaco-vscode-css-default-extension';
import '@codingame/monaco-vscode-sql-default-extension';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._configuration';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._editorPane';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._fileEditorFactory';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileActions.contribution';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileCommands';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensions.contribution';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Worker URLs via ?worker&url — Vite bundles these as self-contained worker files
import editorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker.js?worker&url';
import textMateWorkerUrl from '@codingame/monaco-vscode-textmate-service-override/worker?worker&url';
import extensionHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';

// Force full page reload on change — the Monaco workbench cannot be safely
// hot-reloaded because module-identity-dependent instanceof checks break.
if (import.meta.hot) {
  import.meta.hot.decline();
}

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
    url: editorWorkerUrl,
  },
  TextMateWorker: {
    options: { type: 'module' as const, name: 'TextMateWorker' },
    url: textMateWorkerUrl,
  },
  extensionHostWorkerMain: {
    options: { type: 'module' as const, name: 'extensionHostWorkerMain' },
    url: extensionHostWorkerUrl,
  },
} satisfies Record<string, { options: WorkerOptions; url: string }>;

const CLAUDE_CODE_PACKAGE_PATH = `${WORKSPACE_ROOT}/node_modules/@anthropic-ai/claude-code/package.json`;
const LEGACY_TESTS_ROOT = '/tests';
const LEGACY_TEST_E2E_ROOT = `${LEGACY_TESTS_ROOT}/e2e`;
const LEGACY_TEST_METADATA_PATH = `${LEGACY_TESTS_ROOT}/.almostnode-tests.json`;

export interface WebIDEHostElements {
  workbench: HTMLElement;
}

export interface WebIDEHostOptions {
  elements: WebIDEHostElements;
  marketplaceMode?: MarketplaceMode;
  debugSections?: string[];
  template?: TemplateId;
  referenceApp?: ReferenceAppFiles;
  baseUrl?: string;
  initialProjectFiles?: SerializedFile[] | null;
  skipWorkspaceSeed?: boolean;
  deferPreviewStart?: boolean;
  desktopBridge?: DesktopBridge | null;
  hostProjectDirectory?: string | null;
  agentLaunchCommand?: string | null;
}

export interface BridgedCommandResult extends RunResult {
  background: boolean;
  normalizedCommand: string;
  vfsCwd: string;
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
  if (normalized.endsWith('.sql')) return 'sql';

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

function loadPwWeb(): Promise<void> {
  if ((window as any).playwrightWeb) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL || '/'}pw-web.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load pw-web.js'));
    document.head.appendChild(script);
  });
}

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
  session: WorkbenchTerminalSession;
  currentLine: string;
  history: string[];
  historyIndex: number;
  runningAbortController: AbortController | null;
  closable: boolean;
  kind: 'user' | 'preview' | 'claude';
  inputMode: 'managed' | 'passthrough';
}

interface WorkbenchTerminalSession {
  run?: (
    command: string,
    options?: {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      signal?: AbortSignal;
      interactive?: boolean;
    },
  ) => Promise<RunResult>;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  abort: () => void;
  dispose: () => void;
  getState: () => { cwd: string; env: Record<string, string>; running: boolean };
}

function getWorkbenchCorsProxyUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    return undefined;
  }

  return `${window.location.origin}/__api/cors-proxy?url=`;
}

export class WebIDEHost {
  private static readonly defaultCorsProxyUrl = getWorkbenchCorsProxyUrl();
  readonly container;
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
  private readonly keychain: Keychain;
  private keychainStatusEntry: IStatusbarEntryAccessor | null = null;
  private claudeCodeInstallPromise: Promise<void> | null = null;
  private workspaceDependencyInstallPromise: Promise<void> | null = null;
  private readonly templateId: TemplateId;
  private readonly initialProjectFiles: SerializedFile[] | null;
  private readonly skipWorkspaceSeed: boolean;
  private readonly deferPreviewStart: boolean;
  private readonly desktopBridge: DesktopBridge | null;
  private readonly hostProjectDirectory: string | null;
  private readonly agentLaunchCommand: string | null;
  private readonly agentMode: 'browser' | 'host';
  private readonly databaseSurface: DatabaseSidebarSurface;
  private readonly databaseBrowserSurface: DatabaseBrowserSurface;
  private readonly keychainSurface: KeychainSidebarSurface;
  private pgliteMiddleware: import('almostnode/internal').RequestMiddleware | null = null;
  private readonly testsSurface = new TestsSidebarSurface();
  private testRecorder: import('../features/test-recorder').TestRecorder | null = null;
  private testRunner: import('../features/test-runner').TestRunner | null = null;
  private testMetadataList: import('../features/test-spec-generator').TestMetadata[] = [];
  // testStepsMap removed — pw-web.js reads spec files directly from VFS
  private removePlaywrightListener: (() => void) | null = null;
  private removeCursorOverlay: (() => void) | null = null;

  constructor(private readonly options: WebIDEHostOptions) {
    this.container = createContainer({
      baseUrl: options.baseUrl,
      basePath: import.meta.env.BASE_URL?.replace(/\/$/, '') || '',
      cwd: WORKSPACE_ROOT,
      env: WebIDEHost.defaultCorsProxyUrl
        ? { CORS_PROXY_URL: WebIDEHost.defaultCorsProxyUrl }
        : undefined,
    });
    this.templateId = options.template || 'vite';
    this.initialProjectFiles = options.initialProjectFiles ?? null;
    this.skipWorkspaceSeed = options.skipWorkspaceSeed === true;
    this.deferPreviewStart = options.deferPreviewStart === true;
    this.desktopBridge = options.desktopBridge ?? null;
    this.hostProjectDirectory = options.hostProjectDirectory ?? null;
    this.agentMode = this.desktopBridge ? 'host' : 'browser';
    this.agentLaunchCommand = options.agentLaunchCommand ?? (this.agentMode === 'host' ? 'claude' : null);
    this.marketplaceMode = options.marketplaceMode || 'open-vsx';
    this.debugSections = Array.from(new Set((options.debugSections || []).map((section) => section.trim()).filter(Boolean)));
    this.filesSurface = new FilesSidebarSurface(this.container.vfs, WORKSPACE_ROOT, (path) => {
      void this.openWorkspaceFile(path);
    }, (path) => {
      void this.openWorkspaceFileAsText(path);
    });
    this.previewSurface = new PreviewSurface({
      run: () => {
        void this.runPreviewCommand(this.getDefaults().runCommand);
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
    this.databaseSurface = new DatabaseSidebarSurface();
    this.databaseBrowserSurface = new DatabaseBrowserSurface();
    this.keychainSurface = new KeychainSidebarSurface();
    this.workbenchSurfaces = registerWorkbenchSurfaces({
      filesSurface: this.filesSurface,
      previewSurface: this.previewSurface,
      terminalSurface: this.terminalSurface,
      claudeSurface: this.claudeSurface,
      databaseBrowserSurface: this.databaseBrowserSurface,
      keychainSurface: this.keychainSurface,
      vfs: this.container.vfs,
      openFileAsText: (path: string) => void this.openWorkspaceFileAsText(path),
    });
    this.keychain = new Keychain({
      vfs: this.container.vfs,
      overlayRoot: options.elements.workbench.parentElement ?? options.elements.workbench,
      onStateChange: (state) => {
        this.updateKeychainStatusEntry(state);
        this.updateKeychainSurface(state);
      },
    });
    this.keychainSurface.setActionHandler((action) => {
      switch (action) {
        case 'unlock': void this.unlockKeychain(); break;
        case 'save': void this.unlockKeychain(); break;
        case 'forget': void this.forgetKeychain(); break;
        case 'login:github': void this.keychainAuthAction('gh auth login'); break;
        case 'logout:github': void this.keychainAuthAction('gh auth logout'); break;
        case 'login:replay': void this.keychainAuthAction('replayio login'); break;
        case 'logout:replay': void this.keychainAuthAction('replayio logout'); break;
      }
    });
    this.keychain.registerSlot('claude', [
      CLAUDE_AUTH_CREDENTIALS_PATH,
      CLAUDE_AUTH_CONFIG_PATH,
      CLAUDE_LEGACY_CONFIG_PATH,
    ]);
    this.keychain.registerSlot('github', [
      '/home/user/.config/gh/hosts.yml',
    ]);
    this.keychain.registerSlot('replay', [
      '/home/user/.replay/auth.json',
    ]);
  }

  static async bootstrap(options: WebIDEHostOptions): Promise<WebIDEHost> {
    const host = new WebIDEHost(options);
    await host.init();
    return host;
  }

  private get workbench(): HTMLElement {
    return this.options.elements.workbench;
  }

  /** Returns defaultFile + runCommand for the active template or reference app. */
  getDefaults(): { defaultFile: string; runCommand: string } {
    if (this.options.referenceApp) {
      return {
        defaultFile: `${WORKSPACE_ROOT}/${this.options.referenceApp.defaultFile}`,
        runCommand: this.options.referenceApp.runCommand,
      };
    }
    return getTemplateDefaults(this.templateId);
  }

  get terminal(): Terminal {
    return this.requireActiveTerminalTab().terminal;
  }

  private normalizeHostPath(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  private resolveBridgeWorkspaceCwd(candidate: string | null | undefined): string {
    if (!this.hostProjectDirectory || typeof candidate !== 'string' || !candidate.trim()) {
      return WORKSPACE_ROOT;
    }

    const projectDirectory = this.normalizeHostPath(this.hostProjectDirectory);
    const resolvedCandidate = this.normalizeHostPath(candidate);
    if (resolvedCandidate === projectDirectory) {
      return WORKSPACE_ROOT;
    }

    const projectPrefix = `${projectDirectory}/`;
    if (!resolvedCandidate.startsWith(projectPrefix)) {
      return WORKSPACE_ROOT;
    }

    const relativePath = resolvedCandidate.slice(projectPrefix.length).replace(/^\/+/, '');
    if (!relativePath) {
      return WORKSPACE_ROOT;
    }

    const segments = relativePath.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
    if (segments.length === 0) {
      return WORKSPACE_ROOT;
    }

    return `${WORKSPACE_ROOT}/${segments.join('/')}`;
  }

  private normalizeBridgedCommand(command: string): string {
    const trimmed = command.trim();
    if (!trimmed || !this.hostProjectDirectory) {
      return trimmed;
    }

    const hostProjectDirectory = this.normalizeHostPath(this.hostProjectDirectory);
    return trimmed.split(hostProjectDirectory).join(WORKSPACE_ROOT);
  }

  async executeBridgedCommand(params: Record<string, unknown>): Promise<BridgedCommandResult> {
    const command = typeof params.command === 'string' ? params.command.trim() : '';
    if (!command) {
      throw new Error('Bridged command payload is missing a command.');
    }

    const background = params.background === true;
    const vfsCwd = this.resolveBridgeWorkspaceCwd(typeof params.cwd === 'string' ? params.cwd : null);
    const normalizedCommand = this.normalizeBridgedCommand(command);

    if (background) {
      const session = this.container.createTerminalSession({ cwd: vfsCwd });
      void session.run(normalizedCommand, { interactive: true }).finally(() => {
        session.dispose();
      });
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        background: true,
        normalizedCommand,
        vfsCwd,
      };
    }

    const result = await this.container.run(normalizedCommand, { cwd: vfsCwd });
    return {
      ...result,
      background: false,
      normalizedCommand,
      vfsCwd,
    };
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
    void this.runPreviewCommand(this.getDefaults().runCommand)
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

  ensurePreviewReady(): void {
    this.ensurePreviewServerRunning();
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
      inputMode: 'managed',
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
    if (this.agentMode === 'host') {
      return this.createHostAgentTerminalTab(focus);
    }

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
      inputMode: 'managed',
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
    const state = this.keychain.getState();
    if (state.hasStoredVault && !state.hasLiveCredentials) {
      try {
        await this.keychain.handlePrimaryAction();
      } catch {
        terminal.write('Keychain unlock failed. You can retry from the status bar.\r\n');
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

  private async createHostAgentTerminalTab(focus: boolean): Promise<TerminalTabState> {
    if (!this.desktopBridge) {
      throw new Error('Host agent mode requires a desktop bridge.');
    }

    this.claudeTerminalCounter += 1;
    const id = `agent-${crypto.randomUUID()}`;
    const { terminal, fitAddon } = this.createTerminalInstance();
    const session = new HostTerminalSession(this.desktopBridge);
    const tab: TerminalTabState = {
      id,
      title: `Agent ${this.claudeTerminalCounter}`,
      terminal,
      fitAddon,
      session,
      currentLine: '',
      history: [],
      historyIndex: -1,
      runningAbortController: null,
      closable: true,
      kind: 'claude',
      inputMode: 'passthrough',
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
    this.updateTerminalStatus(tab, 'Starting host agent shell...');
    try {
      const { shell, cwd } = await session.init({
        cols: terminal.cols,
        rows: terminal.rows,
        cwd: this.hostProjectDirectory ?? undefined,
        initialCommand: this.agentLaunchCommand,
        routeCommandsToBridge: true,
      });

      session.onData((data) => {
        terminal.write(normalizeTerminalOutput(data));
      });
      session.onExit(({ exitCode, signal }) => {
        const signalSuffix = signal ? `, signal ${signal}` : '';
        this.updateTerminalStatus(tab, `Exited ${exitCode}${signalSuffix}`);
      });

      terminal.write(`Host shell: ${shell}\r\n`);
      terminal.write(`CWD: ${cwd}\r\n`);
      terminal.write('almostnode bridge routing is enabled for shell commands.\r\n');
      if (this.agentLaunchCommand) {
        terminal.write(`Launching ${this.agentLaunchCommand} with bridge routing enabled...\r\n`);
      } else {
        terminal.write('Try: claude | codex | opencode | cursor-cli\r\n');
      }
      this.updateTerminalStatus(tab, this.agentLaunchCommand ? `Launching ${this.agentLaunchCommand}` : 'Host shell ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.write(`Failed to start host shell: ${message}\r\n`);
      this.updateTerminalStatus(tab, 'Host shell failed');
    } finally {
      this.claudeSurface.hideLoading();
    }

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

  async revealKeychainPanel(): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.SIDEBAR_PART, true);
    await paneCompositeService.openPaneComposite(this.workbenchSurfaces.keychainViewId, ViewContainerLocation.Sidebar, true);
    this.updateKeychainSurface();
  }

  private updateKeychainSurface(state = this.keychain.getState()): void {
    this.keychainSurface.update(
      [
        { name: 'claude', label: 'Claude Code', active: this.keychain.hasSlotData('claude') },
        { name: 'github', label: 'GitHub', active: this.keychain.hasSlotData('github'), canAuth: true },
        { name: 'replay', label: 'Replay.io', active: this.keychain.hasSlotData('replay'), canAuth: true },
      ],
      { hasStoredVault: state.hasStoredVault, supported: state.supported },
    );
  }

  private async keychainAuthAction(command: string): Promise<void> {
    await this.revealTerminalPanel(true);
    const tab = this.createUserTerminalTab(true);
    await this.runCommand(tab, command, { echoCommand: true });
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

    if (!await this.keychain.prepareForCommand(trimmed)) {
      this.updateTerminalStatus(tab, 'Keychain unlock required');
      this.writeTerminal(tab, 'Keychain unlock is required before running this command.\n');
      this.printPrompt(tab);
      return;
    }

    if (tab.runningAbortController) {
      throw new Error(`${tab.title} is already running a command`);
    }
    if (!tab.session.run) {
      this.updateTerminalStatus(tab, 'Host shell attached');
      this.writeTerminal(tab, 'This terminal is attached directly to the host shell.\n');
      return;
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
    const resolved = command || window.prompt('Command to run', this.getDefaults().runCommand) || '';
    await this.runCommand(this.requireActiveTerminalTab(), resolved, { echoCommand: true });
  }

  private async runPreviewCommand(command: string): Promise<void> {
    await this.ensureWorkspaceDependenciesInstalled();
    await this.runCommand(this.getPreviewTerminalTab(), command);
  }

  async unlockKeychain(): Promise<void> {
    await this.keychain.handlePrimaryAction();
  }

  forgetKeychain(): void {
    this.keychain.forgetSavedVault();
  }

  getKeychainState(): KeychainState {
    return this.keychain.getState();
  }

  private async openWorkspaceFile(path: string): Promise<void> {
    const lowerPath = path.toLowerCase();

    // Route .md files to rendered markdown editor
    if (lowerPath.endsWith('.md')) {
      const editorService = await getService(IEditorService);
      const input = this.workbenchSurfaces.renderedEditors.createMarkdownInput(path);
      await editorService.openEditor(input, { pinned: true });
      return;
    }

    // Route .json files to visual JSON editor
    if (lowerPath.endsWith('.json')) {
      const editorService = await getService(IEditorService);
      const input = this.workbenchSurfaces.renderedEditors.createJsonInput(path);
      await editorService.openEditor(input, { pinned: true });
      return;
    }

    await this.openWorkspaceFileAsText(path);
  }

  private async openWorkspaceFileAsText(path: string): Promise<void> {
    const editorService = await getService(IEditorService);
    const languageId = inferWorkbenchLanguageId(path);

    try {
      await editorService.openEditor({
        resource: URI.file(path),
        options: {
          pinned: true,
        },
      });
    } catch {
      // Fallback: if instanceof URI fails due to Vite module identity mismatch,
      // dynamically import the URI class from the internal source path (bypassing
      // the resolve alias) to get the same module instance that Monaco uses internally.
      const { URI: InternalURI } = await import(
        /* @vite-ignore */
        '@codingame/monaco-vscode-api/vscode/src/vs/base/common/uri.js'
      );
      await editorService.openEditor({
        resource: InternalURI.file(path),
        options: {
          pinned: true,
        },
      });
    }

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

  private async revealDatabaseEditor(): Promise<void> {
    const editorService = await getService(IEditorService);
    const existing = this.workbenchSurfaces.databaseInput.resource
      ? editorService.findEditors(this.workbenchSurfaces.databaseInput.resource).find((identifier) => {
          return identifier.editor.matches(this.workbenchSurfaces.databaseInput);
        })
      : undefined;

    await editorService.openEditor(
      this.workbenchSurfaces.databaseInput,
      {
        pinned: true,
      },
      existing?.groupId,
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

  private createSearchProvider(): WorkspaceSearchProvider {
    return {
      search: async (options) => {
        const searchService = await getService(ISearchService);
        const start = Date.now();

        // Wait for search provider to initialize (same retry as searchWorkspaceText)
        while (!searchService.schemeHasFileSearchProvider('file') && Date.now() - start < 5000) {
          await delay(100);
        }

        let lastError: unknown = null;
        while (Date.now() - start < 5000) {
          try {
            const folderUri = URI.file(options.folderPath);
            const query: Parameters<typeof searchService.textSearch>[0] = {
              type: QueryType.Text,
              folderQueries: [{ folder: folderUri }],
              contentPattern: {
                pattern: options.pattern,
                isRegExp: options.isRegExp,
                isCaseSensitive: options.isCaseSensitive,
                isWordMatch: options.isWordMatch,
              },
              previewOptions: {
                matchLines: 1,
                charsPerLine: 10000,
              },
              maxResults: options.maxResults ?? 10000,
              surroundingContext: options.surroundingContext,
            };

            if (options.includePattern) {
              const patterns: Record<string, boolean> = {};
              for (const p of options.includePattern.split(',')) {
                if (p.trim()) patterns[p.trim()] = true;
              }
              query.includePattern = patterns;
            }
            if (options.excludePattern) {
              const patterns: Record<string, boolean> = {};
              for (const p of options.excludePattern.split(',')) {
                if (p.trim()) patterns[p.trim()] = true;
              }
              query.excludePattern = patterns;
            }

            const searchResult = await searchService.textSearch(query);

            // Map VS Code results → WorkspaceSearchResult
            const resultFiles: Array<{
              filePath: string;
              matches: Array<{
                lineNumber: number;
                lineText: string;
                matchStart: number;
                matchEnd: number;
              }>;
            }> = [];

            for (const fileMatch of searchResult.results) {
              const filePath = fileMatch.resource.path;
              const matches: Array<{
                lineNumber: number;
                lineText: string;
                matchStart: number;
                matchEnd: number;
              }> = [];

              if (fileMatch.results) {
                for (const textResult of fileMatch.results) {
                  // ITextSearchMatch has rangeLocations + previewText
                  // ITextSearchContext has text + lineNumber
                  if ('rangeLocations' in textResult && textResult.rangeLocations) {
                    const match = textResult as { rangeLocations: Array<{ source: { startLineNumber: number; startColumn: number; endColumn: number }; preview: { startColumn: number; endColumn: number } }>; previewText: string };
                    for (const rangePair of match.rangeLocations) {
                      matches.push({
                        lineNumber: rangePair.source.startLineNumber,
                        lineText: match.previewText,
                        matchStart: rangePair.preview.startColumn,
                        matchEnd: rangePair.preview.endColumn,
                      });
                    }
                  }
                }
              }

              if (matches.length > 0) {
                resultFiles.push({ filePath, matches });
              }
            }

            return {
              files: resultFiles,
              limitHit: searchResult.limitHit ?? false,
            };
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
          : new Error('Search provider did not initialize.');
      },
    };
  }

  private bindTerminal(tab: TerminalTabState): void {
    if (tab.inputMode === 'passthrough') {
      tab.terminal.onData((data) => {
        tab.session.sendInput(data);
      });
      return;
    }

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

  private buildKeychainStatusEntry(state = this.keychain.getState()): IStatusbarEntry {
    if (state.busy) {
      return {
        name: 'Keychain',
        text: '$(sync~spin) Keychain',
        ariaLabel: 'Keychain action in progress',
        tooltip: 'Keychain action in progress',
        command: 'almostnode.keychain.primary',
      };
    }

    if (!state.supported) {
      return {
        name: 'Keychain',
        text: '$(shield) Keychain',
        ariaLabel: 'Keychain unavailable',
        tooltip: 'Passkey-backed keychain is unavailable in this browser.',
        command: 'almostnode.keychain.primary',
      };
    }

    if (state.hasStoredVault && !state.hasLiveCredentials) {
      return {
        name: 'Keychain',
        text: '$(lock) Keychain',
        ariaLabel: 'Unlock saved keychain',
        tooltip: 'Unlock the saved keychain for this browser.',
        command: 'almostnode.keychain.primary',
      };
    }

    if (state.hasLiveCredentials && !state.hasStoredVault) {
      return {
        name: 'Keychain',
        text: '$(key) Save Keychain',
        ariaLabel: 'Save keychain',
        tooltip: 'Save credentials for this browser with a passkey.',
        command: 'almostnode.keychain.primary',
      };
    }

    return {
      name: 'Keychain',
      text: state.hasStoredVault ? '$(shield) Keychain Saved' : '$(shield) Keychain',
      ariaLabel: state.hasStoredVault ? 'Keychain is saved for this browser' : 'Keychain',
      tooltip: state.hasStoredVault
        ? 'Keychain is available for this browser.'
        : 'No keychain has been saved for this browser.',
      command: 'almostnode.keychain.primary',
    };
  }

  private updateKeychainStatusEntry(state = this.keychain.getState()): void {
    this.keychainStatusEntry?.update(this.buildKeychainStatusEntry(state));
  }

  private async registerStatusbarEntries(): Promise<void> {
    const statusbarService = await getService(IStatusbarService);
    const agentLabel = this.agentMode === 'host' ? 'Agents' : 'Claude Code';
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
        name: agentLabel,
        text: `$(sparkle) ${agentLabel}`,
        ariaLabel: `Open ${agentLabel}`,
        tooltip: this.agentMode === 'host' ? 'Open the host agent panel' : 'Open the Claude Code panel',
        command: 'almostnode.claude.open',
      },
      'almostnode.status.claude',
      StatusbarAlignment.LEFT,
      { primary: 997, secondary: 997 },
    );

    if (this.agentMode === 'browser') {
      this.keychainStatusEntry = statusbarService.addEntry(
        this.buildKeychainStatusEntry(),
        'almostnode.status.keychain',
        StatusbarAlignment.LEFT,
        { primary: 996, secondary: 996 },
      );
    }
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
        ...getLogServiceOverride(),
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
            id: 'almostnode.keychain.primary',
            label: 'Almostnode: Open Keychain',
            handler: () => this.revealKeychainPanel(),
          },
          {
            id: 'almostnode.keychain.unlock',
            label: 'Almostnode: Unlock Keychain',
            menu: Menu.CommandPalette,
            handler: () => this.unlockKeychain(),
          },
          {
            id: 'almostnode.keychain.forget',
            label: 'Almostnode: Forget Keychain',
            menu: Menu.CommandPalette,
            handler: () => this.forgetKeychain(),
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

  private async initPGliteIfNeeded(): Promise<void> {
    const schemaPath = `${WORKSPACE_ROOT}/schema.sql`;
    const hasSchema = this.container.vfs.existsSync(schemaPath);
    const hasDrizzleDir = (() => { try { return this.container.vfs.statSync(`${WORKSPACE_ROOT}/drizzle`).isDirectory(); } catch { return false; } })();

    // Import db-manager lazily
    const { listDatabases, ensureDefaultDatabase, getIdbPath, getActiveDatabase, setActiveDatabase, createDatabase, deleteDatabase } = await import('../../../../packages/almostnode/src/pglite/db-manager');
    const hasExistingDbs = listDatabases().length > 0;

    if (!hasSchema && !hasDrizzleDir && !hasExistingDbs) {
      // No database needed
      return;
    }

    try {
      // Register database sidebar view (workbench is already initialized at this point)
      const { registerCustomView } = await import('@codingame/monaco-vscode-workbench-service-override');
      registerCustomView({
        id: 'almostnode.sidebar.database',
        name: 'Database',
        location: ViewContainerLocation.Sidebar,
        order: 1,
        icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>'),
        renderBody: (container) => this.databaseSurface.attach(container),
      });

      const activeName = ensureDefaultDatabase();

      // Load PGlite and init instance (with migration support)
      const { initAndMigrate } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
      await initAndMigrate(activeName, this.container.vfs, getIdbPath(activeName));
      console.log(`[pglite] Database "${activeName}" ready`);

      // Register middleware
      const { createPGliteMiddleware } = await import('../../../../packages/almostnode/src/pglite/bridge-middleware');
      this.pgliteMiddleware = createPGliteMiddleware();
      this.container.serverBridge.registerMiddleware(this.pgliteMiddleware);

      // Set active DB on preview surface
      this.previewSurface.setActiveDb(activeName);

      // Update database panel
      this.databaseSurface.update(listDatabases(), activeName);

      // Set up database browser query handler
      this.databaseBrowserSurface.setQueryHandler(async (operation, body, dbName) => {
        const { handleDatabaseRequest } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
        return handleDatabaseRequest(operation, body, dbName);
      });

      // Wire database panel callbacks
      this.databaseSurface.setCallbacks({
        onOpen: async (name: string) => {
          try {
            // Switch active database if different
            const currentActive = getActiveDatabase();
            if (currentActive !== name) {
              const { closePGliteInstance, initAndMigrate: initMigrate } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
              if (currentActive) await closePGliteInstance(currentActive);
              setActiveDatabase(name);
              await initMigrate(name, this.container.vfs, getIdbPath(name));
              this.previewSurface.setActiveDb(name);
              this.databaseSurface.update(listDatabases(), name);
            }
            // Update browser surface and open tab
            this.databaseBrowserSurface.setDatabase(name);
            await this.revealDatabaseEditor();
          } catch (err) {
            console.error('[pglite] Open database browser failed:', err);
          }
        },
        onSwitch: async (name: string) => {
          try {
            const { closePGliteInstance, initAndMigrate: initMigrate } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
            const oldActive = getActiveDatabase();
            if (oldActive) await closePGliteInstance(oldActive);
            setActiveDatabase(name);
            await initMigrate(name, this.container.vfs, getIdbPath(name));
            this.previewSurface.setActiveDb(name);
            this.databaseSurface.update(listDatabases(), name);
            console.log(`[pglite] Switched to database "${name}"`);
          } catch (err) {
            console.error('[pglite] Switch failed:', err);
          }
        },
        onCreate: async (name: string) => {
          try {
            createDatabase(name);
            const { initAndMigrate: initMigrate } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
            await initMigrate(name, this.container.vfs, getIdbPath(name));
            this.databaseSurface.update(listDatabases(), getActiveDatabase());
            console.log(`[pglite] Created database "${name}"`);
          } catch (err) {
            console.error('[pglite] Create failed:', err);
          }
        },
        onDelete: async (name: string) => {
          try {
            const { closePGliteInstance: closeInst } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
            await closeInst(name);
            deleteDatabase(name);
            const active = getActiveDatabase();
            if (!active || active === name) {
              const newActive = ensureDefaultDatabase();
              const { initAndMigrate: initMigrate } = await import('../../../../packages/almostnode/src/pglite/pglite-database');
              await initMigrate(newActive, this.container.vfs, getIdbPath(newActive));
              this.previewSurface.setActiveDb(newActive);
            }
            this.databaseSurface.update(listDatabases(), getActiveDatabase());
            console.log(`[pglite] Deleted database "${name}"`);
          } catch (err) {
            console.error('[pglite] Delete failed:', err);
          }
        },
      });
    } catch (err) {
      console.error('[pglite] Init failed:', err);
    }
  }

  private async ensureGitInitialized(): Promise<void> {
    if (this.container.vfs.existsSync(`${WORKSPACE_ROOT}/.git`)) return;
    await this.container.run('git init', { cwd: WORKSPACE_ROOT });
    await this.container.run('git add -A', { cwd: WORKSPACE_ROOT });
    await this.container.run('git commit -m "Initial commit"', { cwd: WORKSPACE_ROOT });
  }

  private migrateLegacyTestsToWorkspace(): void {
    const vfs = this.container.vfs;

    if (!vfs.existsSync(LEGACY_TESTS_ROOT)) {
      return;
    }

    if (vfs.existsSync(LEGACY_TEST_E2E_ROOT) && !vfs.existsSync(WORKSPACE_TEST_E2E_ROOT)) {
      if (!vfs.existsSync(WORKSPACE_TESTS_ROOT)) {
        vfs.mkdirSync(WORKSPACE_TESTS_ROOT, { recursive: true });
      }
      vfs.renameSync(LEGACY_TEST_E2E_ROOT, WORKSPACE_TEST_E2E_ROOT);
    }

    if (vfs.existsSync(LEGACY_TEST_METADATA_PATH) && !vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)) {
      const raw = vfs.readFileSync(LEGACY_TEST_METADATA_PATH, 'utf8') as string;
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.tests)) {
          data.tests = data.tests.map((test: Record<string, unknown>) => {
            const specPath = typeof test.specPath === 'string'
              ? test.specPath.replace(LEGACY_TEST_E2E_ROOT, WORKSPACE_TEST_E2E_ROOT)
              : test.specPath;
            return { ...test, specPath };
          });
          if (!vfs.existsSync(WORKSPACE_TESTS_ROOT)) {
            vfs.mkdirSync(WORKSPACE_TESTS_ROOT, { recursive: true });
          }
          vfs.writeFileSync(WORKSPACE_TEST_METADATA_PATH, JSON.stringify(data, null, 2));
        }
      } catch {
        // Ignore malformed legacy metadata and leave it in place.
      }
    }

    try {
      if (vfs.existsSync(LEGACY_TEST_METADATA_PATH) && vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)) {
        vfs.unlinkSync(LEGACY_TEST_METADATA_PATH);
      }
    } catch {
      // Ignore cleanup failures.
    }

    try {
      if (vfs.existsSync(LEGACY_TESTS_ROOT) && vfs.readdirSync(LEGACY_TESTS_ROOT).length === 0) {
        vfs.rmdirSync(LEGACY_TESTS_ROOT);
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  private async init(): Promise<void> {
    const logMemory = (label: string) => {
      if ((performance as any).memory) {
        const m = (performance as any).memory;
        console.log(`[memory] ${label}: ${(m.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(m.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB`);
      }
    };

    logMemory('before workspace seed');
    if (this.initialProjectFiles && this.initialProjectFiles.length > 0) {
      loadProjectFilesIntoVfs(this.container.vfs, this.initialProjectFiles);
    } else if (this.skipWorkspaceSeed) {
      this.container.vfs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    } else if (this.options.referenceApp) {
      seedReferenceApp(this.container, this.options.referenceApp);
    } else {
      seedWorkspace(this.container, this.templateId);
    }
    this.migrateLegacyTestsToWorkspace();
    await this.ensureGitInitialized();

    this.installWorkerEnvironment();
    const initialTab = this.createUserTerminalTab(false);
    await this.keychain.init();
    this.container.setKeychain(this.keychain);
    this.container.setSearchProvider(this.createSearchProvider());
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

    logMemory('before service worker init');
    try {
      await this.container.serverBridge.initServiceWorker();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to initialize service worker';
      this.updatePreviewStatus(message);
    }

    logMemory('before workbench init');
    await this.initWorkbench();
    logMemory('after workbench init');

    // ── PGlite database initialization (after workbench is ready) ──
    void this.initPGliteIfNeeded();

    // ── Test recorder initialization (after workbench is ready) ──
    void this.initTestRecorder();

    if (!this.deferPreviewStart) {
      this.ensurePreviewServerRunning();
    }
    window.__almostnodeWebIDE = this;

    logMemory('before claude boot');
    // Feature flag: skip Claude Code auto-boot to reduce memory pressure (e.g. on GitHub Pages)
    const skipClaude = new URLSearchParams(window.location.search).has('no-claude');
    if (!skipClaude && this.agentMode === 'host') {
      void this.revealClaudePanel(false);
      return;
    }

    if (!skipClaude) {
      // Show Claude loading splash immediately so it's visible during WebAuthn
      this.claudeSurface.showLoading();

      // Auto-start Claude Code: if there's a stored API key, prompt WebAuthn
      // to unlock it, then start a Claude Code session
      const claudeState = this.keychain.getState();
      if (claudeState.hasStoredVault && !claudeState.hasLiveCredentials) {
        this.keychain.handlePrimaryAction().then(() => {
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

  }

  private async ensureClaudeCodeInstalled(onProgress?: (message: string) => void): Promise<void> {
    if (this.container.vfs.existsSync(CLAUDE_CODE_PACKAGE_PATH)) {
      return;
    }

    if (!this.claudeCodeInstallPromise) {
      this.claudeCodeInstallPromise = this.container.npm.install('@anthropic-ai/claude-code', {
        save: false,
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

  private async ensureWorkspaceDependenciesInstalled(): Promise<void> {
    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    const nodeModulesPath = `${WORKSPACE_ROOT}/node_modules`;

    if (!this.container.vfs.existsSync(packageJsonPath)) {
      return;
    }
    if (this.container.vfs.existsSync(nodeModulesPath)) {
      return;
    }

    if (!this.workspaceDependencyInstallPromise) {
      this.workspaceDependencyInstallPromise = this.container.npm.installFromPackageJson({
        onProgress: (message) => {
          const previewTab = this.previewTerminalTabId ? this.terminalTabs.get(this.previewTerminalTabId) : null;
          if (previewTab) {
            this.updateTerminalStatus(previewTab, message);
          }
        },
      }).then(() => undefined).catch((error) => {
        this.workspaceDependencyInstallPromise = null;
        throw error;
      });
    }

    await this.workspaceDependencyInstallPromise;
  }

  // ── Test Recorder / Runner ──────────────────────────────────────────────────

  private async initTestRecorder(): Promise<void> {
    const { TestRecorder } = await import('../features/test-recorder');
    const { onPlaywrightCommand } = await import('../../../../packages/almostnode/src/shims/playwright-command');
    const { initToasts, showTestDetectedToast, showTestSavedToast, showTestResultToast } = await import('../features/toast');

    // Mount toast system
    const workbenchEl = this.options.elements.workbench;
    initToasts(workbenchEl.parentElement ?? workbenchEl);

    // Create recorder
    const recorder = new TestRecorder();
    this.testRecorder = recorder;

    recorder.setCallbacks({
      onTestDetected: () => {
        showTestDetectedToast({
          onSave: (name) => void this.saveDetectedTest(name),
          onDismiss: () => recorder.reset(),
        });
      },
      onStepRecorded: () => {
        // Could update UI in real-time if needed
      },
    });

    // Subscribe to playwright commands
    this.removePlaywrightListener = onPlaywrightCommand((subcommand, args, result, selectorContext) => {
      recorder.recordCommand(subcommand, args, result, selectorContext);
    });

    // Cursor overlay — animated agent cursor on preview
    const { initCursorOverlay } = await import('../features/cursor-overlay');
    this.removeCursorOverlay = initCursorOverlay(
      this.previewSurface.getBody(),
      onPlaywrightCommand,
    );

    // Register tests sidebar view (workbench is already initialized)
    const { registerCustomView } = await import('@codingame/monaco-vscode-workbench-service-override');
    registerCustomView({
      id: 'almostnode.sidebar.tests',
      name: 'Tests',
      location: ViewContainerLocation.Sidebar,
      order: 2,
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>'),
      renderBody: (container) => this.testsSurface.attach(container),
    });

    // Wire sidebar callbacks
    this.testsSurface.setCallbacks({
      onRun: (id) => void this.runTest(id),
      onRunAll: () => void this.runAllTests(),
      onDelete: (id) => this.deleteTest(id),
      onOpen: (id) => void this.openTestSpec(id),
    });

    // Load saved test metadata
    this.loadTestMetadata();

    const { registerTestCodeLens } = await import('../features/test-codelens');
    registerTestCodeLens({
      getTests: () => this.testMetadataList,
      onRunTest: (id) => void this.runTest(id),
    });

    console.log('[test-recorder] Initialized');
  }

  private async saveDetectedTest(name: string): Promise<void> {
    if (!this.testRecorder) return;

    const steps = this.testRecorder.finalize();
    if (steps.length === 0) return;

    const { generateTestSpec, generateTestId } = await import('../features/test-spec-generator');
    const { showTestSavedToast } = await import('../features/toast');

    const testId = generateTestId();
    const specContent = generateTestSpec(name, steps);
    const specPath = `${WORKSPACE_TEST_E2E_ROOT}/${name.replace(/[^a-zA-Z0-9_-]/g, '-')}.spec.ts`;

    // Ensure directory exists
    const dir = specPath.substring(0, specPath.lastIndexOf('/'));
    if (!this.container.vfs.existsSync(dir)) {
      this.container.vfs.mkdirSync(dir, { recursive: true });
    }

    // Write spec file
    this.container.vfs.writeFileSync(specPath, specContent);

    // Store metadata (no steps — pw-web.js reads spec files directly)
    const metadata: import('../features/test-spec-generator').TestMetadata = {
      id: testId,
      name,
      specPath,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.testMetadataList.push(metadata);

    // Persist metadata
    this.saveTestMetadata();

    // Update sidebar
    this.testsSurface.update(
      this.testMetadataList.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    );

    showTestSavedToast(name, specPath);
    console.log(`[test-recorder] Test "${name}" saved to ${specPath}`);
  }

  private async runTest(testId: string): Promise<void> {
    const metadata = this.testMetadataList.find((m) => m.id === testId);
    if (!metadata) return;

    // Load pw-web.js if not already loaded
    await loadPwWeb();

    // Ensure runner exists
    if (!this.testRunner) {
      const { TestRunner } = await import('../features/test-runner');
      const devUrl = this.previewUrl || `/__virtual__/${this.previewPort || 5173}/`;
      this.testRunner = new TestRunner(this.container.vfs, devUrl);
    }

    // Create a test runner tab in the terminal panel
    const runnerEl = document.createElement('div');
    runnerEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:8px;height:100%;overflow:auto;align-content:start;background:#071018;color:#ccc;font-family:monospace;font-size:12px;';

    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'width:100%;padding:4px 8px;';
    statusLine.textContent = `Running test: ${metadata.name}...`;
    runnerEl.appendChild(statusLine);

    const tabId = `test-run-${testId.slice(0, 8)}`;
    this.terminalSurface.addCustomTab({
      id: tabId,
      title: `Test: ${metadata.name}`,
      element: runnerEl,
      closable: true,
    });
    this.setActiveTerminalTab(tabId);

    // Update status
    metadata.status = 'running';
    this.testsSurface.updateTestStatus(testId, 'running');

    this.testRunner.setCallbacks({
      onTestStart: () => {
        statusLine.textContent = `Running: ${metadata.name}`;
      },
      onTestComplete: (id, result) => {
        const status = result.passed ? 'passed' : 'failed';
        metadata.status = status;
        metadata.lastRunAt = new Date().toISOString();
        if (result.error) metadata.error = result.error;
        this.testsSurface.updateTestStatus(id, status);
        this.saveTestMetadata();

        // Show result in the tab
        statusLine.textContent = '';
        const resultEl = document.createElement('div');
        resultEl.style.cssText = 'width:100%;';

        const header = document.createElement('div');
        header.style.cssText = `padding:8px;font-weight:bold;color:${result.passed ? '#4ec9b0' : '#e06c75'};`;
        header.textContent = `${result.passed ? 'PASSED' : 'FAILED'} - ${metadata.name} (${result.duration}ms)`;
        resultEl.appendChild(header);

        for (const step of result.steps) {
          const stepEl = document.createElement('div');
          stepEl.style.cssText = `padding:2px 16px;color:${step.status === 'passed' ? '#98c379' : '#e06c75'};`;
          stepEl.textContent = `${step.status === 'passed' ? '\u2713' : '\u2717'} ${step.description}`;
          if (step.error) {
            const errEl = document.createElement('div');
            errEl.style.cssText = 'padding:2px 32px;color:#e06c75;font-style:italic;';
            errEl.textContent = step.error;
            stepEl.appendChild(errEl);
          }
          resultEl.appendChild(stepEl);
        }

        if (result.error) {
          const errSummary = document.createElement('div');
          errSummary.style.cssText = 'padding:8px;color:#e06c75;';
          errSummary.textContent = `Error: ${result.error}`;
          resultEl.appendChild(errSummary);
        }

        runnerEl.appendChild(resultEl);
      },
      onProgress: () => {},
    });

    this.testRunner.setHostContainer(runnerEl);

    const { showTestResultToast } = await import('../features/toast');
    const result = await this.testRunner.runTest(metadata.specPath, metadata.name, testId);
    showTestResultToast(metadata.name, result.passed, result.error);
  }

  private async runAllTests(): Promise<void> {
    for (const metadata of this.testMetadataList) {
      await this.runTest(metadata.id);
    }
  }

  private deleteTest(testId: string): void {
    const idx = this.testMetadataList.findIndex((m) => m.id === testId);
    if (idx < 0) return;

    const metadata = this.testMetadataList[idx];

    // Remove spec file from VFS
    try {
      this.container.vfs.unlinkSync(metadata.specPath);
    } catch { /* file may already be gone */ }

    this.testMetadataList.splice(idx, 1);
    this.saveTestMetadata();

    this.testsSurface.update(
      this.testMetadataList.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    );
  }

  private async openTestSpec(testId: string): Promise<void> {
    const metadata = this.testMetadataList.find((m) => m.id === testId);
    if (!metadata) return;
    void this.openWorkspaceFile(metadata.specPath);
  }

  private loadTestMetadata(): void {
    const metaPath = WORKSPACE_TEST_METADATA_PATH;
    try {
      if (this.container.vfs.existsSync(metaPath)) {
        const raw = this.container.vfs.readFileSync(metaPath, 'utf8') as string;
        const data = JSON.parse(raw);
        if (Array.isArray(data.tests)) {
          this.testMetadataList = data.tests;
          this.testsSurface.update(
            this.testMetadataList.map((m) => ({ id: m.id, name: m.name, status: m.status })),
          );
        }
      }
    } catch {
      // No saved tests
    }

    // Auto-discover spec files not already tracked
    this.autoDiscoverTests();
  }

  private autoDiscoverTests(): void {
    const testDir = WORKSPACE_TEST_E2E_ROOT;
    try {
      if (!this.container.vfs.existsSync(testDir)) return;

      const entries = this.container.vfs.readdirSync(testDir) as string[];
      const knownPaths = new Set(this.testMetadataList.map((m) => m.specPath));
      let added = false;

      for (const entry of entries) {
        if (!entry.endsWith('.spec.ts')) continue;
        const specPath = `${testDir}/${entry}`;
        if (knownPaths.has(specPath)) continue;

        // Extract test name from filename
        const name = entry.replace(/\.spec\.ts$/, '');

        // Generate a unique ID inline (same logic as generateTestId)
        const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.testMetadataList.push({
          id,
          name,
          specPath,
          createdAt: new Date().toISOString(),
          status: 'pending',
        });
        added = true;
      }

      if (added) {
        this.saveTestMetadata();
        this.testsSurface.update(
          this.testMetadataList.map((m) => ({ id: m.id, name: m.name, status: m.status })),
        );
      }
    } catch {
      // Directory may not exist yet
    }
  }

  private saveTestMetadata(): void {
    const metaPath = WORKSPACE_TEST_METADATA_PATH;
    const dir = WORKSPACE_TESTS_ROOT;
    if (!this.container.vfs.existsSync(dir)) {
      this.container.vfs.mkdirSync(dir, { recursive: true });
    }

    this.container.vfs.writeFileSync(metaPath, JSON.stringify({
      tests: this.testMetadataList,
    }, null, 2));
  }
}
