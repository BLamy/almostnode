import { beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { act } from "react";

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
    IS_REACT_ACT_ENVIRONMENT: true,
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

  it("can render a login action for tailscale when the session needs authentication", () => {
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
          authAction: "login:tailscale",
          statusText: "Needs login",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Login",
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();
    button?.click();

    expect(actions).toEqual(["login:tailscale"]);
  });

  it("can render an AWS login action when the slot is configured but unauthenticated", () => {
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
          name: "aws",
          label: "AWS",
          active: false,
          canAuth: true,
          authAction: "login:aws",
          statusText: "Ready to sign in",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Login",
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();
    button?.click();

    expect(actions).toEqual(["login:aws"]);
  });

  it("can render an AWS setup action with helper copy", () => {
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
          name: "aws",
          label: "AWS",
          active: false,
          canAuth: true,
          authAction: "setup:aws",
          authLabel: "Set up AWS",
          statusText: "Setup required",
          statusDetail: "Add your AWS access portal and region before signing in.",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Setup required");
    expect(container.textContent).toContain("Add your AWS access portal and region before signing in.");

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Set up AWS",
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();
    button?.click();

    expect(actions).toEqual(["setup:aws"]);
  });

  it("renders the App Building slot without a button and lists missing pieces", () => {
    const surface = new KeychainSidebarSurface();
    surface.setActionHandler(() => {});

    const container = document.createElement("div");
    surface.attach(container);
    surface.update(
      [
        {
          name: "app-building",
          label: "App Building",
          active: false,
          canAuth: false,
          statusText: "Missing 2 items",
          statusDetail: "Missing: Fly app (pick one in the Fly.io slot), Infisical project (pick one in the Infisical slot).",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Missing 2 items");
    expect(container.textContent).toContain("Fly app");
    const inlineButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => !["Save with Passkey", "Unlock Vault", "Forget", "View Vault", "Hide Vault"].includes(button.textContent ?? ""),
    );
    expect(inlineButtons.length).toBe(0);
  });

  it("marks the App Building slot active when nothing is missing", () => {
    const surface = new KeychainSidebarSurface();
    surface.setActionHandler(() => {});

    const container = document.createElement("div");
    surface.attach(container);
    surface.update(
      [
        {
          name: "app-building",
          label: "App Building",
          active: true,
          canAuth: false,
          statusText: "Ready for remote jobs",
          statusDetail: "Fly app: workers • Infisical: prod",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Ready for remote jobs");
    const inlineButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => !["Save with Passkey", "Unlock Vault", "Forget", "View Vault", "Hide Vault"].includes(button.textContent ?? ""),
    );
    expect(inlineButtons.length).toBe(0);
  });

  it("renders a Fly app picker labeled App and dispatches selection", () => {
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
          name: "fly",
          label: "Fly.io",
          active: true,
          canAuth: true,
          authAction: "logout:fly",
          authLabel: "Logout",
          statusText: "Signed in",
          selectActionPrefix: "select-app:fly",
          selectLabel: "App",
          selectOptions: [
            { value: "workers", label: "workers (acme)" },
            { value: "previews", label: "previews (acme)" },
          ],
          selectValue: "workers",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("App");
    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("workers");

    select!.value = "previews";
    select!.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-app:fly:previews"]);
  });

  it("can render an Infisical login action", () => {
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
          name: "infisical",
          label: "Infisical",
          active: false,
          canAuth: true,
          authAction: "login:infisical",
          authLabel: "Login",
          statusText: "Ready to sign in",
          statusDetail: "Uses Infisical browser login and stores the session in this workspace.",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Login",
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();
    button?.click();

    expect(actions).toEqual(["login:infisical"]);
  });

  it("swaps Unlock Vault for View Vault when the keychain is unlocked and reveals env vars", () => {
    const surface = new KeychainSidebarSurface();
    const actions: string[] = [];
    surface.setActionHandler((action) => {
      actions.push(action);
    });

    const container = document.createElement("div");
    surface.attach(container);
    surface.update([], {
      hasStoredVault: true,
      hasUnlockedKey: true,
      supported: true,
      vaultEnvVars: [
        { name: "ANTHROPIC_API_KEY", value: "sk-ant-test-token-1234" },
        { name: "GITHUB_TOKEN", value: "gho_test-token-9999" },
        { name: "NETLIFY_ACCOUNT_SLUG", value: null, note: "Not stored locally" },
      ],
    });

    expect(container.textContent).not.toContain("Unlock Vault");
    const viewButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "View Vault",
    ) as HTMLButtonElement | undefined;
    expect(viewButton).toBeTruthy();
    expect(container.textContent).not.toContain("ANTHROPIC_API_KEY");

    act(() => {
      viewButton?.click();
    });

    expect(container.textContent).toContain("ANTHROPIC_API_KEY");
    expect(container.textContent).toContain("GITHUB_TOKEN");
    expect(container.textContent).toContain("NETLIFY_ACCOUNT_SLUG");
    expect(container.textContent).toContain("Not stored locally");

    const hideButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Hide Vault",
    );
    expect(hideButton).toBeTruthy();

    expect(actions).toEqual([]);
  });

  it("keeps showing Unlock Vault when the vault is stored but locked", () => {
    const surface = new KeychainSidebarSurface();
    const actions: string[] = [];
    surface.setActionHandler((action) => {
      actions.push(action);
    });

    const container = document.createElement("div");
    surface.attach(container);
    surface.update([], {
      hasStoredVault: true,
      hasUnlockedKey: false,
      supported: true,
    });

    const unlock = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Unlock Vault",
    ) as HTMLButtonElement | undefined;
    expect(unlock).toBeTruthy();
    unlock?.click();
    expect(actions).toEqual(["unlock"]);
  });

  it("renders both project and env pickers for Infisical and dispatches env selection", () => {
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
          name: "infisical",
          label: "Infisical",
          active: true,
          canAuth: true,
          authAction: "logout:infisical",
          authLabel: "Logout",
          statusText: "Signed in as brett@example.com",
          pickers: [
            {
              actionPrefix: "select-project:infisical",
              label: "Project",
              options: [
                { value: "proj-1", label: "Default" },
                { value: "proj-2", label: "Production" },
              ],
              value: "proj-1",
            },
            {
              actionPrefix: "select-environment:infisical",
              label: "Env",
              options: [
                { value: "dev", label: "Development" },
                { value: "prod", label: "Production" },
              ],
              value: "dev",
            },
          ],
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Project");
    expect(container.textContent).toContain("Env");
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBe(2);

    const envSelect = selects[1] as HTMLSelectElement;
    expect(envSelect.value).toBe("dev");
    envSelect.value = "prod";
    envSelect.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-environment:infisical:prod"]);
  });

  it("renders an Infisical project picker labeled Project and dispatches selection", () => {
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
          name: "infisical",
          label: "Infisical",
          active: true,
          canAuth: true,
          authAction: "logout:infisical",
          authLabel: "Logout",
          statusText: "Signed in as brett@example.com",
          selectActionPrefix: "select-project:infisical",
          selectLabel: "Project",
          selectOptions: [
            { value: "proj-1", label: "Default" },
            { value: "proj-2", label: "Production" },
          ],
          selectValue: "proj-1",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Project");
    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("proj-1");

    select!.value = "proj-2";
    select!.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-project:infisical:proj-2"]);
  });

  it("dispatches sync-vault-env:infisical when the Sync to Infisical button is clicked", () => {
    const surface = new KeychainSidebarSurface();
    const actions: string[] = [];
    surface.setActionHandler((action) => {
      actions.push(action);
    });

    const container = document.createElement("div");
    surface.attach(container);
    surface.update([], {
      hasStoredVault: true,
      hasUnlockedKey: true,
      supported: true,
      vaultEnvVars: [{ name: "ANTHROPIC_API_KEY", value: "sk-ant-test" }],
      vaultSync: {
        target: "infisical:proj-1",
        targetLabel: "Default",
        busy: false,
        message: null,
        messageKind: null,
      },
    });

    const viewButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "View Vault",
    ) as HTMLButtonElement | undefined;
    expect(viewButton).toBeTruthy();

    act(() => {
      viewButton?.click();
    });

    const syncButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Sync to Infisical",
    ) as HTMLButtonElement | undefined;
    expect(syncButton).toBeTruthy();
    expect(syncButton?.disabled).toBe(false);

    syncButton?.click();

    expect(actions).toEqual(["sync-vault-env:infisical"]);
  });

  it("renders excludeFromSync env vars in Copy as .env output", () => {
    const surface = new KeychainSidebarSurface();
    surface.setActionHandler(() => {});

    const container = document.createElement("div");
    surface.attach(container);
    surface.update([], {
      hasStoredVault: true,
      hasUnlockedKey: true,
      supported: true,
      vaultEnvVars: [
        { name: "ANTHROPIC_API_KEY", value: "sk-ant-1234" },
        {
          name: "INFISICAL_CLIENT_ID",
          value: "ua-client-id-9999",
          excludeFromSync: true,
          note: "Infisical Universal Auth client ID",
        },
        {
          name: "INFISICAL_CLIENT_SECRET",
          value: "ua-client-secret-abcd",
          excludeFromSync: true,
        },
      ],
      vaultSync: {
        target: "infisical:proj-1",
        targetLabel: "Default",
        busy: false,
        message: null,
        messageKind: null,
      },
    });

    const viewButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "View Vault",
    ) as HTMLButtonElement | undefined;
    act(() => {
      viewButton?.click();
    });

    expect(container.textContent).toContain("INFISICAL_CLIENT_ID");
    expect(container.textContent).toContain("INFISICAL_CLIENT_SECRET");
    expect(container.textContent).toContain("ANTHROPIC_API_KEY");
  });

  it("disables the sync button when no Infisical project is selected", () => {
    const surface = new KeychainSidebarSurface();
    surface.setActionHandler(() => {});

    const container = document.createElement("div");
    surface.attach(container);
    surface.update([], {
      hasStoredVault: true,
      hasUnlockedKey: true,
      supported: true,
      vaultEnvVars: [{ name: "ANTHROPIC_API_KEY", value: "sk-ant-test" }],
      vaultSync: {
        target: null,
        targetLabel: null,
        busy: false,
        message: null,
        messageKind: null,
      },
    });

    const viewButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "View Vault",
    ) as HTMLButtonElement | undefined;
    act(() => {
      viewButton?.click();
    });

    const syncButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Sync to Infisical",
    ) as HTMLButtonElement | undefined;
    expect(syncButton).toBeTruthy();
    expect(syncButton?.disabled).toBe(true);
  });

  it("renders a Netlify account picker labeled Account and dispatches selection", () => {
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
          name: "netlify",
          label: "Netlify",
          active: true,
          canAuth: true,
          authAction: "logout:netlify",
          authLabel: "Logout",
          statusText: "Signed in as brett@example.com",
          selectActionPrefix: "select-account:netlify",
          selectLabel: "Account",
          selectOptions: [
            { value: "brett-personal", label: "Brett's Personal" },
            { value: "almostnode", label: "almostnode" },
          ],
          selectValue: "brett-personal",
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    expect(container.textContent).toContain("Account");
    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("brett-personal");

    select!.value = "almostnode";
    select!.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-account:netlify:almostnode"]);
  });

  it("renders a placeholder when exit nodes exist but none is actually selected", () => {
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
          statusText: "Running, choose an exit node",
          selectActionPrefix: "select-exit-node:tailscale",
          selectOptions: [{ value: "node-self", label: "bretts-macbook-air" }],
        },
      ],
      { hasStoredVault: false, supported: true },
    );

    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("");
    expect(
      Array.from(select!.options).map((option) => ({
        value: option.value,
        text: option.textContent,
        disabled: option.disabled,
      })),
    ).toEqual([
      { value: "", text: "Choose…", disabled: true },
      { value: "node-self", text: "bretts-macbook-air", disabled: false },
    ]);

    select!.value = "node-self";
    select!.dispatchEvent(new window.Event("change", { bubbles: true }));

    expect(actions).toEqual(["select-exit-node:tailscale:node-self"]);
  });
});
