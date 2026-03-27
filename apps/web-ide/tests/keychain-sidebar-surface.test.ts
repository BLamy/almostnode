import { beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

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

let KeychainSidebarSurface: typeof import("../src/workbench/workbench-surfaces").KeychainSidebarSurface;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Node: dom.window.Node,
  });

  ({ KeychainSidebarSurface } = await import("../src/workbench/workbench-surfaces"));
});

describe("KeychainSidebarSurface", () => {
  it("renders exit node choices and emits selection actions", () => {
    const surface = new KeychainSidebarSurface();
    const actions: string[] = [];
    surface.setActionHandler((action) => {
      actions.push(action);
    });

    const container = document.createElement("div");
    surface.attach(container);
    surface.update(
      [
        {
          name: "tailscale",
          label: "Tailscale",
          active: true,
          canAuth: true,
          statusText: "Running via nyc",
          selectActionPrefix: "select-exit-node:tailscale",
          selectOptions: [
            { value: "node-nyc", label: "nyc" },
            { value: "node-sfo", label: "sfo" },
          ],
          selectValue: "node-nyc",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect(
      Array.from((select as HTMLSelectElement).options).map((option) => option.value),
    ).toEqual(["node-nyc", "node-sfo"]);

    (select as HTMLSelectElement).value = "node-sfo";
    select!.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-exit-node:tailscale:node-sfo"]);
  });

  it("can render a logout action for tailscale even when the slot is not active", () => {
    const surface = new KeychainSidebarSurface();
    const actions: string[] = [];
    surface.setActionHandler((action) => {
      actions.push(action);
    });

    const container = document.createElement("div");
    surface.attach(container);
    surface.update(
      [
        {
          name: "tailscale",
          label: "Tailscale",
          active: false,
          canAuth: true,
          authAction: "logout:tailscale",
          statusText: "NeedsLogin",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Logout",
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();
    button?.click();

    expect(actions).toEqual(["logout:tailscale"]);
  });
});
