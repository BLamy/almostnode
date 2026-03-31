import {
  createContainer,
  type PersistedNetworkSession,
  type NetworkStatus,
  type RunResult,
  type WorkspaceSearchProvider,
} from "almostnode";
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
} from "../features/workspace-seed";
import type { ReferenceAppFiles } from "../features/reference-app-loader";
import { FixtureMarketplaceClient } from "../extensions/fixture-extensions";
import { OpenVSXClient } from "../extensions/open-vsx";
import { prunePersistedWorkbenchExtensions } from "../features/persisted-extensions";
import {
  parseOpenCodeLaunchCommand,
  shouldRunWorkbenchCommandInteractively,
} from "../features/terminal-command-routing";
import { installHostConsoleBridge } from "../features/host-console-bridge";
import { VfsFileSystemProvider } from "../features/vfs-file-system-provider";
import type { DesktopBridge } from "../desktop/bridge";
import { HostTerminalSession } from "../desktop/host-terminal-session";
import {
  loadProjectFilesIntoVfs,
  replaceProjectFilesInVfs,
  collectScopedFilesBase64,
  replaceScopedFilesInVfs,
  type SerializedFile,
} from "../desktop/project-snapshot";
import type {
  ProjectAgentStateSnapshot,
  ProjectGitRemoteRecord,
  ProjectRecord,
  ResumableThreadRecord,
} from "../features/project-db";
import {
  CLAUDE_PROJECTS_ROOT,
  discoverClaudeThreads,
  toOpenCodeThreads,
} from "../features/resumable-threads";
import { readGhToken } from "../../../../packages/almostnode/src/shims/gh-auth";
import {
  createExtensionServiceOverrides,
  type ExtensionServiceOverrideBundle,
} from "../extensions/extension-services";
import {
  FilesSidebarSurface,
  PreviewSurface,
  TerminalPanelSurface,
  OpenCodeTerminalSurface,
  type AgentLaunchKind,
  ConsolePanelElement,
  DatabaseSidebarSurface,
  DatabaseBrowserSurface,
  KeychainSidebarSurface,
  TestsSidebarSurface,
  registerWorkbenchSurfaces,
  type RegisteredWorkbenchSurfaces,
} from "./workbench-surfaces";
import {
  MarkdownEditorInput,
  JsonEditorInput,
} from "../features/rendered-editors";
import {
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
  Keychain,
  OPENCODE_AUTH_PATH,
  OPENCODE_CONFIG_JSONC_PATH,
  OPENCODE_CONFIG_PATH,
  OPENCODE_LEGACY_CONFIG_PATH,
  OPENCODE_MCP_AUTH_PATH,
  TAILSCALE_SESSION_KEYCHAIN_PATH,
  type KeychainState,
} from "../features/keychain";
import {
  clearStoredWorkbenchNetworkConfig,
  clearStoredTailscaleSessionSnapshot,
  readStoredWorkbenchNetworkConfig,
  readStoredTailscaleSessionSnapshot,
  writeStoredWorkbenchNetworkConfig,
  writeStoredTailscaleSessionSnapshot,
} from "../features/network-session";
import {
  collectOpenCodeBrowserSnapshot,
  listOpenCodeBrowserSessions,
  mountOpenCodeBrowserSession,
  type OpenCodeBrowserLaunchArgs,
  type OpenCodeBrowserSessionHandle,
  type OpenCodeBrowserShellState,
  restoreOpenCodeBrowserSnapshot,
} from "../features/opencode-browser-session";
import {
  initialize,
  getService,
  ICommandService,
  Menu,
  ConfigurationTarget,
} from "@codingame/monaco-vscode-api";
import {
  IEditorService,
  IPaneCompositePartService,
  IStatusbarService,
  IWorkbenchLayoutService,
  IWorkbenchThemeService,
} from "@codingame/monaco-vscode-api/services";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
  StatusbarAlignment,
  type IStatusbarEntry,
  type IStatusbarEntryAccessor,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/statusbar/browser/statusbar";
import { EnablementState } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";
import { QueryType } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getSearchServiceOverride from "@codingame/monaco-vscode-search-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getWorkbenchServiceOverride, {
  Parts,
  ViewContainerLocation,
  setPartVisibility,
} from "@codingame/monaco-vscode-workbench-service-override";
import getExtensionsServiceOverride from "@codingame/monaco-vscode-extensions-service-override";
import getLogServiceOverride from "@codingame/monaco-vscode-log-service-override";
import {
  createIndexedDBProviders,
  registerFileSystemOverlay,
} from "@codingame/monaco-vscode-files-service-override";
import * as monaco from "monaco-editor";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import "@codingame/monaco-vscode-javascript-default-extension";
import "@codingame/monaco-vscode-json-default-extension";
import "@codingame/monaco-vscode-typescript-basics-default-extension";
import "@codingame/monaco-vscode-html-default-extension";
import "@codingame/monaco-vscode-css-default-extension";
import "@codingame/monaco-vscode-sql-default-extension";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._configuration";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._editorPane";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._fileEditorFactory";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileActions.contribution";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileCommands";
import "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensions.contribution";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Worker URLs via ?worker&url — Vite bundles these as self-contained worker files
import editorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker.js?worker&url";
import textMateWorkerUrl from "@codingame/monaco-vscode-textmate-service-override/worker?worker&url";
import extensionHostWorkerUrl from "@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url";

// Force full page reload on change — the Monaco workbench cannot be safely
// hot-reloaded because module-identity-dependent instanceof checks break.
if (import.meta.hot) {
  import.meta.hot.decline();
}

export type ReturnTypeOfCreateContainer = ReturnType<typeof createContainer>;

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (
        _workerId: string,
        label: string,
      ) => Worker | Promise<Worker> | undefined;
      getWorkerUrl?: (_workerId: string, label: string) => string | undefined;
      getWorkerOptions?: (
        _workerId: string,
        label: string,
      ) => WorkerOptions | undefined;
    };
    __almostnodeWebIDE?: unknown;
  }
}

type MarketplaceMode = "open-vsx" | "fixtures";

const WORKBENCH_WORKERS = {
  editorWorkerService: {
    options: { type: "module" as const, name: "editorWorkerService" },
    url: editorWorkerUrl,
  },
  TextMateWorker: {
    options: { type: "module" as const, name: "TextMateWorker" },
    url: textMateWorkerUrl,
  },
  extensionHostWorkerMain: {
    options: { type: "module" as const, name: "extensionHostWorkerMain" },
    url: extensionHostWorkerUrl,
  },
} satisfies Record<string, { options: WorkerOptions; url: string }>;

const LEGACY_TESTS_ROOT = "/tests";
const LEGACY_TEST_E2E_ROOT = `${LEGACY_TESTS_ROOT}/e2e`;
const LEGACY_TEST_METADATA_PATH = `${LEGACY_TESTS_ROOT}/.almostnode-tests.json`;
const AI_SIDEBAR_TAB_CLOSED_EVENT = "almostnode:ai-sidebar-tab-closed";

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

const PRELOADED_WORKBENCH_LANGUAGES: Array<
  Parameters<typeof monaco.languages.register>[0]
> = [
  { id: "javascript" },
  { id: "javascriptreact" },
  { id: "typescript" },
  { id: "typescriptreact" },
];

function normalizeTerminalOutput(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

function registerWorkbenchLanguages(): void {
  const registered = new Set(
    monaco.languages.getLanguages().map((language) => language.id),
  );

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

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = 15000,
): Promise<T> {
  let timeoutId = 0;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(message)),
          timeoutMs,
        );
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

  if (normalized.endsWith(".tsx")) return "typescriptreact";
  if (
    normalized.endsWith(".ts") ||
    normalized.endsWith(".cts") ||
    normalized.endsWith(".mts")
  )
    return "typescript";
  if (normalized.endsWith(".jsx")) return "javascriptreact";
  if (
    normalized.endsWith(".js") ||
    normalized.endsWith(".cjs") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".es6")
  ) {
    return "javascript";
  }
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".jsonc")) return "jsonc";
  if (
    normalized.endsWith(".html") ||
    normalized.endsWith(".htm") ||
    normalized.endsWith(".xhtml")
  )
    return "html";
  if (normalized.endsWith(".css")) return "css";
  if (normalized.endsWith(".sql")) return "sql";

  return null;
}

const TERMINAL_THEME_DARK = {
  background: "#0e1218",
  foreground: "#dce5f3",
  cursor: "#ff7a59",
  cursorAccent: "#0e1218",
  selectionBackground: "rgba(255, 122, 89, 0.34)",
  selectionInactiveBackground: "rgba(255, 122, 89, 0.24)",
  black: "#1e2630",
  red: "#f47067",
  green: "#8ddb8c",
  yellow: "#f69d50",
  blue: "#6cb6ff",
  magenta: "#dcbdfb",
  cyan: "#76e3ea",
  white: "#adbac7",
  brightBlack: "#444c56",
  brightRed: "#ff938a",
  brightGreen: "#b4f1b4",
  brightYellow: "#f5c67a",
  brightBlue: "#96d0ff",
  brightMagenta: "#eedcfe",
  brightCyan: "#b3f0f5",
  brightWhite: "#ffffff",
};

const TERMINAL_THEME_LIGHT = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#d1480a",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(209, 72, 10, 0.18)",
  selectionInactiveBackground: "rgba(209, 72, 10, 0.12)",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0550ae",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#7d5600",
  brightBlue: "#0969da",
  brightMagenta: "#6639ba",
  brightCyan: "#3192aa",
  brightWhite: "#8b949e",
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
.part.sidebar .almostnode-opencode-panel-host,
.part.sidebar .almostnode-files-tree-host {
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
}
.part.sidebar .pane-body > .monaco-scrollable-element,
.part.sidebar .almostnode-opencode-panel-host,
.part.sidebar .almostnode-files-tree-host {
  overflow: hidden !important;
}

[id="almostnode.sidebar.opencode"] .pane-body.wide > .monaco-scrollable-element > div {
  min-height: 100% !important;
  max-width: calc(100% + 16px) !important;
}

.part.sidebar .almostnode-opencode-panel-host,
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
    const script = document.createElement("script");
    script.src = `${import.meta.env.BASE_URL || "/"}pw-web.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load pw-web.js"));
    document.head.appendChild(script);
  });
}

function getTerminalTheme(
  themeKind: WorkbenchThemeKind,
): typeof TERMINAL_THEME_DARK {
  return themeKind === "light" ? TERMINAL_THEME_LIGHT : TERMINAL_THEME_DARK;
}

function normalizeWorkbenchThemeKind(
  theme: { type?: string } | null | undefined,
): WorkbenchThemeKind {
  return theme?.type === "light" || theme?.type === "hcLight"
    ? "light"
    : "dark";
}

function inferThemeKindFromThemeName(
  themeName: string | null | undefined,
): WorkbenchThemeKind | null {
  if (typeof themeName !== "string") {
    return null;
  }

  const normalized = themeName.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("light")) {
    return "light";
  }

  if (normalized.includes("dark")) {
    return "dark";
  }

  return null;
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
  kind: "user" | "preview" | "agent";
  inputMode: "managed" | "passthrough";
  surface: "panel" | "sidebar";
}

interface OpenCodeTabState {
  id: string;
  title: string;
  host: HTMLElement;
  session: OpenCodeBrowserSessionHandle;
  restoreShellState: OpenCodeBrowserShellState | null;
  restoreTitle: string | null;
}

interface OpenCodeSidebarTabState {
  id: string;
  title: string;
  host: HTMLElement;
  session: OpenCodeBrowserSessionHandle | null;
}

type WorkbenchThemeKind = "light" | "dark";

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
  getState: () => {
    cwd: string;
    env: Record<string, string>;
    running: boolean;
  };
}

function getWorkbenchCorsProxyUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
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
  private readonly openCodeSurface: OpenCodeTerminalSurface;
  private readonly previewSurface: PreviewSurface;
  private readonly terminalSurface: TerminalPanelSurface;
  private readonly workbenchSurfaces: RegisteredWorkbenchSurfaces;
  private readonly terminalTabs = new Map<string, TerminalTabState>();
  private readonly openCodeTabs = new Map<string, OpenCodeTabState>();
  private readonly openCodeSidebarTabs = new Map<
    string,
    OpenCodeSidebarTabState
  >();
  private readonly openCodeSidebarTerminalTabs = new Map<
    string,
    TerminalTabState
  >();
  private activeTerminalTabId: string | null = null;
  private activeOpenCodeSidebarTabId: string | null = null;
  private previewTerminalTabId: string | null = null;
  private terminalCounter = 0;
  private openCodeTerminalCounter = 0;
  private openCodeSidebarCounter = 0;
  private openCodeSidebarTerminalCounter = 0;
  private claudeSidebarCounter = 0;
  private previewStartRequested = false;
  private previewPort: number | null = null;
  private previewUrl: string | null = null;
  private previewStartRetryTimeoutId = 0;
  private readonly consolePanel = new ConsolePanelElement();
  private readonly consoleTabId = "console-panel";
  private consoleMessageCount = 0;
  private extensionServices: ExtensionServiceOverrideBundle | null = null;
  private readonly keychain: Keychain;
  private keychainStatusEntry: IStatusbarEntryAccessor | null = null;
  private tailscaleStatus: NetworkStatus | null = null;
  private hadTailscaleKeychainData = false;
  private pendingTailscaleKeychainActivation = false;
  private workspaceDependencyInstallPromise: Promise<void> | null = null;
  private workspaceDependencyInstallKey: string | null = null;
  private workspaceDependencyInstallRequestKey: string | null = null;
  private templateId: TemplateId;
  private readonly initialProjectFiles: SerializedFile[] | null;
  private readonly skipWorkspaceSeed: boolean;
  private readonly deferPreviewStart: boolean;
  private readonly desktopBridge: DesktopBridge | null;
  private readonly hostProjectDirectory: string | null;
  private readonly agentLaunchCommand: string | null;
  private readonly agentMode: "browser" | "host";
  private readonly databaseSurface: DatabaseSidebarSurface;
  private readonly databaseBrowserSurface: DatabaseBrowserSurface;
  private readonly keychainSurface: KeychainSidebarSurface;
  private pgliteMiddleware:
    | import("almostnode/internal").RequestMiddleware
    | null = null;
  private databaseSidebarRegistered = false;
  private currentProjectDatabaseNamespace = "global";
  private readonly testsSurface = new TestsSidebarSurface();
  private workbenchThemeKind: WorkbenchThemeKind = "dark";
  private removeHostConsoleBridge: (() => void) | null = null;
  private testRecorder:
    | import("../features/test-recorder").TestRecorder
    | null = null;
  private testRunner: import("../features/test-runner").TestRunner | null =
    null;
  private testMetadataList: import("../features/test-spec-generator").TestMetadata[] =
    [];
  // testStepsMap removed — pw-web.js reads spec files directly from VFS
  private removePlaywrightListener: (() => void) | null = null;
  private removeCursorOverlay: (() => void) | null = null;

  constructor(private readonly options: WebIDEHostOptions) {
    this.container = createContainer({
      baseUrl: options.baseUrl,
      basePath: import.meta.env.BASE_URL?.replace(/\/$/, "") || "",
      cwd: WORKSPACE_ROOT,
      env: WebIDEHost.defaultCorsProxyUrl
        ? { CORS_PROXY_URL: WebIDEHost.defaultCorsProxyUrl }
        : undefined,
      networkIntegration: {
        loadSession: (): PersistedNetworkSession | null => {
          const stored = readStoredWorkbenchNetworkConfig();
          if (!stored) {
            return null;
          }

          return {
            ...stored,
            stateSnapshot: readStoredTailscaleSessionSnapshot(),
          };
        },
        saveSession: (session) => {
          if (!session) {
            clearStoredWorkbenchNetworkConfig();
            clearStoredTailscaleSessionSnapshot();
            return;
          }

          writeStoredWorkbenchNetworkConfig({
            provider: session.provider,
            useExitNode: session.useExitNode,
            exitNodeId: session.exitNodeId,
            acceptDns: session.acceptDns,
          });

          if (session.stateSnapshot) {
            writeStoredTailscaleSessionSnapshot(session.stateSnapshot);
          } else {
            clearStoredTailscaleSessionSnapshot();
          }
        },
        onAuthUrl: (url) => {
          if (!url) {
            return;
          }
          globalThis.open?.(url, "_blank", "noopener,noreferrer");
        },
      },
    });
    this.templateId = options.template || "vite";
    this.initialProjectFiles = options.initialProjectFiles ?? null;
    this.skipWorkspaceSeed = options.skipWorkspaceSeed === true;
    this.deferPreviewStart = options.deferPreviewStart === true;
    this.desktopBridge = options.desktopBridge ?? null;
    this.hostProjectDirectory = options.hostProjectDirectory ?? null;
    this.agentMode = this.desktopBridge ? "host" : "browser";
    this.agentLaunchCommand =
      options.agentLaunchCommand ??
      (this.agentMode === "host" ? "opencode" : null);
    this.marketplaceMode = options.marketplaceMode || "open-vsx";
    this.debugSections = Array.from(
      new Set(
        (options.debugSections || [])
          .map((section) => section.trim())
          .filter(Boolean),
      ),
    );
    this.filesSurface = new FilesSidebarSurface(
      this.container.vfs,
      WORKSPACE_ROOT,
      (path) => {
        void this.openWorkspaceFile(path);
      },
      (path) => {
        void this.openWorkspaceFileAsText(path);
      },
    );
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
    this.openCodeSurface = new OpenCodeTerminalSurface({
      onLaunch: (kind) => {
        void this.launchAiSession(kind);
      },
      onCloseTab: (id) => {
        this.closeAiSidebarTab(id);
      },
      onSelectTab: (id) => {
        this.setActiveAiSidebarTab(id);
      },
      onResize: (id, cols, rows) => {
        this.openCodeSidebarTerminalTabs.get(id)?.session.resize(cols, rows);
      },
    });
    this.databaseSurface = new DatabaseSidebarSurface();
    this.databaseBrowserSurface = new DatabaseBrowserSurface();
    this.keychainSurface = new KeychainSidebarSurface();
    this.workbenchSurfaces = registerWorkbenchSurfaces({
      filesSurface: this.filesSurface,
      openCodeSurface: this.openCodeSurface,
      previewSurface: this.previewSurface,
      terminalSurface: this.terminalSurface,
      databaseBrowserSurface: this.databaseBrowserSurface,
      keychainSurface: this.keychainSurface,
      vfs: this.container.vfs,
      openFileAsText: (path: string) => void this.openWorkspaceFileAsText(path),
    });
    this.keychain = new Keychain({
      vfs: this.container.vfs,
      overlayRoot:
        options.elements.workbench.parentElement ?? options.elements.workbench,
      onStateChange: (state) => {
        this.updateKeychainStatusEntry(state);
        this.updateKeychainSurface(state);
        this.updateAiLauncherSurface();
      },
    });
    this.keychainSurface.setActionHandler((action) => {
      if (action.startsWith("select-exit-node:tailscale:")) {
        void this.selectTailscaleExitNode(
          action.slice("select-exit-node:tailscale:".length),
        );
        return;
      }

      switch (action) {
        case "unlock":
          void this.unlockKeychain();
          break;
        case "save":
          void this.unlockKeychain();
          break;
        case "forget":
          void this.forgetKeychain();
          break;
        case "login:github":
          void this.keychainAuthAction("gh auth login");
          break;
        case "logout:github":
          void this.keychainAuthAction("gh auth logout");
          break;
        case "login:replay":
          void this.keychainAuthAction("replayio login");
          break;
        case "logout:replay":
          void this.keychainAuthAction("replayio logout");
          break;
        case "login:tailscale":
          void this.tailscaleAuthAction("login");
          break;
        case "logout:tailscale":
          void this.tailscaleAuthAction("logout");
          break;
      }
    });
    this.keychain.registerSlot("tailscale", [TAILSCALE_SESSION_KEYCHAIN_PATH]);
    this.keychain.registerSlot("claude", [
      CLAUDE_AUTH_CREDENTIALS_PATH,
      CLAUDE_AUTH_CONFIG_PATH,
      CLAUDE_LEGACY_CONFIG_PATH,
    ]);
    this.keychain.registerSlot("github", ["/home/user/.config/gh/hosts.yml"]);
    this.keychain.registerSlot("opencode", [
      OPENCODE_AUTH_PATH,
      OPENCODE_MCP_AUTH_PATH,
      OPENCODE_CONFIG_JSONC_PATH,
      OPENCODE_CONFIG_PATH,
      OPENCODE_LEGACY_CONFIG_PATH,
    ]);
    this.keychain.registerSlot("replay", ["/home/user/.replay/auth.json"]);
    this.hadTailscaleKeychainData = this.keychain.hasSlotData("tailscale");
    void this.container.network.getStatus().then((status) => {
      this.tailscaleStatus = status;
      this.handleTailscaleKeychainTransition();
      this.updateKeychainSurface();
      this.updateAiLauncherSurface();
    });
    this.container.network.subscribe((status) => {
      this.tailscaleStatus = status;
      this.handleTailscaleKeychainTransition();
      this.updateKeychainSurface();
      this.updateAiLauncherSurface();
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

  getVfs() {
    return this.container.vfs;
  }

  getTemplateId(): TemplateId {
    return this.templateId;
  }

  hasGitHubCredentials(): boolean {
    return Boolean(readGhToken(this.container.vfs)?.oauth_token);
  }

  async createGitHubRemote(projectName: string): Promise<ProjectGitRemoteRecord> {
    const auth = readGhToken(this.container.vfs);
    if (!auth?.oauth_token) {
      throw new Error("GitHub credentials are not available. Run `gh auth login` first.");
    }

    const repoName = this.toGitHubRepositoryName(projectName);
    const response = await this.fetchGitHubApi("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${auth.oauth_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repoName,
        private: true,
      }),
    });

    const raw = await response.text();
    let payload: {
      message?: string;
      clone_url?: string;
      full_name?: string;
      html_url?: string;
    } = {};
    if (raw) {
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      throw new Error(payload.message || `GitHub repository creation failed (${response.status}).`);
    }
    if (!payload.clone_url) {
      throw new Error("GitHub repository creation did not return a clone URL.");
    }

    return {
      name: "origin",
      url: payload.clone_url,
      provider: "github",
      repositoryFullName: payload.full_name,
      repositoryUrl: payload.html_url,
    };
  }

  async syncProjectGit(project: ProjectRecord): Promise<void> {
    await this.ensureGitInitialized(project);
  }

  async collectAgentStateSnapshot(): Promise<ProjectAgentStateSnapshot> {
    return {
      claudeFiles: collectScopedFilesBase64(this.container.vfs, [
        CLAUDE_PROJECTS_ROOT,
      ]),
      openCodeDb:
        this.agentMode === "browser"
          ? await collectOpenCodeBrowserSnapshot()
          : null,
    };
  }

  async restoreAgentStateSnapshot(
    snapshot: ProjectAgentStateSnapshot | null | undefined,
  ): Promise<void> {
    replaceScopedFilesInVfs(
      this.container.vfs,
      [CLAUDE_PROJECTS_ROOT],
      snapshot?.claudeFiles ?? [],
    );

    if (this.agentMode === "browser") {
      await restoreOpenCodeBrowserSnapshot(snapshot?.openCodeDb ?? null);
    }
  }

  async discoverActiveProjectThreads(
    projectId: string,
  ): Promise<{
    claude: ResumableThreadRecord[];
    opencode: ResumableThreadRecord[];
  }> {
    const claudeFiles = collectScopedFilesBase64(this.container.vfs, [
      CLAUDE_PROJECTS_ROOT,
    ]);
    const claude = discoverClaudeThreads(projectId, claudeFiles);

    if (this.agentMode !== "browser") {
      return { claude, opencode: [] };
    }

    const sessions = await listOpenCodeBrowserSessions({
      container: this.container,
      cwd: WORKSPACE_ROOT,
      env: {},
    });
    return {
      claude,
      opencode: toOpenCodeThreads(projectId, sessions),
    };
  }

  async resumeResumableThread(thread: ResumableThreadRecord): Promise<void> {
    const title = thread.title.trim() || (
      thread.harness === "claude"
        ? `Claude Code ${++this.claudeSidebarCounter}`
        : `OpenCode ${++this.openCodeSidebarTerminalCounter}`
    );
    if (thread.harness === "opencode") {
      await this.launchAiSession("opencode", {
        title,
        args: {
          sessionID: thread.resumeToken,
        },
      });
      return;
    }

    await this.revealOpenCodeSidebarView(true);
    const tab = this.createAiSidebarTerminalTab(true, { title });
    const command =
      `npx @anthropic-ai/claude-code --resume ${thread.resumeToken}`;
    await this.runCommand(tab, command, {
      echoCommand: true,
      interceptAgentLaunch: false,
    });
  }

  private normalizeProjectDatabaseNamespace(dbPrefix?: string): string {
    const trimmed = dbPrefix?.trim();
    return trimmed ? trimmed : "global";
  }

  private abortRunningTerminalCommands(): void {
    for (const tab of this.terminalTabs.values()) {
      tab.runningAbortController?.abort();
    }
    for (const tab of this.openCodeSidebarTerminalTabs.values()) {
      tab.runningAbortController?.abort();
    }
  }

  private resetPreviewTerminalTab(): void {
    const previewTabId = this.previewTerminalTabId;
    if (!previewTabId) {
      return;
    }

    const wasActive = this.activeTerminalTabId === previewTabId;
    if (wasActive) {
      this.activeTerminalTabId = null;
    }

    this.previewTerminalTabId = null;
    this.disposeShellTerminalTab(previewTabId);

    if (wasActive) {
      this.activateFallbackTerminalTab(false);
    }
  }

  private async waitForPreviewServerShutdown(port: number | null): Promise<void> {
    if (typeof port !== "number") {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let timeoutId = 0;
      const handleServerUnregistered = (stoppedPort: unknown) => {
        if (stoppedPort !== port) {
          return;
        }
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        this.container.serverBridge.off(
          "server-unregistered",
          handleServerUnregistered,
        );
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      this.container.serverBridge.on(
        "server-unregistered",
        handleServerUnregistered,
      );

      timeoutId = window.setTimeout(() => {
        this.container.serverBridge.off(
          "server-unregistered",
          handleServerUnregistered,
        );
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 1500);
    });
  }

  private async closeCurrentProjectDatabase(): Promise<void> {
    try {
      const { getActiveDatabase, setDatabaseNamespace } =
        await import("../../../../packages/almostnode/src/pglite/db-manager");
      const { closePGliteInstance } =
        await import("../../../../packages/almostnode/src/pglite/pglite-database");
      setDatabaseNamespace(this.currentProjectDatabaseNamespace);
      const active = getActiveDatabase(this.currentProjectDatabaseNamespace);
      if (active) {
        await closePGliteInstance(active);
      }
    } catch {
      // PGlite may not have been initialized.
    }
  }

  async attachProjectContext(
    templateId: TemplateId,
    dbPrefix?: string,
  ): Promise<void> {
    const nextNamespace = this.normalizeProjectDatabaseNamespace(dbPrefix);
    if (this.currentProjectDatabaseNamespace !== nextNamespace) {
      await this.closeCurrentProjectDatabase();
    }
    this.templateId = templateId;
    this.currentProjectDatabaseNamespace = nextNamespace;
    void this.initPGliteIfNeeded();
  }

  async switchProjectWorkspace(
    newTemplateId: TemplateId,
    files: SerializedFile[],
    dbPrefix?: string,
  ): Promise<void> {
    const previousPreviewPort = this.previewPort;
    this.abortRunningTerminalCommands();
    this.clearScheduledPreviewStartRetry();
    this.resetPreviewTerminalTab();
    await this.waitForPreviewServerShutdown(previousPreviewPort);
    await this.closeCurrentProjectDatabase();

    this.previewPort = null;
    this.previewUrl = null;
    this.previewStartRequested = false;
    this.previewSurface.setActiveDb(null);
    this.previewSurface.clear("Switching projects…");
    this.databaseSurface.update([], null);

    this.templateId = newTemplateId;
    replaceProjectFilesInVfs(this.container.vfs, files, { includeGit: true });

    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    if (!this.container.vfs.existsSync(packageJsonPath)) {
      seedWorkspace(this.container, this.templateId);
    }

    this.currentProjectDatabaseNamespace =
      this.normalizeProjectDatabaseNamespace(dbPrefix);

    await this.ensureGitInitialized();

    if (this.terminalTabs.size === 0) {
      const initialTab = this.createUserTerminalTab(false);
      this.updateTerminalStatus(initialTab, "Idle");
    }

    await this.revealPreviewEditor();
    this.updatePreviewStatus("Waiting for a preview server");
    this.ensurePreviewServerRunning();
    this.schedulePreviewStartRetry();
    void this.initPGliteIfNeeded();

    window.dispatchEvent(new Event("resize"));
  }

  /**
   * Tear down the active project: abort all terminal sessions, clear preview,
   * unregister PGlite middleware, and close all editor tabs.
   */
  async teardownActiveProject(): Promise<void> {
    // 1. Abort + dispose all terminal tabs
    for (const [id, tab] of this.terminalTabs) {
      tab.runningAbortController?.abort();
      tab.terminal.dispose();
      tab.session.dispose();
      this.terminalSurface.removeTab(id);
    }
    this.terminalTabs.clear();
    this.activeTerminalTabId = null;
    this.previewTerminalTabId = null;
    this.terminalCounter = 0;

    // 2. Abort + dispose all OpenCode sidebar terminal tabs
    for (const [id, tab] of this.openCodeSidebarTerminalTabs) {
      tab.runningAbortController?.abort();
      tab.terminal.dispose();
      tab.session.dispose();
      this.openCodeSurface.removeTab(id);
    }
    this.openCodeSidebarTerminalTabs.clear();

    // 3. Close OpenCode panel tabs
    for (const [id, tab] of this.openCodeTabs) {
      tab.session.dispose();
      this.terminalSurface.removeTab(id);
    }
    this.openCodeTabs.clear();

    // 4. Close OpenCode sidebar tabs
    for (const [id, tab] of this.openCodeSidebarTabs) {
      tab.session?.dispose();
      this.openCodeSurface.removeTab(id);
    }
    this.openCodeSidebarTabs.clear();
    this.activeOpenCodeSidebarTabId = null;

    // 5. Clear preview state
    this.previewPort = null;
    this.previewUrl = null;
    this.previewStartRequested = false;
    this.previewSurface.setActiveDb(null);
    this.previewSurface.clear("Switching projects\u2026");

    // 6. Unregister PGlite middleware & close instances
    if (this.pgliteMiddleware) {
      this.container.serverBridge.unregisterMiddleware(this.pgliteMiddleware);
      this.pgliteMiddleware = null;
    }
    await this.closeCurrentProjectDatabase();
    this.databaseSurface.update([], null);

    // 7. Close all open editor tabs
    try {
      const commandService = await getService(ICommandService);
      await commandService.executeCommand("workbench.action.closeAllEditors");
    } catch {
      // May fail if no editors are open
    }

    // 8. Reset workspace dependency install promise
    this.workspaceDependencyInstallPromise = null;
    this.workspaceDependencyInstallKey = null;
    this.workspaceDependencyInstallRequestKey = null;

    // 9. Clear console
    this.consolePanel.clear();
    this.consoleMessageCount = 0;
  }

  /**
   * Reload the workbench for a new project: create terminal, install deps,
   * start dev server, init PGlite.
   */
  async reloadWorkbenchForNewProject(
    newTemplateId: TemplateId,
    dbPrefix?: string,
  ): Promise<void> {
    this.templateId = newTemplateId;
    this.currentProjectDatabaseNamespace =
      this.normalizeProjectDatabaseNamespace(dbPrefix);

    // 1. Seed workspace if VFS is empty (new project with no saved files)
    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    if (!this.container.vfs.existsSync(packageJsonPath)) {
      seedWorkspace(this.container, this.templateId);
    }

    // 2. Ensure git is initialized
    await this.ensureGitInitialized();

    // 3. Create initial terminal tab
    const initialTab = this.createUserTerminalTab(false);
    this.updateTerminalStatus(initialTab, "Idle");

    // 4. Restore preview as the default editor for the switched project.
    await this.revealPreviewEditor();
    this.updatePreviewStatus("Waiting for a preview server");

    // 5. Start preview server (which does npm install first)
    this.ensurePreviewServerRunning();
    this.schedulePreviewStartRetry();

    // 6. Init PGlite if needed
    void this.initPGliteIfNeeded();

    // 7. Trigger Monaco layout refresh
    window.dispatchEvent(new Event("resize"));
  }

  get terminal(): Terminal {
    return this.requireActiveTerminalTab().terminal;
  }

  private normalizeHostPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/g, "");
  }

  private resolveBridgeWorkspaceCwd(
    candidate: string | null | undefined,
  ): string {
    if (
      !this.hostProjectDirectory ||
      typeof candidate !== "string" ||
      !candidate.trim()
    ) {
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

    const relativePath = resolvedCandidate
      .slice(projectPrefix.length)
      .replace(/^\/+/, "");
    if (!relativePath) {
      return WORKSPACE_ROOT;
    }

    const segments = relativePath
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..");
    if (segments.length === 0) {
      return WORKSPACE_ROOT;
    }

    return `${WORKSPACE_ROOT}/${segments.join("/")}`;
  }

  private normalizeBridgedCommand(command: string): string {
    const trimmed = command.trim();
    if (!trimmed || !this.hostProjectDirectory) {
      return trimmed;
    }

    const hostProjectDirectory = this.normalizeHostPath(
      this.hostProjectDirectory,
    );
    return trimmed.split(hostProjectDirectory).join(WORKSPACE_ROOT);
  }

  async executeBridgedCommand(
    params: Record<string, unknown>,
  ): Promise<BridgedCommandResult> {
    const command =
      typeof params.command === "string" ? params.command.trim() : "";
    if (!command) {
      throw new Error("Bridged command payload is missing a command.");
    }

    const background = params.background === true;
    const vfsCwd = this.resolveBridgeWorkspaceCwd(
      typeof params.cwd === "string" ? params.cwd : null,
    );
    const normalizedCommand = this.normalizeBridgedCommand(command);

    if (background) {
      const session = this.container.createTerminalSession({ cwd: vfsCwd });
      void session.run(normalizedCommand, { interactive: true }).finally(() => {
        session.dispose();
      });
      return {
        stdout: "",
        stderr: "",
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
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: getTerminalTheme(this.workbenchThemeKind),
    });
    const fitAddon = new FitAddon();
    return { terminal, fitAddon };
  }

  private requireActiveTerminalTab(): TerminalTabState {
    const tab = this.activeTerminalTabId
      ? this.terminalTabs.get(this.activeTerminalTabId)
      : null;
    if (tab) {
      return tab;
    }

    const fallback = this.terminalTabs.values().next().value as
      | TerminalTabState
      | undefined;
    if (fallback) {
      this.setActiveTerminalTab(fallback.id);
      return fallback;
    }

    return this.createUserTerminalTab(false);
  }

  private printPrompt(tab: TerminalTabState): void {
    tab.terminal.write("\r\n$ ");
  }

  private writeTerminal(tab: TerminalTabState, text: string): void {
    if (!text) return;
    tab.terminal.write(normalizeTerminalOutput(text));
  }

  private stringifyConsoleArg(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Error) {
      return value.stack || value.message;
    }
    if (typeof value === "object" && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private addConsoleEntry(
    level: string,
    args: readonly unknown[],
    timestamp = Date.now(),
  ): void {
    const normalizedArgs = args.map((value) => this.stringifyConsoleArg(value));
    this.consolePanel.addEntry(level, normalizedArgs, timestamp);
    this.consoleMessageCount++;
    this.terminalSurface.updateTabStatus(
      this.consoleTabId,
      `${this.consoleMessageCount} messages`,
    );
  }

  private updateTerminalStatus(tab: TerminalTabState, text: string): void {
    if (tab.surface === "sidebar") {
      this.openCodeSurface.updateTabStatus(tab.id, text);
      return;
    }

    this.terminalSurface.updateTabStatus(tab.id, text);
  }

  private updatePreviewStatus(text: string): void {
    this.previewSurface.setStatus(text);
  }

  private clearScheduledPreviewStartRetry(): void {
    if (this.previewStartRetryTimeoutId) {
      window.clearTimeout(this.previewStartRetryTimeoutId);
      this.previewStartRetryTimeoutId = 0;
    }
  }

  private schedulePreviewStartRetry(delayMs = 3000): void {
    this.clearScheduledPreviewStartRetry();
    this.previewStartRetryTimeoutId = window.setTimeout(() => {
      this.previewStartRetryTimeoutId = 0;
      if (!this.previewUrl && !this.previewStartRequested) {
        this.ensurePreviewServerRunning();
      }
    }, delayMs);
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

  private createTerminalTab(
    kind: "user" | "preview" | "agent",
    title: string,
    focus: boolean,
    closable: boolean,
    options?: {
      id?: string;
      cwd?: string;
      env?: Record<string, string>;
      session?: WorkbenchTerminalSession;
      inputMode?: "managed" | "passthrough";
      surface?: "panel" | "sidebar";
    },
  ): TerminalTabState {
    const id = options?.id ?? `${kind}-${crypto.randomUUID()}`;
    const { terminal, fitAddon } = this.createTerminalInstance();
    const surface = options?.surface ?? "panel";
    const tab: TerminalTabState = {
      id,
      title,
      terminal,
      fitAddon,
      session:
        options?.session ??
        this.container.createTerminalSession({
          cwd: options?.cwd ?? WORKSPACE_ROOT,
          env: options?.env,
        }),
      currentLine: "",
      history: [],
      historyIndex: -1,
      runningAbortController: null,
      closable,
      kind,
      inputMode: options?.inputMode ?? "managed",
      surface,
    };
    if (surface === "sidebar") {
      this.openCodeSidebarTerminalTabs.set(id, tab);
      this.openCodeSurface.addTab({
        id,
        title,
        terminal,
        fitAddon,
        closable,
      });
    } else {
      this.terminalTabs.set(id, tab);
      this.terminalSurface.addTab({
        id,
        title,
        terminal,
        fitAddon,
        closable,
      });
    }
    this.bindTerminal(tab);
    if (kind === "preview") {
      this.previewTerminalTabId = id;
    }
    if (surface === "sidebar") {
      if (focus || !this.activeOpenCodeSidebarTabId) {
        this.setActiveAiSidebarTab(id);
      }
    } else if (focus || !this.activeTerminalTabId) {
      this.setActiveTerminalTab(id);
    }
    if (kind === "preview") {
      terminal.write("almostnode preview terminal");
    } else if (surface === "sidebar") {
      terminal.write("almostnode ai panel terminal");
    } else {
      terminal.write("almostnode webide terminal");
    }
    if (
      kind === "user" &&
      this.terminalCounter === 1 &&
      this.debugSections.length > 0
    ) {
      terminal.write(
        `\r\n[almostnode debug] enabled: ${this.debugSections.join(", ")}`,
      );
    }
    if (kind === "agent") {
      terminal.write("almostnode opencode terminal");
    }
    if (!(kind === "agent" && tab.inputMode === "passthrough")) {
      this.printPrompt(tab);
    }
    return tab;
  }

  private createUserTerminalTab(
    focus: boolean,
    options?: {
      id?: string;
      title?: string;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): TerminalTabState {
    const title = options?.title ?? `Terminal ${++this.terminalCounter}`;
    return this.createTerminalTab("user", title, focus, true, {
      id: options?.id,
      cwd: options?.cwd,
      env: options?.env,
    });
  }

  private createAiSidebarTerminalTab(
    focus: boolean,
    options?: {
      title?: string;
    },
  ): TerminalTabState {
    const id = `ai-sidebar-${crypto.randomUUID()}`;
    const title =
      options?.title ?? `Terminal ${++this.openCodeSidebarTerminalCounter}`;
    return this.createTerminalTab("user", title, focus, true, {
      id,
      cwd: WORKSPACE_ROOT,
      surface: "sidebar",
    });
  }

  private getPreviewTerminalTab(): TerminalTabState {
    const existing = this.previewTerminalTabId
      ? this.terminalTabs.get(this.previewTerminalTabId)
      : null;
    if (existing) {
      return existing;
    }
    return this.createTerminalTab("preview", "Preview", false, false);
  }

  private setActiveTerminalTab(id: string): void {
    if (
      !this.terminalTabs.has(id) &&
      !this.openCodeTabs.has(id) &&
      id !== this.consoleTabId
    ) {
      return;
    }
    this.activeTerminalTabId = id;
    this.terminalSurface.setActiveTab(id);
    this.openCodeTabs.get(id)?.host.focus();
  }

  private closeTerminalTab(id: string): void {
    if (this.openCodeTabs.has(id)) {
      this.closeOpenCodeTab(id, { restoreShell: true });
      return;
    }

    const tab = this.terminalTabs.get(id);
    if (!tab || tab.kind === "preview") {
      return;
    }

    const wasActive = this.activeTerminalTabId === id;
    tab.runningAbortController?.abort();
    this.terminalTabs.delete(id);
    this.terminalSurface.removeTab(id);
    tab.terminal.dispose();
    tab.session.dispose();

    if (wasActive) {
      this.activateFallbackTerminalTab(true);
    }
  }

  private createOpenCodeHostElement(): HTMLElement {
    const host = document.createElement("div");
    host.className = "almostnode-opencode-host";
    host.tabIndex = -1;
    host.style.height = "100%";
    host.style.minHeight = "0";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    return host;
  }

  private async revealOpenCodeSidebarView(focus: boolean): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.SIDEBAR_PART, true);
    await paneCompositeService.openPaneComposite(
      this.workbenchSurfaces.openCodeViewId,
      ViewContainerLocation.Sidebar,
      focus,
    );
    if (focus) {
      this.openCodeSurface.focus();
    }
  }

  private getClaudeLauncherAvailable(): boolean {
    return (
      this.tailscaleStatus?.state === "running"
      && this.keychain.hasSlotData("claude")
    );
  }

  private hasAiSidebarTab(id: string | null | undefined): boolean {
    return Boolean(
      id
      && (
        this.openCodeSidebarTabs.has(id)
        || this.openCodeSidebarTerminalTabs.has(id)
      ),
    );
  }

  private getFirstAiSidebarTabId(): string | null {
    return (
      this.openCodeSidebarTabs.keys().next().value
      ?? this.openCodeSidebarTerminalTabs.keys().next().value
      ?? null
    );
  }

  private setActiveAiSidebarTab(id: string): void {
    if (!this.hasAiSidebarTab(id)) {
      return;
    }

    this.activeOpenCodeSidebarTabId = id;
    this.openCodeSurface.setActiveTab(id);
    const sidebarTerminalTab = this.openCodeSidebarTerminalTabs.get(id);
    if (sidebarTerminalTab) {
      sidebarTerminalTab.terminal.focus();
      return;
    }

    this.openCodeSidebarTabs.get(id)?.host.focus();
  }

  private closeAiSidebarTab(id: string): void {
    const openCodeTab = this.openCodeSidebarTabs.get(id);
    if (openCodeTab) {
      const wasActive = this.activeOpenCodeSidebarTabId === id;
      this.openCodeSidebarTabs.delete(id);
      this.openCodeSurface.removeTab(id);
      openCodeTab.session?.dispose();
      window.dispatchEvent(new CustomEvent(AI_SIDEBAR_TAB_CLOSED_EVENT));
      if (wasActive) {
        this.activeOpenCodeSidebarTabId = null;
        const nextTabId = this.getFirstAiSidebarTabId();
        if (nextTabId) {
          this.setActiveAiSidebarTab(nextTabId);
        }
      }
      return;
    }

    const terminalTab = this.openCodeSidebarTerminalTabs.get(id);
    if (!terminalTab) {
      return;
    }

    const wasActive = this.activeOpenCodeSidebarTabId === id;
    terminalTab.runningAbortController?.abort();
    this.openCodeSidebarTerminalTabs.delete(id);
    this.openCodeSurface.removeTab(id);
    terminalTab.terminal.dispose();
    terminalTab.session.dispose();
    window.dispatchEvent(new CustomEvent(AI_SIDEBAR_TAB_CLOSED_EVENT));

    if (wasActive) {
      this.activeOpenCodeSidebarTabId = null;
      const nextTabId = this.getFirstAiSidebarTabId();
      if (nextTabId) {
        this.setActiveAiSidebarTab(nextTabId);
      }
    }
  }

  private updateAiLauncherSurface(): void {
    this.openCodeSurface.setClaudeAvailable(this.getClaudeLauncherAvailable());
  }

  private getAiLaunchCommand(
    kind: Exclude<AgentLaunchKind, "terminal">,
  ): string {
    return kind === "claude"
      ? "npx @anthropic-ai/claude-code"
      : "npx opencode-ai";
  }

  private async createOpenCodeSidebarTab(
    focus: boolean,
    options?: {
      title?: string;
      args?: OpenCodeBrowserLaunchArgs;
    },
  ): Promise<void> {
    if (this.agentMode === "host") {
      await this.revealTerminalPanel(focus);
      void this.createHostAgentTerminalTab(focus);
      return;
    }

    if (!(await this.keychain.prepareForCommand("opencode"))) {
      await this.revealKeychainPanel();
      return;
    }

    this.openCodeSidebarCounter += 1;
    const id = `opencode-sidebar-${crypto.randomUUID()}`;
    const title = options?.title ?? `OpenCode ${this.openCodeSidebarCounter}`;
    const host = this.createOpenCodeHostElement();

    this.openCodeSurface.addCustomTab({
      id,
      title,
      element: host,
      closable: true,
    });
    this.openCodeSidebarTabs.set(id, {
      id,
      title,
      host,
      session: null,
    });
    this.openCodeSurface.updateTabStatus(id, "Starting OpenCode...");
    this.setActiveAiSidebarTab(id);

    try {
      const session = await mountOpenCodeBrowserSession({
        container: this.container,
        element: host,
        cwd: WORKSPACE_ROOT,
        env: {},
        args: options?.args,
        themeMode: this.workbenchThemeKind,
        onTitleChange: (nextTitle) => {
          const resolvedTitle = nextTitle?.trim() || title;
          this.openCodeSurface.updateTabTitle(id, resolvedTitle);
        },
      });

      this.openCodeSidebarTabs.set(id, { id, title, host, session });
      this.openCodeSurface.updateTabStatus(id, "OpenCode ready");

      void session.exited.finally(() => {
        if (!this.openCodeSidebarTabs.has(id)) {
          return;
        }

        this.closeAiSidebarTab(id);
      });
    } catch (error) {
      console.error("[opencode] failed to start sidebar session", error);
      this.openCodeSidebarTabs.delete(id);
      this.openCodeSurface.removeTab(id);
      if (this.activeOpenCodeSidebarTabId === id) {
        this.activeOpenCodeSidebarTabId = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      const fallbackTab = this.createAiSidebarTerminalTab(focus, {
        title: `Terminal ${++this.openCodeSidebarTerminalCounter}`,
      });
      fallbackTab.terminal.write(`\r\nOpenCode failed to start: ${message}`);
      this.printPrompt(fallbackTab);
    }
  }

  private normalizeOpenCodeSidebarArgs(
    args?: OpenCodeBrowserLaunchArgs,
  ): OpenCodeBrowserLaunchArgs | undefined {
    if (!args) {
      return undefined;
    }

    const next: OpenCodeBrowserLaunchArgs = {};
    if (args.sessionID) {
      next.sessionID = args.sessionID;
    }
    if (args.fork) {
      next.fork = true;
    }
    if (args.continue && !args.sessionID) {
      next.continue = true;
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  private async launchAiSession(
    kind: AgentLaunchKind,
    options?: {
      title?: string;
      args?: OpenCodeBrowserLaunchArgs;
    },
  ): Promise<void> {
    if (this.agentMode === "host") {
      await this.revealTerminalPanel(true);
      void this.createHostAgentTerminalTab(true);
      return;
    }

    await this.revealOpenCodeSidebarView(true);

    if (kind === "opencode") {
      await this.createOpenCodeSidebarTab(true, {
        title: options?.title,
        args: this.normalizeOpenCodeSidebarArgs(options?.args),
      });
      return;
    }

    if (kind === "terminal") {
      this.createAiSidebarTerminalTab(true);
      return;
    }

    if (!this.getClaudeLauncherAvailable()) {
      return;
    }

    const command = this.getAiLaunchCommand(kind);
    if (!(await this.keychain.prepareForCommand(command))) {
      await this.revealKeychainPanel();
      return;
    }

    const tab = this.createTerminalTab(
      "user",
      `Claude Code ${++this.claudeSidebarCounter}`,
      true,
      true,
      {
        id: `claude-sidebar-${crypto.randomUUID()}`,
        cwd: WORKSPACE_ROOT,
        surface: "sidebar",
      },
    );
    await this.runCommand(tab, command, { echoCommand: true });
  }

  private async createOpenCodeTerminalTab(
    focus: boolean,
    options?: {
      replaceTab?: TerminalTabState;
      title?: string;
    },
  ): Promise<void> {
    if (this.agentMode === "host") {
      void this.createHostAgentTerminalTab(focus);
      return;
    }

    if (!(await this.keychain.prepareForCommand("opencode"))) {
      await this.revealKeychainPanel();
      return;
    }

    this.openCodeTerminalCounter += 1;
    const restoreTitle = options?.replaceTab?.title ?? null;
    const initialShellState = options?.replaceTab
      ? options.replaceTab.session.getState()
      : {
          cwd: WORKSPACE_ROOT,
          env: {} as Record<string, string>,
          running: false,
        };
    const id = options?.replaceTab?.id ?? `opencode-${crypto.randomUUID()}`;
    const title = options?.title ?? `OpenCode ${this.openCodeTerminalCounter}`;
    const host = this.createOpenCodeHostElement();

    if (options?.replaceTab) {
      this.disposeShellTerminalTab(options.replaceTab.id);
    }

    this.terminalSurface.addCustomTab({
      id,
      title,
      element: host,
      closable: true,
    });
    this.terminalSurface.updateTabStatus(id, "Starting OpenCode...");
    if (focus || !this.activeTerminalTabId) {
      this.setActiveTerminalTab(id);
    }

    try {
      const session = await mountOpenCodeBrowserSession({
        container: this.container,
        element: host,
        cwd: initialShellState.cwd,
        env: initialShellState.env,
        themeMode: this.workbenchThemeKind,
        onTitleChange: (nextTitle) => {
          const resolvedTitle = nextTitle?.trim() || title;
          this.terminalSurface.updateTabTitle(id, resolvedTitle);
        },
      });
      this.openCodeTabs.set(id, {
        id,
        title,
        host,
        session,
        restoreShellState: restoreTitle
          ? { cwd: initialShellState.cwd, env: initialShellState.env }
          : null,
        restoreTitle,
      });
      this.terminalSurface.updateTabStatus(id, "OpenCode ready");
      void session.exited.finally(() => {
        if (!this.openCodeTabs.has(id)) {
          return;
        }
        const shellState = session.getShellState();
        this.closeOpenCodeTab(id, {
          restoreShell: true,
          restoreShellState: shellState,
        });
      });
    } catch (error) {
      console.error("[opencode] failed to start terminal session", error);
      this.terminalSurface.removeTab(id);
      const message = error instanceof Error ? error.message : String(error);
      if (options?.replaceTab) {
        const restored = this.createUserTerminalTab(focus, {
          id,
          title: restoreTitle ?? `Terminal ${this.terminalCounter}`,
          cwd: initialShellState.cwd,
          env: initialShellState.env,
        });
        restored.terminal.write(`\r\nOpenCode failed to start: ${message}`);
        this.printPrompt(restored);
      } else {
        const tab = this.createUserTerminalTab(focus);
        tab.terminal.write(`\r\nOpenCode failed to start: ${message}`);
        this.printPrompt(tab);
      }
    }
  }

  private async createHostAgentTerminalTab(
    focus: boolean,
  ): Promise<TerminalTabState> {
    if (!this.desktopBridge) {
      throw new Error("Host agent mode requires a desktop bridge.");
    }

    this.openCodeTerminalCounter += 1;
    const id = `agent-${crypto.randomUUID()}`;
    const session = new HostTerminalSession(this.desktopBridge);
    const tab = this.createTerminalTab(
      "agent",
      `OpenCode ${this.openCodeTerminalCounter}`,
      focus,
      true,
      {
        id,
        session,
        inputMode: "passthrough",
      },
    );
    const { terminal } = tab;
    this.updateTerminalStatus(tab, "Starting host agent shell...");
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
        const signalSuffix = signal ? `, signal ${signal}` : "";
        this.updateTerminalStatus(tab, `Exited ${exitCode}${signalSuffix}`);
      });

      terminal.write(`Host shell: ${shell}\r\n`);
      terminal.write(`CWD: ${cwd}\r\n`);
      terminal.write(
        "almostnode bridge routing is enabled for shell commands.\r\n",
      );
      if (this.agentLaunchCommand) {
        terminal.write(
          `Launching ${this.agentLaunchCommand} with bridge routing enabled...\r\n`,
        );
      } else {
        terminal.write("Try: opencode | codex | cursor-cli\r\n");
      }
      this.updateTerminalStatus(
        tab,
        this.agentLaunchCommand
          ? `Launching ${this.agentLaunchCommand}`
          : "Host shell ready",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.write(`Failed to start host shell: ${message}\r\n`);
      this.updateTerminalStatus(tab, "Host shell failed");
    }

    return tab;
  }

  private disposeShellTerminalTab(id: string): void {
    const tab = this.terminalTabs.get(id);
    if (!tab) {
      return;
    }
    this.terminalTabs.delete(id);
    this.terminalSurface.removeTab(id);
    tab.runningAbortController?.abort();
    tab.terminal.dispose();
    tab.session.dispose();
  }

  private activateFallbackTerminalTab(focus: boolean): void {
    const nextShellTab = this.terminalTabs.values().next().value as
      | TerminalTabState
      | undefined;
    if (nextShellTab) {
      this.setActiveTerminalTab(nextShellTab.id);
      return;
    }

    const nextOpenCodeTab = this.openCodeTabs.values().next().value as
      | OpenCodeTabState
      | undefined;
    if (nextOpenCodeTab) {
      this.setActiveTerminalTab(nextOpenCodeTab.id);
      return;
    }

    this.createUserTerminalTab(focus);
  }

  private closeOpenCodeTab(
    id: string,
    options?: {
      restoreShell: boolean;
      restoreShellState?: OpenCodeBrowserShellState;
    },
  ): void {
    const tab = this.openCodeTabs.get(id);
    if (!tab) {
      return;
    }

    const wasActive = this.activeTerminalTabId === id;
    const nextShellState =
      options?.restoreShellState ?? tab.session.getShellState();
    this.openCodeTabs.delete(id);
    this.terminalSurface.removeTab(id);
    tab.session.dispose();

    if (options?.restoreShell && tab.restoreShellState) {
      this.createUserTerminalTab(wasActive, {
        id,
        title: tab.restoreTitle ?? undefined,
        cwd: nextShellState.cwd,
        env: nextShellState.env,
      });
      return;
    }

    if (wasActive) {
      this.activateFallbackTerminalTab(true);
    }
  }

  async revealOpenCodePanel(focus: boolean): Promise<void> {
    if (this.agentMode === "host") {
      await this.revealTerminalPanel(focus);
      const existing = this.openCodeTabs.values().next().value as
        | OpenCodeTabState
        | undefined;
      if (existing) {
        this.setActiveTerminalTab(existing.id);
        return;
      }

      await this.createOpenCodeTerminalTab(focus);
      return;
    }

    await this.revealOpenCodeSidebarView(focus);
    const existingTabId = this.hasAiSidebarTab(this.activeOpenCodeSidebarTabId)
      ? this.activeOpenCodeSidebarTabId
      : this.getFirstAiSidebarTabId();
    if (existingTabId) {
      this.setActiveAiSidebarTab(existingTabId);
      return;
    }

    await this.createOpenCodeSidebarTab(focus);
  }

  async revealKeychainPanel(): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.AUXILIARYBAR_PART, true);
    await paneCompositeService.openPaneComposite(
      this.workbenchSurfaces.keychainViewId,
      ViewContainerLocation.AuxiliaryBar,
      true,
    );
    this.updateKeychainSurface();
  }

  private updateKeychainSurface(state = this.keychain.getState()): void {
    const tailscaleStatus = this.tailscaleStatus;
    const tailscaleStatusText = this.formatTailscaleStatus(tailscaleStatus);
    const tailscaleAuthAction = this.getTailscaleSidebarAuthAction(
      tailscaleStatus,
    );
    const exitNodeOptions = tailscaleStatus?.exitNodes.map((exitNode) => ({
      value: exitNode.id,
      label: exitNode.online ? exitNode.name : `${exitNode.name} (offline)`,
    }));
    const slots = [
      {
        name: "tailscale",
        label: "Tailscale",
        active: tailscaleStatus?.state === "running",
        canAuth: true,
        authAction: tailscaleAuthAction,
        statusText: tailscaleStatusText,
        selectActionPrefix:
          exitNodeOptions && exitNodeOptions.length > 0
            ? "select-exit-node:tailscale"
            : undefined,
        selectOptions: exitNodeOptions,
        selectValue: tailscaleStatus?.selectedExitNodeId ?? undefined,
      },
      {
        name: "github",
        label: "GitHub",
        active: this.keychain.hasSlotData("github"),
        canAuth: true,
      },
      ...(this.keychain.hasSlotData("claude")
        ? [
            {
              name: "claude",
              label: "Claude Code",
              active: true,
            },
          ]
        : []),
      {
        name: "opencode",
        label: "OpenCode",
        active: this.keychain.hasSlotData("opencode"),
      },
      {
        name: "replay",
        label: "Replay.io",
        active: this.keychain.hasSlotData("replay"),
        canAuth: true,
      },
    ];
    this.keychainSurface.update(slots, {
      hasStoredVault: state.hasStoredVault,
      supported: state.supported,
    });
  }

  private getTailscaleSidebarAuthAction(
    status: NetworkStatus | null,
  ): "login:tailscale" | "logout:tailscale" {
    return status?.provider === "tailscale"
      && (status.canLogout || status.state === "running" || status.state === "starting")
      ? "logout:tailscale"
      : "login:tailscale";
  }

  private handleTailscaleKeychainTransition(): void {
    const hasTailscaleKeychainData = this.keychain.hasSlotData("tailscale");
    if (!hasTailscaleKeychainData) {
      const hadData = this.hadTailscaleKeychainData;
      this.hadTailscaleKeychainData = false;
      this.pendingTailscaleKeychainActivation = false;
      if (hadData) {
        this.keychain.notifyExternalStateChanged();
      }
      return;
    }

    if (!this.hadTailscaleKeychainData) {
      this.pendingTailscaleKeychainActivation = true;
    }
    this.hadTailscaleKeychainData = true;

    if (
      this.pendingTailscaleKeychainActivation
      && this.isTailscaleSessionReadyForKeychain(this.tailscaleStatus)
    ) {
      this.pendingTailscaleKeychainActivation = false;
      void this.keychain.handleExternalCredentialActivation();
    }
  }

  private isTailscaleSessionReadyForKeychain(
    status: NetworkStatus | null,
  ): boolean {
    return status?.provider === "tailscale" && status.state === "running";
  }

  private formatTailscaleStatus(status: NetworkStatus | null): string {
    if (!status) {
      return "Loading status";
    }

    const selectedExitNodeName =
      status.selectedExitNodeId
        ? status.exitNodes.find((exitNode) => exitNode.id === status.selectedExitNodeId)?.name
        : null;

    switch (status.state) {
      case "browser":
        return "Not connected";
      case "starting":
        return status.detail || "Starting";
      case "running":
        if (status.dnsEnabled && status.dnsHealthy === false) {
          return status.dnsDetail
            ? `Running, DNS issue: ${status.dnsDetail}`
            : "Running, DNS issue";
        }
        return selectedExitNodeName
          ? `Running via ${selectedExitNodeName}`
          : status.exitNodes.length > 0
            ? "Running, choose an exit node"
            : "Running, no exit nodes available";
      case "needs-login":
        return "Needs login";
      case "needs-machine-auth":
        return "Needs machine auth";
      case "locked":
        return "Locked";
      case "unavailable":
        return status.detail || "Unavailable";
      case "error":
        return status.detail || "Error";
      case "stopped":
      default:
        return "Stopped";
    }
  }

  private async keychainAuthAction(command: string): Promise<void> {
    await this.revealTerminalPanel(true);
    const tab = this.createUserTerminalTab(true);
    await this.runCommand(tab, command, { echoCommand: true });
  }

  private async tailscaleAuthAction(
    action: "login" | "logout",
  ): Promise<void> {
    try {
      if (action === "login") {
        await this.container.network.configure({
          provider: "tailscale",
          useExitNode: true,
        });
        this.tailscaleStatus = await this.container.network.login();
      } else {
        this.tailscaleStatus = await this.container.network.logout();
      }
    } catch (error) {
      if (action === "logout") {
        clearStoredWorkbenchNetworkConfig();
        clearStoredTailscaleSessionSnapshot();
      }
      this.tailscaleStatus = {
        provider: "tailscale",
        state: "error",
        active: false,
        canLogin: true,
        canLogout: false,
        adapterAvailable: false,
        dnsEnabled: true,
        dnsHealthy: null,
        exitNodes: [],
        selectedExitNodeId: null,
        detail: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
    }

    this.updateKeychainSurface();
  }

  private async selectTailscaleExitNode(exitNodeId: string): Promise<void> {
    try {
      this.tailscaleStatus = await this.container.network.configure({
        provider: "tailscale",
        useExitNode: true,
        exitNodeId: exitNodeId || null,
      });
    } catch (error) {
      this.tailscaleStatus = {
        provider: "tailscale",
        state: "error",
        active: false,
        canLogin: true,
        canLogout: false,
        adapterAvailable: false,
        dnsEnabled: true,
        dnsHealthy: null,
        exitNodes: [],
        selectedExitNodeId: null,
        detail: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
    }

    this.updateKeychainSurface();
  }
  async revealClaudePanel(focus: boolean): Promise<void> {
    if (this.agentMode === "browser" && this.getClaudeLauncherAvailable()) {
      await this.launchAiSession("claude");
      return;
    }

    await this.revealOpenCodePanel(focus);
  }

  private async runCommand(
    tab: TerminalTabState,
    command: string,
    options?: {
      echoCommand?: boolean;
      interceptAgentLaunch?: boolean;
    },
  ): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) {
      this.printPrompt(tab);
      return;
    }

    if (options?.echoCommand) {
      tab.terminal.write(trimmed);
      tab.terminal.write("\r\n");
    }

    if (
      this.agentMode === "browser"
      && tab.kind === "user"
      && options?.interceptAgentLaunch !== false
    ) {
      const openCodeLaunchArgs = parseOpenCodeLaunchCommand(trimmed);
      if (openCodeLaunchArgs) {
        await this.launchAiSession("opencode", {
          args: openCodeLaunchArgs,
        });
        this.writeTerminal(tab, "Launching OpenCode in the AI panel.\n");
        this.updateTerminalStatus(tab, "OpenCode moved to AI panel");
        this.printPrompt(tab);
        return;
      }
    }

    if (!(await this.keychain.prepareForCommand(trimmed))) {
      this.updateTerminalStatus(tab, "Keychain unlock required");
      this.writeTerminal(
        tab,
        "Keychain unlock is required before running this command.\n",
      );
      this.printPrompt(tab);
      return;
    }

    if (tab.runningAbortController) {
      throw new Error(`${tab.title} is already running a command`);
    }
    if (!tab.session.run) {
      this.updateTerminalStatus(tab, "Host shell attached");
      this.writeTerminal(
        tab,
        "This terminal is attached directly to the host shell.\n",
      );
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
    const resolved =
      command ||
      window.prompt("Command to run", this.getDefaults().runCommand) ||
      "";
    await this.runCommand(this.requireActiveTerminalTab(), resolved, {
      echoCommand: true,
    });
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
    if (lowerPath.endsWith(".md")) {
      const editorService = await getService(IEditorService);
      const input =
        this.workbenchSurfaces.renderedEditors.createMarkdownInput(path);
      await editorService.openEditor(input, { pinned: true });
      return;
    }

    // Route .json files to visual JSON editor
    if (lowerPath.endsWith(".json")) {
      const editorService = await getService(IEditorService);
      const input =
        this.workbenchSurfaces.renderedEditors.createJsonInput(path);
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
        "@codingame/monaco-vscode-api/vscode/src/vs/base/common/uri.js"
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

    const modelReference = await monaco.editor.createModelReference(
      URI.file(path),
    );
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
    const previewInput = this.workbenchSurfaces.previewInput;
    const existing = previewInput.resource
      ? editorService
          .findEditors(previewInput.resource)
          .find((identifier) => {
            return identifier.editor.typeId === previewInput.typeId;
          })
      : undefined;

    if (existing?.groupId !== undefined) {
      await editorService.openEditor(
        previewInput,
        {
          pinned: true,
        },
        existing.groupId,
      );
      return;
    }

    await editorService.openEditor(previewInput, {
      pinned: true,
    });
  }

  private async revealDatabaseEditor(): Promise<void> {
    const editorService = await getService(IEditorService);
    const databaseInput = this.workbenchSurfaces.databaseInput;
    const existing = databaseInput.resource
      ? editorService
          .findEditors(databaseInput.resource)
          .find((identifier) => {
            return identifier.editor.typeId === databaseInput.typeId;
          })
      : undefined;

    if (existing?.groupId !== undefined) {
      await editorService.openEditor(
        databaseInput,
        {
          pinned: true,
        },
        existing.groupId,
      );
      return;
    }

    await editorService.openEditor(databaseInput, {
      pinned: true,
    });
  }

  private async revealTerminalPanel(focus: boolean): Promise<void> {
    const paneCompositeService = await getService(IPaneCompositePartService);
    setPartVisibility(Parts.PANEL_PART, true);
    await paneCompositeService.openPaneComposite(
      this.workbenchSurfaces.terminalViewId,
      ViewContainerLocation.Panel,
      focus,
    );
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

    throw new Error("Preview server did not become ready in time.");
  }

  refreshPreview(): void {
    if (!this.previewUrl) {
      return;
    }

    this.consolePanel.clear();
    this.consoleMessageCount = 0;
    this.terminalSurface.updateTabStatus(this.consoleTabId, "");
    this.previewSurface.reload();
  }

  async focusTerminal(): Promise<void> {
    await this.revealTerminalPanel(true);
  }

  async executeWorkbenchCommand(
    command: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const commandService = await getService(ICommandService);
    return commandService.executeCommand(command, ...args);
  }

  async setWorkbenchColorTheme(themeId: string): Promise<void> {
    const themeService = await getService(IWorkbenchThemeService);
    const resolvedThemeId = await this.resolveWorkbenchColorThemeId(
      themeService,
      themeId,
    );
    const appliedTheme = await themeService.setColorTheme(
      resolvedThemeId,
      ConfigurationTarget.WORKSPACE,
    );
    this.applyWorkbenchThemeKind(
      appliedTheme
        ? normalizeWorkbenchThemeKind(appliedTheme)
        : (inferThemeKindFromThemeName(themeId) ?? this.workbenchThemeKind),
    );
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
      throw new Error("Extension services are not initialized.");
    }

    const [extension] = await withTimeout(
      this.extensionServices.galleryService.getExtensions([
        { id: extensionId },
      ]),
      `Timed out while resolving extension ${extensionId}.`,
    );
    if (!extension) {
      throw new Error(
        `Extension ${extensionId} was not found in the marketplace.`,
      );
    }

    await withTimeout(
      this.extensionServices.managementService.installFromGallery(extension),
      `Timed out while installing extension ${extensionId}.`,
    );
  }

  async setExtensionEnabled(
    extensionId: string,
    enabled: boolean,
  ): Promise<void> {
    if (!this.extensionServices) {
      throw new Error("Extension services are not initialized.");
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      `Timed out while listing installed extensions for ${extensionId}.`,
    );
    const extension = installed.find(
      (candidate) => candidate.identifier.id === extensionId,
    );
    if (!extension) {
      throw new Error(`Extension ${extensionId} is not installed.`);
    }

    await withTimeout(
      this.extensionServices.enablementService.setEnablement(
        [extension],
        enabled
          ? EnablementState.EnabledGlobally
          : EnablementState.DisabledGlobally,
      ),
      `Timed out while updating enablement for ${extensionId}.`,
    );
  }

  async uninstallExtension(extensionId: string): Promise<void> {
    if (!this.extensionServices) {
      throw new Error("Extension services are not initialized.");
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      `Timed out while listing installed extensions for ${extensionId}.`,
    );
    const extension = installed.find(
      (candidate) => candidate.identifier.id === extensionId,
    );
    if (!extension) {
      throw new Error(`Extension ${extensionId} is not installed.`);
    }

    await withTimeout(
      this.extensionServices.managementService.uninstall(extension),
      `Timed out while uninstalling extension ${extensionId}.`,
    );
  }

  async listInstalledExtensions(): Promise<
    Array<{ id: string; enabled: boolean }>
  > {
    if (!this.extensionServices) {
      return [];
    }

    const installed = await withTimeout(
      this.extensionServices.managementService.getInstalled(),
      "Timed out while listing installed extensions.",
    );
    return installed.map((extension) => ({
      id: extension.identifier.id,
      enabled:
        this.extensionServices?.enablementService.isEnabled(extension) ?? false,
    }));
  }

  async searchWorkspaceText(pattern: string): Promise<string[]> {
    const searchService = await getService(ISearchService);
    const start = Date.now();

    while (
      !searchService.schemeHasFileSearchProvider("file") &&
      Date.now() - start < 5000
    ) {
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
        if (!message.includes("Search provider not initialized")) {
          throw error;
        }
        await delay(100);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(
          `Search provider did not initialize for pattern "${pattern}".`,
        );
  }

  private createSearchProvider(): WorkspaceSearchProvider {
    return {
      search: async (options) => {
        const searchService = await getService(ISearchService);
        const start = Date.now();

        // Wait for search provider to initialize (same retry as searchWorkspaceText)
        while (
          !searchService.schemeHasFileSearchProvider("file") &&
          Date.now() - start < 5000
        ) {
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
              for (const p of options.includePattern.split(",")) {
                if (p.trim()) patterns[p.trim()] = true;
              }
              query.includePattern = patterns;
            }
            if (options.excludePattern) {
              const patterns: Record<string, boolean> = {};
              for (const p of options.excludePattern.split(",")) {
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
                  if (
                    "rangeLocations" in textResult &&
                    textResult.rangeLocations
                  ) {
                    const match = textResult as {
                      rangeLocations: Array<{
                        source: {
                          startLineNumber: number;
                          startColumn: number;
                          endColumn: number;
                        };
                        preview: { startColumn: number; endColumn: number };
                      }>;
                      previewText: string;
                    };
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
            const message =
              error instanceof Error ? error.message : String(error);
            if (!message.includes("Search provider not initialized")) {
              throw error;
            }
            await delay(100);
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("Search provider did not initialize.");
      },
    };
  }

  private bindTerminal(tab: TerminalTabState): void {
    if (tab.inputMode === "passthrough") {
      tab.terminal.onData((data) => {
        tab.session.sendInput(data);
      });
      return;
    }

    tab.terminal.onData((data) => {
      // Interactive CLIs need raw input passthrough while they own the terminal.
      if (tab.runningAbortController) {
        if (data === "\u0003") {
          tab.runningAbortController.abort();
          tab.session.sendInput(data);
          tab.terminal.write("^C");
          return;
        }

        tab.session.sendInput(data);
        return;
      }

      if (data === "\u0003") {
        tab.currentLine = "";
        this.printPrompt(tab);
        return;
      }

      if (data === "\r") {
        const command = tab.currentLine;
        tab.currentLine = "";
        tab.historyIndex = -1;
        if (command.trim()) {
          tab.history.unshift(command);
        }
        tab.terminal.write("\r\n");
        void this.runCommand(tab, command);
        return;
      }

      if (data === "\u007F") {
        if (tab.currentLine.length > 0) {
          tab.currentLine = tab.currentLine.slice(0, -1);
          tab.terminal.write("\b \b");
        }
        return;
      }

      if (data === "\u001b[A") {
        if (tab.history.length === 0) return;
        tab.historyIndex = Math.min(
          tab.historyIndex + 1,
          tab.history.length - 1,
        );
        this.replaceTerminalLine(tab, tab.history[tab.historyIndex] || "");
        return;
      }

      if (data === "\u001b[B") {
        if (tab.history.length === 0) return;
        tab.historyIndex = Math.max(tab.historyIndex - 1, -1);
        this.replaceTerminalLine(
          tab,
          tab.historyIndex >= 0 ? tab.history[tab.historyIndex] || "" : "",
        );
        return;
      }

      if (data >= " ") {
        tab.currentLine += data;
        tab.terminal.write(data);
      }
    });
  }

  private replaceTerminalLine(tab: TerminalTabState, nextValue: string): void {
    while (tab.currentLine.length > 0) {
      tab.terminal.write("\b \b");
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
        return WORKBENCH_WORKERS[label as keyof typeof WORKBENCH_WORKERS]
          ?.options;
      },
    };
  }

  private buildKeychainStatusEntry(
    state = this.keychain.getState(),
  ): IStatusbarEntry {
    if (state.busy) {
      return {
        name: "Keychain",
        text: "$(sync~spin) Keychain",
        ariaLabel: "Keychain action in progress",
        tooltip: "Keychain action in progress",
        command: "almostnode.keychain.primary",
      };
    }

    if (!state.supported) {
      return {
        name: "Keychain",
        text: "$(shield) Keychain",
        ariaLabel: "Keychain unavailable",
        tooltip: "Passkey-backed keychain is unavailable in this browser.",
        command: "almostnode.keychain.primary",
      };
    }

    if (state.hasStoredVault && !state.hasLiveCredentials) {
      return {
        name: "Keychain",
        text: "$(lock) Keychain",
        ariaLabel: "Unlock saved keychain",
        tooltip: "Unlock the saved keychain for this browser.",
        command: "almostnode.keychain.primary",
      };
    }

    if (state.hasLiveCredentials && !state.hasStoredVault) {
      return {
        name: "Keychain",
        text: "$(key) Save Keychain",
        ariaLabel: "Save keychain",
        tooltip: "Save credentials for this browser with a passkey.",
        command: "almostnode.keychain.primary",
      };
    }

    return {
      name: "Keychain",
      text: state.hasStoredVault
        ? "$(shield) Keychain Saved"
        : "$(shield) Keychain",
      ariaLabel: state.hasStoredVault
        ? "Keychain is saved for this browser"
        : "Keychain",
      tooltip: state.hasStoredVault
        ? "Keychain is available for this browser."
        : "No keychain has been saved for this browser.",
      command: "almostnode.keychain.primary",
    };
  }

  private updateKeychainStatusEntry(state = this.keychain.getState()): void {
    this.keychainStatusEntry?.update(this.buildKeychainStatusEntry(state));
  }

  private async registerStatusbarEntries(): Promise<void> {
    const statusbarService = await getService(IStatusbarService);
    const agentLabel = "OpenCode";
    statusbarService.addEntry(
      {
        name: "Run",
        text: "$(play) Run",
        ariaLabel: "Run workspace command",
        tooltip: "Run a workspace command",
        command: "almostnode.run",
      },
      "almostnode.status.run",
      StatusbarAlignment.LEFT,
      { primary: 1000, secondary: 1000 },
    );

    statusbarService.addEntry(
      {
        name: "Preview",
        text: "$(globe) Preview",
        ariaLabel: "Open preview",
        tooltip: "Open the preview tab",
        command: "almostnode.preview.open",
      },
      "almostnode.status.preview",
      StatusbarAlignment.LEFT,
      { primary: 999, secondary: 999 },
    );

    statusbarService.addEntry(
      {
        name: "Terminal",
        text: "$(terminal) Terminal",
        ariaLabel: "Focus terminal",
        tooltip: "Focus the terminal panel",
        command: "almostnode.terminal.focus",
      },
      "almostnode.status.terminal",
      StatusbarAlignment.LEFT,
      { primary: 998, secondary: 998 },
    );

    statusbarService.addEntry(
      {
        name: agentLabel,
        text: `$(sparkle) ${agentLabel}`,
        ariaLabel: `Open ${agentLabel}`,
        tooltip:
          this.agentMode === "host"
            ? "Open the host OpenCode terminal"
            : "Open OpenCode",
        command: "almostnode.opencode.open",
      },
      "almostnode.status.opencode",
      StatusbarAlignment.LEFT,
      { primary: 997, secondary: 997 },
    );

    if (this.agentMode === "browser") {
      this.keychainStatusEntry = statusbarService.addEntry(
        this.buildKeychainStatusEntry(),
        "almostnode.status.keychain",
        StatusbarAlignment.LEFT,
        { primary: 996, secondary: 996 },
      );
    }
  }

  private resolveMarketplaceClient() {
    if (this.marketplaceMode === "fixtures") {
      return {
        client: new FixtureMarketplaceClient(),
        baseUrl: "https://fixtures.almostnode.invalid",
      };
    }

    return {
      client: new OpenVSXClient(),
      baseUrl: "https://open-vsx.org",
    };
  }

  private async initWorkbench(): Promise<void> {
    const userDataProvider = await createIndexedDBProviders();
    await prunePersistedWorkbenchExtensions(userDataProvider);
    registerWorkbenchLanguages();

    const provider = new VfsFileSystemProvider(
      this.container.vfs,
      WORKSPACE_ROOT,
    );
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
        additionalTrustedDomains: ["https://open-vsx.org"],
        enableWorkspaceTrust: true,
        defaultLayout: {
          force: true,
          views: [
            { id: this.workbenchSurfaces.filesViewId },
            { id: this.workbenchSurfaces.terminalViewId },
          ],
        },
        configurationDefaults: {
          "workbench.startupEditor": "none",
          "editor.minimap.enabled": false,
          "files.autoSave": "afterDelay",
          "extensions.autoCheckUpdates": false,
          "extensions.autoUpdate": false,
        },
        productConfiguration: {
          nameShort: "almostnode",
          nameLong: "almostnode webide",
          applicationName: "almostnode-webide",
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
            id: "almostnode.run",
            label: "Almostnode: Run Command",
            menu: Menu.CommandPalette,
            handler: (...args: unknown[]) =>
              this.executeHostCommand(
                typeof args[0] === "string" ? args[0] : undefined,
              ),
          },
          {
            id: "almostnode.preview.open",
            label: "Almostnode: Open Preview",
            menu: Menu.CommandPalette,
            handler: () => this.openPreview(),
          },
          {
            id: "almostnode.preview.refresh",
            label: "Almostnode: Refresh Preview",
            menu: Menu.CommandPalette,
            handler: () => this.refreshPreview(),
          },
          {
            id: "almostnode.terminal.focus",
            label: "Almostnode: Focus Terminal",
            menu: Menu.CommandPalette,
            handler: () => this.focusTerminal(),
          },
          {
            id: "almostnode.opencode.open",
            label: "Almostnode: Open OpenCode",
            menu: Menu.CommandPalette,
            handler: () => this.revealOpenCodePanel(true),
          },
          {
            id: "almostnode.claude.open",
            label: "Almostnode: Open Claude Code",
            menu: Menu.CommandPalette,
            handler: () => this.revealClaudePanel(true),
          },
          {
            id: "almostnode.keychain.primary",
            label: "Almostnode: Open Keychain",
            handler: () => this.revealKeychainPanel(),
          },
          {
            id: "almostnode.keychain.unlock",
            label: "Almostnode: Unlock Keychain",
            menu: Menu.CommandPalette,
            handler: () => this.unlockKeychain(),
          },
          {
            id: "almostnode.keychain.forget",
            label: "Almostnode: Forget Keychain",
            menu: Menu.CommandPalette,
            handler: () => this.forgetKeychain(),
          },
        ],
      },
    );

    await this.registerStatusbarEntries();

    const editorService = await getService(IEditorService);

    // Open preview as the only editor (no default source file)
    await editorService.openEditor(this.workbenchSurfaces.previewInput, {
      pinned: true,
      preserveFocus: true,
    });

    // Keep terminal collapsed by default
    setPartVisibility(Parts.PANEL_PART, false);

    // Set sidebar to 600px initial width
    const layoutService = await getService(IWorkbenchLayoutService);
    const currentSize = layoutService.getSize(Parts.SIDEBAR_PART);
    layoutService.setSize(Parts.SIDEBAR_PART, {
      width: 600,
      height: currentSize.height,
    });

    // Inject custom-ui-style.stylesheet CSS from workspace settings
    this.injectCustomUiStylesheet();

    await this.applyConfiguredWorkbenchTheme();
    this.listenForWorkbenchThemeChanges();
  }

  private readWorkspaceSettings(): Record<string, unknown> | null {
    try {
      const settingsPath = `${WORKSPACE_ROOT}/.vscode/settings.json`;
      const raw = this.container.vfs.readFileSync(settingsPath, "utf8");
      return JSON.parse(raw as string) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private primeWorkbenchThemeFromWorkspaceSettings(): void {
    const configuredTheme = this.readConfiguredWorkbenchTheme();
    this.applyWorkbenchThemeKind(
      inferThemeKindFromThemeName(configuredTheme) ?? "dark",
    );
  }

  private readConfiguredWorkbenchTheme(): string | null {
    const settings = this.readWorkspaceSettings();
    return typeof settings?.["workbench.colorTheme"] === "string"
      ? settings["workbench.colorTheme"]
      : null;
  }

  private injectCustomUiStylesheet(): void {
    const settings = this.readWorkspaceSettings();
    const stylesheet = settings?.["custom-ui-style.stylesheet"];
    const cssRules: string[] = [];

    if (stylesheet && typeof stylesheet === "object") {
      for (const [selector, properties] of Object.entries(stylesheet)) {
        if (!properties || typeof properties !== "object") continue;
        const declarations = Object.entries(
          properties as Record<string, string>,
        )
          .map(([prop, value]) => `  ${prop}: ${value};`)
          .join("\n");
        cssRules.push(`${selector} {\n${declarations}\n}`);
      }
    }

    const style = document.createElement("style");
    style.id = "almostnode-custom-ui-style";
    style.textContent =
      cssRules.join("\n\n") +
      "\n\n" +
      LAYOUT_OVERRIDES +
      "\n\n" +
      LIGHT_MODE_OVERRIDES;
    document.head.appendChild(style);
  }

  private applyWorkbenchThemeKind(themeKind: WorkbenchThemeKind): void {
    this.workbenchThemeKind = themeKind;
    document.documentElement.dataset.almostnodeTheme = themeKind;
    document.documentElement.style.colorScheme = themeKind;
    this.workbench.dataset.almostnodeTheme = themeKind;

    const terminalTheme = getTerminalTheme(themeKind);
    for (const tab of this.terminalTabs.values()) {
      tab.terminal.options.theme = terminalTheme;
    }

    for (const tab of this.openCodeSidebarTerminalTabs.values()) {
      tab.terminal.options.theme = terminalTheme;
    }

    for (const tab of this.openCodeTabs.values()) {
      tab.session.setThemeMode(themeKind);
    }

    for (const tab of this.openCodeSidebarTabs.values()) {
      tab.session?.setThemeMode(themeKind);
    }
  }

  private async syncWorkbenchTheme(): Promise<void> {
    const themeService = await getService(IWorkbenchThemeService);
    const currentTheme = (
      themeService as IWorkbenchThemeService & {
        getColorTheme?: () => { type?: string };
      }
    ).getColorTheme?.();
    if (currentTheme) {
      this.applyWorkbenchThemeKind(normalizeWorkbenchThemeKind(currentTheme));
    }
  }

  private async resolveWorkbenchColorThemeId(
    themeService: IWorkbenchThemeService,
    themeReference: string,
  ): Promise<string> {
    const normalizedReference = themeReference.trim().toLowerCase();
    if (!normalizedReference) {
      return themeReference;
    }

    try {
      const themes = await themeService.getColorThemes();
      const resolvedTheme = themes.find((theme) =>
        [theme.id, theme.label, theme.settingsId].some((value) => {
          return value?.trim().toLowerCase() === normalizedReference;
        }),
      );
      return resolvedTheme?.id ?? themeReference;
    } catch {
      return themeReference;
    }
  }

  private workbenchThemeMatchesReference(
    theme:
      | {
          id?: string | null;
          label?: string | null;
          settingsId?: string | null;
        }
      | null
      | undefined,
    themeReference: string,
  ): boolean {
    const normalizedReference = themeReference.trim().toLowerCase();
    if (!normalizedReference || !theme) {
      return false;
    }

    return [theme.id, theme.label, theme.settingsId].some((value) => {
      return value?.trim().toLowerCase() === normalizedReference;
    });
  }

  private async applyConfiguredWorkbenchTheme(): Promise<void> {
    const configuredTheme = this.readConfiguredWorkbenchTheme();
    if (!configuredTheme) {
      await this.syncWorkbenchTheme();
      return;
    }

    const themeService = await getService(IWorkbenchThemeService);
    const currentTheme = themeService.getColorTheme?.();

    if (this.workbenchThemeMatchesReference(currentTheme, configuredTheme)) {
      this.applyWorkbenchThemeKind(normalizeWorkbenchThemeKind(currentTheme));
      return;
    }

    const resolvedThemeId = await this.resolveWorkbenchColorThemeId(
      themeService,
      configuredTheme,
    );
    const appliedTheme = await themeService.setColorTheme(
      resolvedThemeId,
      ConfigurationTarget.WORKSPACE,
    );
    this.applyWorkbenchThemeKind(
      appliedTheme
        ? normalizeWorkbenchThemeKind(appliedTheme)
        : (inferThemeKindFromThemeName(configuredTheme) ?? "dark"),
    );
  }

  private listenForWorkbenchThemeChanges(): void {
    void getService(IWorkbenchThemeService).then((themeService) => {
      themeService.onDidColorThemeChange((theme) => {
        this.applyWorkbenchThemeKind(normalizeWorkbenchThemeKind(theme));
      });
    });
  }

  private async initPGliteIfNeeded(): Promise<void> {
    const schemaPath = `${WORKSPACE_ROOT}/schema.sql`;
    const hasSchema = this.container.vfs.existsSync(schemaPath);
    const hasDrizzleDir = (() => {
      try {
        return this.container.vfs
          .statSync(`${WORKSPACE_ROOT}/drizzle`)
          .isDirectory();
      } catch {
        return false;
      }
    })();

    // Import db-manager lazily
    const {
      listDatabases,
      ensureDefaultDatabase,
      getIdbPath,
      getActiveDatabase,
      setActiveDatabase,
      setDatabaseNamespace,
      createDatabase,
      deleteDatabase,
    } = await import("../../../../packages/almostnode/src/pglite/db-manager");
    const namespace = setDatabaseNamespace(this.currentProjectDatabaseNamespace);
    const hasExistingDbs = listDatabases(namespace).length > 0;

    if (!hasSchema && !hasDrizzleDir && !hasExistingDbs) {
      this.previewSurface.setActiveDb(null);
      this.databaseSurface.update([], null);
      return;
    }

    try {
      if (!this.databaseSidebarRegistered) {
        const { registerCustomView } =
          await import("@codingame/monaco-vscode-workbench-service-override");
        registerCustomView({
          id: "almostnode.sidebar.database",
          name: "Database",
          location: ViewContainerLocation.Sidebar,
          order: 1,
          icon:
            "data:image/svg+xml," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
            ),
          renderBody: (container) => this.databaseSurface.attach(container),
        });
        this.databaseSidebarRegistered = true;
      }

      const activeName = ensureDefaultDatabase(namespace);

      // Load PGlite and init instance (with migration support)
      const { initAndMigrate } =
        await import("../../../../packages/almostnode/src/pglite/pglite-database");
      await initAndMigrate(
        activeName,
        this.container.vfs,
        getIdbPath(activeName, namespace),
      );
      console.log(`[pglite] Database "${activeName}" ready`);

      // Register middleware
      if (!this.pgliteMiddleware) {
        const { createPGliteMiddleware } =
          await import("../../../../packages/almostnode/src/pglite/bridge-middleware");
        this.pgliteMiddleware = createPGliteMiddleware();
        this.container.serverBridge.registerMiddleware(this.pgliteMiddleware);
      }

      // Set active DB on preview surface
      this.previewSurface.setActiveDb(activeName);

      // Update database panel
      this.databaseSurface.update(listDatabases(namespace), activeName);

      // Set up database browser query handler
      this.databaseBrowserSurface.setQueryHandler(
        async (operation, body, dbName) => {
          const { handleDatabaseRequest } =
            await import("../../../../packages/almostnode/src/pglite/pglite-database");
          return handleDatabaseRequest(operation, body, dbName);
        },
      );
      this.databaseBrowserSurface.setDatabase(activeName);

      // Wire database panel callbacks
      this.databaseSurface.setCallbacks({
        onOpen: async (name: string) => {
          try {
            const callbackNamespace = setDatabaseNamespace(
              this.currentProjectDatabaseNamespace,
            );
            // Switch active database if different
            const currentActive = getActiveDatabase(callbackNamespace);
            if (currentActive !== name) {
              const { closePGliteInstance, initAndMigrate: initMigrate } =
                await import("../../../../packages/almostnode/src/pglite/pglite-database");
              if (currentActive) await closePGliteInstance(currentActive);
              setActiveDatabase(name, callbackNamespace);
              await initMigrate(
                name,
                this.container.vfs,
                getIdbPath(name, callbackNamespace),
              );
              this.previewSurface.setActiveDb(name);
              this.databaseSurface.update(listDatabases(callbackNamespace), name);
            }
            // Update browser surface and open tab
            this.databaseBrowserSurface.setDatabase(name);
            await this.revealDatabaseEditor();
          } catch (err) {
            console.error("[pglite] Open database browser failed:", err);
          }
        },
        onSwitch: async (name: string) => {
          try {
            const callbackNamespace = setDatabaseNamespace(
              this.currentProjectDatabaseNamespace,
            );
            const { closePGliteInstance, initAndMigrate: initMigrate } =
              await import("../../../../packages/almostnode/src/pglite/pglite-database");
            const oldActive = getActiveDatabase(callbackNamespace);
            if (oldActive) await closePGliteInstance(oldActive);
            setActiveDatabase(name, callbackNamespace);
            await initMigrate(
              name,
              this.container.vfs,
              getIdbPath(name, callbackNamespace),
            );
            this.previewSurface.setActiveDb(name);
            this.databaseSurface.update(listDatabases(callbackNamespace), name);
            this.databaseBrowserSurface.setDatabase(name);
            console.log(`[pglite] Switched to database "${name}"`);
          } catch (err) {
            console.error("[pglite] Switch failed:", err);
          }
        },
        onCreate: async (name: string) => {
          try {
            const callbackNamespace = setDatabaseNamespace(
              this.currentProjectDatabaseNamespace,
            );
            createDatabase(name, callbackNamespace);
            const { initAndMigrate: initMigrate } =
              await import("../../../../packages/almostnode/src/pglite/pglite-database");
            await initMigrate(
              name,
              this.container.vfs,
              getIdbPath(name, callbackNamespace),
            );
            this.databaseSurface.update(
              listDatabases(callbackNamespace),
              getActiveDatabase(callbackNamespace),
            );
            console.log(`[pglite] Created database "${name}"`);
          } catch (err) {
            console.error("[pglite] Create failed:", err);
          }
        },
        onDelete: async (name: string) => {
          try {
            const callbackNamespace = setDatabaseNamespace(
              this.currentProjectDatabaseNamespace,
            );
            const { closePGliteInstance: closeInst } =
              await import("../../../../packages/almostnode/src/pglite/pglite-database");
            await closeInst(name);
            deleteDatabase(name, callbackNamespace);
            let active = getActiveDatabase(callbackNamespace);
            if (!active) {
              const newActive = ensureDefaultDatabase(callbackNamespace);
              const { initAndMigrate: initMigrate } =
                await import("../../../../packages/almostnode/src/pglite/pglite-database");
              await initMigrate(
                newActive,
                this.container.vfs,
                getIdbPath(newActive, callbackNamespace),
              );
              this.previewSurface.setActiveDb(newActive);
              this.databaseBrowserSurface.setDatabase(newActive);
              active = newActive;
            }
            this.databaseSurface.update(listDatabases(callbackNamespace), active);
            console.log(`[pglite] Deleted database "${name}"`);
          } catch (err) {
            console.error("[pglite] Delete failed:", err);
          }
        },
      });
    } catch (err) {
      console.error("[pglite] Init failed:", err);
    }
  }

  private async ensureGitInitialized(project?: Pick<ProjectRecord, "gitRemote">): Promise<void> {
    if (!this.container.vfs.existsSync(`${WORKSPACE_ROOT}/.git`)) {
      await this.runWorkspaceGitCommand("git init");
      await this.runWorkspaceGitCommand("git add .");
      await this.runWorkspaceGitCommand('git commit -m "Initial commit"');
    }

    if (project?.gitRemote) {
      await this.ensureProjectRemote(project.gitRemote);
    }
  }

  private async ensureProjectRemote(remote: ProjectGitRemoteRecord): Promise<void> {
    const remoteName = remote.name || "origin";
    const current = await this.container.run(
      `git remote get-url ${this.quoteShellArg(remoteName)}`,
      { cwd: WORKSPACE_ROOT },
    );

    if (current.exitCode === 0) {
      if (current.stdout.trim() === remote.url) {
        return;
      }
      await this.runWorkspaceGitCommand(
        `git remote set-url ${this.quoteShellArg(remoteName)} ${this.quoteShellArg(remote.url)}`,
      );
      return;
    }

    await this.runWorkspaceGitCommand(
      `git remote add ${this.quoteShellArg(remoteName)} ${this.quoteShellArg(remote.url)}`,
    );
  }

  private async runWorkspaceGitCommand(command: string): Promise<RunResult> {
    const result = await this.container.run(command, { cwd: WORKSPACE_ROOT });
    if (result.exitCode !== 0) {
      throw new Error(
        (result.stderr || result.stdout || `${command} failed`).trim(),
      );
    }
    return result;
  }

  private quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  private toGitHubRepositoryName(projectName: string): string {
    const slug = projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    return slug || "untitled-project";
  }

  private resolveGitHubCorsProxy(): string | null {
    try {
      const stored = window.localStorage.getItem("__corsProxyUrl");
      if (stored !== null) {
        const trimmed = stored.trim();
        return trimmed || null;
      }
    } catch {
      // Ignore storage failures.
    }

    if (
      typeof window !== "undefined"
      && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
    ) {
      return `${window.location.origin}/__api/cors-proxy?url=`;
    }

    return null;
  }

  private async fetchGitHubApi(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const corsProxy = this.resolveGitHubCorsProxy();
    const attempts = corsProxy
      ? [`${corsProxy}${encodeURIComponent(url)}`, url]
      : [url];

    let lastResponse: Response | null = null;
    let lastError: unknown = null;

    for (let index = 0; index < attempts.length; index += 1) {
      try {
        const response = await fetch(attempts[index]!, init);
        if (response.ok || index === attempts.length - 1) {
          return response;
        }
        lastResponse = response;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastResponse) {
      return lastResponse;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`GitHub API request failed for ${url}`);
  }

  private migrateLegacyTestsToWorkspace(): void {
    const vfs = this.container.vfs;

    if (!vfs.existsSync(LEGACY_TESTS_ROOT)) {
      return;
    }

    if (
      vfs.existsSync(LEGACY_TEST_E2E_ROOT) &&
      !vfs.existsSync(WORKSPACE_TEST_E2E_ROOT)
    ) {
      if (!vfs.existsSync(WORKSPACE_TESTS_ROOT)) {
        vfs.mkdirSync(WORKSPACE_TESTS_ROOT, { recursive: true });
      }
      vfs.renameSync(LEGACY_TEST_E2E_ROOT, WORKSPACE_TEST_E2E_ROOT);
    }

    if (
      vfs.existsSync(LEGACY_TEST_METADATA_PATH) &&
      !vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)
    ) {
      const raw = vfs.readFileSync(LEGACY_TEST_METADATA_PATH, "utf8") as string;
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.tests)) {
          data.tests = data.tests.map((test: Record<string, unknown>) => {
            const specPath =
              typeof test.specPath === "string"
                ? test.specPath.replace(
                    LEGACY_TEST_E2E_ROOT,
                    WORKSPACE_TEST_E2E_ROOT,
                  )
                : test.specPath;
            return { ...test, specPath };
          });
          if (!vfs.existsSync(WORKSPACE_TESTS_ROOT)) {
            vfs.mkdirSync(WORKSPACE_TESTS_ROOT, { recursive: true });
          }
          vfs.writeFileSync(
            WORKSPACE_TEST_METADATA_PATH,
            JSON.stringify(data, null, 2),
          );
        }
      } catch {
        // Ignore malformed legacy metadata and leave it in place.
      }
    }

    try {
      if (
        vfs.existsSync(LEGACY_TEST_METADATA_PATH) &&
        vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)
      ) {
        vfs.unlinkSync(LEGACY_TEST_METADATA_PATH);
      }
    } catch {
      // Ignore cleanup failures.
    }

    try {
      if (
        vfs.existsSync(LEGACY_TESTS_ROOT) &&
        vfs.readdirSync(LEGACY_TESTS_ROOT).length === 0
      ) {
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
        console.log(
          `[memory] ${label}: ${(m.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(m.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB`,
        );
      }
    };

    logMemory("before workspace seed");
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
    this.primeWorkbenchThemeFromWorkspaceSettings();

    this.installWorkerEnvironment();
    const initialTab = this.createUserTerminalTab(false);
    await this.keychain.init();
    this.updateAiLauncherSurface();
    this.container.setKeychain(this.keychain);
    this.container.setSearchProvider(this.createSearchProvider());
    this.updatePreviewStatus("Waiting for a preview server");
    this.updateTerminalStatus(initialTab, "Idle");

    // Add Console tab as a custom (non-terminal) tab in the terminal panel
    this.terminalSurface.addCustomTab({
      id: this.consoleTabId,
      title: "Console",
      element: this.consolePanel.root,
      closable: false,
    });
    this.removeHostConsoleBridge?.();
    this.removeHostConsoleBridge = installHostConsoleBridge(
      (level, args, timestamp) => {
        this.addConsoleEntry(level, args, timestamp);
      },
    );

    // Listen for console messages from the preview iframe
    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "almostnode-console") return;
      const { level, args, timestamp } = event.data;
      if (!level || !Array.isArray(args)) return;
      this.addConsoleEntry(level, args, timestamp || Date.now());
    });

    this.container.on("server-ready", (_port: unknown, url: unknown) => {
      if (typeof _port !== "number" || typeof url !== "string") {
        return;
      }
      this.previewPort = _port;
      this.previewUrl = `${url}/`;
      this.previewStartRequested = false;
      this.clearScheduledPreviewStartRetry();
      this.previewSurface.setUrl(this.previewUrl);

      const iframe = this.previewSurface.getIframe();
      const registerHMRTarget = () => {
        if (iframe.contentWindow && this.previewPort !== null) {
          this.container.setHMRTargetForPort(
            this.previewPort,
            iframe.contentWindow,
          );
        }
      };
      iframe.addEventListener("load", registerHMRTarget, { once: true });
      // Also register immediately if iframe is already loaded
      registerHMRTarget();

      const previewTab = this.previewTerminalTabId
        ? this.terminalTabs.get(this.previewTerminalTabId)
        : null;
      if (previewTab) {
        this.updateTerminalStatus(
          previewTab,
          `Preview ready: ${this.previewUrl}`,
        );
      }
    });

    this.container.on("server-unregistered", (port: unknown) => {
      if (typeof port !== "number" || port !== this.previewPort) {
        return;
      }

      this.previewPort = null;
      this.previewUrl = null;
      this.previewStartRequested = false;
      this.clearScheduledPreviewStartRetry();
      this.previewSurface.clear(
        "Preview server stopped. Run the workspace to start it again.",
      );
      const previewTab = this.previewTerminalTabId
        ? this.terminalTabs.get(this.previewTerminalTabId)
        : null;
      if (previewTab) {
        this.updateTerminalStatus(previewTab, "Preview server stopped");
      }
    });

    logMemory("before service worker init");
    try {
      await this.container.serverBridge.initServiceWorker();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to initialize service worker";
      this.updatePreviewStatus(message);
    }

    logMemory("before workbench init");
    await this.initWorkbench();
    logMemory("after workbench init");

    // ── PGlite database initialization (after workbench is ready) ──
    void this.initPGliteIfNeeded();

    // ── Test recorder initialization (after workbench is ready) ──
    void this.initTestRecorder();

    if (!this.deferPreviewStart) {
      this.ensurePreviewServerRunning();
    }
    window.__almostnodeWebIDE = this;

    logMemory("before opencode boot");
    const searchParams = new URLSearchParams(window.location.search);
    const skipOpenCode =
      searchParams.has("no-opencode") || searchParams.has("no-claude");
    if (!skipOpenCode) {
      void this.revealOpenCodePanel(false);
    }
  }

  private readWorkspaceFileText(path: string): string | null {
    if (!this.container.vfs.existsSync(path)) {
      return null;
    }

    try {
      const raw: unknown = this.container.vfs.readFileSync(path);
      if (typeof raw === "string") {
        return raw;
      }
      if (raw instanceof Uint8Array) {
        return new TextDecoder().decode(raw);
      }
      if (raw && typeof raw === "object" && ArrayBuffer.isView(raw)) {
        const view = raw as ArrayBufferView;
        return new TextDecoder().decode(
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        );
      }
      if (raw instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(raw));
      }
      return String(raw);
    } catch {
      return null;
    }
  }

  private getWorkspaceDependencyInstallKey(): string | null {
    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    const packageJson = this.readWorkspaceFileText(packageJsonPath);
    if (!packageJson) {
      return null;
    }

    const parts = [`package.json:${packageJson}`];
    for (const lockFile of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
      const lockPath = `${WORKSPACE_ROOT}/${lockFile}`;
      const lockContents = this.readWorkspaceFileText(lockPath);
      if (lockContents !== null) {
        parts.push(`${lockFile}:${lockContents}`);
      }
    }

    return parts.join("\n\n");
  }

  private async ensureWorkspaceDependenciesInstalled(): Promise<void> {
    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    const nodeModulesPath = `${WORKSPACE_ROOT}/node_modules`;

    if (!this.container.vfs.existsSync(packageJsonPath)) {
      return;
    }
    const installKey = this.getWorkspaceDependencyInstallKey();
    if (!installKey) {
      return;
    }

    if (
      this.container.vfs.existsSync(nodeModulesPath) &&
      this.workspaceDependencyInstallKey === installKey
    ) {
      return;
    }

    if (this.workspaceDependencyInstallPromise) {
      if (this.workspaceDependencyInstallRequestKey === installKey) {
        await this.workspaceDependencyInstallPromise;
        return;
      }

      await this.workspaceDependencyInstallPromise.catch(() => undefined);
    }

    if (
      this.container.vfs.existsSync(nodeModulesPath) &&
      this.workspaceDependencyInstallKey === installKey
    ) {
      return;
    }

    this.workspaceDependencyInstallRequestKey = installKey;
    this.workspaceDependencyInstallPromise = this.container.npm
      .installFromPackageJson({
        onProgress: (message) => {
          const previewTab = this.previewTerminalTabId
            ? this.terminalTabs.get(this.previewTerminalTabId)
            : null;
          if (previewTab) {
            this.updateTerminalStatus(previewTab, message);
          }
        },
      })
      .then(() => {
        this.workspaceDependencyInstallKey = installKey;
      })
      .finally(() => {
        if (this.workspaceDependencyInstallRequestKey === installKey) {
          this.workspaceDependencyInstallPromise = null;
          this.workspaceDependencyInstallRequestKey = null;
        }
      });

    await this.workspaceDependencyInstallPromise;
  }

  // ── Test Recorder / Runner ──────────────────────────────────────────────────

  private async initTestRecorder(): Promise<void> {
    const { TestRecorder } = await import("../features/test-recorder");
    const { onPlaywrightCommand } =
      await import("../../../../packages/almostnode/src/shims/playwright-command");
    const {
      initToasts,
      showTestDetectedToast,
      showTestSavedToast,
      showTestResultToast,
    } = await import("../features/toast");

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
    this.removePlaywrightListener = onPlaywrightCommand(
      (subcommand, args, result, selectorContext) => {
        recorder.recordCommand(subcommand, args, result, selectorContext);
      },
    );

    // Cursor overlay — animated agent cursor on preview
    const { initCursorOverlay } = await import("../features/cursor-overlay");
    this.removeCursorOverlay = initCursorOverlay(
      this.previewSurface.getBody(),
      onPlaywrightCommand,
    );

    // Register tests sidebar view (workbench is already initialized)
    const { registerCustomView } =
      await import("@codingame/monaco-vscode-workbench-service-override");
    registerCustomView({
      id: "almostnode.sidebar.tests",
      name: "Tests",
      location: ViewContainerLocation.Sidebar,
      order: 2,
      icon:
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>',
        ),
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

    const { registerTestCodeLens } = await import("../features/test-codelens");
    registerTestCodeLens({
      getTests: () => this.testMetadataList,
      onRunTest: (id) => void this.runTest(id),
    });

    console.log("[test-recorder] Initialized");
  }

  private async saveDetectedTest(name: string): Promise<void> {
    if (!this.testRecorder) return;

    const steps = this.testRecorder.finalize();
    if (steps.length === 0) return;

    const { generateTestSpec, generateTestId } =
      await import("../features/test-spec-generator");
    const { showTestSavedToast } = await import("../features/toast");

    const testId = generateTestId();
    const specContent = generateTestSpec(name, steps);
    const specPath = `${WORKSPACE_TEST_E2E_ROOT}/${name.replace(/[^a-zA-Z0-9_-]/g, "-")}.spec.ts`;

    // Ensure directory exists
    const dir = specPath.substring(0, specPath.lastIndexOf("/"));
    if (!this.container.vfs.existsSync(dir)) {
      this.container.vfs.mkdirSync(dir, { recursive: true });
    }

    // Write spec file
    this.container.vfs.writeFileSync(specPath, specContent);

    // Store metadata (no steps — pw-web.js reads spec files directly)
    const metadata: import("../features/test-spec-generator").TestMetadata = {
      id: testId,
      name,
      specPath,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.testMetadataList.push(metadata);

    // Persist metadata
    this.saveTestMetadata();

    // Update sidebar
    this.testsSurface.update(
      this.testMetadataList.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
      })),
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
      const { TestRunner } = await import("../features/test-runner");
      const devUrl =
        this.previewUrl || `/__virtual__/${this.previewPort || 5173}/`;
      this.testRunner = new TestRunner(this.container.vfs, devUrl);
    }

    // Create a test runner tab in the terminal panel
    const runnerEl = document.createElement("div");
    runnerEl.style.cssText =
      "display:flex;flex-wrap:wrap;gap:8px;padding:8px;height:100%;overflow:auto;align-content:start;background:var(--almostnode-editor-bg);color:var(--text);font-family:monospace;font-size:12px;";

    const statusLine = document.createElement("div");
    statusLine.style.cssText = "width:100%;padding:4px 8px;";
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
    metadata.status = "running";
    this.testsSurface.updateTestStatus(testId, "running");

    this.testRunner.setCallbacks({
      onTestStart: () => {
        statusLine.textContent = `Running: ${metadata.name}`;
      },
      onTestComplete: (id, result) => {
        const status = result.passed ? "passed" : "failed";
        metadata.status = status;
        metadata.lastRunAt = new Date().toISOString();
        if (result.error) metadata.error = result.error;
        this.testsSurface.updateTestStatus(id, status);
        this.saveTestMetadata();

        // Show result in the tab
        statusLine.textContent = "";
        const resultEl = document.createElement("div");
        resultEl.style.cssText = "width:100%;";

        const header = document.createElement("div");
        header.style.cssText = `padding:8px;font-weight:bold;color:${result.passed ? "var(--almostnode-success)" : "var(--almostnode-danger)"};`;
        header.textContent = `${result.passed ? "PASSED" : "FAILED"} - ${metadata.name} (${result.duration}ms)`;
        resultEl.appendChild(header);

        for (const step of result.steps) {
          const stepEl = document.createElement("div");
          stepEl.style.cssText = `padding:2px 16px;color:${step.status === "passed" ? "var(--almostnode-success)" : "var(--almostnode-danger)"};`;
          stepEl.textContent = `${step.status === "passed" ? "\u2713" : "\u2717"} ${step.description}`;
          if (step.error) {
            const errEl = document.createElement("div");
            errEl.style.cssText =
              "padding:2px 32px;color:var(--almostnode-danger);font-style:italic;";
            errEl.textContent = step.error;
            stepEl.appendChild(errEl);
          }
          resultEl.appendChild(stepEl);
        }

        if (result.error) {
          const errSummary = document.createElement("div");
          errSummary.style.cssText =
            "padding:8px;color:var(--almostnode-danger);";
          errSummary.textContent = `Error: ${result.error}`;
          resultEl.appendChild(errSummary);
        }

        runnerEl.appendChild(resultEl);
      },
      onProgress: () => {},
    });

    this.testRunner.setHostContainer(runnerEl);

    const { showTestResultToast } = await import("../features/toast");
    const result = await this.testRunner.runTest(
      metadata.specPath,
      metadata.name,
      testId,
    );
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
    } catch {
      /* file may already be gone */
    }

    this.testMetadataList.splice(idx, 1);
    this.saveTestMetadata();

    this.testsSurface.update(
      this.testMetadataList.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
      })),
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
        const raw = this.container.vfs.readFileSync(metaPath, "utf8") as string;
        const data = JSON.parse(raw);
        if (Array.isArray(data.tests)) {
          this.testMetadataList = data.tests;
          this.testsSurface.update(
            this.testMetadataList.map((m) => ({
              id: m.id,
              name: m.name,
              status: m.status,
            })),
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
        if (!entry.endsWith(".spec.ts")) continue;
        const specPath = `${testDir}/${entry}`;
        if (knownPaths.has(specPath)) continue;

        // Extract test name from filename
        const name = entry.replace(/\.spec\.ts$/, "");

        // Generate a unique ID inline (same logic as generateTestId)
        const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.testMetadataList.push({
          id,
          name,
          specPath,
          createdAt: new Date().toISOString(),
          status: "pending",
        });
        added = true;
      }

      if (added) {
        this.saveTestMetadata();
        this.testsSurface.update(
          this.testMetadataList.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
          })),
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

    this.container.vfs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          tests: this.testMetadataList,
        },
        null,
        2,
      ),
    );
  }
}
