import { Buffer } from "node:buffer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const getServiceMock = vi.fn();
const loadProjectFilesIntoVfsMock = vi.fn();
const replaceProjectFilesInVfsMock = vi.fn();
const collectScopedFilesBase64Mock = vi.fn();
const replaceScopedFilesInVfsMock = vi.fn();
const listOpenCodeBrowserSessionsMock = vi.fn();
const registerLegacyOpenCodeDbSnapshotMock = vi.fn();
const disposeOpenCodeInstanceMock = vi.fn(async () => undefined);
const readGhTokenMock = vi.fn();
const createModelReferenceMock = vi.fn();
const getModelMock = vi.fn();
const setModelLanguageMock = vi.fn();

let containerCounter = 0;

function makeFakeContainer() {
  containerCounter += 1;
  return {
    id: `container-${containerCounter}`,
    vfs: {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ""),
      statSync: vi.fn(() => {
        throw new Error("ENOENT");
      }),
      watch: vi.fn(() => ({ close: vi.fn() })),
      on: vi.fn(),
      off: vi.fn(),
    },
    on: vi.fn(),
    run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    dispose: vi.fn(),
  };
}

const createContainerMock = vi.fn((_options?: unknown) => makeFakeContainer());

vi.mock("almostnode", () => ({
  createContainer: (options: unknown) => createContainerMock(options),
  stream: { Buffer },
}));
vi.mock("../src/features/workspace-seed", () => ({
  DEFAULT_FILE: "/project/src/main.ts",
  DEFAULT_RUN_COMMAND: "npm run dev",
  WORKSPACE_ROOT: "/project",
  WORKSPACE_TESTS_ROOT: "/project/tests",
  WORKSPACE_TEST_E2E_ROOT: "/project/tests/e2e",
  WORKSPACE_TEST_METADATA_PATH: "/project/tests/.almostnode-tests.json",
  seedWorkspace: vi.fn(),
  seedReferenceApp: vi.fn(),
  getTemplateDefaults: vi.fn(() => ({
    defaultFile: "/project/src/main.ts",
    runCommand: "npm run dev",
  })),
}));
vi.mock("../src/extensions/fixture-extensions", () => ({
  FixtureMarketplaceClient: class {},
}));
vi.mock("../src/extensions/open-vsx", () => ({
  OpenVSXClient: class {},
}));
vi.mock("../src/features/persisted-extensions", () => ({
  prunePersistedWorkbenchExtensions: vi.fn(),
}));
vi.mock("../src/features/vfs-file-system-provider", () => ({
  VfsFileSystemProvider: class {},
}));
vi.mock("../src/desktop/host-terminal-session", () => ({
  HostTerminalSession: class {},
}));
vi.mock("../src/desktop/project-snapshot", () => ({
  loadProjectFilesIntoVfs: loadProjectFilesIntoVfsMock,
  replaceProjectFilesInVfs: replaceProjectFilesInVfsMock,
  collectScopedFilesBase64: collectScopedFilesBase64Mock,
  replaceScopedFilesInVfs: replaceScopedFilesInVfsMock,
}));
vi.mock("../src/extensions/extension-services", () => ({
  createExtensionServiceOverrides: vi.fn(() => ({})),
}));
vi.mock("../src/workbench/workbench-surfaces", () => ({
  FilesSidebarSurface: class {},
  PreviewSurface: class {
    setSelectActive(): void {}
  },
  TerminalPanelSurface: class {},
  OpenCodeTerminalSurface: class {},
  ConsolePanelElement: class {},
  DatabaseSidebarSurface: class {},
  DatabaseBrowserSurface: class {},
  KeychainSidebarSurface: class {},
  TestsSidebarSurface: class {},
  registerWorkbenchSurfaces: vi.fn(() => ({})),
}));
vi.mock("../src/features/keychain", () => ({
  Keychain: class {},
  CLAUDE_AUTH_CONFIG_PATH: "/home/user/.claude/.config.json",
  CLAUDE_AUTH_CREDENTIALS_PATH: "/home/user/.claude/.credentials.json",
  CLAUDE_LEGACY_CONFIG_PATH: "/home/user/.claude.json",
  CODEX_AUTH_PATH: "/home/user/.codex/auth.json",
  CODEX_CONFIG_JSON_PATH: "/home/user/.codex/config.json",
  CODEX_CONFIG_TOML_PATH: "/home/user/.codex/config.toml",
  FLY_CONFIG_PATH: "/home/user/.fly/config.yml",
  NETLIFY_CONFIG_PATH: "/home/user/.config/netlify/config.json",
  NETLIFY_LEGACY_CONFIG_PATH: "/home/user/.netlify/config.json",
  WRANGLER_AUTH_CONFIG_PATH:
    "/home/user/.config/.wrangler/config/default.toml",
  WRANGLER_LEGACY_AUTH_CONFIG_PATH: "/home/user/.wrangler/config/default.toml",
  OPENCODE_AUTH_PATH: "/opencode/data/opencode/auth.json",
  OPENCODE_MCP_AUTH_PATH: "/opencode/data/opencode/mcp-auth.json",
  OPENCODE_CONFIG_PATH: "/opencode/config/opencode/opencode.json",
  OPENCODE_CONFIG_JSONC_PATH: "/opencode/config/opencode/opencode.jsonc",
  OPENCODE_LEGACY_CONFIG_PATH: "/opencode/config/opencode/config.json",
  PI_AGENT_DIR: "/home/user/.pi/agent",
  PI_AUTH_PATH: "/home/user/.pi/agent/auth.json",
  PI_SETTINGS_PATH: "/home/user/.pi/agent/settings.json",
  PI_MODELS_PATH: "/home/user/.pi/agent/models.json",
  TAILSCALE_SESSION_KEYCHAIN_PATH:
    "/__almostnode/keychain/tailscale-session.json",
}));
vi.mock("../src/features/network-session", () => ({
  clearStoredWorkbenchNetworkConfig: vi.fn(),
  clearStoredTailscaleSessionSnapshot: vi.fn(),
  readStoredWorkbenchNetworkConfig: vi.fn(() => null),
  readStoredTailscaleSessionSnapshot: vi.fn(() => null),
  writeStoredWorkbenchNetworkConfig: vi.fn(),
  writeStoredTailscaleSessionSnapshot: vi.fn(),
}));
vi.mock("../src/features/opencode-browser-session", () => ({
  mountOpenCodeBrowserSession: vi.fn(),
  listOpenCodeBrowserSessions: listOpenCodeBrowserSessionsMock,
  registerLegacyOpenCodeDbSnapshot: registerLegacyOpenCodeDbSnapshotMock,
  disposeOpenCodeInstance: disposeOpenCodeInstanceMock,
}));
vi.mock("../src/features/claude-ide-bridge", () => ({
  buildClaudeIdeMcpConfig: vi.fn(() => "{}"),
  ClaudeIdeBridge: class {},
}));
vi.mock("../../../packages/almostnode/src/shims/gh-auth", () => ({
  readGhToken: readGhTokenMock,
}));
vi.mock("@codingame/monaco-vscode-api", () => ({
  initialize: vi.fn(),
  getService: getServiceMock,
  ICommandService: class {},
  Menu: {},
  ConfigurationTarget: {},
}));
vi.mock("@codingame/monaco-vscode-api/services", () => ({
  getService: getServiceMock,
  IEditorService: class {},
  IPaneCompositePartService: class {},
  IStatusbarService: class {},
  IWorkbenchLayoutService: class {},
  IWorkbenchThemeService: class {},
}));
vi.mock("@codingame/monaco-vscode-api/vscode/vs/base/common/uri", () => ({
  URI: {
    from: (value: unknown) => value,
    file: (path: string) => ({ path, toString: () => path }),
  },
}));
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/statusbar/browser/statusbar",
  () => ({
    StatusbarAlignment: {},
  }),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement",
  () => ({
    EnablementState: {},
  }),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service",
  () => ({
    ISearchService: class {},
  }),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search",
  () => ({
    QueryType: {},
  }),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService",
  () => ({
    SIDE_GROUP: {},
  }),
);
vi.mock("@codingame/monaco-vscode-configuration-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-keybindings-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-languages-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-search-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-theme-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-textmate-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-workbench-service-override", () => ({
  default: vi.fn(() => ({})),
  Parts: {},
  ViewContainerLocation: {},
  setPartVisibility: vi.fn(),
}));
vi.mock("@codingame/monaco-vscode-extensions-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-log-service-override", () => ({
  default: vi.fn(() => ({})),
}));
vi.mock("@codingame/monaco-vscode-files-service-override", () => ({
  createIndexedDBProviders: vi.fn(),
  registerFileSystemOverlay: vi.fn(),
}));
vi.mock("monaco-editor", () => ({
  languages: {
    register: vi.fn(),
    getLanguages: () => [],
  },
  editor: {
    createModelReference: createModelReferenceMock,
    getModel: getModelMock,
    setModelLanguage: setModelLanguageMock,
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {},
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {},
}));
vi.mock("monaco-editor/esm/vs/editor/editor.worker.js?worker&url", () => ({
  default: "editor-worker.js",
}));
vi.mock(
  "@codingame/monaco-vscode-textmate-service-override/worker?worker&url",
  () => ({ default: "textmate-worker.js" }),
);
vi.mock(
  "@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url",
  () => ({ default: "extension-worker.js" }),
);
vi.mock(
  "@codingame/monaco-vscode-theme-defaults-default-extension",
  () => ({}),
);
vi.mock("@codingame/monaco-vscode-javascript-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-json-default-extension", () => ({}));
vi.mock(
  "@codingame/monaco-vscode-typescript-basics-default-extension",
  () => ({}),
);
vi.mock("@codingame/monaco-vscode-html-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-css-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-sql-default-extension", () => ({}));
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._configuration",
  () => ({}),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._editorPane",
  () => ({}),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/files.contribution._fileEditorFactory",
  () => ({}),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileActions.contribution",
  () => ({}),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/files/browser/fileCommands",
  () => ({}),
);
vi.mock(
  "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/extensions/browser/extensions.contribution",
  () => ({}),
);
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

let WebIDEHost: typeof import("../src/workbench/workbench-host").WebIDEHost;
let SandboxSession: typeof import("../src/workbench/sandbox-session").SandboxSession;
let agentSessionRegistry: typeof import("../src/chat/agent-session-registry").agentSessionRegistry;
let codexConversationBus: typeof import("../src/chat/codex-conversation-bus").codexConversationBus;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:5173/",
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    AbortController: dom.window.AbortController,
    Worker: class {},
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  ({ WebIDEHost } = await import("../src/workbench/workbench-host"));
  ({ SandboxSession } = await import("../src/workbench/sandbox-session"));
  ({ agentSessionRegistry } = await import(
    "../src/chat/agent-session-registry"
  ));
  ({ codexConversationBus } = await import(
    "../src/chat/codex-conversation-bus"
  ));
}, 60000);

/**
 * Mirrors the detach/attach contract of TerminalPanelSurface and
 * OpenCodeTerminalSurface: bodies survive detachTab and the SAME element
 * must be handed back to attachTab.
 */
class FakeTabSurface {
  tabs = new Map<string, HTMLElement>();
  active: string | null = null;
  attachCalls: Array<{ id: string; body: HTMLElement }> = [];

  addTab(tab: { id: string }): void {
    this.tabs.set(tab.id, document.createElement("div"));
  }

  detachTab(id: string): HTMLElement | null {
    const body = this.tabs.get(id) ?? null;
    if (body) {
      this.tabs.delete(id);
    }
    if (this.active === id) {
      this.active = null;
    }
    return body;
  }

  attachTab(tab: { id: string }, body: HTMLElement): void {
    this.tabs.set(tab.id, body);
    this.attachCalls.push({ id: tab.id, body });
  }

  setActiveTab(id: string): void {
    this.active = id;
  }

  removeTab(id: string): void {
    this.tabs.delete(id);
  }

  updateTabStatus(): void {}
  updateTabTitle(): void {}
}

function makeFakeTerminalTab(id: string) {
  return {
    id,
    title: id,
    terminal: {
      dispose: vi.fn(),
      element: document.createElement("div"),
      focus: vi.fn(),
      write: vi.fn(),
    },
    fitAddon: {},
    session: {
      dispose: vi.fn(),
      resize: vi.fn(),
      sendInput: vi.fn(),
      abort: vi.fn(),
    },
    currentLine: "",
    history: [],
    historyIndex: -1,
    runningAbortController: { abort: vi.fn() },
    closable: true,
    kind: "user" as const,
    inputMode: "managed" as const,
    surface: "panel" as const,
    agentHarness: null,
  };
}

function makeSession(id: string) {
  return new SandboxSession({
    id,
    templateId: "vite",
    createContainerOptions: {},
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeHost(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const host: any = Object.create(WebIDEHost.prototype);
  host.sessions = new Map();
  host.projectSessionIds = new Map();
  host.options = { baseUrl: "/" };
  host.previewMode = "workbench";
  host.terminalSurface = new FakeTabSurface();
  host.openCodeSurface = new FakeTabSurface();
  host.previewSurface = {
    setActiveDb: vi.fn(),
    clear: vi.fn(),
    setUrl: vi.fn(),
    setStatus: vi.fn(),
    setSelectActive: vi.fn(),
    getIframe: vi.fn(() => ({
      contentWindow: null,
      addEventListener: vi.fn(),
    })),
  };
  host.appBuildingPreviewSurface = { clear: vi.fn(), setUrl: vi.fn() };
  host.databaseSurface = { update: vi.fn() };
  host.filesSurface = {};
  host.initPGliteIfNeeded = vi.fn(async () => {});
  host.revealPreviewEditor = vi.fn(async () => {});
  host.ensurePreviewServerRunning = vi.fn();
  host.schedulePreviewStartRetry = vi.fn();
  host.createUserTerminalTab = vi.fn(() => makeFakeTerminalTab("starter"));
  host.updateTerminalStatus = vi.fn();
  return host;
}

beforeEach(() => {
  replaceProjectFilesInVfsMock.mockReset();
  getServiceMock.mockReset();
  getServiceMock.mockResolvedValue({
    executeCommand: vi.fn(async () => undefined),
  });
  // The registry is a module singleton — clear leftover sessions per test.
  for (const session of [
    ...agentSessionRegistry.getSessionsForSandbox("session-a"),
    ...agentSessionRegistry.getSessionsForSandbox("session-b"),
  ]) {
    agentSessionRegistry.clearActive(session.tabId);
  }
  agentSessionRegistry.deactivate();
});

describe("WebIDEHost multi-session switching", () => {
  it("keeps terminal tabs alive across detach and revives them on re-attach", async () => {
    const sessionA = makeSession("session-a");
    const tab = makeFakeTerminalTab("term-1");
    sessionA.terminalTabs.set(tab.id, tab as never);
    sessionA.activeTerminalTabId = tab.id;
    sessionA.previewPort = 5173;
    sessionA.previewUrl = "/__virtual__/5173/";

    const host = makeHost();
    host.sessions.set(sessionA.id, sessionA);
    host.activeSession = sessionA;
    const body = document.createElement("div");
    host.terminalSurface.tabs.set(tab.id, body);

    await host.switchToSession("session-b", { templateId: "vite", files: [] });

    // Nothing in session A was aborted or disposed.
    expect(tab.runningAbortController.abort).not.toHaveBeenCalled();
    expect(tab.terminal.dispose).not.toHaveBeenCalled();
    expect(tab.session.dispose).not.toHaveBeenCalled();
    expect(sessionA.container.dispose).not.toHaveBeenCalled();
    // The tab body was parked on the session, preview state retained.
    expect(sessionA.detachedTabBodies.get(tab.id)).toBe(body);
    expect(host.terminalSurface.tabs.has(tab.id)).toBe(false);
    expect(sessionA.previewUrl).toBe("/__virtual__/5173/");
    expect(sessionA.previewPort).toBe(5173);
    // A fresh session B exists with its own container and starter terminal.
    const sessionB = host.sessions.get("session-b");
    expect(sessionB).toBeDefined();
    expect(host.container).toBe(sessionB.container);
    expect(sessionB.container).not.toBe(sessionA.container);
    expect(host.createUserTerminalTab).toHaveBeenCalled();

    await host.switchToSession("session-a", { templateId: "vite" });

    // The SAME body element came back and the active tab selection restored.
    expect(host.container).toBe(sessionA.container);
    expect(host.terminalSurface.tabs.get(tab.id)).toBe(body);
    expect(host.terminalSurface.attachCalls).toEqual([
      { id: tab.id, body },
    ]);
    expect(sessionA.detachedTabBodies.size).toBe(0);
    expect(host.terminalSurface.active).toBe(tab.id);
    // The still-running dev server was re-adopted, not restarted.
    expect(host.previewSurface.setUrl).toHaveBeenCalledWith(
      "/__virtual__/5173/",
    );
    expect(host.ensurePreviewServerRunning).toHaveBeenCalledTimes(1); // only for the fresh session B
  });

  it("parks OpenCode sidebar tabs without disposing their TUI sessions", async () => {
    const sessionA = makeSession("session-a");
    const tuiHost = document.createElement("div");
    const tuiSession = { dispose: vi.fn() };
    sessionA.openCodeSidebarTabs.set("oc-1", {
      id: "oc-1",
      title: "OpenCode 1",
      host: tuiHost,
      session: tuiSession as never,
    });
    sessionA.activeOpenCodeSidebarTabId = "oc-1";

    const host = makeHost();
    host.sessions.set(sessionA.id, sessionA);
    host.activeSession = sessionA;
    const body = document.createElement("div");
    body.appendChild(tuiHost);
    host.openCodeSurface.tabs.set("oc-1", body);

    await host.switchToSession("session-b", { templateId: "vite" });

    expect(tuiSession.dispose).not.toHaveBeenCalled();
    expect(sessionA.detachedTabBodies.get("oc-1")).toBe(body);
    expect(sessionA.openCodeSidebarTabs.has("oc-1")).toBe(true);

    await host.switchToSession("session-a", { templateId: "vite" });

    expect(host.openCodeSurface.tabs.get("oc-1")).toBe(body);
    expect(body.contains(tuiHost)).toBe(true);
    expect(host.openCodeSurface.active).toBe("oc-1");
  });

  it("detaches chat on switch but re-activates a running agent on re-attach", async () => {
    const sessionA = makeSession("session-a");
    const host = makeHost();
    host.sessions.set(sessionA.id, sessionA);
    host.activeSession = sessionA;

    let running = true;
    agentSessionRegistry.setActive({
      harness: "claude",
      tabId: "agent-tab-1",
      startedAt: Date.now(),
      sandboxId: "session-a",
      threadId: null,
      resumeToken: null,
      sendInput: vi.fn(),
      isRunning: () => running,
    });

    await host.switchToSession("session-b", { templateId: "vite" });

    // Chat detached, but the agent session stays registered and running.
    expect(agentSessionRegistry.getActive()).toBeNull();
    expect(
      agentSessionRegistry.getSessionsForSandbox("session-a"),
    ).toHaveLength(1);
    expect(agentSessionRegistry.getRunningSandboxes().has("session-a")).toBe(
      true,
    );

    await host.switchToSession("session-a", { templateId: "vite" });
    expect(agentSessionRegistry.getActive()?.tabId).toBe("agent-tab-1");

    // An exited agent must NOT be re-activated.
    agentSessionRegistry.deactivate();
    running = false;
    await host.switchToSession("session-b", { templateId: "vite" });
    await host.switchToSession("session-a", { templateId: "vite" });
    expect(agentSessionRegistry.getActive()).toBeNull();
  });

  it("maps projects to sessions and only writes files into fresh sessions", async () => {
    const sessionA = makeSession("session-a");
    const host = makeHost();
    host.sessions.set(sessionA.id, sessionA);
    host.activeSession = sessionA;
    host.switchProjectWorkspace = vi.fn(async () => undefined);

    const files = [{ path: "/project/a.txt", contentBase64: "QQ==" }];

    // First project adopts the unbound bootstrap session via the legacy
    // in-place restore.
    const first = await host.switchProjectWorkspaceToSession(
      "p1",
      "vite",
      files,
    );
    expect(first).toEqual({ workspaceReplaced: true });
    expect(host.switchProjectWorkspace).toHaveBeenCalledWith(
      "vite",
      files,
      undefined,
      undefined,
    );
    expect(host.projectSessionIds.get("p1")).toBe("session-a");
    expect(host.getVfsForProject("p1")).toBe(sessionA.container.vfs);

    // Second project gets its own fresh session, seeded from files.
    const second = await host.switchProjectWorkspaceToSession(
      "p2",
      "vite",
      files,
    );
    expect(second).toEqual({ workspaceReplaced: true });
    const sessionP2 = host.sessions.get(host.projectSessionIds.get("p2"));
    expect(sessionP2).toBeDefined();
    expect(sessionP2).not.toBe(sessionA);
    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledTimes(1);
    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledWith(
      sessionP2.container.vfs,
      files,
      { includeGit: true },
    );
    expect(host.getVfsForProject("p2")).toBe(sessionP2.container.vfs);

    // Switching back to a live project re-attaches without rewriting files.
    const third = await host.switchProjectWorkspaceToSession(
      "p1",
      "vite",
      files,
    );
    expect(third).toEqual({ workspaceReplaced: false });
    expect(host.container).toBe(sessionA.container);
    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledTimes(1);
  });

  it("marks project sessions read-only and sandbox sessions writable on attach", async () => {
    const sessionA = makeSession("session-a");
    const host = makeHost();
    host.sessions.set(sessionA.id, sessionA);
    host.activeSession = sessionA;
    host.switchProjectWorkspace = vi.fn(async () => undefined);
    const setReadOnly = vi.fn();
    host.vfsProvider = { setVfs: vi.fn(), setReadOnly };

    // Bootstrap adoption marks the active session read-only in place.
    await host.switchProjectWorkspaceToSession("p1", "vite", []);
    expect(sessionA.readOnly).toBe(true);
    expect(setReadOnly).toHaveBeenLastCalledWith(true);

    // A second project's fresh session attaches read-only too.
    await host.switchProjectWorkspaceToSession("p2", "vite", []);
    const sessionP2 = host.sessions.get(host.projectSessionIds.get("p2"));
    expect(sessionP2.readOnly).toBe(true);
    expect(setReadOnly).toHaveBeenLastCalledWith(true);

    // A sandbox session attaches writable.
    await host.switchToSession("sandbox-1", {
      templateId: "vite",
      readOnly: false,
    });
    expect(host.sessions.get("sandbox-1").readOnly).toBe(false);
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
  });

  it("never adopts an active sandbox session for a project", async () => {
    const sandboxSession = makeSession("sandbox-1");
    const host = makeHost();
    host.sandboxSessionRepoIds = new Map([["sandbox-1", "repo-1"]]);
    host.sessions.set(sandboxSession.id, sandboxSession);
    host.activeSession = sandboxSession;
    host.switchProjectWorkspace = vi.fn(async () => undefined);

    const result = await host.switchProjectWorkspaceToSession(
      "p1",
      "vite",
      [],
    );

    // The repo got its own fresh session instead of overwriting the sandbox.
    expect(result).toEqual({ workspaceReplaced: true });
    expect(host.switchProjectWorkspace).not.toHaveBeenCalled();
    expect(host.projectSessionIds.get("p1")).toBe("project-p1");
    expect(host.sessions.get("project-p1")).toBeDefined();
    expect(host.sessions.get("sandbox-1")).toBe(sandboxSession);
  });
});

describe("WebIDEHost sandbox sessions", () => {
  it("forks a sandbox session from the repo base and checks out its branch", async () => {
    const host = makeHost();
    host.activeSession = makeSession("default");
    host.sessions.set("default", host.activeSession);
    host.sandboxSessionRepoIds = new Map();
    host.agentMode = "host"; // skip ClaudeIdeBridge creation in tests

    const repo = {
      id: "repo-1",
      name: "Repo",
      templateId: "vite" as const,
      createdAt: 1,
      lastModified: 1,
      dbPrefix: "db1",
      defaultBranch: "main",
      gitRemote: { name: "origin", url: "https://example.com/repo.git" },
    };
    const sandbox = {
      id: "sandbox-1",
      repoId: "repo-1",
      name: "fix-login",
      branch: "sandbox/fix-login",
      createdAt: 1,
      lastActive: 1,
      filesKey: "sandbox-1",
      agentStateKey: "sandbox-1",
    };
    const baseFiles = [{ path: "/project/a.txt", contentBase64: "QQ==" }];

    const session = await host.createSandboxSession(repo, sandbox, baseFiles);

    expect(host.sandboxSessionRepoIds.get("sandbox-1")).toBe("repo-1");
    expect(host.sessions.get("sandbox-1")).toBe(session);
    expect(session.readOnly).toBe(false);
    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledWith(
      session.container.vfs,
      baseFiles,
      { includeGit: true },
    );
    // git ran inside the sandbox's own container: init (no .git in the fake
    // vfs), then the branch fork, then the background fetch.
    const runMock = session.container.run as unknown as ReturnType<
      typeof vi.fn
    >;
    const commands = runMock.mock.calls.map((call) => call[0] as string);
    expect(commands).toContain("git checkout -b 'sandbox/fix-login'");
    expect(commands[commands.length - 1]).toBe("git fetch origin 'main'");
    // The fork happened in the background — the active session is untouched.
    expect(host.activeSession.id).toBe("default");
  });

  it("skips the background fetch for repos without a remote", async () => {
    const host = makeHost();
    host.activeSession = makeSession("default");
    host.sandboxSessionRepoIds = new Map();
    host.agentMode = "host";

    const session = await host.createSandboxSession(
      {
        id: "repo-2",
        name: "Local",
        templateId: "vite",
        createdAt: 1,
        lastModified: 1,
        dbPrefix: "db2",
      },
      {
        id: "sandbox-2",
        repoId: "repo-2",
        name: "s",
        branch: "sandbox/s",
        createdAt: 1,
        lastActive: 1,
        filesKey: "sandbox-2",
        agentStateKey: "sandbox-2",
      },
      [],
    );

    const runMock = session.container.run as unknown as ReturnType<
      typeof vi.fn
    >;
    const commands = runMock.mock.calls.map((call) => call[0] as string);
    expect(commands.some((cmd) => cmd.startsWith("git fetch"))).toBe(false);
  });
});

describe("WebIDEHost session pool eviction", () => {
  function makePoolHost() {
    const host = makeHost();
    host.activeSession = makeSession("active");
    host.sessions.set("active", host.activeSession);
    host.sandboxSessionRepoIds = new Map();
    return host;
  }

  function addBackgroundSession(host: ReturnType<typeof makeHost>, id: string, lastActiveAt: number) {
    const session = makeSession(id);
    session.lastActiveAt = lastActiveAt;
    host.sessions.set(id, session);
    return session;
  }

  it("evicts nothing without a registered persistence handler", async () => {
    const host = makePoolHost();
    addBackgroundSession(host, "s1", 1);
    addBackgroundSession(host, "s2", 2);
    addBackgroundSession(host, "s3", 3);

    await expect(host.evictIdleSessions()).resolves.toEqual([]);
    expect(host.sessions.size).toBe(4);
  });

  it("snapshots then fully disposes the LRU background session beyond the cap", async () => {
    const host = makePoolHost();
    const oldest = addBackgroundSession(host, "oldest", 10);
    addBackgroundSession(host, "mid", 20);
    addBackgroundSession(host, "newest", 30);

    const tab = makeFakeTerminalTab("victim-term");
    Object.assign(tab, { runningAbortController: null }); // idle — not pinned
    oldest.terminalTabs.set(tab.id, tab as never);
    oldest.detachedTabBodies.set(tab.id, document.createElement("div"));
    const bridge = { dispose: vi.fn() };
    oldest.claudeIdeBridge = bridge as never;
    const unregisterMiddleware = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (oldest.container as any).serverBridge = { unregisterMiddleware };
    const middleware = { id: "pglite" };
    oldest.pgliteMiddleware = middleware as never;
    host.projectSessionIds.set("p-oldest", "oldest");

    const order: string[] = [];
    const persist = vi.fn(async (sessionId: string) => {
      order.push(`persist:${sessionId}`);
    });
    (
      oldest.container.dispose as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => {
      order.push("dispose:oldest");
    });
    host.setSessionPersistence(persist);

    await expect(host.evictIdleSessions()).resolves.toEqual(["oldest"]);

    // Snapshot strictly before disposal.
    expect(order).toEqual(["persist:oldest", "dispose:oldest"]);
    expect(persist).toHaveBeenCalledTimes(1);
    // Full teardown: xterm, shell session, bridge, middleware, parked DOM.
    expect(tab.terminal.dispose).toHaveBeenCalled();
    expect(tab.session.dispose).toHaveBeenCalled();
    expect(bridge.dispose).toHaveBeenCalled();
    expect(unregisterMiddleware).toHaveBeenCalledWith(middleware);
    expect(oldest.detachedTabBodies.size).toBe(0);
    expect(host.sessions.has("oldest")).toBe(false);
    expect(host.sessions.size).toBe(3);
    // The project binding survives so re-opening restores from the snapshot.
    expect(host.projectSessionIds.get("p-oldest")).toBe("oldest");
  });

  it("never evicts the active session even when it is the LRU", async () => {
    const host = makePoolHost();
    host.activeSession.lastActiveAt = 1;
    addBackgroundSession(host, "s2", 20);
    addBackgroundSession(host, "s3", 30);
    addBackgroundSession(host, "s4", 40);
    host.setSessionPersistence(vi.fn(async () => undefined));

    await expect(host.evictIdleSessions()).resolves.toEqual(["s2"]);
    expect(host.sessions.has("active")).toBe(true);
  });

  it("pins sessions with a running terminal command", async () => {
    const host = makePoolHost();
    const runningSession = addBackgroundSession(host, "running", 1);
    const runningTab = makeFakeTerminalTab("busy");
    runningSession.terminalTabs.set(runningTab.id, runningTab as never);
    addBackgroundSession(host, "idle", 2);
    addBackgroundSession(host, "fresh", 3);
    host.setSessionPersistence(vi.fn(async () => undefined));

    await expect(host.evictIdleSessions()).resolves.toEqual(["idle"]);
    expect(host.sessions.has("running")).toBe(true);
  });

  it("pins sandboxes with a running agent CLI", async () => {
    const host = makePoolHost();
    addBackgroundSession(host, "agent-sandbox", 1);
    addBackgroundSession(host, "idle", 2);
    addBackgroundSession(host, "fresh", 3);
    agentSessionRegistry.register({
      harness: "claude",
      tabId: "pool-agent-tab",
      startedAt: Date.now(),
      sandboxId: "agent-sandbox",
      threadId: null,
      resumeToken: null,
      sendInput: vi.fn(),
      isRunning: () => true,
    });
    host.setSessionPersistence(vi.fn(async () => undefined));

    try {
      await expect(host.evictIdleSessions()).resolves.toEqual(["idle"]);
      expect(host.sessions.has("agent-sandbox")).toBe(true);
    } finally {
      agentSessionRegistry.clearActive("pool-agent-tab");
    }
  });

  it("keeps a session live when its pre-eviction snapshot fails", async () => {
    const host = makePoolHost();
    const oldest = addBackgroundSession(host, "oldest", 1);
    addBackgroundSession(host, "mid", 2);
    addBackgroundSession(host, "newest", 3);
    host.setSessionPersistence(
      vi.fn(async () => {
        throw new Error("quota exceeded");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(host.evictIdleSessions()).resolves.toEqual([]);
      expect(host.sessions.has("oldest")).toBe(true);
      expect(oldest.container.dispose).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("drops the evicted sandbox's exited agent sessions from the registry", async () => {
    const host = makePoolHost();
    addBackgroundSession(host, "stale-sandbox", 1);
    addBackgroundSession(host, "idle", 2);
    addBackgroundSession(host, "fresh", 3);
    agentSessionRegistry.register({
      harness: "claude",
      tabId: "stale-agent-tab",
      startedAt: Date.now(),
      sandboxId: "stale-sandbox",
      threadId: null,
      resumeToken: null,
      sendInput: vi.fn(),
      isRunning: () => false,
    });
    host.setSessionPersistence(vi.fn(async () => undefined));

    try {
      await expect(host.evictIdleSessions()).resolves.toEqual([
        "stale-sandbox",
      ]);
      expect(
        agentSessionRegistry.getSessionsForSandbox("stale-sandbox"),
      ).toHaveLength(0);
    } finally {
      agentSessionRegistry.clearActive("stale-agent-tab");
    }
  });

  it("runs pool eviction after every session switch", async () => {
    const host = makePoolHost();
    host.evictIdleSessions = vi.fn(async () => []);

    await host.switchToSession("session-b", { templateId: "vite" });

    expect(host.evictIdleSessions).toHaveBeenCalledTimes(1);
  });
});

describe("WebIDEHost session commands and disposal", () => {
  it("runs session commands in the owning container, resolving project ids", async () => {
    const host = makeHost();
    const sandboxSession = makeSession("sandbox-1");
    const projectSession = makeSession("project-p1");
    host.sessions.set("sandbox-1", sandboxSession);
    host.sessions.set("project-p1", projectSession);
    host.projectSessionIds.set("p1", "project-p1");
    (sandboxSession.container.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 0,
      stdout: "sandbox-out",
      stderr: "",
    });

    const result = await host.runSessionCommand("sandbox-1", "git status --porcelain");
    expect(result).toEqual({ stdout: "sandbox-out", stderr: "", exitCode: 0 });
    expect(sandboxSession.container.run).toHaveBeenCalledWith(
      "git status --porcelain",
      { cwd: "/project" },
    );

    await host.runSessionCommand("p1", "gh pr view 1 --json state");
    expect(projectSession.container.run).toHaveBeenCalledWith(
      "gh pr view 1 --json state",
      { cwd: "/project" },
    );

    await expect(host.runSessionCommand("missing", "git status")).rejects.toThrow(
      "No live session",
    );
  });

  it("disposeSession fully disposes background sessions and drops bindings", () => {
    const host = makeHost();
    host.sandboxSessionRepoIds = new Map([["doomed", "repo-1"]]);
    const active = makeSession("active");
    const doomed = makeSession("doomed");
    host.sessions.set("active", active);
    host.sessions.set("doomed", doomed);
    host.activeSession = active;
    agentSessionRegistry.register({
      harness: "claude",
      tabId: "doomed-agent-tab",
      startedAt: Date.now(),
      sandboxId: "doomed",
      threadId: null,
      resumeToken: null,
      sendInput: vi.fn(),
      isRunning: () => false,
    });

    try {
      host.disposeSession("doomed");

      expect(host.sessions.has("doomed")).toBe(false);
      expect(host.sandboxSessionRepoIds.has("doomed")).toBe(false);
      expect(doomed.container.dispose).toHaveBeenCalled();
      expect(agentSessionRegistry.getSessionsForSandbox("doomed")).toHaveLength(0);

      // The active session is never disposed through this path.
      host.disposeSession("active");
      expect(host.sessions.has("active")).toBe(true);
      expect(active.container.dispose).not.toHaveBeenCalled();
    } finally {
      agentSessionRegistry.clearActive("doomed-agent-tab");
    }
  });

  it("invokes the opencode instance dispose hook before the container dies", () => {
    const session = makeSession("session-a");
    const order: string[] = [];
    session.disposeOpenCodeInstance = () => {
      order.push("opencode-dispose");
    };
    (session.container.dispose as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        order.push("container-dispose");
      },
    );

    session.dispose();

    expect(order).toEqual(["opencode-dispose", "container-dispose"]);
    expect(session.disposeOpenCodeInstance).toBeNull();
  });

  it("markActiveSessionReadOnly flags the session and the editor provider", () => {
    const host = makeHost();
    const session = makeSession("session-a");
    host.sessions.set(session.id, session);
    host.activeSession = session;
    const setReadOnly = vi.fn();
    host.vfsProvider = { setReadOnly };

    host.markActiveSessionReadOnly();

    expect(session.readOnly).toBe(true);
    expect(setReadOnly).toHaveBeenCalledWith(true);
  });
});

describe("WebIDEHost codex thread discovery", () => {
  it("records threads from the codex bus and lists them per sandbox", async () => {
    const host = makeHost();
    const session = makeSession("session-a");
    host.sessions.set(session.id, session);
    host.activeSession = session;
    host.codexThreadsBySandbox = new Map();
    host.subscribeCodexThreadEvents();

    const threadEvents: number[] = [];
    const onThreadUpdated = () => threadEvents.push(Date.now());
    window.addEventListener("almostnode:agent-thread-updated", onThreadUpdated);

    try {
      codexConversationBus.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          item: {
            type: "userMessage",
            id: "item-1",
            content: [{ type: "text", text: "make homepage advertise todos" }],
          },
        },
      });
      codexConversationBus.emitNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", itemId: "item-2", delta: "On it" },
      });

      const records = await host.discoverSandboxCodexThreads("session-a");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: "codex:session-a:thread-1",
        harness: "codex",
        title: "make homepage advertise todos",
        resumeToken: "thread-1",
        sandboxId: "session-a",
      });
      expect(threadEvents.length).toBeGreaterThan(0);

      // Other sandboxes see nothing.
      expect(await host.discoverSandboxCodexThreads("session-b")).toEqual([]);
    } finally {
      window.removeEventListener(
        "almostnode:agent-thread-updated",
        onThreadUpdated,
      );
      codexConversationBus.reset();
    }
  });

  it("records threads announced only by the thread/start request result", async () => {
    const host = makeHost();
    const session = makeSession("session-a");
    host.sessions.set(session.id, session);
    host.activeSession = session;
    host.codexThreadsBySandbox = new Map();
    host.subscribeCodexThreadEvents();

    try {
      // The WASM app-server states the thread id only in the thread/start
      // REQUEST result; its item notifications carry no params.threadId.
      codexConversationBus.emitRequest(
        "thread/start",
        { cwd: "/project" },
        { thread: { id: "thread-9" } },
      );
      codexConversationBus.emitNotification({
        method: "item/completed",
        params: {
          item: {
            type: "userMessage",
            id: "item-1",
            content: [{ type: "text", text: "add a footer" }],
          },
        },
      });

      const records = await host.discoverSandboxCodexThreads("session-a");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: "codex:session-a:thread-9",
        harness: "codex",
        title: "add a footer",
        resumeToken: "thread-9",
      });
    } finally {
      codexConversationBus.reset();
    }
  });

  it("persists transcripts in snapshots and replays a dead thread into the chat", async () => {
    const host = makeHost();
    const session = makeSession("session-a");
    host.sessions.set(session.id, session);
    host.activeSession = session;
    host.codexThreadsBySandbox = new Map();
    host.subscribeCodexThreadEvents();

    try {
      // Realistic event order for a chat-launched Codex turn: the
      // app-server session resets the bus, thread/start states the id only
      // in its request result, item notifications carry no threadId.
      codexConversationBus.reset();
      codexConversationBus.emitRequest(
        "thread/start",
        { cwd: "/project" },
        { thread: { id: "thread-7" } },
      );
      codexConversationBus.emitNotification({
        method: "item/completed",
        params: {
          item: {
            type: "userMessage",
            id: "item-1",
            content: [{ type: "text", text: "hello codex" }],
          },
        },
      });
      codexConversationBus.emitNotification({
        method: "item/completed",
        params: { item: { type: "agentMessage", id: "item-2", text: "hi" } },
      });

      // The session snapshot carries the captured transcript.
      const snapshot =
        await host.collectAgentStateSnapshotForSession("session-a");
      expect(snapshot.codexThreads).toHaveLength(1);
      expect(snapshot.codexThreads[0]).toMatchObject({
        id: "thread-7",
        title: "hello codex",
      });
      expect(snapshot.codexThreads[0].events).toHaveLength(3);

      // "Page reload": a fresh host restores the snapshot — the thread is
      // listable again without any live Codex session.
      const reloadedHost = makeHost();
      const reloadedSession = makeSession("session-a");
      reloadedHost.sessions.set(reloadedSession.id, reloadedSession);
      reloadedHost.activeSession = reloadedSession;
      reloadedHost.codexThreadsBySandbox = new Map();
      await reloadedHost.restoreAgentStateSnapshot({
        claudeFiles: [],
        codexThreads: snapshot.codexThreads,
      });
      const records =
        await reloadedHost.discoverSandboxCodexThreads("session-a");
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        title: "hello codex",
        resumeToken: "thread-7",
      });

      // Reopening the thread replays the transcript onto the bus (the chat
      // adapter renders it) and routes chat to a non-running session — the
      // next send launches a fresh Codex session.
      const replayed: unknown[] = [];
      const unsubscribe = codexConversationBus.subscribe(
        (event) => replayed.push(event),
        { replay: false },
      );
      try {
        await reloadedHost.resumeResumableThread(records[0]);
      } finally {
        unsubscribe();
      }
      expect(
        replayed.filter(
          (event) => (event as { kind?: string }).kind === "notification",
        ),
      ).toHaveLength(2);
      expect(
        replayed.filter(
          (event) => (event as { kind?: string }).kind === "request",
        ),
      ).toHaveLength(1);

      const active = agentSessionRegistry.getActive();
      expect(active?.harness).toBe("codex");
      expect(active?.resumeToken).toBe("thread-7");
      expect(active?.isRunning()).toBe(false);

      // The replay must not re-capture its own events (they would double
      // in the store on every reopen).
      const storedAfterReplay = reloadedHost.codexThreadsBySandbox
        .get("session-a")
        .get("thread-7");
      expect(storedAfterReplay.events).toHaveLength(3);

      agentSessionRegistry.clearActive(active!.tabId);
    } finally {
      codexConversationBus.reset();
    }
  });
});

describe("WebIDEHost typed agent launch guard", () => {
  it("refuses typed claude launches on a read-only repo base", async () => {
    const host = makeHost();
    const session = makeSession("session-a");
    session.readOnly = true;
    host.sessions.set(session.id, session);
    host.activeSession = session;
    host.agentMode = "browser";
    const tab = makeFakeTerminalTab("term-1");
    tab.runningAbortController = null as never;

    const forkEvents: unknown[] = [];
    const onFork = (event: Event) => {
      forkEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener("almostnode:fork-requested", onFork);

    try {
      await host.runCommand(tab, "claude");
    } finally {
      window.removeEventListener("almostnode:fork-requested", onFork);
    }

    expect(forkEvents).toHaveLength(1);
    expect(tab.terminal.write).toHaveBeenCalledWith(
      expect.stringContaining("read-only"),
    );
    expect(host.updateTerminalStatus).toHaveBeenCalledWith(
      tab,
      "Read-only main",
    );
    // The command never started: no abort controller was armed.
    expect(tab.runningAbortController).toBeNull();
  });
});
