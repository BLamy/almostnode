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
  augmentClaudeLaunchCommand as augmentClaudeLaunchCommandString,
  parseOpenCodeLaunchCommand,
  shouldRunWorkbenchCommandInteractively,
} from "../features/terminal-command-routing";
import { isCloudflareLoginCommand } from "../features/cloudflare-command-routing";
import { isFlyLoginCommand } from "../features/fly-command-routing";
import { isNetlifyLoginCommand } from "../features/netlify-command-routing";
import {
  buildClaudeIdeMcpConfig,
  ClaudeIdeBridge,
} from "../features/claude-ide-bridge";
import { installHostConsoleBridge } from "../features/host-console-bridge";
import { installDesktopOAuthLoopbackBridge } from "../features/desktop-oauth-loopback";
import { installOxcMonacoIntegration } from "../features/oxc-monaco";
import { VfsFileSystemProvider } from "../features/vfs-file-system-provider";
import type { DesktopBridge } from "../desktop/bridge";
import { HostTerminalSession } from "../desktop/host-terminal-session";
import {
  loadProjectFilesIntoVfs,
  replaceProjectFilesInVfs,
  clearProjectVfs,
  collectScopedFilesBase64,
  replaceScopedFilesInVfs,
  type SerializedFile,
} from "../desktop/project-snapshot";
import {
  ProjectDB,
  type AppBuildingConfig,
  type AppBuildingJobRecord,
  type ProjectAgentStateSnapshot,
  type ProjectGitRemoteRecord,
  type ProjectRecord,
  type ResumableThreadRecord,
} from "../features/project-db";
import type { GitHubRepositorySummary } from "../features/github-repositories";
import {
  CLAUDE_PROJECTS_ROOT,
  discoverClaudeThreads,
  toOpenCodeThreads,
} from "../features/resumable-threads";
import { readGhToken } from "../../../../packages/almostnode/src/shims/gh-auth";
import {
  cancelPreparedCloudflareAuthPopup,
  prepareCloudflareAuthPopup,
  readWranglerAuthConfig,
} from "../../../../packages/almostnode/src/shims/wrangler-auth";
import {
  cancelPreparedFlyAuthPopup,
  DEFAULT_FLY_API_BASE_URL,
  fetchFlyApps,
  prepareFlyAuthPopup,
  readFlyConfig,
  writeFlyAppName,
  type FlyAppSummary,
} from "../../../../packages/almostnode/src/shims/fly-auth";
import {
  cancelPreparedNetlifyAuthPopup,
  DEFAULT_NETLIFY_API_BASE_URL,
  fetchNetlifyAccounts,
  prepareNetlifyAuthPopup,
  readNetlifyConfig,
  type NetlifyAccount,
} from "../../../../packages/almostnode/src/shims/netlify-auth";
import { readNeonCredentials, NEON_CREDENTIALS_PATH } from "../../../../packages/almostnode/src/shims/neon-auth";
import { readReplayAuth } from "../../../../packages/almostnode/src/shims/replay-auth";
import {
  AWS_AUTH_PATH,
  AWS_CONFIG_PATH,
  readAwsAuth,
  readAwsConfig,
  inspectAwsStoredState,
  writeAwsConfig,
} from "../../../../packages/almostnode/src/shims/aws-storage";
import {
  ensureInfisicalFolder,
  fetchInfisicalProjects,
  INFISICAL_AUTH_PATH,
  INFISICAL_CONFIG_PATH,
  isInfisicalAccessTokenValid,
  provisionInfisicalUniversalAuth,
  readInfisicalAuth,
  readInfisicalConfig,
  upsertInfisicalSecret,
  writeInfisicalConfig,
  type InfisicalProjectInfo,
} from "../../../../packages/almostnode/src/shims/infisical-auth";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_AWS_SESSION_NAME,
  normalizeAwsSetupDraft,
  validateAwsSetupDraft,
  type AwsSetupDraft,
} from "../features/aws-setup";
import {
  createExtensionServiceOverrides,
  type ExtensionServiceOverrideBundle,
} from "../extensions/extension-services";
import {
  AppBuildingPreviewSurface,
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
  type KeychainSlotStatus,
  type RegisteredWorkbenchSurfaces,
} from "./workbench-surfaces";
import type { KeychainSlotPicker, KeychainVaultEnvVar, KeychainVaultSyncState } from "./surface-model-types";
import {
  MarkdownEditorInput,
  JsonEditorInput,
} from "../features/rendered-editors";
import {
  APP_BUILDING_CONFIG_PATH,
  buildAppBuildingConfigSummary,
  DEFAULT_APP_BUILDING_IMAGE_REF,
  normalizeAppBuildingSetupDraft,
  readAppBuildingSetup,
  summarizeAppBuildingRepository,
  validateAppBuildingSetupDraft,
  writeAppBuildingSetup,
  type AppBuildingSetupDraft,
} from "../features/app-building-setup";
import {
  APP_BUILDING_HELP_TEXT,
  formatAppBuildingJobList,
  parseAppBuildingCommand,
  summarizeAppBuildingPrompt,
} from "../features/app-building-command";
import {
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
  FLY_CONFIG_PATH,
  Keychain,
  NETLIFY_CONFIG_PATH,
  NETLIFY_LEGACY_CONFIG_PATH,
  WRANGLER_AUTH_CONFIG_PATH,
  WRANGLER_LEGACY_AUTH_CONFIG_PATH,
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
  collectClipboardImageMimeTypes,
  describeClaudeImagePasteBlocker,
} from "../features/claude-image-paste";
import {
  createAppBuildingMachine,
  DEFAULT_APP_BUILDING_IMAGE_REF as DEFAULT_REMOTE_APP_BUILDING_IMAGE_REF,
  destroyFlyMachine,
  fetchAppBuildingEvents,
  fetchAppBuildingStatus,
  fetchFlyLogsSince,
  formatFlyLogEntry,
  getFlyMachine,
  infisicalLogin,
  mergeFlyLogDelta,
  parseAddTaskLogMessage,
  postAppBuildingMessage,
  postAppBuildingStop,
  waitForFlyMachineStarted,
  waitForWorkerReady,
} from "almostnode/internal";
import {
  type WebIdeOpenTarget,
  parseWebIdeOpenTarget,
  resolveWebIdeOpenPath,
} from "../features/webide-open-command";
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
type PreviewMode = "workbench" | "external";

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
  previewMode?: PreviewMode;
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
  onRequestAwsSetup?: (draft: AwsSetupDraft) => void;
  onRequestAppBuildingSetup?: (draft: AppBuildingSetupDraft) => void;
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

function isStaleFlyInstanceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed \(400\)/i.test(error.message);
}

/** Stable djb2 hash as an unsigned base-36 string — enough entropy for card IDs. */
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
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

/* Panel must fill its split-view-view container */
.part.panel.bottom {
  height: 100% !important;
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
.part.panel.bottom .content,
.part.panel.bottom .composite,
.part.panel.bottom .split-view-container,
.part.panel.bottom .split-view-view,
.part.panel.bottom .pane-body,
.part.panel.bottom .pane-body > .monaco-scrollable-element,
.part.panel.bottom .almostnode-terminal-panel-host {
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
}
.part.panel.bottom .content,
.part.panel.bottom .composite,
.part.panel.bottom .split-view-container,
.part.panel.bottom .split-view-view,
.part.panel.bottom .pane-body,
.part.panel.bottom .pane-body > .monaco-scrollable-element,
.part.panel.bottom .almostnode-terminal-panel-host {
  display: flex !important;
  flex-direction: column !important;
}
.part.panel.bottom .pane-body > .monaco-scrollable-element,
.part.panel.bottom .almostnode-terminal-panel-host {
  overflow: hidden !important;
}

[id="almostnode.panel.terminal"] .pane-body.wide > .monaco-scrollable-element > div {
  min-height: 100% !important;
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
  agentHarness: "claude" | "opencode" | null;
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

interface PreviewSourcePickerSelectionMessage {
  type: "almostnode-preview-source-picker";
  status: "selected";
  filePath?: string;
  lineNumber?: number | null;
  columnNumber?: number | null;
}

interface PreviewSourcePickerStatusMessage {
  type: "almostnode-preview-source-picker";
  status: "armed" | "cancelled" | "error";
  reason?: string;
}

type PreviewSourcePickerMessage =
  | PreviewSourcePickerSelectionMessage
  | PreviewSourcePickerStatusMessage;

interface PreviewSourcePickerBridge {
  activateOpen(): void;
  deactivate(notifyParent?: boolean): void;
}

interface PreviewSourcePickerSourceInfo {
  filePath?: string | null;
  lineNumber?: number | null;
  columnNumber?: number | null;
  componentName?: string | null;
}

interface PreviewSourcePickerElementInfo {
  tagName?: string | null;
  componentName?: string | null;
  source?: PreviewSourcePickerSourceInfo | null;
  stack?: PreviewSourcePickerSourceInfo[] | null;
  formattedStack?: string | null;
}

interface PreviewSourcePickerRuntime {
  window: Window & {
    __REACT_GRAB__?: {
      activate(): void;
      deactivate(): void;
    };
    ElementSource?: {
      resolveSource?: (
        element: Element,
      ) => Promise<PreviewSourcePickerSourceInfo | null> | PreviewSourcePickerSourceInfo | null;
      resolveStack?: (
        element: Element,
      ) => Promise<PreviewSourcePickerSourceInfo[]> | PreviewSourcePickerSourceInfo[];
      resolveElementInfo?: (
        element: Element,
      ) => Promise<PreviewSourcePickerElementInfo | null> | PreviewSourcePickerElementInfo | null;
      formatStack?: (
        stack: PreviewSourcePickerSourceInfo[],
        maxLines?: number,
      ) => string;
    };
    __almostnodePreviewSourcePickerBridge__?: PreviewSourcePickerBridge;
  };
  document: Document;
  bridgePromise: Promise<PreviewSourcePickerBridge> | null;
}

type PreviewAppBuildingBridgeRequest =
  | {
    type: "almostnode-app-building-request";
    requestId: string;
    action: "create";
    name: string;
    prompt: string;
  }
  | {
    type: "almostnode-app-building-request";
    requestId: string;
    action: "message";
    jobId: string;
    prompt: string;
  }
  | {
    type: "almostnode-app-building-request";
    requestId: string;
    action: "status" | "stop" | "reset-logs";
    jobId: string;
  }
  | {
    type: "almostnode-app-building-request";
    requestId: string;
    action: "logs";
    jobId: string;
    offset?: number;
  };

interface PreviewAppBuildingBridgeResponse {
  type: "almostnode-app-building-response";
  requestId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  jobId?: string;
  error?: string;
}

type EditorSelectionRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type AppBuildingRunResult = RunResult & {
  jobId?: string;
};

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
  private readonly appBuildingPreviewSurface: AppBuildingPreviewSurface;
  private readonly appBuildingPreviewOpenedJobs = new Set<string>();
  private currentAppBuildingPreviewUrl: string | null = null;
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
  private previewSourcePickerActive = false;
  private previewSourcePickerRuntime: PreviewSourcePickerRuntime | null = null;
  private previewStartRetryTimeoutId = 0;
  private readonly consolePanel = new ConsolePanelElement();
  private readonly consoleTabId = "console-panel";
  private consoleMessageCount = 0;
  private extensionServices: ExtensionServiceOverrideBundle | null = null;
  private readonly keychain: Keychain;
  private readonly projectDb = new ProjectDB();
  private readonly claudeImagePasteCleanup = new Map<string, () => void>();
  private keychainStatusEntry: IStatusbarEntryAccessor | null = null;
  private tailscaleStatus: NetworkStatus | null = null;
  private tailscaleDiagnosticsHintPrinted = false;
  private hadTailscaleKeychainData = false;
  private pendingTailscaleKeychainActivation = false;
  private netlifyAccountsCache: { userId: string; accounts: NetlifyAccount[] } | null = null;
  private netlifyAccountsFetchInFlight: Promise<void> | null = null;
  private infisicalProjectsCache: { key: string; projects: InfisicalProjectInfo[] } | null = null;
  private infisicalProjectsFetchInFlight: Promise<void> | null = null;
  private flyAppsCache: { tokenFingerprint: string; apps: FlyAppSummary[] } | null = null;
  private flyAppsFetchInFlight: Promise<void> | null = null;
  private flyAppsFetchState: { fingerprint: string; status: "loading" | "error"; message?: string } | null = null;
  private infisicalUaProvisionInFlight: Promise<void> | null = null;
  private infisicalUaProvisionState: { tokenFingerprint: string; status: "error"; message: string } | null = null;
  private vaultSyncState: KeychainVaultSyncState = {
    target: null,
    targetLabel: null,
    busy: false,
    message: null,
    messageKind: null,
  };
  private vaultSyncMessageClearTimer: ReturnType<typeof setTimeout> | null = null;
  private workspaceDependencyInstallPromise: Promise<void> | null = null;
  private workspaceDependencyInstallKey: string | null = null;
  private workspaceDependencyInstallRequestKey: string | null = null;
  private pendingProjectLaunch = false;
  private activeProjectId: string | null = null;
  private templateId: TemplateId;
  private readonly initialProjectFiles: SerializedFile[] | null;
  private readonly skipWorkspaceSeed: boolean;
  private readonly deferPreviewStart: boolean;
  private readonly previewMode: PreviewMode;
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
  private currentProjectDefaultDatabaseName = "default";
  private readonly testsSurface = new TestsSidebarSurface();
  private workbenchThemeKind: WorkbenchThemeKind = "dark";
  private externalPreviewWindow: Window | null = null;
  private removeHostConsoleBridge: (() => void) | null = null;
  private removeDesktopOAuthLoopbackBridge: (() => void) | null = null;
  private claudeIdeBridge: ClaudeIdeBridge | null = null;
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
  private static readonly reactGrabScriptUrl =
    "https://unpkg.com/react-grab@0.1.29/dist/index.global.js";
  private static readonly elementSourceScriptUrl =
    "https://unpkg.com/element-source@0.0.5/dist/index.global.js";

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
    this.previewMode = options.previewMode === "external" ? "external" : "workbench";
    this.pendingProjectLaunch = this.skipWorkspaceSeed || this.deferPreviewStart;
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
      toggleSelect: () => {
        void this.togglePreviewSourcePicker();
      },
    });
    this.appBuildingPreviewSurface = new AppBuildingPreviewSurface();
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
      appBuildingPreviewSurface: this.appBuildingPreviewSurface,
      terminalSurface: this.terminalSurface,
      databaseSurface: this.databaseSurface,
      databaseBrowserSurface: this.databaseBrowserSurface,
      keychainSurface: this.keychainSurface,
      testsSurface: this.testsSurface,
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

      if (action.startsWith("select-account:netlify:")) {
        this.selectNetlifyAccount(
          action.slice("select-account:netlify:".length),
        );
        return;
      }

      if (action.startsWith("select-project:infisical:")) {
        this.selectInfisicalProject(
          action.slice("select-project:infisical:".length),
        );
        return;
      }

      if (action.startsWith("select-environment:infisical:")) {
        this.selectInfisicalEnvironment(
          action.slice("select-environment:infisical:".length),
        );
        return;
      }

      if (action.startsWith("select-app:fly:")) {
        this.selectFlyApp(action.slice("select-app:fly:".length));
        return;
      }

      if (action === "sync-vault-env:infisical") {
        void this.syncVaultEnvToInfisical();
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
        case "login:aws":
          void this.keychainAuthAction(this.buildAwsLoginCommand());
          break;
        case "logout:aws":
          void this.keychainAuthAction(this.buildAwsLogoutCommand());
          break;
        case "login:infisical":
          void this.handleInfisicalLogin();
          break;
        case "logout:infisical":
          this.infisicalUaProvisionState = null;
          this.infisicalProjectsCache = null;
          void this.keychainAuthAction("infisical logout");
          break;
        case "login:fly":
          void this.flyAuthAction("login");
          break;
        case "logout:fly":
          void this.flyAuthAction("logout");
          break;
        case "login:netlify":
          void this.netlifyAuthAction("login");
          break;
        case "logout:netlify":
          void this.netlifyAuthAction("logout");
          break;
        case "login:cloudflare":
          void this.cloudflareAuthAction("login");
          break;
        case "logout:cloudflare":
          void this.cloudflareAuthAction("logout");
          break;
        case "login:neon":
          void this.keychainAuthAction("neon auth login");
          break;
        case "logout:neon":
          void this.keychainAuthAction("neon auth logout");
          break;
        case "setup:aws":
          this.options.onRequestAwsSetup?.(this.getAwsSetupDraft());
          break;
        case "setup:app-building":
          this.options.onRequestAppBuildingSetup?.(this.getAppBuildingSetupDraft());
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
    this.keychain.registerSlot("aws", [AWS_CONFIG_PATH, AWS_AUTH_PATH]);
    this.keychain.registerSlot("infisical", [INFISICAL_CONFIG_PATH, INFISICAL_AUTH_PATH]);
    this.keychain.registerSlot("fly", [FLY_CONFIG_PATH]);
    this.keychain.registerSlot("netlify", [NETLIFY_CONFIG_PATH, NETLIFY_LEGACY_CONFIG_PATH]);
    this.keychain.registerSlot("cloudflare", [WRANGLER_AUTH_CONFIG_PATH, WRANGLER_LEGACY_AUTH_CONFIG_PATH]);
    this.keychain.registerSlot("neon", [NEON_CREDENTIALS_PATH]);
    this.keychain.registerSlot("app-building", [APP_BUILDING_CONFIG_PATH]);
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
    this.registerWorkbenchShellCommands();
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

  getPreviewUrl(): string | null {
    return this.previewUrl;
  }

  setActiveProjectId(projectId: string | null): void {
    this.activeProjectId = projectId;
    void this.syncActiveProjectAppBuildingConfig();
  }

  registerExternalPreviewWindow(target: Window | null): void {
    this.externalPreviewWindow = target;
    if (target && this.previewPort !== null) {
      this.container.setHMRTargetForPort(this.previewPort, target);
    }
  }

  hasGitHubCredentials(): boolean {
    return Boolean(readGhToken(this.container.vfs)?.oauth_token);
  }

  async requestGitHubLogin(): Promise<void> {
    await this.keychainAuthAction("gh auth login");
    this.keychain.notifyExternalStateChanged();
  }

  async loginToFly(): Promise<void> {
    await this.flyAuthAction("login");
  }

  async loginToGithub(): Promise<void> {
    await this.keychainAuthAction("gh auth login");
    this.keychain.notifyExternalStateChanged();
  }

  async loginToInfisical(): Promise<void> {
    await this.handleInfisicalLogin();
  }

  async loginToNetlify(): Promise<void> {
    await this.netlifyAuthAction("login");
  }

  async loginToNeon(): Promise<void> {
    await this.keychainAuthAction("neon auth login");
  }

  async loginToReplay(): Promise<void> {
    await this.keychainAuthAction("replayio login");
  }

  isServiceSignedIn(slot: string): boolean {
    return this.keychain.hasSlotData(slot);
  }

  async listGitHubRepositories(): Promise<GitHubRepositorySummary[]> {
    const token = this.getGitHubAuthToken();
    const repositories: GitHubRepositorySummary[] = [];
    let page = 1;

    while (true) {
      const response = await this.fetchGitHubApi(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const raw = await response.text();
      let payload: unknown = [];
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = [];
        }
      }

      if (!response.ok) {
        const message = this.getGitHubApiErrorMessage(
          payload,
          `GitHub repository listing failed (${response.status}).`,
        );
        throw new Error(message);
      }

      const rawPageRepositories = Array.isArray(payload) ? payload : [];
      const pageRepositories = rawPageRepositories
          .map((entry) => this.toGitHubRepositorySummary(entry))
          .filter((entry): entry is GitHubRepositorySummary => entry !== null);

      repositories.push(...pageRepositories);

      if (rawPageRepositories.length < 100) {
        break;
      }

      page += 1;
    }

    const deduped = new Map<number, GitHubRepositorySummary>();
    for (const repository of repositories) {
      deduped.set(repository.id, repository);
    }

    return Array.from(deduped.values()).sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt)
    ));
  }

  async createGitHubRemote(projectName: string): Promise<ProjectGitRemoteRecord> {
    const createRepository = typeof (this as {
      createGitHubRepository?: typeof WebIDEHost.prototype.createGitHubRepository;
    }).createGitHubRepository === "function"
      ? (this as {
        createGitHubRepository: typeof WebIDEHost.prototype.createGitHubRepository;
      }).createGitHubRepository.bind(this)
      : WebIDEHost.prototype.createGitHubRepository.bind(this as WebIDEHost);
    const repository = await createRepository(projectName);

    return {
      name: "origin",
      url: repository.cloneUrl,
      provider: "github",
      repositoryFullName: repository.fullName,
      repositoryUrl: repository.htmlUrl,
    };
  }

  async importGitHubRepository(
    repository: GitHubRepositorySummary,
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<TemplateId> {
    const previousPreviewPort = this.previewPort;
    this.abortRunningTerminalCommands();
    this.clearScheduledPreviewStartRetry();
    this.resetPreviewTerminalTab();
    await this.waitForPreviewServerShutdown(previousPreviewPort);
    await this.closeCurrentProjectDatabase();

    this.previewPort = null;
    this.previewUrl = null;
    this.previewStartRequested = false;
    this.setPreviewSourcePickerActive(false);
    this.previewSurface.setActiveDb(null);
    this.previewSurface.clear("Switching projects…");
    this.resetAppBuildingPreview("Switching projects…");
    this.databaseSurface.update([], null);

    clearProjectVfs(this.container.vfs);
    await this.runRequiredCommand(
      `git clone ${this.quoteShellArg(repository.cloneUrl)} ${this.quoteShellArg(WORKSPACE_ROOT)}`,
      "/",
    );

    const templateId = this.inferWorkspaceTemplateId();
    this.templateId = templateId;
    this.currentProjectDatabaseNamespace =
      this.normalizeProjectDatabaseNamespace(dbPrefix);
    this.currentProjectDefaultDatabaseName =
      this.normalizeProjectDefaultDatabaseName(defaultDatabaseName);

    await this.ensureGitInitialized({
      gitRemote: {
        name: "origin",
        url: repository.cloneUrl,
        provider: "github",
        repositoryFullName: repository.fullName,
        repositoryUrl: repository.htmlUrl,
      },
    });

    if (this.terminalTabs.size === 0) {
      const initialTab = this.createUserTerminalTab(false);
      this.updateTerminalStatus(initialTab, "Idle");
    }

    await this.revealPreviewEditor();
    this.updatePreviewStatus("Waiting for a preview server");
    this.ensurePreviewServerRunning();
    this.schedulePreviewStartRetry();
    void this.initPGliteIfNeeded();
    await this.resumePendingProjectLaunch({ previewRevealed: true });

    window.dispatchEvent(new Event("resize"));

    return templateId;
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
    const tab = this.createAiSidebarTerminalTab(true, {
      id: `claude-sidebar-${crypto.randomUUID()}`,
      title,
      agentHarness: "claude",
    });
    const command = this.buildClaudeLaunchCommand({ resumeToken: thread.resumeToken });
    await this.runCommand(tab, command, { echoCommand: true, interceptAgentLaunch: false });
  }

  private normalizeProjectDatabaseNamespace(dbPrefix?: string): string {
    const trimmed = dbPrefix?.trim();
    return trimmed ? trimmed : "global";
  }

  private normalizeProjectDefaultDatabaseName(defaultDatabaseName?: string): string {
    const trimmed = defaultDatabaseName?.trim();
    return trimmed ? trimmed : "default";
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
    defaultDatabaseName?: string,
  ): Promise<void> {
    const nextNamespace = this.normalizeProjectDatabaseNamespace(dbPrefix);
    const nextDefaultDatabaseName =
      this.normalizeProjectDefaultDatabaseName(defaultDatabaseName);
    if (
      this.currentProjectDatabaseNamespace !== nextNamespace
      || this.currentProjectDefaultDatabaseName !== nextDefaultDatabaseName
    ) {
      await this.closeCurrentProjectDatabase();
    }
    this.templateId = templateId;
    this.currentProjectDatabaseNamespace = nextNamespace;
    this.currentProjectDefaultDatabaseName = nextDefaultDatabaseName;
    void this.initPGliteIfNeeded();
    await this.resumePendingProjectLaunch();
  }

  async switchProjectWorkspace(
    newTemplateId: TemplateId,
    files: SerializedFile[],
    dbPrefix?: string,
    defaultDatabaseName?: string,
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
    this.setPreviewSourcePickerActive(false);
    this.previewSurface.setActiveDb(null);
    this.previewSurface.clear("Switching projects…");
    this.resetAppBuildingPreview("Switching projects…");
    this.databaseSurface.update([], null);

    this.templateId = newTemplateId;
    replaceProjectFilesInVfs(this.container.vfs, files, { includeGit: true });

    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    if (!this.container.vfs.existsSync(packageJsonPath)) {
      seedWorkspace(this.container, this.templateId);
    }

    this.currentProjectDatabaseNamespace =
      this.normalizeProjectDatabaseNamespace(dbPrefix);
    this.currentProjectDefaultDatabaseName =
      this.normalizeProjectDefaultDatabaseName(defaultDatabaseName);

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
    await this.resumePendingProjectLaunch({ previewRevealed: true });

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
    this.pendingProjectLaunch = true;
    this.setPreviewSourcePickerActive(false);
    this.previewSurface.setActiveDb(null);
    this.previewSurface.clear("Switching projects\u2026");
    this.resetAppBuildingPreview("Switching projects\u2026");

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
    defaultDatabaseName?: string,
  ): Promise<void> {
    this.templateId = newTemplateId;
    this.currentProjectDatabaseNamespace =
      this.normalizeProjectDatabaseNamespace(dbPrefix);
    this.currentProjectDefaultDatabaseName =
      this.normalizeProjectDefaultDatabaseName(defaultDatabaseName);

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
    await this.resumePendingProjectLaunch({ previewRevealed: true });

    // 7. Trigger Monaco layout refresh
    window.dispatchEvent(new Event("resize"));
  }

  get terminal(): Terminal {
    return this.requireActiveTerminalTab().terminal;
  }

  private normalizeHostPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/g, "");
  }

  private normalizePreviewSourcePath(
    sourcePath: string | null | undefined,
  ): string | null {
    if (typeof sourcePath !== "string") {
      return null;
    }

    let normalized = sourcePath.trim();
    if (!normalized) {
      return null;
    }

    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
        normalized = new URL(normalized).pathname || normalized;
      }
    } catch {
      // Leave raw values untouched if they are not valid URLs.
    }

    normalized = normalized
      .replace(/\\/g, "/")
      .split(/[?#]/, 1)[0]
      .trim();

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Ignore invalid escape sequences.
    }

    normalized = normalized.replace(/^\/?__virtual__\/\d+(?=\/)/, "");
    normalized = normalized.replace(/^[^/]+:\d+(?=\/)/, "");
    normalized = normalized.replace(/^\/?\d+(?=\/(src|app|pages|components|lib|routes|tests?|e2e|drizzle|public)\b)/, "");
    if (normalized && !normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }

    const projectMarker = `${WORKSPACE_ROOT}/`;
    const projectMarkerIndex = normalized.indexOf(projectMarker);
    if (projectMarkerIndex !== -1) {
      normalized = normalized.slice(projectMarkerIndex);
    } else if (!normalized.startsWith("/")) {
      normalized = `${WORKSPACE_ROOT}/${normalized}`;
    } else if (normalized !== WORKSPACE_ROOT) {
      normalized = `${WORKSPACE_ROOT}${normalized}`;
    }

    const resolvedSegments: string[] = [];
    for (const segment of normalized.split("/")) {
      if (!segment || segment === ".") {
        continue;
      }
      if (segment === "..") {
        resolvedSegments.pop();
        continue;
      }
      resolvedSegments.push(segment);
    }

    const resolvedPath = `/${resolvedSegments.join("/")}`;
    if (
      resolvedPath === WORKSPACE_ROOT ||
      resolvedPath.startsWith(`${WORKSPACE_ROOT}/`)
    ) {
      return resolvedPath;
    }

    return null;
  }

  private postPreviewSourcePickerMessage(
    action: "activate-open" | "deactivate",
  ): boolean {
    const iframeWindow = this.previewSurface.getIframe().contentWindow;
    if (!iframeWindow) {
      return false;
    }

    iframeWindow.postMessage(
      {
        type: "almostnode-preview-source-picker",
        action,
      },
      "*",
    );
    return true;
  }

  private setPreviewSourcePickerActive(active: boolean): void {
    this.previewSourcePickerActive = active;
    this.previewSurface.setSelectActive(active);
  }

  private getPreviewSourcePickerRuntime():
    | PreviewSourcePickerRuntime
    | null {
    const iframe = this.previewSurface.getIframe();
    const win = iframe.contentWindow as PreviewSourcePickerRuntime["window"] | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      return null;
    }

    if (
      !this.previewSourcePickerRuntime
      || this.previewSourcePickerRuntime.window !== win
    ) {
      this.previewSourcePickerRuntime = {
        window: win,
        document: doc,
        bridgePromise: null,
      };
    }

    return this.previewSourcePickerRuntime;
  }

  private waitForPreviewWindowGlobal<T>(
    runtime: PreviewSourcePickerRuntime,
    readGlobal: () => T | null | undefined,
    errorMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const existing = readGlobal();
      if (existing) {
        resolve(existing);
        return;
      }

      let settled = false;
      const timeoutId = runtime.window.setTimeout(() => {
        cleanup();
        reject(new Error(errorMessage));
      }, 15000);
      const intervalId = runtime.window.setInterval(() => {
        const value = readGlobal();
        if (!value) {
          return;
        }
        cleanup();
        resolve(value);
      }, 50);

      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        runtime.window.clearTimeout(timeoutId);
        runtime.window.clearInterval(intervalId);
      };
    });
  }

  private getPreviewSourcePickerBridgeBootstrap(): string {
    return String.raw`
(() => {
  const bridgeKey = "__almostnodePreviewSourcePickerBridge__";
  const messageType = "almostnode-preview-source-picker";
  const reactGrabScriptUrl = ${JSON.stringify(WebIDEHost.reactGrabScriptUrl)};
  const elementSourceScriptUrl = ${JSON.stringify(WebIDEHost.elementSourceScriptUrl)};
  if (window[bridgeKey]) {
    return;
  }

  let openMode = false;
  let pluginRegistered = false;
  let reactGrabPromise = null;
  let elementSourcePromise = null;

  function postSourcePickerMessage(payload) {
    try {
      window.parent?.postMessage(
        {
          type: messageType,
          ...payload,
        },
        "*",
      );
    } catch {
      // Ignore postMessage failures.
    }
  }

  function readReactGrab() {
    return window.__REACT_GRAB__ || null;
  }

  function readElementSource() {
    return window.ElementSource || null;
  }

  function waitForGlobal(readGlobal, errorMessage) {
    return new Promise((resolve, reject) => {
      const existing = readGlobal();
      if (existing) {
        resolve(existing);
        return;
      }

      let settled = false;
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(errorMessage));
      }, 15000);
      const intervalId = window.setInterval(() => {
        const value = readGlobal();
        if (!value) {
          return;
        }
        cleanup();
        resolve(value);
      }, 50);

      function cleanup() {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        window.clearInterval(intervalId);
      }
    });
  }

  function injectScript(dataAttribute, src) {
    const selector = "script[" + dataAttribute + "]";
    const existingScript = document.querySelector(selector);
    if (existingScript) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.setAttribute(dataAttribute, "true");

      function cleanup() {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      }

      function onLoad() {
        cleanup();
        resolve();
      }

      function onError() {
        cleanup();
        reject(new Error("Failed to load " + src));
      }

      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function ensureReactGrabLoaded() {
    const existing = readReactGrab();
    if (existing) {
      return Promise.resolve(existing);
    }
    if (reactGrabPromise) {
      return reactGrabPromise;
    }

    reactGrabPromise = injectScript(
      "data-almostnode-react-grab",
      reactGrabScriptUrl,
    )
      .catch(() => undefined)
      .then(() =>
        waitForGlobal(readReactGrab, "Timed out loading react-grab."),
      )
      .catch((error) => {
        reactGrabPromise = null;
        throw error;
      });

    return reactGrabPromise;
  }

  function ensureElementSourceLoaded() {
    const existing = readElementSource();
    if (existing) {
      return Promise.resolve(existing);
    }
    if (elementSourcePromise) {
      return elementSourcePromise;
    }

    elementSourcePromise = injectScript(
      "data-almostnode-element-source",
      elementSourceScriptUrl,
    )
      .catch(() => undefined)
      .then(() =>
        waitForGlobal(
          readElementSource,
          "Timed out loading element-source.",
        ).catch(() => null),
      )
      .catch((error) => {
        elementSourcePromise = null;
        throw error;
      });

    return elementSourcePromise;
  }

  function normalizeSourceInfo(source) {
    if (!source || typeof source !== "object") {
      return null;
    }

    return {
      filePath:
        typeof source.filePath === "string" ? source.filePath : null,
      lineNumber:
        typeof source.lineNumber === "number" ? source.lineNumber : null,
      columnNumber:
        typeof source.columnNumber === "number" ? source.columnNumber : null,
      componentName:
        typeof source.componentName === "string"
          ? source.componentName
          : null,
    };
  }

  function normalizeStack(stack) {
    if (!Array.isArray(stack)) {
      return [];
    }

    return stack
      .map((frame) => normalizeSourceInfo(frame))
      .filter((frame) => Boolean(frame?.filePath));
  }

  function resolveElementInfo(api, element) {
    return ensureElementSourceLoaded()
      .catch(() => null)
      .then((elementSourceApi) => {
        if (typeof elementSourceApi?.resolveElementInfo === "function") {
          return Promise.resolve(elementSourceApi.resolveElementInfo(element))
            .then((info) => {
              const normalizedSource = normalizeSourceInfo(info?.source);
              const normalizedStack = normalizeStack(info?.stack);

              return {
                tagName:
                  typeof info?.tagName === "string"
                    ? info.tagName
                    : typeof element?.tagName === "string"
                      ? element.tagName.toLowerCase()
                      : "",
                componentName:
                  typeof info?.componentName === "string"
                    ? info.componentName
                    : normalizedSource?.componentName ?? null,
                source:
                  normalizedSource ??
                  normalizedStack[0] ??
                  null,
                stack:
                  normalizedStack,
                formattedStack:
                  typeof elementSourceApi?.formatStack === "function"
                    ? elementSourceApi.formatStack(normalizedStack)
                    : null,
              };
            })
            .catch(() => null);
        }

        return Promise.resolve(
          typeof elementSourceApi?.resolveSource === "function"
            ? elementSourceApi.resolveSource(element)
            : null,
        )
          .catch(() => null)
          .then((source) => {
            const normalizedSource = normalizeSourceInfo(source);
            if (normalizedSource?.filePath) {
              return {
                tagName:
                  typeof element?.tagName === "string"
                    ? element.tagName.toLowerCase()
                    : "",
                componentName: normalizedSource.componentName ?? null,
                source: normalizedSource,
                stack: normalizedSource ? [normalizedSource] : [],
                formattedStack: null,
              };
            }

            return api.getSource(element).then((fallbackSource) => {
              const normalizedFallbackSource = normalizeSourceInfo(
                fallbackSource,
              );
              return {
                tagName:
                  typeof element?.tagName === "string"
                    ? element.tagName.toLowerCase()
                    : "",
                componentName:
                  normalizedFallbackSource?.componentName ?? null,
                source: normalizedFallbackSource,
                stack: normalizedFallbackSource
                  ? [normalizedFallbackSource]
                  : [],
                formattedStack: null,
              };
            });
          });
      });
  }

  function registerPlugin(api) {
    if (pluginRegistered) {
      return;
    }

    api.registerPlugin({
      name: "almostnode-preview-source-picker-direct",
      theme: {
        toolbar: { enabled: false },
        grabbedBoxes: { enabled: false },
      },
      options: {
        activationKey: function() {
          return false;
        },
      },
      hooks: {
        onElementSelect: function(element) {
          if (!openMode) {
            return;
          }

          return resolveElementInfo(api, element)
            .then((info) => {
              openMode = false;
              api.deactivate();
              console.log("[almostnode] preview element info", info ?? null);

              const source = info?.source ?? info?.stack?.[0] ?? null;
              console.log("[almostnode] source", source ?? null);
              if (!source?.filePath) {
                postSourcePickerMessage({
                  status: "error",
                  reason: "no-source",
                });
                return true;
              }

              postSourcePickerMessage({
                status: "selected",
                filePath: source.filePath,
                lineNumber:
                  typeof source.lineNumber === "number"
                    ? source.lineNumber
                    : null,
                columnNumber:
                  typeof source.columnNumber === "number"
                    ? source.columnNumber
                    : null,
              });
              return true;
            })
            .catch((error) => {
              openMode = false;
              api.deactivate();
              postSourcePickerMessage({
                status: "error",
                reason:
                  error instanceof Error ? error.message : String(error),
              });
              return true;
            });
        },
      },
    });

    pluginRegistered = true;
  }

  function activateOpen() {
    return ensureReactGrabLoaded()
      .then((api) =>
        ensureElementSourceLoaded()
          .catch(() => null)
          .then(() => {
            registerPlugin(api);
            openMode = true;
            api.activate();
            if (typeof api.isActive === "function" && !api.isActive()) {
              return new Promise((resolve) =>
                window.requestAnimationFrame(resolve),
              ).then(() => {
                api.activate();
              });
            }
          })
          .then(() => {
            postSourcePickerMessage({ status: "armed" });
          }),
      )
      .catch((error) => {
        openMode = false;
        postSourcePickerMessage({
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
      });
  }

  function deactivate(notifyParent) {
    openMode = false;
    readReactGrab()?.deactivate();
    if (notifyParent) {
      postSourcePickerMessage({ status: "cancelled" });
    }
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (!openMode || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      deactivate(true);
    },
    true,
  );

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || payload.type !== messageType) {
      return;
    }

    if (payload.action === "activate-open") {
      void activateOpen();
      return;
    }

    if (payload.action === "deactivate") {
      deactivate(false);
    }
  });

  window[bridgeKey] = {
    activateOpen: function() {
      void activateOpen();
    },
    deactivate,
  };
})();
`.trim();
  }

  private async ensurePreviewSourcePickerBridgeLoaded(
    runtime: PreviewSourcePickerRuntime,
  ): Promise<PreviewSourcePickerBridge> {
    const existing = runtime.window.__almostnodePreviewSourcePickerBridge__;
    if (existing) {
      return existing;
    }
    if (runtime.bridgePromise) {
      return runtime.bridgePromise;
    }

    runtime.bridgePromise = Promise.resolve()
      .then(() => {
        const existingScript = runtime.document.querySelector(
          "script[data-almostnode-source-picker-bridge]",
        ) as HTMLScriptElement | null;
        if (!existingScript) {
          const script = runtime.document.createElement("script");
          script.setAttribute("data-almostnode-source-picker-bridge", "true");
          script.textContent = this.getPreviewSourcePickerBridgeBootstrap();
          (
            runtime.document.head || runtime.document.documentElement
          ).appendChild(script);
        }

        return this.waitForPreviewWindowGlobal(
          runtime,
          () => runtime.window.__almostnodePreviewSourcePickerBridge__,
          "Timed out loading preview source picker bridge.",
        );
      })
      .catch((error) => {
        runtime.bridgePromise = null;
        throw error;
      });

    return runtime.bridgePromise;
  }

  private async activatePreviewSourcePickerDirect(): Promise<boolean> {
    const runtime = this.getPreviewSourcePickerRuntime();
    if (!runtime) {
      return false;
    }

    await this.ensurePreviewSourcePickerBridgeLoaded(runtime);
    return this.postPreviewSourcePickerMessage("activate-open");
  }

  private deactivatePreviewSourcePickerDirect(): void {
    this.postPreviewSourcePickerMessage("deactivate");
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

  private shouldAutoLaunchOpenCode(): boolean {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      return !(
        searchParams.has("no-opencode") || searchParams.has("no-claude")
      );
    } catch {
      return true;
    }
  }

  private async resumePendingProjectLaunch(options?: {
    previewRevealed?: boolean;
  }): Promise<void> {
    if (!this.pendingProjectLaunch) {
      return;
    }

    this.pendingProjectLaunch = false;

    if (!options?.previewRevealed) {
      await this.revealPreviewEditor();
    }

    if (!this.previewUrl && !this.previewStartRequested) {
      this.updatePreviewStatus("Waiting for a preview server");
      this.ensurePreviewServerRunning();
      this.schedulePreviewStartRetry();
    }

    if (this.shouldAutoLaunchOpenCode()) {
      void this.revealOpenCodePanel(false);
    }
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
      agentHarness?: "claude" | "opencode" | null;
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
      agentHarness: options?.agentHarness ?? null,
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
      if (
        !this.tailscaleDiagnosticsHintPrinted &&
        this.debugSections.some(
          (section) =>
            section.toLowerCase() === "tailscale" ||
            section.toLowerCase() === "network",
        )
      ) {
        terminal.write(
          "\r\n[almostnode debug] Tailscale diagnostics available via `tailscale debug`",
        );
        this.tailscaleDiagnosticsHintPrinted = true;
      }
    }
    if (kind === "agent") {
      terminal.write("almostnode opencode terminal");
    }
    if (!(kind === "agent" && tab.inputMode === "passthrough")) {
      this.printPrompt(tab);
    }
    this.installClaudeImagePasteGuard(tab);
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
      id?: string;
      title?: string;
      agentHarness?: "claude" | "opencode" | null;
    },
  ): TerminalTabState {
    const id = options?.id ?? `ai-sidebar-${crypto.randomUUID()}`;
    const title =
      options?.title ?? `Terminal ${++this.openCodeSidebarTerminalCounter}`;
    return this.createTerminalTab("user", title, focus, true, {
      id,
      cwd: WORKSPACE_ROOT,
      surface: "sidebar",
      agentHarness: options?.agentHarness ?? null,
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
    this.disposeClaudeImagePasteGuard(id);
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
    this.disposeClaudeImagePasteGuard(id);
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
      ? this.buildClaudeLaunchCommand()
      : "npx opencode-ai";
  }

  private buildClaudeLaunchCommand(options?: {
    resumeToken?: string;
  }): string {
    const parts = [
      "/usr/local/bin/claude-wrapper",
      "--plugin-dir",
      this.quoteShellArg(`${WORKSPACE_ROOT}/.claude-plugin`),
    ];
    if (options?.resumeToken) {
      parts.push("--resume", this.quoteShellArg(options.resumeToken));
    }
    return this.augmentClaudeLaunchCommand(parts.join(" "));
  }

  private augmentClaudeLaunchCommand(command: string): string {
    const sseUrl = this.claudeIdeBridge?.getSseUrl();
    if (!sseUrl) {
      return command;
    }

    return augmentClaudeLaunchCommandString(
      command,
      buildClaudeIdeMcpConfig(sseUrl),
      (value) => this.quoteShellArg(value),
    );
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
        agentHarness: "claude",
      },
    );
    await this.runCommand(tab, command, {
      echoCommand: true,
    });
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
    this.disposeClaudeImagePasteGuard(id);
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
    const requestedExitNodeId = this.getRequestedTailscaleExitNodeId();
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
        selectValue:
          tailscaleStatus?.selectedExitNodeId
          ?? requestedExitNodeId
          ?? undefined,
      },
      {
        name: "github",
        label: "GitHub",
        active: this.keychain.hasSlotData("github"),
        canAuth: true,
      },
      {
        name: "aws",
        label: "AWS",
        canAuth: true,
        ...this.buildAwsSidebarSlotStatus(),
      },
      {
        name: "infisical",
        label: "Infisical",
        canAuth: true,
        ...this.buildInfisicalSidebarSlotStatus(),
      },
      {
        name: "fly",
        label: "Fly.io",
        canAuth: true,
        ...this.buildFlySidebarSlotStatus(),
      },
      {
        name: "netlify",
        label: "Netlify",
        canAuth: true,
        ...this.buildNetlifySidebarSlotStatus(),
      },
      {
        name: "cloudflare",
        label: "Cloudflare",
        canAuth: true,
        ...this.buildCloudflareSidebarSlotStatus(),
      },
      {
        name: "neon",
        label: "Neon",
        canAuth: true,
        ...this.buildNeonSidebarSlotStatus(),
      },
      {
        name: "app-building",
        label: "App Building",
        canAuth: true,
        ...this.buildAppBuildingSidebarSlotStatus(),
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
      hasUnlockedKey: state.hasUnlockedKey,
      supported: state.supported,
      vaultEnvVars: state.hasUnlockedKey ? this.buildVaultEnvVars() : [],
      vaultSync: this.getCurrentVaultSyncState(),
    });
  }

  private buildVaultEnvVars(): KeychainVaultEnvVar[] {
    const vfs = this.container.vfs;

    const claudeToken = (() => {
      if (!vfs.existsSync(CLAUDE_AUTH_CREDENTIALS_PATH)) return null;
      try {
        const parsed = JSON.parse(vfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, "utf8")) as {
          claudeAiOauth?: { accessToken?: string };
        };
        return parsed?.claudeAiOauth?.accessToken?.trim() || null;
      } catch {
        return null;
      }
    })();

    const replayToken = readReplayAuth(vfs)?.accessToken?.trim() || null;

    const ghToken = readGhToken(vfs)?.oauth_token?.trim() || null;

    const netlifyConfig = readNetlifyConfig(vfs);
    const netlifyToken = netlifyConfig.accessToken?.trim() || null;
    const netlifyAccountSlug = (() => {
      const fromPicker = this.getSelectedNetlifyAccountSlug(netlifyConfig.userId);
      if (fromPicker) return fromPicker;
      const candidates: unknown[] = [
        (netlifyConfig.raw as { accountSlug?: unknown })?.accountSlug,
        (netlifyConfig.raw as { account?: { slug?: unknown } })?.account?.slug,
        (netlifyConfig.raw as { telemetryAccountSlug?: unknown })?.telemetryAccountSlug,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
      }
      return null;
    })();

    const neonCredentials = readNeonCredentials(vfs);
    const neonAccessToken = neonCredentials?.access_token?.trim() || null;
    const neonApiKey = neonCredentials?.personal_api_key?.trim() || null;

    const infisicalConfig = readInfisicalConfig(vfs);
    const infisicalAuth = readInfisicalAuth(vfs);
    const infisicalCacheKey = this.getInfisicalCacheKey();
    const selectedInfisicalProjectId = infisicalCacheKey
      ? this.getSelectedInfisicalProjectId(infisicalCacheKey)
      : null;
    const infisicalProjects = infisicalCacheKey
      ? this.getCachedInfisicalProjects(infisicalCacheKey)
      : [];
    const selectedInfisicalProject = selectedInfisicalProjectId
      ? infisicalProjects.find((entry) => entry.id === selectedInfisicalProjectId)
      : undefined;
    const infisicalEnvironment = this.resolveInfisicalEnvironment();
    const infisicalClientId = infisicalConfig.machineIdentity?.clientId?.trim() || null;
    const infisicalClientSecret = infisicalConfig.machineIdentity?.clientSecret?.trim() || null;

    return [
      {
        name: "ANTHROPIC_API_KEY",
        value: claudeToken,
        source: CLAUDE_AUTH_CREDENTIALS_PATH,
        note: claudeToken ? "Claude OAuth access token" : undefined,
      },
      {
        name: "RECORD_REPLAY_API_KEY",
        value: replayToken,
        source: "/home/user/.replay/auth.json",
      },
      {
        name: "GITHUB_TOKEN",
        value: ghToken,
        source: "/home/user/.config/gh/hosts.yml",
      },
      {
        name: "NETLIFY_ACCOUNT_SLUG",
        value: netlifyAccountSlug,
        source: NETLIFY_CONFIG_PATH,
        note: netlifyAccountSlug
          ? undefined
          : "Pick an account from the Netlify slot.",
      },
      {
        name: "NETLIFY_AUTH_TOKEN",
        value: netlifyToken,
        source: NETLIFY_CONFIG_PATH,
      },
      {
        name: "NEON_API_KEY",
        value: neonApiKey,
        source: NEON_CREDENTIALS_PATH,
        note: neonApiKey
          ? "Neon personal API key"
          : neonAccessToken
            ? "Not minted yet — run `neon auth api-key create` or re-login."
            : undefined,
      },
      {
        name: "NEON_ACCESS_TOKEN",
        value: neonAccessToken,
        source: NEON_CREDENTIALS_PATH,
        note: neonAccessToken ? "Short-lived OAuth Bearer token" : undefined,
      },
      {
        name: "INFISICAL_CLIENT_ID",
        value: infisicalClientId,
        source: INFISICAL_CONFIG_PATH,
        note: infisicalClientId
          ? "Infisical Universal Auth client ID"
          : isInfisicalAccessTokenValid(infisicalAuth)
            ? "Auto-provisioning…"
            : "Sign in to Infisical to auto-provision.",
        excludeFromSync: true,
      },
      {
        name: "INFISICAL_CLIENT_SECRET",
        value: infisicalClientSecret,
        source: INFISICAL_CONFIG_PATH,
        note: infisicalClientSecret
          ? "Infisical Universal Auth client secret"
          : isInfisicalAccessTokenValid(infisicalAuth)
            ? "Auto-provisioning…"
            : "Sign in to Infisical to auto-provision.",
        excludeFromSync: true,
      },
      {
        name: "INFISICAL_PROJECT_ID",
        value: selectedInfisicalProjectId,
        source: INFISICAL_CONFIG_PATH,
        note: selectedInfisicalProjectId
          ? "Selected Infisical project"
          : "Pick a project from the Infisical slot.",
        excludeFromSync: true,
      },
      {
        name: "INFISICAL_ENVIRONMENT",
        value: selectedInfisicalProject ? infisicalEnvironment : null,
        source: INFISICAL_CONFIG_PATH,
        note: selectedInfisicalProject
          ? "Default Infisical environment"
          : "Pick a project from the Infisical slot.",
        excludeFromSync: true,
      },
    ];
  }

  private getTailscaleSidebarAuthAction(
    status: NetworkStatus | null,
  ): "login:tailscale" | "logout:tailscale" {
    return status?.provider === "tailscale"
      && (status.canLogout || status.state === "running" || status.state === "starting")
      ? "logout:tailscale"
      : "login:tailscale";
  }

  private buildAwsSidebarSlotStatus(
    summary = inspectAwsStoredState(this.container.vfs),
    config = readAwsConfig(this.container.vfs),
    auth = readAwsAuth(this.container.vfs),
  ): Pick<KeychainSlotStatus, "active" | "authAction" | "authLabel" | "statusText" | "statusDetail"> {
    const hasStoredLoginState = Object.keys(auth.sessions).length > 0
      || Object.keys(auth.roleCredentials).length > 0;
    const activeContext = summary.defaultProfile
      || (Object.keys(config.ssoSessions).length === 1 ? Object.keys(config.ssoSessions)[0] : null);

    if (!summary.hasSsoSessions) {
      return {
        active: false,
        authAction: "setup:aws",
        authLabel: "Set up AWS",
        statusText: "Setup required",
        statusDetail: "Add your AWS access portal and region before signing in.",
      };
    }

    if (summary.hasValidRoleCredentials || summary.hasValidAccessToken) {
      return {
        active: true,
        authAction: "logout:aws",
        authLabel: "Logout",
        statusText: activeContext ? `Signed in via ${activeContext}` : "Signed in",
      };
    }

    if (hasStoredLoginState) {
      return {
        active: false,
        authAction: "login:aws",
        authLabel: "Re-authenticate",
        statusText: "Session expired",
        statusDetail: "Sign in again to refresh your AWS session.",
      };
    }

    return {
      active: false,
      authAction: "login:aws",
      authLabel: "Login",
      statusText: "Ready to sign in",
    };
  }

  private buildInfisicalSidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    | "active"
    | "authAction"
    | "authLabel"
    | "statusText"
    | "statusDetail"
    | "pickers"
  > {
    const config = readInfisicalConfig(this.container.vfs);
    const auth = readInfisicalAuth(this.container.vfs);
    const isAuthenticated = isInfisicalAccessTokenValid(auth);
    const identityLabel = auth.email || config.loggedInUserEmail;
    const expiryLabel =
      auth.expiresAt && !Number.isNaN(new Date(auth.expiresAt).getTime())
        ? new Date(auth.expiresAt).toLocaleString()
        : null;
    const detail = [
      `Domain: ${auth.domain || config.domain}`,
      identityLabel ? `Account: ${identityLabel}` : null,
    ].filter(Boolean).join(" • ");

    if (isAuthenticated) {
      void this.ensureInfisicalProjectsLoaded();
      const cacheKey = this.getInfisicalCacheKey();
      const projects = cacheKey ? this.getCachedInfisicalProjects(cacheKey) : [];
      const selectedId = cacheKey
        ? this.getSelectedInfisicalProjectId(cacheKey)
        : null;
      const projectOptions = projects.map((project) => ({
        value: project.id,
        label: project.name,
      }));
      const selectedProject = selectedId
        ? projects.find((entry) => entry.id === selectedId)
        : undefined;
      const envOptions = (selectedProject?.environments ?? [])
        .map((env) => {
          const value = (env.slug ?? env.name ?? "").trim();
          const label = (env.name ?? env.slug ?? "").trim();
          return value ? { value, label: label || value } : null;
        })
        .filter((entry): entry is { value: string; label: string } => entry !== null);
      const selectedEnv = cacheKey && selectedId
        ? this.getSelectedInfisicalEnvironment(cacheKey, selectedId, envOptions.map((entry) => entry.value))
        : null;

      const pickers: KeychainSlotPicker[] = [];
      if (projectOptions.length > 0) {
        pickers.push({
          actionPrefix: "select-project:infisical",
          label: "Project",
          options: projectOptions,
          value: selectedId ?? undefined,
        });
      }
      if (envOptions.length > 0) {
        pickers.push({
          actionPrefix: "select-environment:infisical",
          label: "Env",
          options: envOptions,
          value: selectedEnv ?? undefined,
        });
      }

      return {
        active: true,
        authAction: "logout:infisical",
        authLabel: "Logout",
        statusText: identityLabel ? `Signed in as ${identityLabel}` : "Signed in",
        statusDetail: expiryLabel
          ? `${detail} • Token expires: ${expiryLabel}`
          : detail || "Infisical session stored in the workspace keychain.",
        pickers: pickers.length > 0 ? pickers : undefined,
      };
    }

    if (auth.accessToken) {
      return {
        active: false,
        authAction: "login:infisical",
        authLabel: "Re-authenticate",
        statusText: "Session expired",
        statusDetail: detail || "Sign in again to refresh the stored access token.",
      };
    }

    return {
      active: false,
      authAction: "login:infisical",
      authLabel: "Login",
      statusText: "Ready to sign in",
      statusDetail: detail || "Uses Infisical browser login and stores the session in this workspace.",
    };
  }

  private getInfisicalCacheKey(): string | null {
    const auth = readInfisicalAuth(this.container.vfs);
    const config = readInfisicalConfig(this.container.vfs);
    const domain = auth.domain || config.domain;
    const email = auth.email || config.loggedInUserEmail;
    if (!domain || !email) return null;
    return `${domain.toLowerCase()}|${email.toLowerCase()}`;
  }

  private getInfisicalProjectsCacheKey(key: string): string {
    return `almostnode.webide.infisical.projects.v1:${key}`;
  }

  private getInfisicalSelectedProjectKey(key: string): string {
    return `almostnode.webide.infisical.selectedProject.v1:${key}`;
  }

  private getCachedInfisicalProjects(key: string): InfisicalProjectInfo[] {
    if (this.infisicalProjectsCache?.key === key) {
      return this.infisicalProjectsCache.projects;
    }
    try {
      const raw = localStorage.getItem(this.getInfisicalProjectsCacheKey(key));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const projects: InfisicalProjectInfo[] = [];
      for (const entry of parsed) {
        if (
          entry
          && typeof entry === "object"
          && typeof (entry as InfisicalProjectInfo).id === "string"
          && typeof (entry as InfisicalProjectInfo).name === "string"
        ) {
          const value = entry as InfisicalProjectInfo;
          projects.push({
            id: value.id,
            name: value.name,
            slug: typeof value.slug === "string" ? value.slug : null,
            environments: Array.isArray(value.environments) ? value.environments : [],
          });
        }
      }
      this.infisicalProjectsCache = { key, projects };
      return projects;
    } catch {
      return [];
    }
  }

  private getSelectedInfisicalProjectId(key: string): string | null {
    try {
      const raw = localStorage.getItem(this.getInfisicalSelectedProjectKey(key));
      const trimmed = raw?.trim();
      if (!trimmed) return null;
      const projects = this.getCachedInfisicalProjects(key);
      if (projects.length > 0 && !projects.some((project) => project.id === trimmed)) {
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  private setSelectedInfisicalProjectId(key: string, projectId: string | null): void {
    try {
      const storageKey = this.getInfisicalSelectedProjectKey(key);
      if (projectId) {
        localStorage.setItem(storageKey, projectId);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  }

  private writeCachedInfisicalProjects(key: string, projects: InfisicalProjectInfo[]): void {
    this.infisicalProjectsCache = { key, projects };
    try {
      localStorage.setItem(
        this.getInfisicalProjectsCacheKey(key),
        JSON.stringify(projects),
      );
    } catch {
      // ignore
    }
  }

  private async ensureInfisicalProjectsLoaded(): Promise<void> {
    const key = this.getInfisicalCacheKey();
    if (!key) return;
    if (this.getCachedInfisicalProjects(key).length > 0) return;
    if (this.infisicalProjectsFetchInFlight) return;

    const auth = readInfisicalAuth(this.container.vfs);
    const config = readInfisicalConfig(this.container.vfs);
    const domain = auth.domain || config.domain;
    const token = auth.accessToken;
    if (!domain || !token) return;

    this.infisicalProjectsFetchInFlight = (async () => {
      try {
        const projects = await fetchInfisicalProjects(domain, token);
        this.writeCachedInfisicalProjects(key, projects);
        if (!this.getSelectedInfisicalProjectId(key) && projects.length > 0) {
          this.setSelectedInfisicalProjectId(key, projects[0].id);
        }
        this.updateKeychainSurface();
      } catch {
        // Network/API failures keep the picker hidden.
      } finally {
        this.infisicalProjectsFetchInFlight = null;
      }
    })();
  }

  private selectInfisicalProject(projectId: string): void {
    const key = this.getInfisicalCacheKey();
    if (!key || !projectId) return;
    this.setSelectedInfisicalProjectId(key, projectId);
    this.updateKeychainSurface();
    void this.ensureInfisicalUniversalAuthProvisioned();
  }

  private getInfisicalSelectedEnvKey(key: string, projectId: string): string {
    return `almostnode.webide.infisical.selectedEnv.v1:${key}:${projectId}`;
  }

  private getSelectedInfisicalEnvironment(
    key: string,
    projectId: string,
    knownValues?: string[],
  ): string | null {
    try {
      const raw = localStorage.getItem(this.getInfisicalSelectedEnvKey(key, projectId));
      const trimmed = raw?.trim();
      if (trimmed) {
        if (!knownValues || knownValues.length === 0 || knownValues.includes(trimmed)) {
          return trimmed;
        }
      }
    } catch {
      // ignore
    }
    return knownValues && knownValues.length > 0 ? knownValues[0] : null;
  }

  private setSelectedInfisicalEnvironment(
    key: string,
    projectId: string,
    env: string | null,
  ): void {
    try {
      const storageKey = this.getInfisicalSelectedEnvKey(key, projectId);
      if (env) {
        localStorage.setItem(storageKey, env);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  }

  private selectInfisicalEnvironment(env: string): void {
    const key = this.getInfisicalCacheKey();
    if (!key || !env) return;
    const projectId = this.getSelectedInfisicalProjectId(key);
    if (!projectId) return;
    this.setSelectedInfisicalEnvironment(key, projectId, env);
    this.updateKeychainSurface();
  }

  private resolveInfisicalEnvironment(): string {
    const key = this.getInfisicalCacheKey();
    if (!key) return "prod";
    const projectId = this.getSelectedInfisicalProjectId(key);
    if (!projectId) return "prod";
    const projects = this.getCachedInfisicalProjects(key);
    const project = projects.find((entry) => entry.id === projectId);
    const envOptions = (project?.environments ?? [])
      .map((env) => (env.slug ?? env.name ?? "").trim())
      .filter(Boolean);
    const selected = this.getSelectedInfisicalEnvironment(key, projectId, envOptions);
    if (selected) return selected;
    return envOptions[0] ?? "prod";
  }

  private getInfisicalEnvironmentLabel(slug: string): string {
    const key = this.getInfisicalCacheKey();
    if (!key) return slug;
    const projectId = this.getSelectedInfisicalProjectId(key);
    if (!projectId) return slug;
    const project = this.getCachedInfisicalProjects(key).find(
      (entry) => entry.id === projectId,
    );
    if (!project) return slug;
    const match = project.environments.find(
      (env) => (env.slug ?? env.name ?? "").trim() === slug,
    );
    return match?.name?.trim() || match?.slug?.trim() || slug;
  }

  private async handleInfisicalLogin(): Promise<void> {
    await this.keychainAuthAction("infisical login");
    void this.ensureInfisicalUniversalAuthProvisioned();
  }

  private async ensureInfisicalUniversalAuthProvisioned(): Promise<void> {
    if (this.infisicalUaProvisionInFlight) return;

    const auth = readInfisicalAuth(this.container.vfs);
    if (!isInfisicalAccessTokenValid(auth) || !auth.accessToken) return;

    const config = readInfisicalConfig(this.container.vfs);
    if (config.machineIdentity?.clientId && config.machineIdentity?.clientSecret) {
      return;
    }

    const tokenFingerprint = auth.accessToken.length + ":" + auth.accessToken.slice(-12);
    if (
      this.infisicalUaProvisionState?.tokenFingerprint === tokenFingerprint
      && this.infisicalUaProvisionState.status === "error"
    ) {
      return;
    }

    const domain = auth.domain || config.domain;
    const token = auth.accessToken;
    const cacheKey = this.getInfisicalCacheKey();
    const projectId = cacheKey
      ? this.getSelectedInfisicalProjectId(cacheKey)
      : null;

    this.infisicalUaProvisionInFlight = (async () => {
      try {
        const identityName = `almostnode-${typeof window !== "undefined" ? window.location.hostname : "browser"}-${new Date().toISOString().slice(0, 10)}`;
        const result = await provisionInfisicalUniversalAuth({
          domain,
          token,
          identityName,
          projectId: projectId ?? undefined,
        });

        const refreshedConfig = readInfisicalConfig(this.container.vfs);
        writeInfisicalConfig(this.container.vfs, {
          ...refreshedConfig,
          machineIdentity: {
            method: "universal-auth",
            clientId: result.clientId,
            clientSecret: result.clientSecret,
            organizationSlug: result.organizationSlug
              ?? refreshedConfig.machineIdentity?.organizationSlug
              ?? null,
          },
        });

        this.infisicalUaProvisionState = null;
        this.keychain.notifyExternalStateChanged();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.infisicalUaProvisionState = {
          tokenFingerprint,
          status: "error",
          message,
        };
        if (typeof console !== "undefined") {
          console.warn("Infisical Universal Auth auto-provision failed:", message);
        }
      } finally {
        this.infisicalUaProvisionInFlight = null;
        this.updateKeychainSurface();
      }
    })();
  }

  private getCurrentVaultSyncState(): KeychainVaultSyncState {
    const key = this.getInfisicalCacheKey();
    if (!key) {
      return {
        ...this.vaultSyncState,
        target: null,
        targetLabel: null,
      };
    }
    const projects = this.getCachedInfisicalProjects(key);
    const selectedId = this.getSelectedInfisicalProjectId(key);
    const selected = selectedId
      ? projects.find((project) => project.id === selectedId)
      : undefined;
    return {
      ...this.vaultSyncState,
      target: selected ? `infisical:${selected.id}` : null,
      targetLabel: selected ? selected.name : null,
    };
  }

  private setVaultSyncMessage(
    message: string | null,
    kind: KeychainVaultSyncState["messageKind"],
    autoClearMs?: number,
  ): void {
    this.vaultSyncState = {
      ...this.vaultSyncState,
      message,
      messageKind: message ? kind : null,
    };
    if (this.vaultSyncMessageClearTimer) {
      clearTimeout(this.vaultSyncMessageClearTimer);
      this.vaultSyncMessageClearTimer = null;
    }
    if (message && autoClearMs && autoClearMs > 0) {
      this.vaultSyncMessageClearTimer = setTimeout(() => {
        this.vaultSyncState = {
          ...this.vaultSyncState,
          message: null,
          messageKind: null,
        };
        this.vaultSyncMessageClearTimer = null;
        this.updateKeychainSurface();
      }, autoClearMs);
    }
  }

  private async syncVaultEnvToInfisical(): Promise<void> {
    if (this.vaultSyncState.busy) return;

    const key = this.getInfisicalCacheKey();
    if (!key) {
      this.setVaultSyncMessage(
        "Sign in to Infisical and pick a project first.",
        "error",
        6000,
      );
      this.updateKeychainSurface();
      return;
    }

    const auth = readInfisicalAuth(this.container.vfs);
    const config = readInfisicalConfig(this.container.vfs);
    const domain = auth.domain || config.domain;
    const token = auth.accessToken;
    if (!domain || !token) {
      this.setVaultSyncMessage("Infisical session is missing.", "error", 6000);
      this.updateKeychainSurface();
      return;
    }

    const projects = this.getCachedInfisicalProjects(key);
    const selectedId = this.getSelectedInfisicalProjectId(key);
    const project = selectedId
      ? projects.find((entry) => entry.id === selectedId)
      : undefined;
    if (!project) {
      this.setVaultSyncMessage(
        "Pick an Infisical project from the slot above first.",
        "error",
        6000,
      );
      this.updateKeychainSurface();
      return;
    }

    const environment = this.resolveInfisicalEnvironment();

    const envVars = this.buildVaultEnvVars().filter(
      (entry) => entry.value && !entry.excludeFromSync,
    );
    if (envVars.length === 0) {
      this.setVaultSyncMessage("No populated env vars to sync.", "error", 6000);
      this.updateKeychainSurface();
      return;
    }

    this.vaultSyncState = {
      ...this.vaultSyncState,
      busy: true,
      message: `Syncing ${envVars.length} secret${envVars.length === 1 ? "" : "s"} to ${project.name}…`,
      messageKind: "info",
    };
    this.updateKeychainSurface();

    try {
      await ensureInfisicalFolder({
        domain,
        token,
        projectId: project.id,
        environment,
        secretPath: "/global",
      });
    } catch (error) {
      this.vaultSyncState = { ...this.vaultSyncState, busy: false };
      this.setVaultSyncMessage(
        `Sync failed while ensuring /global folder: ${error instanceof Error ? error.message : String(error)}`,
        "error",
        10000,
      );
      this.updateKeychainSurface();
      return;
    }

    let createdCount = 0;
    let updatedCount = 0;
    const failures: string[] = [];
    for (const entry of envVars) {
      try {
        const result = await upsertInfisicalSecret({
          domain,
          token,
          projectId: project.id,
          environment,
          key: entry.name,
          value: entry.value as string,
          secretPath: "/global",
        });
        if (result === "created") createdCount += 1;
        else updatedCount += 1;
      } catch (error) {
        failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.vaultSyncState = {
      ...this.vaultSyncState,
      busy: false,
    };

    if (failures.length === 0) {
      this.setVaultSyncMessage(
        `Synced ${envVars.length} secret${envVars.length === 1 ? "" : "s"} to ${project.name} (${environment} • /global). ${createdCount} created, ${updatedCount} updated.`,
        "success",
        8000,
      );
    } else if (failures.length === envVars.length) {
      this.setVaultSyncMessage(
        `Sync failed: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`,
        "error",
        10000,
      );
    } else {
      this.setVaultSyncMessage(
        `Synced ${envVars.length - failures.length}/${envVars.length} secrets. Failed: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`,
        "error",
        10000,
      );
    }
    this.updateKeychainSurface();
  }

  private buildFlySidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    | "active"
    | "authAction"
    | "authLabel"
    | "statusText"
    | "statusDetail"
    | "selectActionPrefix"
    | "selectLabel"
    | "selectOptions"
    | "selectValue"
  > {
    const config = readFlyConfig(this.container.vfs);
    if (!config.accessToken) {
      return {
        active: false,
        authAction: "login:fly",
        authLabel: "Login",
        statusText: "Ready to sign in",
        statusDetail:
          "Uses Fly.io's browser login flow and stores the short-lived auth token in this workspace.",
      };
    }

    const parsedLastLogin = config.lastLogin ? new Date(config.lastLogin) : null;
    const lastLoginLabel =
      parsedLastLogin && !Number.isNaN(parsedLastLogin.getTime())
        ? parsedLastLogin.toLocaleString()
        : null;

    void this.ensureFlyAppsLoaded(config.accessToken);
    const fingerprint = this.getFlyTokenFingerprint(config.accessToken);
    const apps = fingerprint ? this.getCachedFlyApps(fingerprint) : [];
    const fetchStatus = this.getFlyAppsFetchStatus(config.accessToken);
    const selectedAppName = fingerprint
      ? this.getSelectedFlyAppName(fingerprint)
      : null;
    const appOptions = apps.map((app) => ({
      value: app.name,
      label: app.organizationSlug ? `${app.name} (${app.organizationSlug})` : app.name,
    }));

    const detailParts: string[] = [];
    if (lastLoginLabel) detailParts.push(`Last login: ${lastLoginLabel}`);
    if (apps.length === 0) {
      if (fetchStatus?.status === "loading") {
        detailParts.push("Loading apps…");
      } else if (fetchStatus?.status === "error") {
        detailParts.push(`Apps: ${fetchStatus.message ?? "fetch failed"}`);
      } else {
        detailParts.push("No Fly apps found for this token.");
      }
    }

    return {
      active: true,
      authAction: "logout:fly",
      authLabel: "Logout",
      statusText: "Signed in",
      statusDetail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      selectActionPrefix:
        appOptions.length > 0 ? "select-app:fly" : undefined,
      selectLabel: appOptions.length > 0 ? "App" : undefined,
      selectOptions: appOptions.length > 0 ? appOptions : undefined,
      selectValue: selectedAppName ?? undefined,
    };
  }

  private getFlyTokenFingerprint(token: string | null): string | null {
    if (!token) return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    const tail = trimmed.slice(-12);
    return `${trimmed.length}:${tail}`;
  }

  private getFlyAppsCacheKey(fingerprint: string): string {
    return `almostnode.webide.fly.apps.v1:${fingerprint}`;
  }

  private getFlySelectedAppKey(fingerprint: string): string {
    return `almostnode.webide.fly.selectedApp.v1:${fingerprint}`;
  }

  private getCachedFlyApps(fingerprint: string): FlyAppSummary[] {
    if (this.flyAppsCache?.tokenFingerprint === fingerprint) {
      return this.flyAppsCache.apps;
    }
    try {
      const raw = localStorage.getItem(this.getFlyAppsCacheKey(fingerprint));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const apps: FlyAppSummary[] = [];
      for (const entry of parsed) {
        if (
          entry
          && typeof entry === "object"
          && typeof (entry as FlyAppSummary).id === "string"
          && typeof (entry as FlyAppSummary).name === "string"
        ) {
          const value = entry as FlyAppSummary;
          apps.push({
            id: value.id,
            name: value.name,
            status: typeof value.status === "string" ? value.status : null,
            organizationSlug:
              typeof value.organizationSlug === "string"
                ? value.organizationSlug
                : null,
          });
        }
      }
      this.flyAppsCache = { tokenFingerprint: fingerprint, apps };
      return apps;
    } catch {
      return [];
    }
  }

  private getSelectedFlyAppName(fingerprint: string): string | null {
    try {
      const raw = localStorage.getItem(this.getFlySelectedAppKey(fingerprint));
      const trimmed = raw?.trim();
      if (!trimmed) return null;
      const apps = this.getCachedFlyApps(fingerprint);
      if (apps.length > 0 && !apps.some((app) => app.name === trimmed)) {
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  private setSelectedFlyAppName(fingerprint: string, name: string | null): void {
    try {
      const key = this.getFlySelectedAppKey(fingerprint);
      if (name) {
        localStorage.setItem(key, name);
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  private writeCachedFlyApps(fingerprint: string, apps: FlyAppSummary[]): void {
    this.flyAppsCache = { tokenFingerprint: fingerprint, apps };
    try {
      localStorage.setItem(
        this.getFlyAppsCacheKey(fingerprint),
        JSON.stringify(apps),
      );
    } catch {
      // ignore
    }
  }

  private async ensureFlyAppsLoaded(token: string | null): Promise<void> {
    const fingerprint = this.getFlyTokenFingerprint(token);
    if (!fingerprint || !token) return;
    if (this.getCachedFlyApps(fingerprint).length > 0) return;
    if (this.flyAppsFetchInFlight) return;
    if (this.flyAppsFetchState?.fingerprint === fingerprint && this.flyAppsFetchState.status === "error") {
      // Don't keep retrying a failed fetch on every render; user can refresh after re-login.
      return;
    }

    this.flyAppsFetchState = { fingerprint, status: "loading" };
    this.flyAppsFetchInFlight = (async () => {
      try {
        const apps = await fetchFlyApps(DEFAULT_FLY_API_BASE_URL, token);
        this.writeCachedFlyApps(fingerprint, apps);
        this.flyAppsFetchState = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.flyAppsFetchState = { fingerprint, status: "error", message };
      } finally {
        this.flyAppsFetchInFlight = null;
        this.updateKeychainSurface();
      }
    })();
  }

  private getFlyAppsFetchStatus(token: string | null): { status: "loading" | "error"; message?: string } | null {
    const fingerprint = this.getFlyTokenFingerprint(token);
    if (!fingerprint) return null;
    if (this.flyAppsFetchState?.fingerprint !== fingerprint) return null;
    return {
      status: this.flyAppsFetchState.status,
      message: this.flyAppsFetchState.message,
    };
  }

  private selectFlyApp(name: string): void {
    const config = readFlyConfig(this.container.vfs);
    const fingerprint = this.getFlyTokenFingerprint(config.accessToken);
    if (!name) return;
    if (fingerprint) {
      this.setSelectedFlyAppName(fingerprint, name);
    }
    writeFlyAppName(this.container.vfs, name);
    this.keychain.notifyExternalStateChanged();
    this.updateKeychainSurface();
  }

  private getEffectiveFlyAppName(token: string | null, fallback: string): string {
    const fingerprint = this.getFlyTokenFingerprint(token);
    const fromLocalStorage = fingerprint ? this.getSelectedFlyAppName(fingerprint) : null;
    const fromConfig = readFlyConfig(this.container.vfs).appName;
    return fromLocalStorage || fromConfig || fallback;
  }

  private buildNetlifySidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    | "active"
    | "authAction"
    | "authLabel"
    | "statusText"
    | "statusDetail"
    | "selectActionPrefix"
    | "selectLabel"
    | "selectOptions"
    | "selectValue"
  > {
    const config = readNetlifyConfig(this.container.vfs);
    if (!config.accessToken) {
      return {
        active: false,
        authAction: "login:netlify",
        authLabel: "Login",
        statusText: "Ready to sign in",
        statusDetail:
          "Uses Netlify's browser authorization flow and stores the access token in this workspace.",
      };
    }

    const identity = config.currentUser?.email
      || config.currentUser?.name
      || null;

    void this.ensureNetlifyAccountsLoaded(config);

    const accounts = this.getCachedNetlifyAccounts(config.userId);
    const selectedSlug = this.getSelectedNetlifyAccountSlug(config.userId);
    const accountOptions = accounts.map((account) => ({
      value: account.slug,
      label: account.name?.trim() || account.slug,
    }));

    return {
      active: true,
      authAction: "logout:netlify",
      authLabel: "Logout",
      statusText: identity ? `Signed in as ${identity}` : "Signed in",
      statusDetail:
        config.currentUser?.name && config.currentUser?.email
          ? `${config.currentUser.name} • ${config.currentUser.email}`
          : undefined,
      selectActionPrefix:
        accountOptions.length > 0 ? "select-account:netlify" : undefined,
      selectLabel: accountOptions.length > 0 ? "Account" : undefined,
      selectOptions: accountOptions.length > 0 ? accountOptions : undefined,
      selectValue: selectedSlug ?? undefined,
    };
  }

  private getNetlifyAccountsCacheKey(userId: string): string {
    return `almostnode.webide.netlify.accounts.v1:${userId}`;
  }

  private getNetlifySelectedAccountKey(userId: string): string {
    return `almostnode.webide.netlify.selectedAccount.v1:${userId}`;
  }

  private getCachedNetlifyAccounts(userId: string | null): NetlifyAccount[] {
    if (!userId) return [];
    if (this.netlifyAccountsCache?.userId === userId) {
      return this.netlifyAccountsCache.accounts;
    }
    try {
      const raw = localStorage.getItem(this.getNetlifyAccountsCacheKey(userId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const accounts: NetlifyAccount[] = [];
      for (const entry of parsed) {
        if (
          entry
          && typeof entry === "object"
          && typeof (entry as NetlifyAccount).id === "string"
          && typeof (entry as NetlifyAccount).slug === "string"
        ) {
          const value = entry as NetlifyAccount;
          accounts.push({
            id: value.id,
            slug: value.slug,
            name: typeof value.name === "string" ? value.name : null,
            type: typeof value.type === "string" ? value.type : null,
          });
        }
      }
      this.netlifyAccountsCache = { userId, accounts };
      return accounts;
    } catch {
      return [];
    }
  }

  private getSelectedNetlifyAccountSlug(userId: string | null): string | null {
    if (!userId) return null;
    try {
      const raw = localStorage.getItem(this.getNetlifySelectedAccountKey(userId));
      const trimmed = raw?.trim();
      if (!trimmed) return null;
      const accounts = this.getCachedNetlifyAccounts(userId);
      if (accounts.length > 0 && !accounts.some((account) => account.slug === trimmed)) {
        return null;
      }
      return trimmed;
    } catch {
      return null;
    }
  }

  private setSelectedNetlifyAccountSlug(userId: string, slug: string | null): void {
    try {
      const key = this.getNetlifySelectedAccountKey(userId);
      if (slug) {
        localStorage.setItem(key, slug);
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore storage failures
    }
  }

  private writeCachedNetlifyAccounts(userId: string, accounts: NetlifyAccount[]): void {
    this.netlifyAccountsCache = { userId, accounts };
    try {
      localStorage.setItem(
        this.getNetlifyAccountsCacheKey(userId),
        JSON.stringify(accounts),
      );
    } catch {
      // ignore storage failures
    }
  }

  private async ensureNetlifyAccountsLoaded(
    config = readNetlifyConfig(this.container.vfs),
  ): Promise<void> {
    if (!config.accessToken || !config.userId) return;
    if (this.getCachedNetlifyAccounts(config.userId).length > 0) return;
    if (this.netlifyAccountsFetchInFlight) return;

    const userId = config.userId;
    const token = config.accessToken;
    this.netlifyAccountsFetchInFlight = (async () => {
      try {
        const accounts = await fetchNetlifyAccounts(
          DEFAULT_NETLIFY_API_BASE_URL,
          token,
        );
        this.writeCachedNetlifyAccounts(userId, accounts);

        if (!this.getSelectedNetlifyAccountSlug(userId) && accounts.length > 0) {
          const personal = accounts.find(
            (account) => (account.type ?? "").toLowerCase() === "personal",
          );
          this.setSelectedNetlifyAccountSlug(
            userId,
            (personal ?? accounts[0]).slug,
          );
        }

        this.updateKeychainSurface();
      } catch {
        // Network/API failure — keep showing the slot without a picker.
      } finally {
        this.netlifyAccountsFetchInFlight = null;
      }
    })();
  }

  private selectNetlifyAccount(slug: string): void {
    const config = readNetlifyConfig(this.container.vfs);
    if (!config.userId || !slug) return;
    this.setSelectedNetlifyAccountSlug(config.userId, slug);
    this.updateKeychainSurface();
  }

  private buildNeonSidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    "active" | "authAction" | "authLabel" | "statusText" | "statusDetail"
  > {
    const credentials = readNeonCredentials(this.container.vfs);
    if (!credentials?.access_token && !credentials?.refresh_token) {
      return {
        active: false,
        authAction: "login:neon",
        authLabel: "Login",
        statusText: "Ready to sign in",
        statusDetail:
          this.desktopBridge
            ? "Uses Neon OAuth with an automatic localhost callback listener in the desktop host. After login, run `neon auth api-key create --name <name>` for a personal API key or `neon auth token` for the short-lived bearer token."
            : "Uses Neon OAuth and stores refreshable workspace credentials. After login, run `neon auth api-key create --name <name>` for a personal API key or `neon auth token` for the short-lived bearer token.",
      };
    }

    const parsedExpiry = typeof credentials.expires_at === "number"
      ? new Date(credentials.expires_at)
      : null;
    const expiryLabel =
      parsedExpiry && !Number.isNaN(parsedExpiry.getTime())
        ? parsedExpiry.toLocaleString()
        : null;

    return {
      active: true,
      authAction: "logout:neon",
      authLabel: "Logout",
      statusText: "Signed in",
      statusDetail: expiryLabel ? `Token expires: ${expiryLabel}` : "Refresh token stored in workspace keychain.",
    };
  }

  private buildCloudflareSidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    "active" | "authAction" | "authLabel" | "statusText" | "statusDetail"
  > {
    const config = readWranglerAuthConfig(this.container.vfs);
    if (!config.accessToken && !config.refreshToken) {
      return {
        active: false,
        authAction: "login:cloudflare",
        authLabel: "Login",
        statusText: "Ready to sign in",
        statusDetail:
          this.desktopBridge
            ? "Uses Wrangler OAuth with an automatic localhost callback listener in the desktop host."
            : "Uses Wrangler OAuth. In browser-only sessions, Cloudflare still redirects to localhost:8976, so the fallback is pasting the callback URL to complete login.",
      };
    }

    const parsedExpiry = config.expirationTime ? new Date(config.expirationTime) : null;
    const expiryLabel =
      parsedExpiry && !Number.isNaN(parsedExpiry.getTime())
        ? parsedExpiry.toLocaleString()
        : null;

    return {
      active: true,
      authAction: "logout:cloudflare",
      authLabel: "Logout",
      statusText: "Signed in",
      statusDetail: expiryLabel ? `Token expires: ${expiryLabel}` : "Refresh token stored in workspace keychain.",
    };
  }

  private buildAppBuildingSidebarSlotStatus(): Pick<
    KeychainSlotStatus,
    "active" | "authAction" | "authLabel" | "statusText" | "statusDetail" | "canAuth"
  > {
    const config = this.getEffectiveAppBuildingSetup();
    const missing: string[] = [];
    if (!config.flyAppName) missing.push("Fly app (pick one in the Fly.io slot)");
    if (!config.flyApiToken) missing.push("Fly API token (login via Fly.io slot)");
    if (!config.infisicalClientId) missing.push("Infisical Universal Auth client ID");
    if (!config.infisicalClientSecret) missing.push("Infisical Universal Auth client secret");
    if (!config.infisicalProjectId) missing.push("Infisical project (pick one in the Infisical slot)");
    if (!config.infisicalEnvironment) missing.push("Infisical environment");

    if (missing.length > 0) {
      return {
        active: false,
        canAuth: false,
        statusText: `Missing ${missing.length} item${missing.length === 1 ? "" : "s"}`,
        statusDetail: `Missing: ${missing.join(", ")}.`,
      };
    }

    const envLabel = this.getInfisicalEnvironmentLabel(config.infisicalEnvironment);
    const detail = [
      `Fly app: ${config.flyAppName}`,
      `Infisical: ${envLabel}`,
      config.imageRef ? `Image: ${config.imageRef}` : null,
    ].filter(Boolean).join(" • ");

    return {
      active: true,
      canAuth: false,
      statusText: "Ready for remote jobs",
      statusDetail: detail || undefined,
    };
  }

  private getEffectiveAppBuildingSetup(): AppBuildingSetupDraft {
    const stored = readAppBuildingSetup(this.container.vfs);
    const flyConfig = readFlyConfig(this.container.vfs);
    const infisicalConfig = readInfisicalConfig(this.container.vfs);

    const infisicalKey = this.getInfisicalCacheKey();
    const selectedProjectId = infisicalKey
      ? this.getSelectedInfisicalProjectId(infisicalKey)
      : null;
    const resolvedEnvironment = selectedProjectId
      ? this.resolveInfisicalEnvironment()
      : stored.infisicalEnvironment || "prod";

    return normalizeAppBuildingSetupDraft({
      flyAppName: this.getEffectiveFlyAppName(flyConfig.accessToken, stored.flyAppName),
      flyApiToken: stored.flyApiToken || flyConfig.accessToken || undefined,
      infisicalClientId:
        infisicalConfig.machineIdentity?.clientId || stored.infisicalClientId,
      infisicalClientSecret:
        infisicalConfig.machineIdentity?.clientSecret || stored.infisicalClientSecret,
      infisicalProjectId: selectedProjectId || stored.infisicalProjectId,
      infisicalEnvironment: resolvedEnvironment,
      repositoryCloneUrl: stored.repositoryCloneUrl,
      repositoryBaseBranch: stored.repositoryBaseBranch,
      imageRef: stored.imageRef,
    });
  }

  private getPreferredAwsSessionName(config = readAwsConfig(this.container.vfs)): string | null {
    if (config.defaultProfile && config.profiles[config.defaultProfile]) {
      const sessionName = config.profiles[config.defaultProfile].ssoSession;
      if (config.ssoSessions[sessionName]) {
        return sessionName;
      }
    }

    const sessionNames = Object.keys(config.ssoSessions);
    return sessionNames.length === 1 ? sessionNames[0] : null;
  }

  private buildAwsLoginCommand(): string {
    const sessionName = this.getPreferredAwsSessionName();
    return sessionName
      ? `aws sso login --sso-session ${this.quoteShellArg(sessionName)}`
      : "aws sso login";
  }

  private buildAwsLogoutCommand(): string {
    const sessionName = this.getPreferredAwsSessionName();
    return sessionName
      ? `aws sso logout --sso-session ${this.quoteShellArg(sessionName)}`
      : "aws sso logout";
  }

  private getAwsSetupDraft(): AwsSetupDraft {
    const config = readAwsConfig(this.container.vfs);
    const sessionNames = Object.keys(config.ssoSessions);
    const sessionName = sessionNames[0] || DEFAULT_AWS_SESSION_NAME;
    const session = config.ssoSessions[sessionName];

    return normalizeAwsSetupDraft({
      sessionName,
      startUrl: session?.startUrl || "",
      region: session?.region || DEFAULT_AWS_REGION,
    });
  }

  async saveAwsSetup(draft: AwsSetupDraft): Promise<void> {
    const normalized = normalizeAwsSetupDraft(draft);
    const validationError = validateAwsSetupDraft(normalized);
    if (validationError) {
      throw new Error(validationError);
    }

    const config = readAwsConfig(this.container.vfs);
    const existingSession = config.ssoSessions[normalized.sessionName];
    config.ssoSessions[normalized.sessionName] = {
      startUrl: normalized.startUrl,
      region: normalized.region,
      registrationScopes: existingSession?.registrationScopes || ["sso:account:access"],
    };
    writeAwsConfig(this.container.vfs, config);
    this.keychain.notifyExternalStateChanged();
    this.updateKeychainSurface();
  }

  private getAppBuildingSetupDraft(): AppBuildingSetupDraft {
    return this.getEffectiveAppBuildingSetup();
  }

  async saveAppBuildingSetup(draft: AppBuildingSetupDraft): Promise<void> {
    const normalized = normalizeAppBuildingSetupDraft(draft);
    const validationError = validateAppBuildingSetupDraft(normalized);
    if (validationError) {
      throw new Error(validationError);
    }

    writeAppBuildingSetup(this.container.vfs, normalized);
    await this.syncActiveProjectAppBuildingConfig();
    this.keychain.notifyExternalStateChanged();
    this.updateKeychainSurface();
  }

  private async syncActiveProjectAppBuildingConfig(): Promise<void> {
    if (!this.activeProjectId) {
      return;
    }

    const config = readAppBuildingSetup(this.container.vfs);
    const summary = buildAppBuildingConfigSummary(
      this.activeProjectId,
      config,
    );
    await this.projectDb.putAppBuildingConfig(summary);
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

    const requestedExitNodeId = this.getRequestedTailscaleExitNodeId();
    const selectedExitNodeName =
      status.selectedExitNodeId
        ? status.exitNodes.find((exitNode) => exitNode.id === status.selectedExitNodeId)?.name
        : null;
    const requestedExitNodeName =
      !selectedExitNodeName && requestedExitNodeId
        ? status.exitNodes.find((exitNode) => exitNode.id === requestedExitNodeId)?.name
          ?? requestedExitNodeId
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
          : requestedExitNodeName
            ? `Running, selecting ${requestedExitNodeName}`
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

  private getRequestedTailscaleExitNodeId(): string | null {
    try {
      const config = this.container.network.getConfig();
      if (config.provider !== "tailscale" || !config.useExitNode) {
        return null;
      }
      return config.exitNodeId?.trim() || null;
    } catch {
      return null;
    }
  }

  private async keychainAuthAction(command: string): Promise<void> {
    await this.revealTerminalPanel(true);
    const tab = this.createUserTerminalTab(true);
    try {
      await this.runCommand(tab, command, { echoCommand: true });
    } finally {
      await this.syncActiveProjectAppBuildingConfig();
      this.keychain.notifyExternalStateChanged();
      this.updateKeychainStatusEntry();
      this.updateKeychainSurface();
    }
  }

  private async flyAuthAction(
    action: "login" | "logout",
  ): Promise<void> {
    this.flyAppsCache = null;
    this.flyAppsFetchState = null;
    if (action === "logout") {
      await this.keychainAuthAction("fly auth logout");
      return;
    }

    prepareFlyAuthPopup();
    await this.keychainAuthAction("fly auth login");
  }

  private async netlifyAuthAction(
    action: "login" | "logout",
  ): Promise<void> {
    if (action === "logout") {
      await this.keychainAuthAction("netlify logout");
      return;
    }

    prepareNetlifyAuthPopup();
    await this.keychainAuthAction("netlify login");
  }

  private async cloudflareAuthAction(
    action: "login" | "logout",
  ): Promise<void> {
    if (action === "logout") {
      await this.keychainAuthAction("wrangler logout");
      return;
    }

    prepareCloudflareAuthPopup();
    await this.keychainAuthAction("wrangler login");
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

  private isPreviewMessageSource(source: MessageEventSource | null): boolean {
    if (source && this.externalPreviewWindow && source === this.externalPreviewWindow) {
      return true;
    }

    const iframeWindow = this.previewSurface.getIframe().contentWindow;
    return Boolean(iframeWindow && source === iframeWindow);
  }

  private registerPreviewHmrTargets(): void {
    if (this.previewPort === null) {
      return;
    }

    if (this.previewMode === "workbench") {
      const iframeWindow = this.previewSurface.getIframe().contentWindow;
      if (iframeWindow) {
        this.container.setHMRTargetForPort(this.previewPort, iframeWindow);
      }
    }

    if (this.externalPreviewWindow) {
      this.container.setHMRTargetForPort(this.previewPort, this.externalPreviewWindow);
    }
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

    const shouldPrepareFlyAuthPopup =
      this.agentMode === "browser"
      && tab.kind === "user"
      && isFlyLoginCommand(trimmed);
    if (shouldPrepareFlyAuthPopup) {
      prepareFlyAuthPopup();
    }

    const shouldPrepareNetlifyAuthPopup =
      this.agentMode === "browser"
      && tab.kind === "user"
      && isNetlifyLoginCommand(trimmed);
    if (shouldPrepareNetlifyAuthPopup) {
      prepareNetlifyAuthPopup();
    }

    const shouldPrepareCloudflareAuthPopup =
      this.agentMode === "browser"
      && tab.kind === "user"
      && isCloudflareLoginCommand(trimmed);
    if (shouldPrepareCloudflareAuthPopup) {
      prepareCloudflareAuthPopup();
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
      if (shouldPrepareFlyAuthPopup) {
        cancelPreparedFlyAuthPopup();
      }
      if (shouldPrepareNetlifyAuthPopup) {
        cancelPreparedNetlifyAuthPopup();
      }
      if (shouldPrepareCloudflareAuthPopup) {
        cancelPreparedCloudflareAuthPopup();
      }
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
    const executableCommand =
      this.agentMode === "browser"
        ? this.augmentClaudeLaunchCommand(trimmed)
        : trimmed;

    try {
      const result = await tab.session.run(executableCommand, {
        signal: tab.runningAbortController.signal,
        onStdout: (text) => this.writeTerminal(tab, text),
        onStderr: (text) => this.writeTerminal(tab, text),
        interactive: shouldRunWorkbenchCommandInteractively(trimmed, tab.kind),
      });
      this.updateTerminalStatus(tab, `Exited ${result.exitCode}`);
    } finally {
      if (shouldPrepareFlyAuthPopup) {
        cancelPreparedFlyAuthPopup();
      }
      if (shouldPrepareNetlifyAuthPopup) {
        cancelPreparedNetlifyAuthPopup();
      }
      if (shouldPrepareCloudflareAuthPopup) {
        cancelPreparedCloudflareAuthPopup();
      }
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

  private registerWorkbenchShellCommands(): void {
    if (typeof this.container.registerShellCommand !== "function") {
      return;
    }

    this.container.registerShellCommand({
      name: "webide-open",
      interceptShellParsing: true,
      execute: async (args, context) => {
        const rawTarget = args.join(" ").trim();

        try {
          const target = await this.runWebIdeOpenCommand(rawTarget, context.cwd);
          const suffix =
            typeof target.line === "number"
              ? `:${target.line}${typeof target.column === "number" ? `:${target.column}` : ""}`
              : "";
          return {
            stdout: `Opened ${target.path}${suffix}\n`,
            stderr: "",
            exitCode: 0,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            stdout: "",
            stderr: `${message}\n`,
            exitCode: 1,
          };
        }
      },
    });

    this.container.registerShellCommand({
      name: "app-building",
      interceptShellParsing: true,
      execute: async (args, context) => {
        try {
          return await this.runAppBuildingShellCommand(args, context);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            stdout: "",
            stderr: `${message}\n`,
            exitCode: 1,
          };
        }
      },
    });
  }

  private async runWebIdeOpenCommand(
    rawTarget: string,
    cwd: string,
  ): Promise<WebIdeOpenTarget> {
    const target = parseWebIdeOpenTarget(rawTarget);
    const resolvedPath = resolveWebIdeOpenPath(target.path, cwd, WORKSPACE_ROOT);

    if (!this.container.vfs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const stat = this.container.vfs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`webide-open only supports files, not directories: ${resolvedPath}`);
    }

    const resolvedTarget: WebIdeOpenTarget = {
      ...target,
      path: resolvedPath,
    };
    await this.openWorkspaceTargetInEditor(resolvedTarget);
    return resolvedTarget;
  }

  private async runAppBuildingShellCommand(
    args: string[],
    context: import("almostnode").ShellCommandContext,
  ): Promise<AppBuildingRunResult> {
    const command = parseAppBuildingCommand(args);

    if (command.verb === "help") {
      return { stdout: APP_BUILDING_HELP_TEXT, stderr: "", exitCode: 0 };
    }

    if (!(await this.keychain.prepareForCommand("app-building"))) {
      throw new Error(
        "Unlock the saved keychain before running app-building commands.",
      );
    }

    if (command.verb === "list") {
      const projectId = this.requireActiveProjectId();
      const jobs = await this.projectDb.listAppBuildingJobs(projectId);
      const refreshed = await Promise.all(
        jobs.map(async (job) => {
          const updated = await this.refreshAppBuildingJobFromFly(job);
          if (updated !== job) {
            await this.projectDb.putAppBuildingJob(updated);
          }
          return updated;
        }),
      );
      return {
        stdout: formatAppBuildingJobList(refreshed),
        stderr: "",
        exitCode: 0,
      };
    }

    if (command.verb === "create") {
      return this.handleAppBuildingCreate(command, context);
    }

    if (command.verb === "status") {
      return this.handleAppBuildingStatus(command.jobId);
    }

    if (command.verb === "logs") {
      return this.handleAppBuildingLogs(command.jobId, command.offset);
    }

    if (command.verb === "message") {
      return this.handleAppBuildingMessage(command.jobId, command.prompt);
    }

    return this.handleAppBuildingStop(command.jobId);
  }

  private createPreviewAppBuildingBridgeContext(
    stdoutChunks: string[],
    stderrChunks: string[],
  ): import("almostnode").ShellCommandContext {
    const env: Record<string, string> = {};

    return {
      cwd: WORKSPACE_ROOT,
      env,
      stdin: "",
      vfs: this.container.vfs,
      writeStdout: (data: string) => {
        stdoutChunks.push(data);
      },
      writeStderr: (data: string) => {
        stderrChunks.push(data);
      },
      setEnv: (name: string, value: string | null | undefined) => {
        if (value === null || typeof value === "undefined") {
          delete env[name];
          return;
        }
        env[name] = value;
      },
      getEnv: () => ({ ...env }),
      setCwd: () => {},
      exec: async () => ({
        stdout: "",
        stderr: "Shell exec is not available from the preview bridge.\n",
        exitCode: 1,
      }),
    };
  }

  private async handlePreviewAppBuildingBridgeRequest(
    targetWindow: Window,
    request: PreviewAppBuildingBridgeRequest,
  ): Promise<void> {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const context = this.createPreviewAppBuildingBridgeContext(
      stdoutChunks,
      stderrChunks,
    );

    if (request.action === "reset-logs") {
      try {
        const reset = await this.resetAppBuildingLogCursor(request.jobId);
        const response: PreviewAppBuildingBridgeResponse = {
          type: "almostnode-app-building-response",
          requestId: request.requestId,
          ok: true,
          stdout: "Log cursor reset.\n",
          stderr: "",
          exitCode: 0,
          jobId: reset.id,
        };
        targetWindow.postMessage(response, "*");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response: PreviewAppBuildingBridgeResponse = {
          type: "almostnode-app-building-response",
          requestId: request.requestId,
          ok: false,
          stdout: "",
          stderr: `${message}\n`,
          exitCode: 1,
          error: message,
        };
        targetWindow.postMessage(response, "*");
      }
      return;
    }

    const args = request.action === "create"
      ? ["create", "--remote", "--name", request.name, "--prompt", request.prompt]
      : request.action === "message"
        ? ["message", request.jobId, "--prompt", request.prompt]
        : request.action === "logs"
          ? [
            "logs",
            request.jobId,
            ...(typeof request.offset === "number" ? ["--offset", String(request.offset)] : []),
          ]
          : [request.action, request.jobId];

    try {
      const result = await this.runAppBuildingShellCommand(args, context);
      const response: PreviewAppBuildingBridgeResponse = {
        type: "almostnode-app-building-response",
        requestId: request.requestId,
        ok: result.exitCode === 0,
        stdout: `${stdoutChunks.join("")}${result.stdout}`,
        stderr: `${stderrChunks.join("")}${result.stderr}`,
        exitCode: result.exitCode,
        jobId: result.jobId,
      };
      targetWindow.postMessage(response, "*");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response: PreviewAppBuildingBridgeResponse = {
        type: "almostnode-app-building-response",
        requestId: request.requestId,
        ok: false,
        stdout: stdoutChunks.join(""),
        stderr: `${stderrChunks.join("")}${message}\n`,
        exitCode: 1,
        error: message,
      };
      targetWindow.postMessage(response, "*");
    }
  }

  private requireActiveProjectId(): string {
    if (!this.activeProjectId) {
      throw new Error("Select a project before using app-building commands.");
    }
    return this.activeProjectId;
  }

  private requireAppBuildingSetup(): AppBuildingSetupDraft {
    const config = this.getAppBuildingSetupDraft();
    const validationError = validateAppBuildingSetupDraft(config);
    if (validationError) {
      throw new Error(`${validationError} Configure the missing piece in the Keychain sidebar.`);
    }
    return config;
  }

  private getAppBuildingFlyCredentials(): {
    appName: string;
    token: string;
  } | null {
    const config = this.getAppBuildingSetupDraft();
    if (!config.flyAppName || !config.flyApiToken) {
      return null;
    }
    return {
      appName: config.flyAppName,
      token: config.flyApiToken,
    };
  }

  private async resolveAppBuildingWorkerTarget(
    job: AppBuildingJobRecord,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{
    job: AppBuildingJobRecord;
    routeId: string | null;
  }> {
    if (!options.forceRefresh && job.machineInstanceId) {
      return {
        job,
        routeId: job.machineInstanceId,
      };
    }

    if (!job.machineId) {
      throw new Error(`Job ${job.id} has no provisioned worker yet.`);
    }

    const credentials = this.getAppBuildingFlyCredentials();
    if (!credentials) {
      return {
        job,
        routeId: job.machineInstanceId ?? null,
      };
    }

    try {
      const machine = await getFlyMachine(
        job.flyApp || credentials.appName,
        credentials.token,
        job.machineId,
      );
      const instanceId = machine.instance_id?.trim();
      if (!instanceId) {
        return {
          job,
          routeId: null,
        };
      }

      if (instanceId === job.machineInstanceId) {
        return { job, routeId: instanceId };
      }

      const nextJob = {
        ...job,
        machineInstanceId: instanceId,
        updatedAt: Date.now(),
      };
      await this.projectDb.putAppBuildingJob(nextJob);
      return {
        job: nextJob,
        routeId: instanceId,
      };
    } catch {
      return {
        job,
        routeId: job.machineInstanceId ?? null,
      };
    }
  }

  private async callAppBuildingWorker<T>(
    job: AppBuildingJobRecord,
    fn: (
      resolved: { job: AppBuildingJobRecord; routeId: string | null },
    ) => Promise<T>,
  ): Promise<{ job: AppBuildingJobRecord; result: T }> {
    const firstResolved = await this.resolveAppBuildingWorkerTarget(job);
    try {
      const result = await fn(firstResolved);
      return { job: firstResolved.job, result };
    } catch (error) {
      if (!isStaleFlyInstanceError(error)) {
        throw error;
      }
      const refreshed = await this.resolveAppBuildingWorkerTarget(
        firstResolved.job,
        { forceRefresh: true },
      );
      if (
        refreshed.routeId
        && refreshed.routeId === firstResolved.routeId
      ) {
        throw error;
      }
      const result = await fn(refreshed);
      return { job: refreshed.job, result };
    }
  }

  private requireProvisionedAppBuildingJob(job: AppBuildingJobRecord): AppBuildingJobRecord {
    if (!job.machineId || !job.baseUrl) {
      throw new Error(
        job.error
          ? `Job ${job.id} never reached worker provisioning. ${job.error}`
          : `Job ${job.id} has no provisioned worker yet.`,
      );
    }
    return job;
  }

  private createAppBuildingJobRecord(
    projectId: string,
    appName: string,
    prompt: string,
    flyApp: string,
    imageRef: string | null,
    repositoryCloneUrl: string,
    repositoryBaseBranch: string,
  ): AppBuildingJobRecord {
    const id = crypto.randomUUID();
    const repository = this.buildAppBuildingTargetRepository(
      repositoryCloneUrl,
      repositoryBaseBranch,
      appName,
      id,
    );
    return {
      id,
      projectId,
      appName,
      prompt,
      promptSummary: summarizeAppBuildingPrompt(prompt),
      status: "starting",
      repositoryName: repository.repositoryName,
      repositoryFullName: repository.repositoryFullName,
      repositoryUrl: repository.repositoryUrl,
      repositoryCloneUrl: repository.repositoryCloneUrl,
      cloneBranch: repository.cloneBranch,
      pushBranch: repository.pushBranch,
      flyApp,
      baseUrl: flyApp ? `https://${flyApp}.fly.dev` : "",
      containerName: "",
      machineId: "",
      machineInstanceId: null,
      volumeId: null,
      imageRef,
      agentCommand: null,
      revision: null,
      queueLength: null,
      pendingTasks: null,
      totalCost: null,
      lastActivityAt: null,
      lastEventOffset: 0,
      lastLogOffset: 0,
      recentEvents: [],
      recentLogs: [],
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private buildAppBuildingTargetRepository(
    repositoryCloneUrl: string,
    repositoryBaseBranch: string,
    appName: string,
    jobId: string,
  ): Pick<
    AppBuildingJobRecord,
    | "repositoryName"
    | "repositoryFullName"
    | "repositoryUrl"
    | "repositoryCloneUrl"
    | "cloneBranch"
    | "pushBranch"
  > {
    const repository = summarizeAppBuildingRepository(repositoryCloneUrl);
    return {
      repositoryName: repository.name,
      repositoryFullName: repository.fullName,
      repositoryUrl: repository.htmlUrl,
      repositoryCloneUrl,
      cloneBranch: repositoryBaseBranch || "main",
      pushBranch: this.buildAppBuildingBranch(appName, jobId),
    };
  }

  private buildAppBuildingBranch(appName: string, jobId: string): string {
    const slug = this.toGitHubRepositoryName(appName).replace(/\./g, "-");
    return `codex/${slug}-${jobId.slice(0, 8)}`;
  }

  private buildAppBuildingMachineName(jobId: string): string {
    return `app-building-${jobId.slice(0, 8)}`;
  }

  private mapRemoteWorkerState(
    state: string,
  ): AppBuildingJobRecord["status"] {
    if (
      state === "starting"
      || state === "processing"
      || state === "idle"
      || state === "stopping"
      || state === "stopped"
    ) {
      return state;
    }
    return "error";
  }

  private mapFlyMachineState(
    state: string | undefined,
  ): AppBuildingJobRecord["status"] | null {
    switch (state) {
      case "created":
      case "starting":
      case "started":
        return "starting";
      case "stopping":
      case "suspending":
        return "stopping";
      case "stopped":
      case "suspended":
        return "stopped";
      case "replacing":
      case "destroying":
      case "destroyed":
        return "error";
      default:
        return null;
    }
  }

  private applyRemoteWorkerStatus(
    job: AppBuildingJobRecord,
    status: Awaited<ReturnType<typeof fetchAppBuildingStatus>>,
  ): AppBuildingJobRecord {
    return {
      ...job,
      status: this.mapRemoteWorkerState(status.state),
      containerName: status.containerName || job.containerName,
      revision: status.revision || null,
      queueLength: status.pendingTasks,
      pendingTasks: status.pendingTasks,
      totalCost: status.totalCost,
      lastActivityAt: status.lastActivityAt || null,
      updatedAt: Date.now(),
      error: null,
    };
  }

  private async refreshAppBuildingJobFromFly(
    job: AppBuildingJobRecord,
  ): Promise<AppBuildingJobRecord> {
    if (!job.machineId) {
      return job;
    }
    const credentials = this.getAppBuildingFlyCredentials();
    if (!credentials) {
      return job;
    }

    let flyState: string | undefined;
    try {
      const machine = await getFlyMachine(
        job.flyApp || credentials.appName,
        credentials.token,
        job.machineId,
      );
      flyState = machine.state;
    } catch {
      return job;
    }

    if (flyState === "started" && job.baseUrl) {
      try {
        const resolved = await this.resolveAppBuildingWorkerTarget(job);
        const status = await fetchAppBuildingStatus(resolved.job.baseUrl, resolved.routeId);
        return this.applyRemoteWorkerStatus(resolved.job, status);
      } catch {
        // Machine is up but worker HTTP isn't answering yet — still booting.
      }
    }

    const mapped = this.mapFlyMachineState(flyState);
    if (!mapped) {
      return job;
    }
    if (mapped === job.status && (mapped !== "error" ? !job.error : true)) {
      return job;
    }
    return {
      ...job,
      status: mapped,
      error: mapped === "error" ? job.error : null,
      updatedAt: Date.now(),
    };
  }

  private formatAppBuildingStatus(job: AppBuildingJobRecord): string {
    const lines = [
      `Job: ${job.id}`,
      `Status: ${job.status}`,
      `App: ${job.appName}`,
      `Repo: ${job.repositoryFullName || "(pending)"}`,
      `Repo URL: ${job.repositoryUrl || "(pending)"}`,
      `Branch: ${job.pushBranch || "(pending)"}`,
      `Fly app: ${job.flyApp || "(pending)"}`,
      `Machine: ${job.machineId || "(pending)"}`,
    ];

    if (job.revision) {
      lines.push(`Revision: ${job.revision}`);
    }
    if (job.pendingTasks !== null) {
      lines.push(`Pending tasks: ${job.pendingTasks}`);
    }
    if (job.totalCost !== null) {
      lines.push(`Total cost: ${job.totalCost}`);
    }
    if (job.lastActivityAt) {
      lines.push(`Last activity: ${job.lastActivityAt}`);
    }
    if (job.error) {
      lines.push(`Error: ${job.error}`);
    }

    return `${lines.join("\n")}\n`;
  }

  private async getAppBuildingJobOrThrow(jobId: string): Promise<AppBuildingJobRecord> {
    const job = await this.projectDb.getAppBuildingJob(jobId);
    if (!job) {
      throw new Error(`Unknown app-building job: ${jobId}`);
    }
    return job;
  }

  private async handleAppBuildingCreate(
    command: Extract<ReturnType<typeof parseAppBuildingCommand>, { verb: "create" }>,
    context: import("almostnode").ShellCommandContext,
  ): Promise<AppBuildingRunResult> {
    const projectId = this.requireActiveProjectId();
    const setup = this.requireAppBuildingSetup();
    const imageRef = setup.imageRef || DEFAULT_REMOTE_APP_BUILDING_IMAGE_REF || DEFAULT_APP_BUILDING_IMAGE_REF;
    let job = this.createAppBuildingJobRecord(
      projectId,
      command.name,
      command.prompt,
      setup.flyAppName,
      imageRef,
      setup.repositoryCloneUrl,
      setup.repositoryBaseBranch,
    );
    await this.projectDb.putAppBuildingJob(job);

    try {
      const machineName = this.buildAppBuildingMachineName(job.id);

      context.writeStdout("Logging in to Infisical...\n");
      const infisicalToken = await infisicalLogin(
        setup.infisicalClientId,
        setup.infisicalClientSecret,
      );

      context.writeStdout(`Launching Fly worker in ${setup.flyAppName}...\n`);
      const machine = await createAppBuildingMachine({
        appName: setup.flyAppName,
        token: setup.flyApiToken,
        imageRef,
        machineName,
        env: {
          PLAYWRIGHT_BROWSERS_PATH: "/opt/playwright",
          PORT: "3000",
          CONTAINER_NAME: machineName,
          DETACHED: "1",
          INITIAL_PROMPT: command.prompt,
          REPO_URL: job.repositoryCloneUrl,
          CLONE_BRANCH: job.cloneBranch,
          PUSH_BRANCH: job.pushBranch,
          GIT_AUTHOR_NAME: "App Builder",
          GIT_AUTHOR_EMAIL: "app-builder@localhost",
          GIT_COMMITTER_NAME: "App Builder",
          GIT_COMMITTER_EMAIL: "app-builder@localhost",
          FLY_API_TOKEN: setup.flyApiToken,
          FLY_APP_NAME: setup.flyAppName,
          INFISICAL_TOKEN: infisicalToken,
          INFISICAL_PROJECT_ID: setup.infisicalProjectId,
          INFISICAL_ENVIRONMENT: setup.infisicalEnvironment,
        },
      });

      job = {
        ...job,
        containerName: machineName,
        machineId: machine.machineId,
        machineInstanceId: machine.instanceId,
        volumeId: machine.volumeId,
        imageRef,
        updatedAt: Date.now(),
      };
      await this.projectDb.putAppBuildingJob(job);

      await waitForFlyMachineStarted(
        setup.flyAppName,
        setup.flyApiToken,
        machine.machineId,
      );
      const resolvedTarget = await this.resolveAppBuildingWorkerTarget(job);
      job = resolvedTarget.job;
      const status = await waitForWorkerReady(job.baseUrl, resolvedTarget.routeId);

      job = this.applyRemoteWorkerStatus(job, status);
      await this.projectDb.putAppBuildingJob(job);

      return {
        stdout: [
          `Created app-building job ${job.id}`,
          `Repo: ${job.repositoryFullName || job.repositoryCloneUrl}`,
          `Repo URL: ${job.repositoryUrl || job.repositoryCloneUrl}`,
          `Branch: ${job.pushBranch}`,
          `Machine: ${job.machineId}`,
          `Base URL: ${job.baseUrl}`,
          "",
          `Use \`app-building status ${job.id}\`, \`app-building logs ${job.id}\`, or \`app-building message ${job.id} --prompt "..."\`.`,
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
        jobId: job.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = job.machineId
        ? await this.refreshAppBuildingJobFromFly({ ...job, error: message })
        : null;
      job = fallback && fallback.status !== "error"
        ? { ...fallback, error: message, updatedAt: Date.now() }
        : {
          ...job,
          status: "error",
          error: message,
          updatedAt: Date.now(),
        };
      await this.projectDb.putAppBuildingJob(job);
      return {
        stdout: "",
        stderr: `${message}\n`,
        exitCode: 1,
        jobId: job.id,
      };
    }
  }

  private async handleAppBuildingStatus(jobId: string): Promise<AppBuildingRunResult> {
    let job = await this.getAppBuildingJobOrThrow(jobId);
    if (!job.machineId || !job.baseUrl) {
      return {
        stdout: this.formatAppBuildingStatus(job),
        stderr: job.error ? `${job.error}\n` : "",
        exitCode: job.error ? 1 : 0,
        jobId: job.id,
      };
    }
    try {
      const {
        job: resolvedJob,
        result: [status, events],
      } = await this.callAppBuildingWorker(job, ({ job: j, routeId }) =>
        Promise.all([
          fetchAppBuildingStatus(j.baseUrl, routeId),
          fetchAppBuildingEvents(j.baseUrl, routeId, j.lastEventOffset),
        ]),
      );
      job = this.applyRemoteWorkerStatus(resolvedJob, status);
      job.lastEventOffset = events.nextOffset;
      job.recentEvents = events.items.slice(-12);
      await this.projectDb.putAppBuildingJob(job);

      if (
        status.previewPort
        && job.baseUrl
        && !this.appBuildingPreviewOpenedJobs.has(job.id)
      ) {
        this.appBuildingPreviewOpenedJobs.add(job.id);
        void this.openAppBuildingPreview(`${job.baseUrl.replace(/\/+$/, "")}/preview/`);
      }

      const eventText = events.items.length > 0
        ? `\nRecent events:\n${events.items.join("\n")}\n`
        : "";
      return {
        stdout: `${this.formatAppBuildingStatus(job)}${eventText}`,
        stderr: "",
        exitCode: 0,
        jobId: job.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = job.machineId
        ? await this.refreshAppBuildingJobFromFly({ ...job, error: message })
        : null;
      job = fallback && fallback.status !== "error"
        ? { ...fallback, error: message, updatedAt: Date.now() }
        : {
          ...job,
          status: "error",
          error: message,
          updatedAt: Date.now(),
        };
      await this.projectDb.putAppBuildingJob(job);
      return {
        stdout: this.formatAppBuildingStatus(job),
        stderr: `${message}\n`,
        exitCode: 1,
        jobId: job.id,
      };
    }
  }

  private async handleAppBuildingLogs(
    jobId: string,
    _offset?: number,
  ): Promise<AppBuildingRunResult> {
    const job = await this.getAppBuildingJobOrThrow(jobId);
    const { job: nextJob, newFormatted } = await this.fetchAppBuildingLogDelta(job);
    return {
      stdout: newFormatted.length > 0
        ? `${newFormatted.join("\n")}\n`
        : (nextJob.recentLogs?.length ? "" : "No logs yet.\n"),
      stderr: "",
      exitCode: 0,
      jobId: nextJob.id,
    };
  }

  /**
   * Fetch the next page of Fly logs for a job using its cursor (or a
   * start_time anchor on first call), dedup against the ring buffer,
   * persist the advanced cursor + updated ring buffer, and return the delta.
   */
  private async fetchAppBuildingLogDelta(
    jobInput: AppBuildingJobRecord,
  ): Promise<{ job: AppBuildingJobRecord; newFormatted: string[] }> {
    if (!jobInput.machineId) {
      throw new Error(`Job ${jobInput.id} has no provisioned worker yet.`);
    }
    const credentials = this.getAppBuildingFlyCredentials();
    if (!credentials) {
      throw new Error("Fly credentials are not configured.");
    }

    const appName = jobInput.flyApp || credentials.appName;
    const cursor = jobInput.lastLogCursor || null;
    const startTime = cursor
      ? null
      : new Date(Math.max(jobInput.createdAt - 5 * 60_000, 0)).toISOString();

    const page = await fetchFlyLogsSince(appName, credentials.token, {
      machineId: jobInput.machineId,
      cursor,
      startTime,
    });

    this.autoCreateCardsFromLogs(jobInput.projectId, jobInput.id, page.entries);

    const { newFormatted, mergedBuffer, latestTimestamp } = mergeFlyLogDelta(
      jobInput.recentLogs ?? [],
      page.entries,
      { lastTimestamp: jobInput.lastLogTimestamp ?? null },
    );

    const nextCursor = page.nextToken || cursor || null;
    const nextJob: AppBuildingJobRecord = {
      ...jobInput,
      lastLogCursor: nextCursor,
      lastLogTimestamp: latestTimestamp,
      recentLogs: mergedBuffer,
      updatedAt: Date.now(),
    };
    await this.projectDb.putAppBuildingJob(nextJob);
    return { job: nextJob, newFormatted };
  }

  /**
   * Reset the log cursor + ring buffer so the next fetch backfills from a
   * fresh start_time anchor. Used by the UI's "Refresh" action.
   */
  async resetAppBuildingLogCursor(jobId: string): Promise<AppBuildingJobRecord> {
    const job = await this.getAppBuildingJobOrThrow(jobId);
    const reset = {
      ...job,
      lastLogCursor: null,
      lastLogTimestamp: null,
      recentLogs: [],
      updatedAt: Date.now(),
    };
    await this.projectDb.putAppBuildingJob(reset);
    return reset;
  }

  /**
   * Scan an incoming batch of Fly log entries for `add-task.ts` invocations
   * and append any newly queued subtasks to the shared kanban-cards store so
   * they appear on the board automatically. Idempotent — the same log entry
   * never produces the same card twice thanks to content-addressed IDs.
   */
  private autoCreateCardsFromLogs(
    projectId: string,
    jobId: string,
    entries: readonly { message?: string; timestamp?: string }[],
  ): void {
    if (typeof window === "undefined" || !window.localStorage) return;

    const STORAGE_KEY = "almostnode.app-building.task-cards.v1";
    let existing: unknown[];
    try {
      existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }

    const existingIds = new Set(
      existing
        .map((card) => (card && typeof card === "object" ? (card as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === "string"),
    );

    const newCards: Record<string, unknown>[] = [];
    const now = Date.now();

    for (const entry of entries) {
      const subtasks = parseAddTaskLogMessage(entry.message ?? "");
      if (!subtasks) continue;
      for (let idx = 0; idx < subtasks.length; idx += 1) {
        const subtask = subtasks[idx];
        const hash = hashString(`${jobId}|${subtask.skill}|${subtask.raw}`);
        const id = `auto:${jobId}:${hash}`;
        if (existingIds.has(id)) continue;
        existingIds.add(id);

        const createdAt = entry.timestamp
          ? Date.parse(entry.timestamp) || now
          : now;
        newCards.push({
          id,
          projectId,
          jobId,
          kind: "follow-up",
          title: subtask.name,
          prompt: subtask.description || subtask.raw,
          promptSummary: subtask.description || subtask.raw,
          status: "todo",
          createdAt,
          updatedAt: now,
        });
      }
    }

    if (newCards.length === 0) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...existing, ...newCards]),
      );
    } catch {
      // Storage write failed (quota, privacy mode) — drop silently; the poller
      // will try again on the next batch.
    }
  }

  /**
   * Subscribe to the running log stream for a job. Polls Fly's logs API using
   * the persisted cursor, emits any new entries, and backs off on empty
   * responses or errors. Pauses while `document.hidden` is true.
   *
   * Returns an unsubscribe function. Also honors `options.signal` if provided.
   * Multiple subscribers for the same job share a single poller (refcounted).
   */
  subscribeAppBuildingLogs(
    jobId: string,
    options: {
      onEntries?: (entries: string[], job: AppBuildingJobRecord) => void;
      onError?: (error: unknown) => void;
      onStatus?: (status: "active" | "paused" | "reconnecting") => void;
      signal?: AbortSignal;
      minIntervalMs?: number;
      maxIntervalMs?: number;
    } = {},
  ): () => void {
    const existing = this.appBuildingLogSubscriptions.get(jobId);
    if (existing) {
      existing.refs += 1;
      const handlers = {
        onEntries: options.onEntries,
        onError: options.onError,
        onStatus: options.onStatus,
      };
      existing.handlerSet.add(handlers);
      const unsubscribe = () => {
        existing.handlerSet.delete(handlers);
        existing.refs -= 1;
        if (existing.refs <= 0) existing.stop();
      };
      options.signal?.addEventListener("abort", unsubscribe, { once: true });
      return unsubscribe;
    }

    const minInterval = Math.max(options.minIntervalMs ?? 1_500, 250);
    const maxInterval = Math.max(options.maxIntervalMs ?? 10_000, minInterval);
    const handlers = {
      onEntries: options.onEntries,
      onError: options.onError,
      onStatus: options.onStatus,
    };
    const handlerSet = new Set<{
      onEntries?: (entries: string[], job: AppBuildingJobRecord) => void;
      onError?: (error: unknown) => void;
      onStatus?: (status: "active" | "paused" | "reconnecting") => void;
    }>();
    handlerSet.add(handlers);

    const controller = new AbortController();
    let wakeup: (() => void) | null = null;
    let stopped = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const emitEntries = (entries: string[], record: AppBuildingJobRecord) => {
      for (const h of handlerSet) h.onEntries?.(entries, record);
    };
    const emitError = (err: unknown) => {
      for (const h of handlerSet) h.onError?.(err);
    };
    const emitStatus = (s: "active" | "paused" | "reconnecting") => {
      for (const h of handlerSet) h.onStatus?.(s);
    };

    const wake = () => {
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
      if (wakeup) {
        wakeup();
        wakeup = null;
      }
    };

    const waitFor = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        if (stopped) return resolve();
        pendingTimeout = setTimeout(() => {
          pendingTimeout = null;
          resolve();
        }, ms);
        wakeup = resolve;
      });

    const waitUntilVisible = async () => {
      if (typeof document === "undefined" || !document.hidden) return;
      emitStatus("paused");
      await new Promise<void>((resolve) => {
        const handler = () => {
          if (!document.hidden) {
            document.removeEventListener("visibilitychange", handler);
            resolve();
          }
        };
        document.addEventListener("visibilitychange", handler);
        controller.signal.addEventListener(
          "abort",
          () => {
            document.removeEventListener("visibilitychange", handler);
            resolve();
          },
          { once: true },
        );
      });
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      wake();
      this.appBuildingLogSubscriptions.delete(jobId);
    };

    const entry = {
      refs: 1,
      stop,
      handlerSet,
    };
    this.appBuildingLogSubscriptions.set(jobId, entry);

    const run = async () => {
      let interval = minInterval;
      let errorStreak = 0;
      while (!stopped && !controller.signal.aborted) {
        await waitUntilVisible();
        if (stopped) break;
        emitStatus(errorStreak > 0 ? "reconnecting" : "active");

        let job: AppBuildingJobRecord;
        try {
          job = await this.getAppBuildingJobOrThrow(jobId);
        } catch (error) {
          emitError(error);
          stop();
          break;
        }

        try {
          const { job: nextJob, newFormatted } = await this.fetchAppBuildingLogDelta(
            job,
          );
          errorStreak = 0;
          if (newFormatted.length > 0) {
            emitEntries(newFormatted, nextJob);
            interval = minInterval;
          } else {
            interval = Math.min(interval * 2, maxInterval);
          }
        } catch (error) {
          errorStreak += 1;
          emitError(error);
          interval = Math.min(interval * 2, maxInterval);
        }

        await waitFor(interval);
      }
    };

    void run();

    const unsubscribe = () => {
      handlerSet.delete(handlers);
      entry.refs -= 1;
      if (entry.refs <= 0) stop();
    };
    options.signal?.addEventListener("abort", unsubscribe, { once: true });
    return unsubscribe;
  }

  private appBuildingLogSubscriptions = new Map<
    string,
    {
      refs: number;
      stop: () => void;
      handlerSet: Set<{
        onEntries?: (entries: string[], job: AppBuildingJobRecord) => void;
        onError?: (error: unknown) => void;
        onStatus?: (status: "active" | "paused" | "reconnecting") => void;
      }>;
    }
  >();

  private async handleAppBuildingMessage(
    jobId: string,
    prompt: string,
  ): Promise<AppBuildingRunResult> {
    let job = this.requireProvisionedAppBuildingJob(
      await this.getAppBuildingJobOrThrow(jobId),
    );
    const resolvedTarget = await this.resolveAppBuildingWorkerTarget(job);
    job = resolvedTarget.job;
    await postAppBuildingMessage(job.baseUrl, resolvedTarget.routeId, prompt);

    try {
      const status = await fetchAppBuildingStatus(job.baseUrl, resolvedTarget.routeId);
      job = this.applyRemoteWorkerStatus(job, status);
    } catch {
      job = {
        ...job,
        status: "processing",
        updatedAt: Date.now(),
      };
    }

    await this.projectDb.putAppBuildingJob(job);
    return {
      stdout: `Queued message for ${job.id}: ${summarizeAppBuildingPrompt(prompt, 100)}\n`,
      stderr: "",
      exitCode: 0,
      jobId: job.id,
    };
  }

  private async handleAppBuildingStop(jobId: string): Promise<AppBuildingRunResult> {
    const setup = this.requireAppBuildingSetup();
    let job = this.requireProvisionedAppBuildingJob(
      await this.getAppBuildingJobOrThrow(jobId),
    );

    job = {
      ...job,
      status: "stopping",
      updatedAt: Date.now(),
    };
    await this.projectDb.putAppBuildingJob(job);

    try {
      const resolvedTarget = await this.resolveAppBuildingWorkerTarget(job);
      job = resolvedTarget.job;
      await postAppBuildingStop(job.baseUrl, resolvedTarget.routeId).catch(() => undefined);
      await destroyFlyMachine(
        job.flyApp,
        setup.flyApiToken,
        job.machineId,
        job.volumeId,
      );

      job = {
        ...job,
        status: "stopped",
        stoppedAt: Date.now(),
        updatedAt: Date.now(),
        error: null,
      };
      await this.projectDb.putAppBuildingJob(job);
      return {
        stdout: `Stopped app-building job ${job.id}.\n`,
        stderr: "",
        exitCode: 0,
        jobId: job.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job = {
        ...job,
        status: "error",
        error: message,
        updatedAt: Date.now(),
      };
      await this.projectDb.putAppBuildingJob(job);
      return {
        stdout: "",
        stderr: `${message}\n`,
        exitCode: 1,
        jobId: job.id,
      };
    }
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

  private async openWorkspaceLocation(
    sourcePath: string,
    lineNumber?: number | null,
    columnNumber?: number | null,
  ): Promise<boolean> {
    const normalizedPath = this.normalizePreviewSourcePath(sourcePath);
    if (!normalizedPath) {
      this.updatePreviewStatus("Could not resolve source for that element.");
      return false;
    }

    if (!this.container.vfs.existsSync(normalizedPath)) {
      this.updatePreviewStatus(
        `Resolved source is missing: ${normalizedPath}`,
      );
      return false;
    }

    await this.openWorkspaceFileAsText(
      normalizedPath,
      lineNumber,
      columnNumber,
    );
    return true;
  }

  private async openWorkspaceTargetInEditor(
    target: WebIdeOpenTarget,
  ): Promise<void> {
    if (typeof target.line === "number") {
      await this.openWorkspaceFileAsText(
        target.path,
        target.line,
        target.column ?? 1,
      );
      return;
    }

    await this.openWorkspaceFile(target.path);
  }

  private async resolveWorkspaceJsxSelectionRange(
    path: string,
    model: monaco.editor.ITextModel,
    lineNumber: number,
    columnNumber: number,
  ): Promise<EditorSelectionRange | null> {
    const normalizedPath = path.trim().toLowerCase();
    const isTsxFile = normalizedPath.endsWith(".tsx");
    const isJsxLikeFile =
      normalizedPath.endsWith(".jsx") ||
      normalizedPath.endsWith(".js") ||
      normalizedPath.endsWith(".mjs") ||
      normalizedPath.endsWith(".cjs");
    if (!isTsxFile && !isJsxLikeFile) {
      return null;
    }

    const typescript = await import("typescript");
    const scriptKind = isTsxFile
      ? typescript.ScriptKind.TSX
      : typescript.ScriptKind.JSX;
    const sourceFile = typescript.createSourceFile(
      path,
      model.getValue(),
      typescript.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const offset = model.getOffsetAt({
      lineNumber,
      column: columnNumber,
    });

    let bestRange:
      | {
          start: number;
          end: number;
        }
      | null = null;

    const visit = (node: import("typescript").Node): void => {
      const start = node.getStart(sourceFile, false);
      const end = node.getEnd();
      if (offset < start || offset > end) {
        return;
      }

      if (
        typescript.isJsxElement(node) ||
        typescript.isJsxSelfClosingElement(node) ||
        typescript.isJsxFragment(node)
      ) {
        if (!bestRange || end - start < bestRange.end - bestRange.start) {
          bestRange = { start, end };
        }
      }

      typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    if (!bestRange) {
      return null;
    }

    const startPosition = model.getPositionAt(bestRange.start);
    const endPosition = model.getPositionAt(bestRange.end);
    return {
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    };
  }

  private async openWorkspaceFileAsText(
    path: string,
    lineNumber?: number | null,
    columnNumber?: number | null,
  ): Promise<void> {
    const editorService = await getService(IEditorService);
    const languageId = inferWorkbenchLanguageId(path);
    const normalizedLineNumber =
      typeof lineNumber === "number" &&
      Number.isFinite(lineNumber) &&
      lineNumber > 0
        ? Math.trunc(lineNumber)
        : null;
    const normalizedColumnNumber =
      typeof columnNumber === "number" &&
      Number.isFinite(columnNumber) &&
      columnNumber > 0
        ? Math.trunc(columnNumber)
        : 1;
    let selection: EditorSelectionRange | null = normalizedLineNumber
      ? {
          startLineNumber: normalizedLineNumber,
          startColumn: normalizedColumnNumber,
          endLineNumber: normalizedLineNumber,
          endColumn: normalizedColumnNumber,
        }
      : null;
    const openOptions = {
      pinned: true,
      ...(selection ? { selection } : {}),
    };
    let codeEditor:
      | {
          getModifiedEditor?: () => unknown;
          getModel?: () => { uri?: { path?: string } } | null;
          setSelection?: (
            nextSelection: EditorSelectionRange,
            source?: string,
          ) => void;
          revealPositionNearTop?: (position: {
            lineNumber: number;
            column: number;
          }) => void;
          revealRangeNearTop?: (range: EditorSelectionRange) => void;
        }
      | undefined;

    try {
      await editorService.openEditor({
        resource: URI.file(path),
        options: openOptions,
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
        options: openOptions,
      });
    }

    if (selection) {
      const activeControl = editorService.activeTextEditorControl as
        | {
            getModifiedEditor?: () => unknown;
            getModel?: () => { uri?: { path?: string } } | null;
            setSelection?: (
              nextSelection: EditorSelectionRange,
              source?: string,
            ) => void;
            revealPositionNearTop?: (position: {
              lineNumber: number;
              column: number;
            }) => void;
            revealRangeNearTop?: (range: EditorSelectionRange) => void;
          }
        | undefined;
      codeEditor =
        activeControl &&
        typeof activeControl.getModifiedEditor === "function" &&
        activeControl.getModifiedEditor()
          ? (activeControl.getModifiedEditor() as typeof activeControl)
          : activeControl;
      const activeModelPath = codeEditor?.getModel?.()?.uri?.path;

      if (
        codeEditor &&
        typeof codeEditor.setSelection === "function" &&
        (!activeModelPath || activeModelPath === path)
      ) {
        codeEditor.setSelection(selection, "almostnode.preview-source-picker");
        if (typeof codeEditor.revealPositionNearTop === "function") {
          codeEditor.revealPositionNearTop({
            lineNumber: selection.startLineNumber,
            column: selection.startColumn,
          });
        } else if (typeof codeEditor.revealRangeNearTop === "function") {
          codeEditor.revealRangeNearTop(selection);
        }
      }
    }

    if (!languageId) {
      return;
    }

    const modelReference = await monaco.editor.createModelReference(
      URI.file(path),
    );
    try {
      const model = monaco.editor.getModel(URI.file(path));
      if (!model) {
        return;
      }

      if (selection) {
        const jsxSelection = await this.resolveWorkspaceJsxSelectionRange(
          path,
          model,
          selection.startLineNumber,
          selection.startColumn,
        ).catch(() => null);
        if (
          jsxSelection &&
          (
            jsxSelection.startLineNumber !== selection.startLineNumber ||
            jsxSelection.startColumn !== selection.startColumn ||
            jsxSelection.endLineNumber !== selection.endLineNumber ||
            jsxSelection.endColumn !== selection.endColumn
          )
        ) {
          selection = jsxSelection;
          const activeModelPath = codeEditor?.getModel?.()?.uri?.path;
          if (
            codeEditor &&
            typeof codeEditor.setSelection === "function" &&
            (!activeModelPath || activeModelPath === path)
          ) {
            codeEditor.setSelection(
              selection,
              "almostnode.preview-source-picker.jsx",
            );
            if (typeof codeEditor.revealRangeNearTop === "function") {
              codeEditor.revealRangeNearTop(selection);
            } else if (
              typeof codeEditor.revealPositionNearTop === "function"
            ) {
              codeEditor.revealPositionNearTop({
                lineNumber: selection.startLineNumber,
                column: selection.startColumn,
              });
            }
          }
        }
      }

      if (model.getLanguageId() !== languageId) {
        monaco.editor.setModelLanguage(model, languageId);
      }
    } finally {
      modelReference.dispose();
    }
  }

  private installClaudeImagePasteGuard(tab: TerminalTabState): void {
    this.disposeClaudeImagePasteGuard(tab.id);

    if (this.agentMode !== "browser" || tab.agentHarness !== "claude") {
      return;
    }

    const terminalRoot = tab.terminal.element;
    if (!terminalRoot) {
      return;
    }

    const onPaste = (event: ClipboardEvent) => {
      const mimeTypes = collectClipboardImageMimeTypes(event.clipboardData);
      if (mimeTypes.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      console.warn("[claude-image-paste]", {
        tabId: tab.id,
        mimeTypes,
        blocker: describeClaudeImagePasteBlocker(mimeTypes),
      });
      void this.showClaudeImagePasteUnsupportedError(mimeTypes);
    };

    terminalRoot.addEventListener("paste", onPaste, { capture: true });
    this.claudeImagePasteCleanup.set(tab.id, () => {
      terminalRoot.removeEventListener("paste", onPaste, { capture: true });
    });
  }

  private disposeClaudeImagePasteGuard(id: string): void {
    const cleanup = this.claudeImagePasteCleanup.get(id);
    cleanup?.();
    this.claudeImagePasteCleanup.delete(id);
  }

  private async showClaudeImagePasteUnsupportedError(
    mimeTypes: readonly string[],
  ): Promise<void> {
    const { initToasts, showClaudeImagePasteUnsupportedToast } = await import(
      "../features/toast"
    );
    const workbenchEl = this.options.elements.workbench;
    initToasts(workbenchEl.parentElement ?? workbenchEl);
    showClaudeImagePasteUnsupportedToast(mimeTypes);
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

  private resetAppBuildingPreview(message: string): void {
    this.appBuildingPreviewOpenedJobs.clear();
    this.currentAppBuildingPreviewUrl = null;
    this.appBuildingPreviewSurface.clear(message);
  }

  async openAppBuildingPreview(url: string): Promise<void> {
    if (!url) return;
    if (this.currentAppBuildingPreviewUrl !== url) {
      this.currentAppBuildingPreviewUrl = url;
      this.appBuildingPreviewSurface.setUrl(url);
    }

    const editorService = await getService(IEditorService);
    const previewInput = this.workbenchSurfaces.appBuildingPreviewInput;
    const existing = previewInput.resource
      ? editorService
          .findEditors(previewInput.resource)
          .find((identifier) => identifier.editor.typeId === previewInput.typeId)
      : undefined;

    if (existing?.groupId !== undefined) {
      await editorService.openEditor(
        previewInput,
        { pinned: true },
        existing.groupId,
      );
      return;
    }

    await editorService.openEditor(previewInput, { pinned: true });
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
    const layoutService = await getService(IWorkbenchLayoutService);
    setPartVisibility(Parts.PANEL_PART, true);

    // Restore panel height if collapsed (setPartVisibility(false) can shrink it)
    const panelSize = layoutService.getSize(Parts.PANEL_PART);
    if (panelSize.height < 48) {
      const defaultPanelHeight = Math.max(
        220,
        Math.min(Math.round(window.innerHeight * 0.26), 320),
      );
      layoutService.setSize(Parts.PANEL_PART, {
        width: panelSize.width,
        height: defaultPanelHeight,
      });
    }

    await paneCompositeService.openPaneComposite(
      this.workbenchSurfaces.terminalViewId,
      ViewContainerLocation.Panel,
      focus,
    );
    window.dispatchEvent(new Event("resize"));
    if (focus) {
      this.terminalSurface.focus();
    }
  }

  async ensurePreviewServerReady(timeoutMs = 15000): Promise<string> {
    const start = Date.now();

    if (!this.previewUrl) {
      this.ensurePreviewServerRunning();

      while (!this.previewUrl && Date.now() - start < timeoutMs) {
        await delay(100);
      }
    }

    if (this.previewUrl) {
      await this.waitForPreviewResponse(this.previewUrl, timeoutMs - (Date.now() - start));
      return this.previewUrl;
    }

    throw new Error("Preview server did not become ready in time.");
  }

  private async waitForPreviewResponse(
    previewUrl: string,
    timeoutMs: number,
  ): Promise<void> {
    if (timeoutMs <= 0) {
      throw new Error("Preview server did not become ready in time.");
    }

    const deadline = Date.now() + timeoutMs;
    let lastFailure: string | null = null;

    while (Date.now() < deadline) {
      const probeUrl = new URL(previewUrl, window.location.href);
      probeUrl.searchParams.set("__almostnode_preview_probe", String(Date.now()));

      try {
        const response = await fetch(probeUrl.toString(), {
          cache: "no-store",
          redirect: "follow",
        });

        if (response.ok) {
          return;
        }

        lastFailure = `Preview responded with ${response.status}.`;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      await delay(250);
    }

    throw new Error(
      lastFailure
        ? `Preview server did not become ready in time. ${lastFailure}`
        : "Preview server did not become ready in time.",
    );
  }

  async openPreview(): Promise<void> {
    await this.revealPreviewEditor();
    await this.ensurePreviewServerReady();
    this.previewSurface.focus();
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

  async togglePreviewSourcePicker(): Promise<void> {
    if (this.previewSourcePickerActive) {
      this.setPreviewSourcePickerActive(false);
      this.deactivatePreviewSourcePickerDirect();
      return;
    }

    if (!this.previewUrl) {
      this.updatePreviewStatus("Preview source picker needs a running preview.");
      return;
    }

    this.setPreviewSourcePickerActive(true);
    if (await this.activatePreviewSourcePickerDirect()) {
      return;
    }

    if (!this.postPreviewSourcePickerMessage("activate-open")) {
      this.updatePreviewStatus(
        "Select mode will start once the preview finishes loading.",
      );
    }
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

    installOxcMonacoIntegration(this.container);

    await this.registerStatusbarEntries();

    const editorService = await getService(IEditorService);

    // Open preview as the only editor (no default source file)
    await editorService.openEditor(this.workbenchSurfaces.previewInput, {
      pinned: true,
      preserveFocus: true,
    });

    // Keep terminal collapsed by default
    const layoutService = await getService(IWorkbenchLayoutService);
    const defaultPanelHeight = Math.max(
      220,
      Math.min(Math.round(window.innerHeight * 0.26), 320),
    );
    const panelSize = layoutService.getSize(Parts.PANEL_PART);
    if (panelSize.height < 48) {
      layoutService.setSize(Parts.PANEL_PART, {
        width: panelSize.width,
        height: defaultPanelHeight,
      });
    }
    setPartVisibility(Parts.PANEL_PART, false);

    // Set sidebar to 600px initial width
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
      this.workbenchSurfaces.setActivation(
        this.workbenchSurfaces.databaseViewId,
        false,
      );
      this.previewSurface.setActiveDb(null);
      this.databaseSurface.update([], null);
      return;
    }

    try {
      this.workbenchSurfaces.setActivation(
        this.workbenchSurfaces.databaseViewId,
        true,
      );

      const activeName = ensureDefaultDatabase(
        namespace,
        this.currentProjectDefaultDatabaseName,
      );

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
              const newActive = ensureDefaultDatabase(
                callbackNamespace,
                this.currentProjectDefaultDatabaseName,
              );
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
    return this.runRequiredCommand(command, WORKSPACE_ROOT);
  }

  private async runRequiredCommand(command: string, cwd: string): Promise<RunResult> {
    const result = await this.container.run(command, { cwd });
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

  private getGitHubAuthToken(): string {
    const auth = readGhToken(this.container.vfs);
    if (!auth?.oauth_token) {
      throw new Error("GitHub credentials are not available. Run `gh auth login` first.");
    }
    return auth.oauth_token;
  }

  private getGitHubApiErrorMessage(payload: unknown, fallback: string): string {
    if (
      payload
      && typeof payload === "object"
      && "message" in payload
      && typeof payload.message === "string"
      && payload.message.trim().length > 0
    ) {
      return payload.message;
    }
    return fallback;
  }

  private toGitHubRepositorySummary(payload: unknown): GitHubRepositorySummary | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const repository = payload as Record<string, unknown>;
    const owner = (
      repository.owner
      && typeof repository.owner === "object"
    )
      ? repository.owner as Record<string, unknown>
      : null;
    const fullName = typeof repository.full_name === "string" ? repository.full_name : null;
    const fallbackOwnerLogin = fullName?.split("/")[0] ?? null;
    const fallbackName = fullName?.split("/")[1] ?? null;
    const id = typeof repository.id === "number"
      ? repository.id
      : fullName
        ? Array.from(fullName).reduce(
          (hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0,
          7,
        )
        : null;
    const name = typeof repository.name === "string"
      ? repository.name
      : fallbackName;
    const cloneUrl = typeof repository.clone_url === "string" ? repository.clone_url : null;
    const htmlUrl = typeof repository.html_url === "string" ? repository.html_url : null;
    const ownerLogin = typeof owner?.login === "string"
      ? owner.login
      : fallbackOwnerLogin;

    if (
      id === null
      || !name
      || !fullName
      || !cloneUrl
      || !htmlUrl
      || !ownerLogin
    ) {
      return null;
    }

    return {
      id,
      name,
      fullName,
      description: typeof repository.description === "string"
        ? repository.description
        : null,
      private: Boolean(repository.private),
      updatedAt: typeof repository.updated_at === "string"
        ? repository.updated_at
        : new Date(0).toISOString(),
      defaultBranch: typeof repository.default_branch === "string"
        ? repository.default_branch
        : "main",
      cloneUrl,
      htmlUrl,
      ownerLogin,
    };
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
    this.removeDesktopOAuthLoopbackBridge?.();
    this.removeDesktopOAuthLoopbackBridge = this.desktopBridge
      ? installDesktopOAuthLoopbackBridge(this.desktopBridge)
      : null;

    // Listen for console messages from the preview iframe
    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "almostnode-console") return;
      const { level, args, timestamp } = event.data;
      if (!level || !Array.isArray(args)) return;
      this.addConsoleEntry(level, args, timestamp || Date.now());
    });

    this.previewSurface.getIframe().addEventListener("load", () => {
      this.previewSourcePickerRuntime = null;
      if (this.previewSourcePickerActive) {
        void this.activatePreviewSourcePickerDirect().catch(() => {
          this.postPreviewSourcePickerMessage("activate-open");
        });
      }
    });

    window.addEventListener("keydown", (event) => {
      if (!this.previewSourcePickerActive || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.setPreviewSourcePickerActive(false);
      this.deactivatePreviewSourcePickerDirect();
    });

    window.addEventListener("message", (event) => {
      if (!this.isPreviewMessageSource(event.source)) {
        return;
      }

      const payload = event.data as PreviewSourcePickerMessage | undefined;
      if (
        !payload ||
        payload.type !== "almostnode-preview-source-picker" ||
        typeof payload.status !== "string"
      ) {
        return;
      }

      if (payload.status === "armed") {
        return;
      }

      this.setPreviewSourcePickerActive(false);

      if (
        payload.status === "selected" &&
        typeof payload.filePath === "string"
      ) {
        void this.openWorkspaceLocation(
          payload.filePath,
          payload.lineNumber,
          payload.columnNumber,
        );
        return;
      }

      if (payload.status === "error") {
        this.updatePreviewStatus(
          payload.reason
            ? `Could not resolve source: ${payload.reason}`
            : "Could not resolve source for that element.",
        );
      }
    });

    window.addEventListener("message", (event) => {
      if (!this.isPreviewMessageSource(event.source)) {
        return;
      }

      const payload = event.data as PreviewAppBuildingBridgeRequest | undefined;
      if (
        !payload
        || payload.type !== "almostnode-app-building-request"
        || typeof payload.requestId !== "string"
      ) {
        return;
      }

      void this.handlePreviewAppBuildingBridgeRequest(event.source as Window, payload);
    });

    this.container.on("server-ready", (_port: unknown, url: unknown) => {
      if (typeof _port !== "number" || typeof url !== "string") {
        return;
      }
      this.previewPort = _port;
      this.previewUrl = `${url}/`;
      this.previewStartRequested = false;
      this.clearScheduledPreviewStartRetry();
      if (this.previewMode === "workbench") {
        this.previewSurface.setUrl(this.previewUrl);

        const iframe = this.previewSurface.getIframe();
        iframe.addEventListener("load", () => {
          this.registerPreviewHmrTargets();
        }, { once: true });
      }
      this.registerPreviewHmrTargets();

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
      this.previewSourcePickerRuntime = null;
      this.setPreviewSourcePickerActive(false);
      this.clearScheduledPreviewStartRetry();
      if (this.previewMode === "workbench") {
        this.previewSurface.clear(
          "Preview server stopped. Run the workspace to start it again.",
        );
      }
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

    if (this.agentMode === "browser") {
      try {
        this.claudeIdeBridge = await ClaudeIdeBridge.create({
          container: this.container,
        });
      } catch (error) {
        console.error("[claude-ide] failed to initialize IDE bridge", error);
      }
    }

    // ── PGlite database initialization (after workbench is ready) ──
    void this.initPGliteIfNeeded();

    // ── Test recorder initialization (after workbench is ready) ──
    void this.initTestRecorder();

    if (!this.deferPreviewStart) {
      this.ensurePreviewServerRunning();
    }
    window.__almostnodeWebIDE = this;

    logMemory("before opencode boot");
    if (!this.pendingProjectLaunch && this.shouldAutoLaunchOpenCode()) {
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

  private inferWorkspaceTemplateId(): TemplateId {
    const packageJsonPath = `${WORKSPACE_ROOT}/package.json`;
    const rawPackageJson = this.readWorkspaceFileText(packageJsonPath);

    if (rawPackageJson) {
      try {
        const parsed = JSON.parse(rawPackageJson) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
        };
        const dependencyNames = new Set<string>([
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
        ]);

        if (dependencyNames.has("next")) {
          return "nextjs";
        }
        if (
          dependencyNames.has("@tanstack/start")
          || dependencyNames.has("@tanstack/react-start")
        ) {
          return "tanstack";
        }
      } catch {
        // Fall back to file heuristics below.
      }
    }

    for (const path of [
      `${WORKSPACE_ROOT}/next.config.js`,
      `${WORKSPACE_ROOT}/next.config.mjs`,
      `${WORKSPACE_ROOT}/next.config.ts`,
    ]) {
      if (this.container.vfs.existsSync(path)) {
        return "nextjs";
      }
    }

    for (const path of [
      `${WORKSPACE_ROOT}/app.config.ts`,
      `${WORKSPACE_ROOT}/app.config.js`,
    ]) {
      if (this.container.vfs.existsSync(path)) {
        return "tanstack";
      }
    }

    return "vite";
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
