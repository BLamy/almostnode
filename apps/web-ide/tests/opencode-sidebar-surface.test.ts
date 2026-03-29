import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import type { AgentLaunchKind } from "../src/workbench/workbench-surfaces";

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

  ({ OpenCodeTerminalSurface } = await import("../src/workbench/workbench-surfaces"));
});

afterEach(() => {
  document.body.innerHTML = "";
});

function getMenuLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".almostnode-opencode-surface__menu-label"),
  ).map((node) => node.textContent || "");
}

describe("OpenCodeTerminalSurface", () => {
  it("launches OpenCode from the primary split button", () => {
    const launches: AgentLaunchKind[] = [];
    const surface = new OpenCodeTerminalSurface({
      onLaunch: (kind) => launches.push(kind),
    });

    const container = document.createElement("div");
    surface.attach(container);
    document.body.appendChild(container);

    const button = container.querySelector(
      ".almostnode-opencode-surface__launcher-primary",
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    button?.click();

    expect(launches).toEqual(["opencode"]);
  });

  it("shows OpenCode and Empty Terminal in the dropdown, with Claude Code only when available", () => {
    const launches: AgentLaunchKind[] = [];
    const surface = new OpenCodeTerminalSurface({
      onLaunch: (kind) => launches.push(kind),
    });

    const container = document.createElement("div");
    surface.attach(container);
    document.body.appendChild(container);

    const toggle = container.querySelector(
      ".almostnode-opencode-surface__launcher-toggle",
    ) as HTMLButtonElement | null;

    expect(toggle).not.toBeNull();
    toggle?.click();
    expect(getMenuLabels(container)).toEqual(["OpenCode", "Empty Terminal"]);

    document.body.click();
    surface.setClaudeAvailable(true);
    toggle?.click();
    expect(getMenuLabels(container)).toEqual([
      "OpenCode",
      "Empty Terminal",
      "Claude Code",
    ]);

    const claudeItem = Array.from(
      container.querySelectorAll(".almostnode-opencode-surface__menu-item"),
    ).find((node) => node.textContent?.includes("Claude Code")) as
      | HTMLButtonElement
      | undefined;
    claudeItem?.click();

    expect(launches).toEqual(["claude"]);
  });

  it("does not render the old launcher-only splash copy", () => {
    const surface = new OpenCodeTerminalSurface({
      onLaunch: () => undefined,
    });

    const container = document.createElement("div");
    surface.attach(container);
    document.body.appendChild(container);

    expect(container.textContent).toContain("New Chat");
    expect(container.textContent).not.toContain("Start a CLI chat from here");
    expect(container.textContent).not.toContain(
      "New Chat opens a normal terminal tab",
    );
  });
});
