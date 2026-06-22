import {
  createContainer,
  type ContainerInstance,
  type ContainerOptions,
} from "@agent-wasm/core";
import type { ClaudeIdeBridge } from "../features/claude-ide-bridge";
import type { TemplateId } from "../features/workspace-seed";
import type {
  OpenCodeSidebarTabState,
  OpenCodeTabState,
  PreviewSourcePickerRuntime,
  TerminalTabState,
} from "./workbench-host";

export interface SandboxSessionOptions {
  id: string;
  templateId: TemplateId;
  createContainerOptions: ContainerOptions;
}

/**
 * Per-sandbox state holder: owns the almostnode container plus the tab,
 * preview, and database state scoped to a single sandbox. `WebIDEHost`
 * delegates to its active session through same-named accessors so the
 * existing call sites stay untouched.
 */
export class SandboxSession {
  readonly id: string;
  templateId: TemplateId;
  container: ContainerInstance;
  /** Updated on every attach; drives the session pool's LRU ordering. */
  lastActiveAt: number = Date.now();
  /**
   * True when this session shows a repo's base (main) — editor writes and
   * agent launches refuse and request a sandbox fork instead.
   */
  readOnly = false;

  terminalTabs = new Map<string, TerminalTabState>();
  openCodeTabs = new Map<string, OpenCodeTabState>();
  openCodeSidebarTabs = new Map<string, OpenCodeSidebarTabState>();
  openCodeSidebarTerminalTabs = new Map<string, TerminalTabState>();
  activeTerminalTabId: string | null = null;
  activeOpenCodeSidebarTabId: string | null = null;
  previewTerminalTabId: string | null = null;
  terminalCounter = 0;
  openCodeTerminalCounter = 0;
  openCodeSidebarCounter = 0;
  openCodeSidebarTerminalCounter = 0;
  claudeSidebarCounter = 0;
  codexSidebarCounter = 0;
  piSidebarCounter = 0;
  previewStartRequested = false;
  previewPort: number | null = null;
  previewUrl: string | null = null;
  previewSourcePickerActive = false;
  previewSourcePickerRuntime: PreviewSourcePickerRuntime | null = null;
  previewStartRetryTimeoutId = 0;
  appBuildingPreviewOpenedJobs = new Set<string>();
  currentAppBuildingPreviewUrl: string | null = null;
  pgliteMiddleware: import("@agent-wasm/core/internal").RequestMiddleware | null =
    null;
  currentProjectDatabaseNamespace = "global";
  currentProjectDefaultDatabaseName = "default";
  workspaceDependencyInstallPromise: Promise<void> | null = null;
  workspaceDependencyInstallKey: string | null = null;
  workspaceDependencyInstallRequestKey: string | null = null;
  claudeIdeBridge: ClaudeIdeBridge | null = null;
  claudeImagePasteCleanup = new Map<string, () => void>();
  /** Tab DOM bodies parked while this session is in the background. */
  readonly detachedTabBodies = new Map<string, HTMLElement>();
  /**
   * Set by the host (browser agent mode): drops the in-browser opencode
   * server's per-directory instance cache for this session. Fire-and-forget;
   * runs at the top of {@link dispose} while the container is still usable.
   */
  disposeOpenCodeInstance: (() => void) | null = null;

  constructor(options: SandboxSessionOptions) {
    this.id = options.id;
    this.templateId = options.templateId;
    this.container = createContainer(options.createContainerOptions);
  }

  /**
   * State holder without a container, for hosts built via
   * `Object.create(WebIDEHost.prototype)` in unit tests: skipping the
   * constructor (and field initializers) preserves the old plain-field
   * semantics where unassigned host state reads as `undefined`.
   */
  static createDetached(): SandboxSession {
    return Object.create(SandboxSession.prototype) as SandboxSession;
  }

  /**
   * Tear down everything this session owns: terminal xterms and shells,
   * OpenCode TUI sessions, the Claude IDE bridge, parked tab DOM, the PGlite
   * middleware registration, and finally the container. Only called for
   * background sessions (their tabs are already detached from the surfaces).
   * Optional chaining keeps it safe on `createDetached()` state holders.
   */
  dispose(): void {
    try {
      // Before anything else: the opencode instance dispose needs the
      // container's VFS to still resolve.
      this.disposeOpenCodeInstance?.();
    } catch {
      // Best-effort cache drop.
    }
    this.disposeOpenCodeInstance = null;

    for (const cleanup of this.claudeImagePasteCleanup?.values() ?? []) {
      try {
        cleanup();
      } catch {
        // Best-effort per-tab cleanup.
      }
    }
    this.claudeImagePasteCleanup?.clear();

    for (const tab of this.terminalTabs?.values() ?? []) {
      tab.runningAbortController?.abort();
      tab.terminal.dispose();
      tab.session.dispose();
    }
    this.terminalTabs?.clear();

    for (const tab of this.openCodeSidebarTerminalTabs?.values() ?? []) {
      tab.runningAbortController?.abort();
      tab.terminal.dispose();
      tab.session.dispose();
    }
    this.openCodeSidebarTerminalTabs?.clear();

    for (const tab of this.openCodeTabs?.values() ?? []) {
      tab.session.dispose();
    }
    this.openCodeTabs?.clear();

    for (const tab of this.openCodeSidebarTabs?.values() ?? []) {
      tab.session?.dispose();
    }
    this.openCodeSidebarTabs?.clear();

    this.detachedTabBodies?.clear();

    this.claudeIdeBridge?.dispose();
    this.claudeIdeBridge = null;

    if (this.pgliteMiddleware) {
      // The server bridge is a page singleton — drop this session's
      // middleware so a disposed VFS can't keep serving database requests.
      this.container?.serverBridge.unregisterMiddleware(this.pgliteMiddleware);
      this.pgliteMiddleware = null;
    }

    this.container?.dispose();
  }
}
