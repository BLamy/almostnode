import { beforeEach, describe, expect, it, vi } from "vitest";

const disposeMock = vi.fn();
const createContainerMock = vi.fn((_options: unknown) => ({
  id: "container-1",
  dispose: disposeMock,
}));

vi.mock("@agent-wasm/core", () => ({
  createContainer: (options: unknown) => createContainerMock(options),
}));

import { SandboxSession } from "../src/workbench/sandbox-session";

describe("SandboxSession", () => {
  beforeEach(() => {
    createContainerMock.mockClear();
    disposeMock.mockClear();
  });

  it("creates its container from the provided options", () => {
    const createContainerOptions = { cwd: "/project", baseUrl: "/base" };
    const session = new SandboxSession({
      id: "sandbox-a",
      templateId: "vite",
      createContainerOptions,
    });

    expect(createContainerMock).toHaveBeenCalledTimes(1);
    expect(createContainerMock).toHaveBeenCalledWith(createContainerOptions);
    expect(session.id).toBe("sandbox-a");
    expect(session.templateId).toBe("vite");
    expect(session.container).toEqual({
      id: "container-1",
      dispose: disposeMock,
    });
  });

  it("initializes per-sandbox state with the same defaults the host used", () => {
    const session = new SandboxSession({
      id: "sandbox-b",
      templateId: "nextjs",
      createContainerOptions: {},
    });

    expect(session.terminalTabs.size).toBe(0);
    expect(session.openCodeTabs.size).toBe(0);
    expect(session.openCodeSidebarTabs.size).toBe(0);
    expect(session.openCodeSidebarTerminalTabs.size).toBe(0);
    expect(session.activeTerminalTabId).toBeNull();
    expect(session.activeOpenCodeSidebarTabId).toBeNull();
    expect(session.previewTerminalTabId).toBeNull();
    expect(session.terminalCounter).toBe(0);
    expect(session.openCodeTerminalCounter).toBe(0);
    expect(session.openCodeSidebarCounter).toBe(0);
    expect(session.openCodeSidebarTerminalCounter).toBe(0);
    expect(session.claudeSidebarCounter).toBe(0);
    expect(session.codexSidebarCounter).toBe(0);
    expect(session.piSidebarCounter).toBe(0);
    expect(session.previewStartRequested).toBe(false);
    expect(session.previewPort).toBeNull();
    expect(session.previewUrl).toBeNull();
    expect(session.previewSourcePickerActive).toBe(false);
    expect(session.previewSourcePickerRuntime).toBeNull();
    expect(session.previewStartRetryTimeoutId).toBe(0);
    expect(session.appBuildingPreviewOpenedJobs.size).toBe(0);
    expect(session.currentAppBuildingPreviewUrl).toBeNull();
    expect(session.pgliteMiddleware).toBeNull();
    expect(session.currentProjectDatabaseNamespace).toBe("global");
    expect(session.currentProjectDefaultDatabaseName).toBe("default");
    expect(session.workspaceDependencyInstallPromise).toBeNull();
    expect(session.workspaceDependencyInstallKey).toBeNull();
    expect(session.workspaceDependencyInstallRequestKey).toBeNull();
    expect(session.claudeIdeBridge).toBeNull();
    expect(session.claudeImagePasteCleanup.size).toBe(0);
    expect(session.detachedTabBodies.size).toBe(0);
  });

  it("dispose() tears down the container", () => {
    const session = new SandboxSession({
      id: "sandbox-c",
      templateId: "vite",
      createContainerOptions: {},
    });

    session.dispose();

    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it("dispose() tears down tabs, TUIs, bridge, middleware, and parked DOM", () => {
    const session = new SandboxSession({
      id: "sandbox-d",
      templateId: "vite",
      createContainerOptions: {},
    });

    const terminalTab = {
      runningAbortController: { abort: vi.fn() },
      terminal: { dispose: vi.fn() },
      session: { dispose: vi.fn() },
    };
    const sidebarTerminalTab = {
      runningAbortController: null,
      terminal: { dispose: vi.fn() },
      session: { dispose: vi.fn() },
    };
    const openCodeTab = { session: { dispose: vi.fn() } };
    const sidebarTab = { session: null };
    session.terminalTabs.set("t1", terminalTab as never);
    session.openCodeSidebarTerminalTabs.set("t2", sidebarTerminalTab as never);
    session.openCodeTabs.set("oc1", openCodeTab as never);
    session.openCodeSidebarTabs.set("oc2", sidebarTab as never);
    session.detachedTabBodies.set("t1", {} as HTMLElement);

    const imageCleanup = vi.fn();
    session.claudeImagePasteCleanup.set("t1", imageCleanup);
    const bridge = { dispose: vi.fn() };
    session.claudeIdeBridge = bridge as never;
    const unregisterMiddleware = vi.fn();
    Object.assign(session.container, {
      serverBridge: { unregisterMiddleware },
    });
    const middleware = { id: "pglite" };
    session.pgliteMiddleware = middleware as never;

    session.dispose();

    expect(imageCleanup).toHaveBeenCalledTimes(1);
    expect(terminalTab.runningAbortController.abort).toHaveBeenCalled();
    expect(terminalTab.terminal.dispose).toHaveBeenCalled();
    expect(terminalTab.session.dispose).toHaveBeenCalled();
    expect(sidebarTerminalTab.terminal.dispose).toHaveBeenCalled();
    expect(sidebarTerminalTab.session.dispose).toHaveBeenCalled();
    expect(openCodeTab.session.dispose).toHaveBeenCalled();
    expect(bridge.dispose).toHaveBeenCalledTimes(1);
    expect(session.claudeIdeBridge).toBeNull();
    expect(unregisterMiddleware).toHaveBeenCalledWith(middleware);
    expect(session.pgliteMiddleware).toBeNull();
    expect(session.terminalTabs.size).toBe(0);
    expect(session.openCodeTabs.size).toBe(0);
    expect(session.openCodeSidebarTabs.size).toBe(0);
    expect(session.openCodeSidebarTerminalTabs.size).toBe(0);
    expect(session.detachedTabBodies.size).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it("dispose() is safe on detached state holders", () => {
    const session = SandboxSession.createDetached();

    expect(() => session.dispose()).not.toThrow();
    expect(disposeMock).not.toHaveBeenCalled();
  });

  it("createDetached() skips container creation and field initializers", () => {
    const session = SandboxSession.createDetached();

    expect(createContainerMock).not.toHaveBeenCalled();
    // Matches the plain-field semantics tests relied on before extraction:
    // unassigned state reads as undefined on Object.create-style instances.
    expect(session.container).toBeUndefined();
    expect(session.terminalTabs).toBeUndefined();
    expect(session.templateId).toBeUndefined();

    session.terminalTabs = new Map();
    session.previewPort = 3000;
    expect(session.terminalTabs.size).toBe(0);
    expect(session.previewPort).toBe(3000);
  });
});
