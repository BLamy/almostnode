import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

vi.mock("@codingame/monaco-vscode-api/vscode/vs/base/common/uri", () => ({
  URI: {
    from: (value: unknown) => value,
    file: (path: string) => ({ path, toString: () => path }),
  },
}));
vi.mock("@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle", () => ({
  DisposableStore: class {
    add<T>(value: T): T {
      return value;
    }
  },
  toDisposable: (fn: () => void) => ({ dispose: fn }),
}));
vi.mock("@codingame/monaco-vscode-workbench-service-override", () => ({
  EditorInputCapabilities: {},
  SimpleEditorInput: class {},
  SimpleEditorPane: class {},
  ViewContainerLocation: {},
  registerCustomView() {},
  registerEditorPane() {},
}));
vi.mock("@codingame/monaco-vscode-api/services", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {},
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {},
}));
vi.mock("fflate", () => ({
  strToU8: () => new Uint8Array(0),
  zipSync: () => new Uint8Array(0),
}));

let TerminalPanelSurface: typeof import("../src/workbench/workbench-surfaces").TerminalPanelSurface;
let OpenCodeTerminalSurface: typeof import("../src/workbench/workbench-surfaces").OpenCodeTerminalSurface;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Node: dom.window.Node,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  });

  ({ TerminalPanelSurface, OpenCodeTerminalSurface } = await import(
    "../src/workbench/workbench-surfaces"
  ));
});

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Mimics the xterm contract the surfaces rely on: open() can only run once
 * (it records the rendered element), and writes keep flowing into the buffer
 * while the element is detached from the document.
 */
class FakeTerminal {
  element: HTMLElement | undefined = undefined;
  openCalls = 0;
  cols = 80;
  rows = 24;
  buffer: string[] = [];
  refreshCalls: Array<[number, number]> = [];

  loadAddon(): void {}

  open(parent: HTMLElement): void {
    if (this.element) {
      throw new Error("Terminal already opened");
    }
    this.openCalls += 1;
    this.element = document.createElement("div");
    this.element.className = "xterm";
    parent.appendChild(this.element);
    this.element.textContent = this.buffer.join("");
  }

  write(data: string): void {
    this.buffer.push(data);
    if (this.element) {
      this.element.textContent = this.buffer.join("");
    }
  }

  focus(): void {}

  refresh(start: number, end: number): void {
    this.refreshCalls.push([start, end]);
  }

  scrollToBottom(): void {}
}

class FakeFitAddon {
  fitCalls = 0;

  fit(): void {
    this.fitCalls += 1;
  }
}

function asTerminal(terminal: FakeTerminal): Terminal {
  return terminal as unknown as Terminal;
}

function asFitAddon(fitAddon: FakeFitAddon): FitAddon {
  return fitAddon as unknown as FitAddon;
}

function stubClientSize(element: HTMLElement): void {
  Object.defineProperty(element, "clientWidth", {
    value: 320,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: 200,
    configurable: true,
  });
}

function mountTerminalSurface() {
  const surface = new TerminalPanelSurface({
    onCreateTab: () => {},
    onCloseTab: () => {},
    onSelectTab: () => {},
  });
  const container = document.createElement("div");
  surface.attach(container);
  document.body.appendChild(container);
  return { surface, container };
}

function mountOpenCodeSurface() {
  const surface = new OpenCodeTerminalSurface({
    onLaunch: () => {},
  });
  const container = document.createElement("div");
  surface.attach(container);
  document.body.appendChild(container);
  return { surface, container };
}

describe("TerminalPanelSurface detach/reattach", () => {
  it("detach returns the live body, removes the tab, and reattach reuses the same DOM without reopening xterm", () => {
    const { surface, container } = mountTerminalSurface();
    const terminal = new FakeTerminal();
    const fitAddon = new FakeFitAddon();

    surface.addTab({
      id: "t1",
      title: "Terminal 1",
      terminal: asTerminal(terminal),
      fitAddon: asFitAddon(fitAddon),
      closable: true,
    });
    surface.setActiveTab("t1");

    expect(terminal.openCalls).toBe(1);
    const renderedElement = terminal.element!;
    terminal.write("hello before detach");

    const body = surface.detachTab("t1");
    expect(body).not.toBeNull();
    expect(body!.contains(renderedElement)).toBe(true);
    expect(container.contains(body!)).toBe(false);
    expect(
      container.querySelector('button[data-terminal-id="t1"]'),
    ).toBeNull();

    // Output keeps flowing into the offscreen buffer while detached.
    terminal.write(" + while detached");

    surface.attachTab(
      {
        id: "t1",
        title: "Terminal 1",
        closable: true,
        terminal: asTerminal(terminal),
        fitAddon: asFitAddon(fitAddon),
      },
      body!,
    );

    expect(terminal.openCalls).toBe(1);
    expect(terminal.element).toBe(renderedElement);
    expect(container.contains(renderedElement)).toBe(true);
    expect(
      container.querySelector('button[data-terminal-id="t1"]'),
    ).not.toBeNull();
    expect(body!.textContent).toContain("hello before detach + while detached");
  });

  it("fits and refreshes the reattached terminal once it becomes active", () => {
    const { surface } = mountTerminalSurface();
    const terminal = new FakeTerminal();
    const fitAddon = new FakeFitAddon();

    surface.addTab({
      id: "t1",
      title: "Terminal 1",
      terminal: asTerminal(terminal),
      fitAddon: asFitAddon(fitAddon),
      closable: true,
    });
    surface.setActiveTab("t1");

    const body = surface.detachTab("t1")!;
    surface.attachTab(
      {
        id: "t1",
        title: "Terminal 1",
        closable: true,
        terminal: asTerminal(terminal),
        fitAddon: asFitAddon(fitAddon),
      },
      body,
    );

    stubClientSize(body);
    fitAddon.fitCalls = 0;
    terminal.refreshCalls = [];

    surface.setActiveTab("t1");

    expect(fitAddon.fitCalls).toBeGreaterThan(0);
    expect(terminal.refreshCalls).toContainEqual([0, terminal.rows - 1]);
  });

  it("restores a parked tab status on reattach so running commands keep their status", () => {
    const { surface, container } = mountTerminalSurface();
    const terminal = new FakeTerminal();
    const fitAddon = new FakeFitAddon();

    surface.addTab({
      id: "t1",
      title: "Terminal 1",
      terminal: asTerminal(terminal),
      fitAddon: asFitAddon(fitAddon),
      closable: true,
    });
    surface.setActiveTab("t1");
    surface.updateTabStatus("t1", "Running: node /project/server.js");

    const body = surface.detachTab("t1")!;
    // While detached, the surface idles (another session's tabs own it).
    expect(
      container.querySelector("#webideTerminalStatus")?.textContent,
    ).toBe("Idle");

    surface.attachTab(
      {
        id: "t1",
        title: "Terminal 1",
        closable: true,
        terminal: asTerminal(terminal),
        fitAddon: asFitAddon(fitAddon),
      },
      body,
    );
    surface.setActiveTab("t1");

    expect(
      container.querySelector("#webideTerminalStatus")?.textContent,
    ).toBe("Running: node /project/server.js");
  });

  it("activates another tab when the active tab is detached, and empties cleanly", () => {
    const { surface, container } = mountTerminalSurface();
    const terminalA = new FakeTerminal();
    const terminalB = new FakeTerminal();

    surface.addTab({
      id: "a",
      title: "A",
      terminal: asTerminal(terminalA),
      fitAddon: asFitAddon(new FakeFitAddon()),
      closable: true,
    });
    surface.addTab({
      id: "b",
      title: "B",
      terminal: asTerminal(terminalB),
      fitAddon: asFitAddon(new FakeFitAddon()),
      closable: true,
    });
    surface.setActiveTab("a");

    surface.detachTab("a");

    const buttonB = container.querySelector('button[data-terminal-id="b"]');
    expect(buttonB?.classList.contains("is-active")).toBe(true);

    surface.detachTab("b");
    expect(
      container.querySelector(".almostnode-terminal-surface__tab"),
    ).toBeNull();
    expect(
      container.querySelector("#webideTerminalStatus")?.textContent,
    ).toBe("Idle");
  });

  it("returns null for unknown tabs", () => {
    const { surface } = mountTerminalSurface();
    expect(surface.detachTab("missing")).toBeNull();
  });
});

describe("OpenCodeTerminalSurface detach/reattach", () => {
  it("detaches and reattaches an xterm tab without reopening", () => {
    const { surface, container } = mountOpenCodeSurface();
    const terminal = new FakeTerminal();
    const fitAddon = new FakeFitAddon();

    surface.addTab({
      id: "term-1",
      title: "Terminal 1",
      terminal: asTerminal(terminal),
      fitAddon: asFitAddon(fitAddon),
      closable: true,
    });
    surface.setActiveTab("term-1");
    expect(terminal.openCalls).toBe(1);
    const renderedElement = terminal.element!;

    const body = surface.detachTab("term-1");
    expect(body).not.toBeNull();
    expect(container.contains(renderedElement)).toBe(false);

    terminal.write("buffered offscreen");

    surface.attachTab(
      {
        id: "term-1",
        title: "Terminal 1",
        closable: true,
        terminal: asTerminal(terminal),
        fitAddon: asFitAddon(fitAddon),
      },
      body!,
    );

    expect(terminal.openCalls).toBe(1);
    expect(terminal.element).toBe(renderedElement);
    expect(container.contains(renderedElement)).toBe(true);
    expect(body!.textContent).toContain("buffered offscreen");
  });

  it("keeps the OpenCode TUI mount host alive across detach/reattach", () => {
    const { surface, container } = mountOpenCodeSurface();
    const host = document.createElement("div");
    host.tabIndex = -1;
    host.textContent = "tui canvas";

    surface.addCustomTab({
      id: "tui-1",
      title: "OpenCode 1",
      element: host,
      closable: true,
    });
    surface.setActiveTab("tui-1");
    expect(container.contains(host)).toBe(true);

    const body = surface.detachTab("tui-1");
    expect(body).not.toBeNull();
    expect(body!.contains(host)).toBe(true);
    expect(container.contains(host)).toBe(false);

    surface.attachTab(
      { id: "tui-1", title: "OpenCode 1", closable: true, element: host },
      body!,
    );

    expect(container.contains(host)).toBe(true);
    expect(host.textContent).toBe("tui canvas");
    // Custom-host focus bookkeeping must be restored for the reattached tab.
    expect(() => surface.setActiveTab("tui-1")).not.toThrow();
    expect(
      container
        .querySelector('button[data-terminal-id="tui-1"]')
        ?.classList.contains("is-active"),
    ).toBe(true);
  });

  it("hands the active tab to a remaining tab when the active TUI tab detaches", () => {
    const { surface, container } = mountOpenCodeSurface();
    const hostA = document.createElement("div");
    const hostB = document.createElement("div");

    surface.addCustomTab({
      id: "tui-a",
      title: "A",
      element: hostA,
      closable: true,
    });
    surface.addCustomTab({
      id: "tui-b",
      title: "B",
      element: hostB,
      closable: true,
    });
    surface.setActiveTab("tui-a");

    surface.detachTab("tui-a");

    expect(
      container
        .querySelector('button[data-terminal-id="tui-b"]')
        ?.classList.contains("is-active"),
    ).toBe(true);
    expect(container.contains(hostB)).toBe(true);
  });
});
