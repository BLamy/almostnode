import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const getServiceMock = vi.fn();
const loadProjectFilesIntoVfsMock = vi.fn();
const replaceProjectFilesInVfsMock = vi.fn();

vi.mock("almostnode", () => ({
  createContainer: vi.fn(),
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
}));
vi.mock("../src/extensions/extension-services", () => ({
  createExtensionServiceOverrides: vi.fn(() => ({})),
}));
vi.mock("../src/workbench/workbench-surfaces", () => ({
  FilesSidebarSurface: class {},
  PreviewSurface: class {},
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
  OPENCODE_AUTH_PATH: "/opencode/data/opencode/auth.json",
  OPENCODE_MCP_AUTH_PATH: "/opencode/data/opencode/mcp-auth.json",
  OPENCODE_CONFIG_PATH: "/opencode/config/opencode/opencode.json",
  OPENCODE_CONFIG_JSONC_PATH: "/opencode/config/opencode/opencode.jsonc",
  OPENCODE_LEGACY_CONFIG_PATH: "/opencode/config/opencode/config.json",
  TAILSCALE_SESSION_KEYCHAIN_PATH: "/__almostnode/keychain/tailscale-session.json",
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
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {},
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {},
}));
vi.mock(
  "monaco-editor/esm/vs/editor/editor.worker.js?worker&url",
  () => ({ default: "editor-worker.js" }),
);
vi.mock(
  "@codingame/monaco-vscode-textmate-service-override/worker?worker&url",
  () => ({ default: "textmate-worker.js" }),
);
vi.mock(
  "@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url",
  () => ({ default: "extension-worker.js" }),
);
vi.mock("@codingame/monaco-vscode-theme-defaults-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-javascript-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-json-default-extension", () => ({}));
vi.mock("@codingame/monaco-vscode-typescript-basics-default-extension", () => ({}));
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
    AbortController: dom.window.AbortController,
    Worker: class {},
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  ({ WebIDEHost } = await import("../src/workbench/workbench-host"));
});

beforeEach(() => {
  getServiceMock?.mockReset();
  loadProjectFilesIntoVfsMock.mockReset();
  replaceProjectFilesInVfsMock.mockReset();
});

describe("WebIDEHost AI launcher behavior", () => {
  it("reopens preview in the active group instead of forcing a side group", async () => {
    const openEditor = vi.fn().mockResolvedValue(undefined);
    const findEditors = vi.fn(() => []);
    getServiceMock.mockResolvedValue({
      findEditors,
      openEditor,
    });

    await (WebIDEHost.prototype as unknown as {
      revealPreviewEditor: (this: unknown) => Promise<void>;
    }).revealPreviewEditor.call({
      workbenchSurfaces: {
        previewInput: {
          resource: { toString: () => "almostnode-preview:/workspace" },
        },
      },
    });

    expect(findEditors).toHaveBeenCalled();
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(openEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.anything(),
      }),
      { pinned: true },
    );
    expect(openEditor.mock.calls[0]).toHaveLength(2);
  });

  it("reuses the existing preview editor group when one is already open", async () => {
    const openEditor = vi.fn().mockResolvedValue(undefined);
    const previewInput = {
      resource: { toString: () => "almostnode-preview:/workspace" },
    };
    getServiceMock.mockResolvedValue({
      findEditors: vi.fn(() => [
        {
          groupId: 7,
          editor: {
            matches: (candidate: unknown) => candidate === previewInput,
          },
        },
      ]),
      openEditor,
    });

    await (WebIDEHost.prototype as unknown as {
      revealPreviewEditor: (this: unknown) => Promise<void>;
    }).revealPreviewEditor.call({
      workbenchSurfaces: {
        previewInput,
      },
    });

    expect(openEditor).toHaveBeenCalledWith(previewInput, { pinned: true }, 7);
  });

  it("reopens preview as the default editor when switching projects", async () => {
    const order: string[] = [];
    const initialTab = { id: "terminal-1" };
    const openWorkspaceFile = vi.fn();

    await (WebIDEHost.prototype as unknown as {
      reloadWorkbenchForNewProject: (
        this: unknown,
        newTemplateId: "vite" | "nextjs" | "tanstack",
        dbPrefix?: string,
      ) => Promise<void>;
    }).reloadWorkbenchForNewProject.call(
      {
        templateId: "vite",
        normalizeProjectDatabaseNamespace: vi.fn(
          (dbPrefix?: string) => dbPrefix ?? "global",
        ),
        container: {
          vfs: {
            existsSync: vi.fn(() => true),
          },
        },
        ensureGitInitialized: vi.fn(async () => {
          order.push("git");
        }),
        createUserTerminalTab: vi.fn((focus: boolean) => {
          order.push(`terminal:${String(focus)}`);
          return initialTab;
        }),
        updateTerminalStatus: vi.fn((tab: unknown, text: string) => {
          if (tab === initialTab) {
            order.push(`status:${text}`);
          }
        }),
        revealPreviewEditor: vi.fn(async () => {
          order.push("preview");
        }),
        updatePreviewStatus: vi.fn((text: string) => {
          order.push(`preview-status:${text}`);
        }),
        ensurePreviewServerRunning: vi.fn(() => {
          order.push("preview-start");
        }),
        schedulePreviewStartRetry: vi.fn(() => {
          order.push("preview-retry");
        }),
        initPGliteIfNeeded: vi.fn(() => {
          order.push("pglite");
          return Promise.resolve();
        }),
        openWorkspaceFile,
      },
      "nextjs",
    );

    expect(order).toEqual([
      "git",
      "terminal:false",
      "status:Idle",
      "preview",
      "preview-status:Waiting for a preview server",
      "preview-start",
      "preview-retry",
      "pglite",
    ]);
    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it("switches projects by replacing persisted files in place instead of remounting the workbench", async () => {
    const order: string[] = [];
    const vfs = {
      existsSync: vi.fn(() => true),
    };
    const host = Object.create(WebIDEHost.prototype) as Record<string, unknown>;
    host.templateId = "vite";
    host.currentProjectDatabaseNamespace = "project-a";
    host.previewPort = 3000;
    host.container = {
      vfs,
    };
    host.previewSurface = {
      setActiveDb: vi.fn(),
      clear: vi.fn(),
    };
    host.databaseSurface = {
      update: vi.fn(),
    };
    host.terminalTabs = new Map([["terminal-1", {}]]);
    host.abortRunningTerminalCommands = vi.fn(() => {
      order.push("abort");
    });
    host.clearScheduledPreviewStartRetry = vi.fn(() => {
      order.push("clear-preview-retry");
    });
    host.resetPreviewTerminalTab = vi.fn(() => {
      order.push("reset-preview-terminal");
    });
    host.waitForPreviewServerShutdown = vi.fn(async (port: number | null) => {
      order.push(`wait-preview-stop:${String(port)}`);
    });
    host.closeCurrentProjectDatabase = vi.fn(async () => {
      order.push("close-db");
    });
    host.ensureGitInitialized = vi.fn(async () => {
      order.push("git");
    });
    host.createUserTerminalTab = vi.fn(() => {
      order.push("create-terminal");
      return { id: "terminal-2" };
    });
    host.updateTerminalStatus = vi.fn();
    host.revealPreviewEditor = vi.fn(async () => {
      order.push("preview");
    });
    host.updatePreviewStatus = vi.fn((text: string) => {
      order.push(`preview-status:${text}`);
    });
    host.ensurePreviewServerRunning = vi.fn(() => {
      order.push("preview-start");
    });
    host.schedulePreviewStartRetry = vi.fn(() => {
      order.push("preview-retry");
    });
    host.initPGliteIfNeeded = vi.fn(() => {
      order.push("pglite");
      return Promise.resolve();
    });

    const files = [
      {
        path: "/project/src/main.ts",
        contentBase64: "Y29uc29sZS5sb2coJ3N3aXRjaGVkJyk7Cg==",
      },
    ];

    await (host as unknown as {
      switchProjectWorkspace: (
        templateId: "vite" | "nextjs" | "tanstack",
        files: Array<{ path: string; contentBase64: string }>,
        dbPrefix?: string,
      ) => Promise<void>;
    }).switchProjectWorkspace("nextjs", files, "project-b");

    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledWith(vfs, files);
    expect(order).toEqual([
      "abort",
      "clear-preview-retry",
      "reset-preview-terminal",
      "wait-preview-stop:3000",
      "close-db",
      "git",
      "preview",
      "preview-status:Waiting for a preview server",
      "preview-start",
      "preview-retry",
      "pglite",
    ]);
    expect(host.templateId).toBe("nextjs");
    expect(host.currentProjectDatabaseNamespace).toBe("project-b");
    expect(host.createUserTerminalTab).not.toHaveBeenCalled();
  });

  it("reveals the browser AI panel and auto-starts sidebar OpenCode when no AI tab exists", async () => {
    const revealOpenCodeSidebarView = vi.fn().mockResolvedValue(undefined);
    const createOpenCodeSidebarTab = vi.fn();
    const setActiveAiSidebarTab = vi.fn();

    await (WebIDEHost.prototype as unknown as {
      revealOpenCodePanel: (this: unknown, focus: boolean) => Promise<void>;
    }).revealOpenCodePanel.call(
      {
        agentMode: "browser",
        revealOpenCodeSidebarView,
        createOpenCodeSidebarTab,
        activeOpenCodeSidebarTabId: null,
        hasAiSidebarTab: () => false,
        getFirstAiSidebarTabId: () => null,
        setActiveAiSidebarTab,
      },
      true,
    );

    expect(revealOpenCodeSidebarView).toHaveBeenCalledWith(true);
    expect(createOpenCodeSidebarTab).toHaveBeenCalledWith(true);
    expect(setActiveAiSidebarTab).not.toHaveBeenCalled();
  });

  it("launches Empty Terminal into the AI sidebar instead of the bottom terminal panel", async () => {
    const revealOpenCodeSidebarView = vi.fn().mockResolvedValue(undefined);
    const createAiSidebarTerminalTab = vi.fn();
    const revealTerminalPanel = vi.fn();
    const createUserTerminalTab = vi.fn();

    await (WebIDEHost.prototype as unknown as {
      launchAiSession: (
        this: unknown,
        kind: "opencode" | "terminal" | "claude",
      ) => Promise<void>;
    }).launchAiSession.call(
      {
        agentMode: "browser",
        revealOpenCodeSidebarView,
        createAiSidebarTerminalTab,
        revealTerminalPanel,
        createUserTerminalTab,
      },
      "terminal",
    );

    expect(revealOpenCodeSidebarView).toHaveBeenCalledWith(true);
    expect(createAiSidebarTerminalTab).toHaveBeenCalledWith(true);
    expect(revealTerminalPanel).not.toHaveBeenCalled();
    expect(createUserTerminalTab).not.toHaveBeenCalled();
  });

  it("reroutes typed opencode launches into the AI sidebar instead of running npx in the terminal", async () => {
    const sessionRun = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const launchAiSession = vi.fn().mockResolvedValue(undefined);
    const prepareForCommand = vi.fn().mockResolvedValue(true);
    const printPrompt = vi.fn();
    const updateTerminalStatus = vi.fn();
    const writeTerminal = vi.fn();

    const tab = {
      id: "terminal-1",
      title: "Terminal 1",
      terminal: { write: vi.fn() },
      fitAddon: {},
      session: {
        run: sessionRun,
      },
      currentLine: "",
      history: [],
      historyIndex: -1,
      runningAbortController: null,
      closable: true,
      kind: "user",
      inputMode: "managed",
      surface: "panel",
    };

    await (WebIDEHost.prototype as unknown as {
      runCommand: (
        this: unknown,
        tab: unknown,
        command: string,
        options?: { echoCommand?: boolean },
      ) => Promise<void>;
    }).runCommand.call(
      {
        agentMode: "browser",
        keychain: { prepareForCommand },
        launchAiSession,
        updateTerminalStatus,
        writeTerminal,
        printPrompt,
      },
      tab,
      "npx opencode-ai",
    );

    expect(launchAiSession).toHaveBeenCalledWith("opencode");
    expect(prepareForCommand).not.toHaveBeenCalled();
    expect(sessionRun).not.toHaveBeenCalled();
    expect(writeTerminal).toHaveBeenCalledWith(
      tab,
      "Launching OpenCode in the AI panel.\n",
    );
    expect(updateTerminalStatus).toHaveBeenCalledWith(
      tab,
      "OpenCode moved to AI panel",
    );
    expect(printPrompt).toHaveBeenCalled();
  });

  it("treats needs-login tailscale sessions as a login action and running sessions as logout", () => {
    const getAction = WebIDEHost.prototype as unknown as {
      getTailscaleSidebarAuthAction: (
        this: unknown,
        status: {
          provider: "tailscale";
          state: "needs-login" | "running";
          canLogout: boolean;
        },
      ) => "login:tailscale" | "logout:tailscale";
    };

    expect(
      getAction.getTailscaleSidebarAuthAction.call({}, {
        provider: "tailscale",
        state: "needs-login",
        canLogout: false,
      }),
    ).toBe("login:tailscale");
    expect(
      getAction.getTailscaleSidebarAuthAction.call({}, {
        provider: "tailscale",
        state: "running",
        canLogout: false,
      }),
    ).toBe("logout:tailscale");
  });

  it("formats tailscale auth-required states with readable labels", () => {
    const formatStatus = WebIDEHost.prototype as unknown as {
      formatTailscaleStatus: (
        this: unknown,
        status: {
          state: "needs-login" | "needs-machine-auth";
          exitNodes: [];
          selectedExitNodeId: null;
        },
      ) => string;
    };

    expect(
      formatStatus.formatTailscaleStatus.call({}, {
        state: "needs-login",
        exitNodes: [],
        selectedExitNodeId: null,
      }),
    ).toBe("Needs login");
    expect(
      formatStatus.formatTailscaleStatus.call({}, {
        state: "needs-machine-auth",
        exitNodes: [],
        selectedExitNodeId: null,
      }),
    ).toBe("Needs machine auth");
  });
});
