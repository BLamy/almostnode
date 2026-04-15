import { Buffer } from "node:buffer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const getServiceMock = vi.fn();
const loadProjectFilesIntoVfsMock = vi.fn();
const replaceProjectFilesInVfsMock = vi.fn();
const collectScopedFilesBase64Mock = vi.fn();
const replaceScopedFilesInVfsMock = vi.fn();
const collectOpenCodeBrowserSnapshotMock = vi.fn();
const listOpenCodeBrowserSessionsMock = vi.fn();
const restoreOpenCodeBrowserSnapshotMock = vi.fn();
const readGhTokenMock = vi.fn();
const createModelReferenceMock = vi.fn();
const getModelMock = vi.fn();
const setModelLanguageMock = vi.fn();
const buildClaudeIdeMcpConfigMock = vi.fn((url: string) =>
  JSON.stringify({
    mcpServers: {
      ide: {
        type: "sse-ide",
        url,
        ideName: "almostnode Web IDE",
      },
    },
  }),
);

vi.mock("almostnode", () => ({
  createContainer: vi.fn(),
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
  collectOpenCodeBrowserSnapshot: collectOpenCodeBrowserSnapshotMock,
  listOpenCodeBrowserSessions: listOpenCodeBrowserSessionsMock,
  restoreOpenCodeBrowserSnapshot: restoreOpenCodeBrowserSnapshotMock,
}));
vi.mock("../src/features/claude-ide-bridge", () => ({
  buildClaudeIdeMcpConfig: buildClaudeIdeMcpConfigMock,
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
}, 60000);

beforeEach(() => {
  getServiceMock?.mockReset();
  loadProjectFilesIntoVfsMock.mockReset();
  replaceProjectFilesInVfsMock.mockReset();
  collectScopedFilesBase64Mock.mockReset();
  replaceScopedFilesInVfsMock.mockReset();
  collectOpenCodeBrowserSnapshotMock.mockReset();
  listOpenCodeBrowserSessionsMock.mockReset();
  restoreOpenCodeBrowserSnapshotMock.mockReset();
  readGhTokenMock.mockReset();
  createModelReferenceMock.mockReset();
  getModelMock.mockReset();
  setModelLanguageMock.mockReset();
  buildClaudeIdeMcpConfigMock.mockClear();
  createModelReferenceMock.mockResolvedValue({ dispose: vi.fn() });
  getModelMock.mockReturnValue(null);
  readGhTokenMock.mockReturnValue(null);
});

describe("WebIDEHost AI launcher behavior", () => {
  it("rechecks Tailscale keychain state after persisted session writes", async () => {
    const handleTailscaleKeychainTransition = vi.fn();
    const updateKeychainSurface = vi.fn();
    const updateAiLauncherSurface = vi.fn();

    (
      WebIDEHost.prototype as unknown as {
        handlePersistedTailscaleSessionChange: (this: {
          keychain?: object;
          handleTailscaleKeychainTransition: () => void;
          updateKeychainSurface: () => void;
          updateAiLauncherSurface: () => void;
        }) => void;
      }
    ).handlePersistedTailscaleSessionChange.call({
      keychain: {},
      handleTailscaleKeychainTransition,
      updateKeychainSurface,
      updateAiLauncherSurface,
    });

    await Promise.resolve();

    expect(handleTailscaleKeychainTransition).toHaveBeenCalledTimes(1);
    expect(updateKeychainSurface).toHaveBeenCalledTimes(1);
    expect(updateAiLauncherSurface).toHaveBeenCalledTimes(1);
  });

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

  it("injects the Claude IDE MCP config into launcher and resume commands", () => {
    const command = (
      WebIDEHost.prototype as unknown as {
        buildClaudeLaunchCommand: (
          this: {
            claudeIdeBridge: { getSseUrl(): string } | null;
            quoteShellArg(value: string): string;
            augmentClaudeLaunchCommand(command: string): string;
          },
          options?: { resumeToken?: string },
        ) => string;
      }
    ).buildClaudeLaunchCommand.call({
      claudeIdeBridge: {
        getSseUrl: () => "http://localhost/__virtual__/43127/sse",
      },
      quoteShellArg(value: string): string {
        return `'${value}'`;
      },
      augmentClaudeLaunchCommand:
        (
          WebIDEHost.prototype as unknown as {
            augmentClaudeLaunchCommand: (
              this: {
                claudeIdeBridge: { getSseUrl(): string } | null;
                quoteShellArg(value: string): string;
              },
              command: string,
            ) => string;
          }
        ).augmentClaudeLaunchCommand,
    }, {
      resumeToken: "resume-123",
    });

    expect(buildClaudeIdeMcpConfigMock).toHaveBeenCalledWith(
      "http://localhost/__virtual__/43127/sse",
    );
    expect(command).toContain(
      "--mcp-config '{\"mcpServers\":{\"ide\":{\"type\":\"sse-ide\",\"url\":\"http://localhost/__virtual__/43127/sse\",\"ideName\":\"almostnode Web IDE\"}}}'",
    );
    expect(command).toContain("--resume 'resume-123'");
    expect(command.match(/--mcp-config/g)).toHaveLength(1);
  });

  it("opens preview-selected source files in the text editor at the resolved line", async () => {
    const openEditor = vi.fn().mockResolvedValue(undefined);
    const setSelection = vi.fn();
    const revealPositionNearTop = vi.fn();
    getServiceMock.mockResolvedValue({
      openEditor,
      activeTextEditorControl: {
        getModel: () => ({
          uri: { path: "/project/src/pages/Home.tsx" },
        }),
        setSelection,
        revealPositionNearTop,
      },
    });

    await (WebIDEHost.prototype as unknown as {
      openWorkspaceFileAsText: (
        this: unknown,
        path: string,
        lineNumber?: number | null,
      ) => Promise<void>;
    }).openWorkspaceFileAsText.call({}, "/project/src/pages/Home.tsx", 42);

    expect(openEditor).toHaveBeenCalledWith({
      resource: expect.objectContaining({
        path: "/project/src/pages/Home.tsx",
      }),
      options: {
        pinned: true,
        selection: {
          startLineNumber: 42,
          startColumn: 1,
          endLineNumber: 42,
          endColumn: 1,
        },
      },
    });
    expect(createModelReferenceMock).toHaveBeenCalled();
    expect(setSelection).toHaveBeenCalledWith(
      {
        startLineNumber: 42,
        startColumn: 1,
        endLineNumber: 42,
        endColumn: 1,
      },
      "almostnode.preview-source-picker",
    );
    expect(revealPositionNearTop).toHaveBeenCalledWith({
      lineNumber: 42,
      column: 1,
    });
  });

  it("opens text editors at the requested line and column", async () => {
    const openEditor = vi.fn().mockResolvedValue(undefined);
    const setSelection = vi.fn();
    const revealPositionNearTop = vi.fn();
    getServiceMock.mockResolvedValue({
      openEditor,
      activeTextEditorControl: {
        getModel: () => ({
          uri: { path: "/project/src/pages/Home.tsx" },
        }),
        setSelection,
        revealPositionNearTop,
      },
    });

    await (WebIDEHost.prototype as unknown as {
      openWorkspaceFileAsText: (
        this: unknown,
        path: string,
        lineNumber?: number | null,
        columnNumber?: number | null,
      ) => Promise<void>;
    }).openWorkspaceFileAsText.call({}, "/project/src/pages/Home.tsx", 42, 7);

    expect(openEditor).toHaveBeenCalledWith({
      resource: expect.objectContaining({
        path: "/project/src/pages/Home.tsx",
      }),
      options: {
        pinned: true,
        selection: {
          startLineNumber: 42,
          startColumn: 7,
          endLineNumber: 42,
          endColumn: 7,
        },
      },
    });
    expect(setSelection).toHaveBeenCalledWith(
      {
        startLineNumber: 42,
        startColumn: 7,
        endLineNumber: 42,
        endColumn: 7,
      },
      "almostnode.preview-source-picker",
    );
    expect(revealPositionNearTop).toHaveBeenCalledWith({
      lineNumber: 42,
      column: 7,
    });
  });

  it("resolves and opens webide-open targets inside the workspace", async () => {
    const openWorkspaceTargetInEditor = vi.fn().mockResolvedValue(undefined);
    const host = {
      container: {
        vfs: {
          existsSync: vi.fn(() => true),
          statSync: vi.fn(() => ({
            isDirectory: () => false,
          })),
        },
      },
      openWorkspaceTargetInEditor,
    };

    const target = await (
      WebIDEHost.prototype as unknown as {
        runWebIdeOpenCommand: (
          this: unknown,
          rawTarget: string,
          cwd: string,
        ) => Promise<{
          path: string;
          line?: number;
          column?: number;
        }>;
      }
    ).runWebIdeOpenCommand.call(host, "src/app.tsx:12:4", "/project");

    expect(target).toEqual({
      path: "/project/src/app.tsx",
      line: 12,
      column: 4,
    });
    expect(openWorkspaceTargetInEditor).toHaveBeenCalledWith(target);
  });

  it("rejects webide-open targets that resolve to directories", async () => {
    const host = {
      container: {
        vfs: {
          existsSync: vi.fn(() => true),
          statSync: vi.fn(() => ({
            isDirectory: () => true,
          })),
        },
      },
      openWorkspaceTargetInEditor: vi.fn(),
    };

    await expect(
      (
        WebIDEHost.prototype as unknown as {
          runWebIdeOpenCommand: (
            this: unknown,
            rawTarget: string,
            cwd: string,
          ) => Promise<unknown>;
        }
      ).runWebIdeOpenCommand.call(host, "src", "/project"),
    ).rejects.toThrow(
      "webide-open only supports files, not directories: /project/src",
    );
  });

  it("normalizes preview-selected source paths before opening them", async () => {
    const openWorkspaceFileAsText = vi.fn().mockResolvedValue(undefined);
    const updatePreviewStatus = vi.fn();
    const host = {
      container: {
        vfs: {
          existsSync: vi.fn(() => true),
        },
      },
      normalizePreviewSourcePath: (
        WebIDEHost.prototype as unknown as {
          normalizePreviewSourcePath: (
            this: unknown,
            sourcePath: string,
          ) => string | null;
        }
      ).normalizePreviewSourcePath,
      openWorkspaceFileAsText,
      updatePreviewStatus,
    };

    const opened = await (
      WebIDEHost.prototype as unknown as {
        openWorkspaceLocation: (
          this: unknown,
          sourcePath: string,
          lineNumber?: number | null,
          columnNumber?: number | null,
        ) => Promise<boolean>;
      }
    ).openWorkspaceLocation.call(
      host,
      "http://localhost:3000/src/pages/Home.tsx?t=171234",
      18,
      6,
    );

    expect(opened).toBe(true);
    expect(openWorkspaceFileAsText).toHaveBeenCalledWith(
      "/project/src/pages/Home.tsx",
      18,
      6,
    );
    expect(updatePreviewStatus).not.toHaveBeenCalled();
  });

  it("strips dev-server port prefixes from preview-selected source paths", async () => {
    const normalizePreviewSourcePath = (
      WebIDEHost.prototype as unknown as {
        normalizePreviewSourcePath: (
          this: unknown,
          sourcePath: string,
        ) => string | null;
      }
    ).normalizePreviewSourcePath;

    expect(
      normalizePreviewSourcePath.call({}, "3000/src/pages/Home.tsx"),
    ).toBe("/project/src/pages/Home.tsx");
    expect(
      normalizePreviewSourcePath.call(
        {},
        "localhost:3000/src/pages/Home.tsx",
      ),
    ).toBe("/project/src/pages/Home.tsx");
    expect(
      normalizePreviewSourcePath.call(
        {},
        "/__virtual__/3000/src/pages/Home.tsx",
      ),
    ).toBe("/project/src/pages/Home.tsx");
  });

  it("surfaces missing preview-selected source files without opening an editor", async () => {
    const openWorkspaceFileAsText = vi.fn().mockResolvedValue(undefined);
    const updatePreviewStatus = vi.fn();
    const host = {
      container: {
        vfs: {
          existsSync: vi.fn(() => false),
        },
      },
      normalizePreviewSourcePath: (
        WebIDEHost.prototype as unknown as {
          normalizePreviewSourcePath: (
            this: unknown,
            sourcePath: string,
          ) => string | null;
        }
      ).normalizePreviewSourcePath,
      openWorkspaceFileAsText,
      updatePreviewStatus,
    };

    const opened = await (
      WebIDEHost.prototype as unknown as {
        openWorkspaceLocation: (
          this: unknown,
          sourcePath: string,
          lineNumber?: number | null,
        ) => Promise<boolean>;
      }
    ).openWorkspaceLocation.call(host, "src/pages/Missing.tsx", 7);

    expect(opened).toBe(false);
    expect(openWorkspaceFileAsText).not.toHaveBeenCalled();
    expect(updatePreviewStatus).toHaveBeenCalledWith(
      "Resolved source is missing: /project/src/pages/Missing.tsx",
    );
  });

  it("intercepts pasted image clipboard data in browser Claude terminals", async () => {
    const terminalRoot = document.createElement("div");
    const showClaudeImagePasteUnsupportedError = vi
      .fn()
      .mockResolvedValue(undefined);
    const host = {
      agentMode: "browser",
      claudeImagePasteCleanup: new Map<string, () => void>(),
      showClaudeImagePasteUnsupportedError,
      disposeClaudeImagePasteGuard(id: string): void {
        (
          WebIDEHost.prototype as unknown as {
            disposeClaudeImagePasteGuard: (this: unknown, targetId: string) => void;
          }
        ).disposeClaudeImagePasteGuard.call(this, id);
      },
    };
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const tab = {
      id: "claude-sidebar-1",
      terminal: {
        element: terminalRoot,
      },
      agentHarness: "claude",
    };

    try {
      (
        WebIDEHost.prototype as unknown as {
          installClaudeImagePasteGuard: (
            this: unknown,
            tab: {
              id: string;
              terminal: { element: HTMLElement | null };
              agentHarness: "claude" | "opencode" | null;
            },
          ) => void;
        }
      ).installClaudeImagePasteGuard.call(host, tab);

      const pasteEvent = new window.Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, "clipboardData", {
        configurable: true,
        value: {
          items: [
            { kind: "file", type: "image/png" },
            { kind: "string", type: "text/plain" },
          ],
        },
      });

      terminalRoot.dispatchEvent(pasteEvent);

      expect(pasteEvent.defaultPrevented).toBe(true);
      expect(showClaudeImagePasteUnsupportedError).toHaveBeenCalledWith([
        "image/png",
      ]);
      expect(consoleWarn).toHaveBeenCalledWith(
        "[claude-image-paste]",
        expect.objectContaining({
          tabId: "claude-sidebar-1",
          mimeTypes: ["image/png"],
        }),
      );

      (
        WebIDEHost.prototype as unknown as {
          disposeClaudeImagePasteGuard: (this: unknown, id: string) => void;
        }
      ).disposeClaudeImagePasteGuard.call(host, "claude-sidebar-1");

      const secondPasteEvent = new window.Event("paste", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(secondPasteEvent, "clipboardData", {
        configurable: true,
        value: {
          items: [{ kind: "file", type: "image/png" }],
        },
      });

      terminalRoot.dispatchEvent(secondPasteEvent);
      expect(showClaudeImagePasteUnsupportedError).toHaveBeenCalledTimes(1);
      expect(secondPasteEvent.defaultPrevented).toBe(false);
    } finally {
      consoleWarn.mockRestore();
    }
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
        defaultDatabaseName?: string,
      ) => Promise<void>;
    }).reloadWorkbenchForNewProject.call(
      {
        templateId: "vite",
        normalizeProjectDatabaseNamespace: vi.fn(
          (dbPrefix?: string) => dbPrefix ?? "global",
        ),
        normalizeProjectDefaultDatabaseName: vi.fn(
          (defaultDatabaseName?: string) => defaultDatabaseName ?? "default",
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
        resumePendingProjectLaunch: vi.fn(() => {
          order.push("resume-project-launch");
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
      "resume-project-launch",
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
      setSelectActive: vi.fn(),
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
        defaultDatabaseName?: string,
      ) => Promise<void>;
    }).switchProjectWorkspace("nextjs", files, "project-b");

    expect(replaceProjectFilesInVfsMock).toHaveBeenCalledWith(vfs, files, {
      includeGit: true,
    });
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

  it("starts deferred project launch when restoring a project context", async () => {
    const order: string[] = [];
    const host = Object.create(WebIDEHost.prototype) as Record<string, unknown>;
    host.templateId = "vite";
    host.pendingProjectLaunch = true;
    host.previewUrl = null;
    host.previewStartRequested = false;
    host.currentProjectDatabaseNamespace = "global";
    host.currentProjectDefaultDatabaseName = "default";
    host.closeCurrentProjectDatabase = vi.fn(async () => {
      order.push("close-db");
    });
    host.initPGliteIfNeeded = vi.fn(() => {
      order.push("pglite");
      return Promise.resolve();
    });
    host.revealPreviewEditor = vi.fn(async () => {
      order.push("preview");
    });
    host.updatePreviewStatus = vi.fn((text: string) => {
      order.push(`preview-status:${text}`);
    });
    host.ensurePreviewServerRunning = vi.fn(() => {
      order.push("preview-start");
      host.previewStartRequested = true;
    });
    host.schedulePreviewStartRetry = vi.fn(() => {
      order.push("preview-retry");
    });
    host.revealOpenCodePanel = vi.fn(async (focus: boolean) => {
      order.push(`opencode:${String(focus)}`);
    });

    await (host as unknown as {
      attachProjectContext: (
        templateId: "vite" | "nextjs" | "tanstack",
        dbPrefix?: string,
        defaultDatabaseName?: string,
      ) => Promise<void>;
    }).attachProjectContext("nextjs", "project-b", "project-b");

    expect(order).toEqual([
      "close-db",
      "pglite",
      "preview",
      "preview-status:Waiting for a preview server",
      "preview-start",
      "preview-retry",
      "opencode:false",
    ]);
    expect(host.templateId).toBe("nextjs");
    expect(host.currentProjectDatabaseNamespace).toBe("project-b");
    expect(host.currentProjectDefaultDatabaseName).toBe("project-b");
    expect(host.pendingProjectLaunch).toBe(false);
  });

  it("reopens OpenCode when switching into the first project after an empty state", async () => {
    const order: string[] = [];
    const vfs = {
      existsSync: vi.fn(() => true),
    };
    const host = Object.create(WebIDEHost.prototype) as Record<string, unknown>;
    host.templateId = "vite";
    host.pendingProjectLaunch = true;
    host.currentProjectDatabaseNamespace = "global";
    host.previewPort = null;
    host.previewUrl = null;
    host.previewStartRequested = false;
    host.container = {
      vfs,
    };
    host.previewSurface = {
      setActiveDb: vi.fn(),
      clear: vi.fn(),
      setSelectActive: vi.fn(),
    };
    host.databaseSurface = {
      update: vi.fn(),
    };
    host.terminalTabs = new Map([["terminal-1", {}]]);
    host.abortRunningTerminalCommands = vi.fn();
    host.clearScheduledPreviewStartRetry = vi.fn();
    host.resetPreviewTerminalTab = vi.fn();
    host.waitForPreviewServerShutdown = vi.fn(async () => undefined);
    host.closeCurrentProjectDatabase = vi.fn(async () => undefined);
    host.ensureGitInitialized = vi.fn(async () => undefined);
    host.createUserTerminalTab = vi.fn();
    host.updateTerminalStatus = vi.fn();
    host.revealPreviewEditor = vi.fn(async () => {
      order.push("preview");
    });
    host.updatePreviewStatus = vi.fn((text: string) => {
      order.push(`preview-status:${text}`);
    });
    host.ensurePreviewServerRunning = vi.fn(() => {
      order.push("preview-start");
      host.previewStartRequested = true;
    });
    host.schedulePreviewStartRetry = vi.fn(() => {
      order.push("preview-retry");
    });
    host.initPGliteIfNeeded = vi.fn(() => {
      order.push("pglite");
      return Promise.resolve();
    });
    host.revealOpenCodePanel = vi.fn(async (focus: boolean) => {
      order.push(`opencode:${String(focus)}`);
    });

    await (host as unknown as {
      switchProjectWorkspace: (
        templateId: "vite" | "nextjs" | "tanstack",
        files: Array<{ path: string; contentBase64: string }>,
        dbPrefix?: string,
        defaultDatabaseName?: string,
      ) => Promise<void>;
    }).switchProjectWorkspace("nextjs", [], "project-b");

    expect(order).toEqual([
      "preview",
      "preview-status:Waiting for a preview server",
      "preview-start",
      "preview-retry",
      "pglite",
      "opencode:false",
    ]);
    expect(host.pendingProjectLaunch).toBe(false);
  });

  it("initializes project git with git add . and restores the configured origin", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 2,
        stdout: "",
        stderr: "error: No such remote: 'origin'\n",
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    const host = {
      container: {
        vfs: {
          existsSync: vi.fn(() => false),
        },
        run,
      },
      runRequiredCommand: WebIDEHost.prototype["runRequiredCommand"],
      runWorkspaceGitCommand: WebIDEHost.prototype["runWorkspaceGitCommand"],
      ensureProjectRemote: WebIDEHost.prototype["ensureProjectRemote"],
      quoteShellArg: WebIDEHost.prototype["quoteShellArg"],
    };

    await (WebIDEHost.prototype as unknown as {
      ensureGitInitialized: (
        this: typeof host,
        project?: {
          gitRemote?: {
            name: string;
            url: string;
          };
        },
      ) => Promise<void>;
    }).ensureGitInitialized.call(host, {
      gitRemote: {
        name: "origin",
        url: "https://github.com/example/demo.git",
      },
    });

    expect(run.mock.calls.map(([command]) => command)).toEqual([
      "git init",
      "git add .",
      'git commit -m "Initial commit"',
      "git remote get-url 'origin'",
      "git remote add 'origin' 'https://github.com/example/demo.git'",
    ]);
  });

  it("creates a private GitHub remote configuration for new projects", async () => {
    readGhTokenMock.mockReturnValue({
      oauth_token: "gho_test",
      user: "octocat",
      git_protocol: "https",
    });

    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          clone_url: "https://github.com/octocat/demo-app.git",
          full_name: "octocat/demo-app",
          html_url: "https://github.com/octocat/demo-app",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    Object.assign(globalThis, { fetch: fetchMock });

    try {
      const host = {
        container: { vfs: {} },
        getGitHubAuthToken: WebIDEHost.prototype["getGitHubAuthToken"],
        toGitHubRepositoryName: WebIDEHost.prototype["toGitHubRepositoryName"],
        fetchGitHubApi: WebIDEHost.prototype["fetchGitHubApi"],
        resolveGitHubCorsProxy: vi.fn(() => null),
      };

      const remote = await (WebIDEHost.prototype as unknown as {
        createGitHubRemote: (
          this: typeof host,
          projectName: string,
        ) => Promise<{
          name: string;
          url: string;
          provider?: string;
          repositoryFullName?: string;
          repositoryUrl?: string;
        }>;
      }).createGitHubRemote.call(host, "Demo App");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "demo-app",
            private: true,
          }),
        }),
      );
      expect(remote).toEqual({
        name: "origin",
        url: "https://github.com/octocat/demo-app.git",
        provider: "github",
        repositoryFullName: "octocat/demo-app",
        repositoryUrl: "https://github.com/octocat/demo-app",
      });
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
    }
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
      "npx opencode-ai --continue --session ses_123",
    );

    expect(launchAiSession).toHaveBeenCalledWith("opencode", {
      args: {
        continue: true,
        sessionID: "ses_123",
      },
    });
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

  it("normalizes explicit OpenCode resume sessions before creating a sidebar tab", async () => {
    const revealOpenCodeSidebarView = vi.fn().mockResolvedValue(undefined);
    const createOpenCodeSidebarTab = vi.fn().mockResolvedValue(undefined);

    await (WebIDEHost.prototype as unknown as {
      launchAiSession: (
        this: unknown,
        kind: "opencode" | "terminal" | "claude",
        options?: {
          title?: string;
          args?: {
            continue?: boolean;
            sessionID?: string;
            fork?: boolean;
          };
        },
      ) => Promise<void>;
    }).launchAiSession.call(
      {
        agentMode: "browser",
        revealOpenCodeSidebarView,
        createOpenCodeSidebarTab,
        normalizeOpenCodeSidebarArgs: WebIDEHost.prototype["normalizeOpenCodeSidebarArgs"],
        createAiSidebarTerminalTab: vi.fn(),
        revealTerminalPanel: vi.fn(),
        createUserTerminalTab: vi.fn(),
        getClaudeLauncherAvailable: vi.fn(() => true),
      },
      "opencode",
      {
        title: "Resume OpenCode",
        args: {
          continue: true,
          sessionID: "ses_123",
        },
      },
    );

    expect(revealOpenCodeSidebarView).toHaveBeenCalledWith(true);
    expect(createOpenCodeSidebarTab).toHaveBeenCalledWith(true, {
      title: "Resume OpenCode",
      args: {
        sessionID: "ses_123",
      },
    });
  });

  it("opens a fresh AI sidebar tab and runs the literal Claude resume command", async () => {
    const revealOpenCodeSidebarView = vi.fn().mockResolvedValue(undefined);
    const createAiSidebarTerminalTab = vi.fn(() => ({ id: "ai-sidebar-1" }));
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const buildClaudeLaunchCommand = vi.fn(
      () =>
        "/usr/local/bin/claude-wrapper --plugin-dir '/project/.claude-plugin' --resume 'session-1'",
    );

    await (WebIDEHost.prototype as unknown as {
      resumeResumableThread: (
        this: unknown,
        thread: {
          id: string;
          projectId: string;
          harness: "claude" | "opencode";
          title: string;
          resumeToken: string;
          createdAt: number;
          updatedAt: number;
        },
      ) => Promise<void>;
    }).resumeResumableThread.call(
      {
        revealOpenCodeSidebarView,
        createAiSidebarTerminalTab,
        buildClaudeLaunchCommand,
        runCommand,
        claudeSidebarCounter: 0,
        openCodeSidebarTerminalCounter: 0,
      },
      {
        id: "claude:project-1:session-1",
        projectId: "project-1",
        harness: "claude",
        title: "Fix Claude restore",
        resumeToken: "session-1",
        createdAt: 1,
        updatedAt: 2,
      },
    );

    expect(revealOpenCodeSidebarView).toHaveBeenCalledWith(true);
    expect(createAiSidebarTerminalTab).toHaveBeenCalledWith(true, {
      id: expect.stringMatching(/^claude-sidebar-/),
      title: "Fix Claude restore",
      agentHarness: "claude",
    });
    expect(buildClaudeLaunchCommand).toHaveBeenCalledWith({
      resumeToken: "session-1",
    });
    expect(runCommand).toHaveBeenCalledWith(
      { id: "ai-sidebar-1" },
      "/usr/local/bin/claude-wrapper --plugin-dir '/project/.claude-plugin' --resume 'session-1'",
      {
        echoCommand: true,
        interceptAgentLaunch: false,
      },
    );
  });

  it("resumes OpenCode threads directly into the OpenCode AI panel", async () => {
    const launchAiSession = vi.fn().mockResolvedValue(undefined);

    await (WebIDEHost.prototype as unknown as {
      resumeResumableThread: (
        this: unknown,
        thread: {
          id: string;
          projectId: string;
          harness: "claude" | "opencode";
          title: string;
          resumeToken: string;
          createdAt: number;
          updatedAt: number;
        },
      ) => Promise<void>;
    }).resumeResumableThread.call(
      {
        launchAiSession,
        claudeSidebarCounter: 0,
        openCodeSidebarTerminalCounter: 0,
      },
      {
        id: "opencode:project-1:session-1",
        projectId: "project-1",
        harness: "opencode",
        title: "Resume OpenCode",
        resumeToken: "ses_123",
        createdAt: 1,
        updatedAt: 2,
      },
    );

    expect(launchAiSession).toHaveBeenCalledWith("opencode", {
      title: "Resume OpenCode",
      args: {
        sessionID: "ses_123",
      },
    });
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
      formatStatus.formatTailscaleStatus.call(
        {
          getRequestedTailscaleExitNodeId: () => null,
        },
        {
          state: "needs-login",
          exitNodes: [],
          selectedExitNodeId: null,
        },
      ),
    ).toBe("Needs login");
    expect(
      formatStatus.formatTailscaleStatus.call(
        {
          getRequestedTailscaleExitNodeId: () => null,
        },
        {
          state: "needs-machine-auth",
          exitNodes: [],
          selectedExitNodeId: null,
        },
      ),
    ).toBe("Needs machine auth");
  });

  it("formats a requested tailscale exit node while runtime confirmation is pending", () => {
    const formatStatus = WebIDEHost.prototype as unknown as {
      formatTailscaleStatus: (
        this: {
          getRequestedTailscaleExitNodeId: () => string | null;
        },
        status: {
          state: "running";
          dnsEnabled: boolean;
          dnsHealthy: boolean | null;
          exitNodes: Array<{
            id: string;
            name: string;
          }>;
          selectedExitNodeId: string | null;
        },
      ) => string;
    };

    expect(
      formatStatus.formatTailscaleStatus.call(
        {
          getRequestedTailscaleExitNodeId: () => "node-self",
        },
        {
          state: "running",
          dnsEnabled: true,
          dnsHealthy: null,
          exitNodes: [
            {
              id: "node-self",
              name: "bretts-macbook-air",
            },
          ],
          selectedExitNodeId: null,
        },
      ),
    ).toBe("Running, selecting bretts-macbook-air");
  });

  it("treats unconfigured AWS as a setup action with helper copy", () => {
    const buildSlot = WebIDEHost.prototype as unknown as {
      buildAwsSidebarSlotStatus: (
        this: unknown,
        summary: {
          hasConfig: boolean;
          hasProfiles: boolean;
          hasSsoSessions: boolean;
          hasAuth: boolean;
          hasValidAccessToken: boolean;
          hasValidRoleCredentials: boolean;
          defaultProfile: string | null;
          profileNames: string[];
          sessionNames: string[];
        },
        config: {
          version: number;
          defaultProfile: string | null;
          ssoSessions: Record<string, unknown>;
          profiles: Record<string, unknown>;
        },
        auth: {
          version: number;
          clients: Record<string, unknown>;
          sessions: Record<string, unknown>;
          roleCredentials: Record<string, unknown>;
        },
      ) => {
        active: boolean;
        authAction?: string;
        authLabel?: string;
        statusText?: string;
        statusDetail?: string;
      };
    };

    expect(
      buildSlot.buildAwsSidebarSlotStatus.call(
        {},
        {
          hasConfig: false,
          hasProfiles: false,
          hasSsoSessions: false,
          hasAuth: false,
          hasValidAccessToken: false,
          hasValidRoleCredentials: false,
          defaultProfile: null,
          profileNames: [],
          sessionNames: [],
        },
        {
          version: 1,
          defaultProfile: null,
          ssoSessions: {},
          profiles: {},
        },
        {
          version: 1,
          clients: {},
          sessions: {},
          roleCredentials: {},
        },
      ),
    ).toMatchObject({
      active: false,
      authAction: "setup:aws",
      authLabel: "Set up AWS",
      statusText: "Setup required",
      statusDetail: "Add your AWS access portal and region before signing in.",
    });
  });

  it("distinguishes ready, expired, and signed-in AWS states", () => {
    const buildSlot = WebIDEHost.prototype as unknown as {
      buildAwsSidebarSlotStatus: (
        this: unknown,
        summary: {
          hasConfig: boolean;
          hasProfiles: boolean;
          hasSsoSessions: boolean;
          hasAuth: boolean;
          hasValidAccessToken: boolean;
          hasValidRoleCredentials: boolean;
          defaultProfile: string | null;
          profileNames: string[];
          sessionNames: string[];
        },
        config: {
          version: number;
          defaultProfile: string | null;
          ssoSessions: Record<string, unknown>;
          profiles: Record<string, unknown>;
        },
        auth: {
          version: number;
          clients: Record<string, unknown>;
          sessions: Record<string, unknown>;
          roleCredentials: Record<string, unknown>;
        },
      ) => {
        active: boolean;
        authAction?: string;
        authLabel?: string;
        statusText?: string;
      };
    };

    const config = {
      version: 1,
      defaultProfile: null,
      ssoSessions: {
        default: {
          startUrl: "https://example.awsapps.com/start",
          region: "us-east-1",
          registrationScopes: ["sso:account:access"],
        },
      },
      profiles: {},
    };

    expect(
      buildSlot.buildAwsSidebarSlotStatus.call(
        {},
        {
          hasConfig: true,
          hasProfiles: false,
          hasSsoSessions: true,
          hasAuth: false,
          hasValidAccessToken: false,
          hasValidRoleCredentials: false,
          defaultProfile: null,
          profileNames: [],
          sessionNames: ["default"],
        },
        config,
        {
          version: 1,
          clients: {},
          sessions: {},
          roleCredentials: {},
        },
      ),
    ).toMatchObject({
      active: false,
      authAction: "login:aws",
      authLabel: "Login",
      statusText: "Ready to sign in",
    });

    expect(
      buildSlot.buildAwsSidebarSlotStatus.call(
        {},
        {
          hasConfig: true,
          hasProfiles: false,
          hasSsoSessions: true,
          hasAuth: true,
          hasValidAccessToken: false,
          hasValidRoleCredentials: false,
          defaultProfile: null,
          profileNames: [],
          sessionNames: ["default"],
        },
        config,
        {
          version: 1,
          clients: {},
          sessions: {
            default: { accessToken: "expired" },
          },
          roleCredentials: {},
        },
      ),
    ).toMatchObject({
      active: false,
      authAction: "login:aws",
      authLabel: "Re-authenticate",
      statusText: "Session expired",
    });

    expect(
      buildSlot.buildAwsSidebarSlotStatus.call(
        {},
        {
          hasConfig: true,
          hasProfiles: false,
          hasSsoSessions: true,
          hasAuth: true,
          hasValidAccessToken: true,
          hasValidRoleCredentials: false,
          defaultProfile: null,
          profileNames: [],
          sessionNames: ["default"],
        },
        config,
        {
          version: 1,
          clients: {},
          sessions: {
            default: { accessToken: "token" },
          },
          roleCredentials: {},
        },
      ),
    ).toMatchObject({
      active: true,
      authAction: "logout:aws",
      authLabel: "Logout",
      statusText: "Signed in via default",
    });
  });
});
