export type DocsGroup = "Start" | "Tutorials" | "React" | "API" | "Reference";

export type CodeLanguage = "ts" | "sh";

export interface CodeExample {
  readonly id: string;
  readonly title: string;
  readonly language: CodeLanguage;
  readonly code: string;
}

export interface ApiItem {
  readonly name: string;
  readonly signature: string;
  readonly description: string;
  readonly status?: "current" | "extracting" | "planned";
}

export interface StepItem {
  readonly title: string;
  readonly body: string;
}

export interface CardItem {
  readonly title: string;
  readonly body: string;
  readonly kicker?: string;
}

export type DocsBlock =
  | {
      readonly type: "paragraphs";
      readonly items: readonly string[];
    }
  | {
      readonly type: "steps";
      readonly items: readonly StepItem[];
    }
  | {
      readonly type: "api";
      readonly items: readonly ApiItem[];
    }
  | {
      readonly type: "cards";
      readonly items: readonly CardItem[];
    }
  | {
      readonly type: "code";
      readonly example: CodeExample;
    }
  | {
      readonly type: "checklist";
      readonly items: readonly string[];
    };

export interface DocsPage {
  readonly path: string;
  readonly group: DocsGroup;
  readonly navTitle: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly status?: "current" | "extracting" | "planned";
  readonly blocks: readonly DocsBlock[];
}

export const installCode = `npm install agent-wasm agent-wasm-sdk

# Optional UI package once the React extraction lands
npm install agent-wasm-react`;

export const quickStartCode = `import { createWorkspace } from "agent-wasm-sdk";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
});

await workspace.ready;

workspace.writeFile(
  "/project/src/main.js",
  "document.body.textContent = 'agent-wasm is running';",
);

await workspace.preview.start("npm run dev");`;

export const terminalCode = `const terminal = workspace.terminals.createSession({
  cwd: "/project",
});

await terminal.session.run("npm install");
await terminal.session.run("npm run dev", {
  onStdout: chunk => console.log(chunk),
  onStderr: chunk => console.warn(chunk),
});

terminal.dispose();`;

export const openCodeHarnessCode = `import {
  createOpenCodeAgentAdapter,
  createWorkspace,
} from "agent-wasm-sdk";

const workspace = await createWorkspace({
  snapshotKey: "demo:opencode-workspace",
  autoStartPreview: true,
});

workspace.agents.register(
  createOpenCodeAgentAdapter({
    loadModule: () => import("./opencode-browser-agent"),
    loadFsModule: () => import("./opencode-browser-fs"),
  }),
);

await workspace.agents.mount("opencode", {
  element: document.querySelector("#agent")!,
  storage: window.localStorage,
});`;

export const customAgentCode = `workspace.agents.register({
  id: "review-bot",
  label: "Review Bot",
  async mount({ element, workspace }) {
    const terminal = workspace.terminals.createSession({ cwd: "/project" });
    element.textContent = "Review Bot is checking the workspace...";

    await terminal.session.run("npm test", {
      onStdout: chunk => console.log(chunk),
    });

    return {
      dispose: () => terminal.dispose(),
    };
  },
});`;

export const keychainCode = `import {
  defaultAgentWasmAuthManifest,
  getCredentialPathsForSlots,
} from "agent-wasm-sdk/auth";

const auth = defaultAgentWasmAuthManifest;
const opencode = auth.slots.find(slot => slot.id === "opencode");

const paths = getCredentialPathsForSlots(auth.slots, [
  "opencode",
  "github",
  "neon",
]);

console.log(opencode?.paths);
console.log(paths);`;

export const previewCode = `await workspace.preview.start("npm run dev");

const snapshot = workspace.getSnapshot();
if (snapshot.preview.status === "running") {
  iframe.src = snapshot.preview.url!;
}`;

export const snapshotCode = `await workspace.snapshots.save();

workspace.writeFile("/project/src/main.js", "throw new Error('oops')");

await workspace.snapshots.load();
console.log(workspace.readFile("/project/src/main.js"));`;

export const publishChecklist = `pnpm nx type-check docs
pnpm nx test agent-wasm-sdk
pnpm nx build docs
pnpm pack --pack-destination /tmp/agent-wasm-packs`;

export const reactInstallCode = `npm install agent-wasm agent-wasm-sdk agent-wasm-react`;

export const reactProviderCode = `import { useEffect, useState } from "react";
import { createWorkspace, type WorkspaceController } from "agent-wasm-sdk";
import { AlmostnodeProvider, EditorPane, PreviewPane } from "agent-wasm-react";

export function Workbench() {
  const [workspace, setWorkspace] = useState<WorkspaceController | null>(null);

  useEffect(() => {
    let active = true;
    void createWorkspace({ autoStartPreview: true }).then(async (ws) => {
      await ws.ready;
      if (active) setWorkspace(ws);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!workspace) return <p>Booting workspace…</p>;

  return (
    <AlmostnodeProvider workspace={workspace}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <EditorPane />
        <PreviewPane autoStart />
      </div>
    </AlmostnodeProvider>
  );
}`;

export const reactHooksCode = `import { useWorkspace, useWorkspaceSnapshot } from "agent-wasm-react";

// Read reactive workspace state — re-renders on every snapshot change.
export function PreviewStatus() {
  const workspace = useWorkspace();
  const snapshot = useWorkspaceSnapshot();

  return (
    <div>
      <span>Preview: {snapshot.preview.status}</span>
      <button onClick={() => void workspace.preview.start()}>Start</button>
    </div>
  );
}`;

export const reactAgentCode = `import { AlmostnodeProvider, AgentPanel, TerminalPane } from "agent-wasm-react";

// Drop a fully wired agent chat + terminal beside your app preview.
export function AgentWorkbench({ workspace }) {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <AgentPanel adapterId="opencode" />
      <TerminalPane />
    </AlmostnodeProvider>
  );
}`;

export const reactComponentCards: readonly CardItem[] = [
  {
    title: "AlmostnodeProvider",
    kicker: "context",
    body: "Puts a WorkspaceController on React context so every pane and hook below it shares one workspace instance.",
  },
  {
    title: "EditorPane",
    kicker: "component",
    body: "File tree plus a controlled editor bound to the workspace VFS. Writes flow straight back into the virtual filesystem.",
  },
  {
    title: "PreviewPane",
    kicker: "component",
    body: "Iframe wired to the service-worker preview URL, with start/stop controls and an optional autoStart prop.",
  },
  {
    title: "TerminalPane",
    kicker: "component",
    body: "An xterm.js terminal bound to a workspace terminal session — run npm, node, git, and provider CLIs in the browser.",
  },
  {
    title: "AgentPanel",
    kicker: "component",
    body: "Mounts a registered agent adapter (OpenCode, Codex, custom) into a React-managed element with localStorage persistence.",
  },
  {
    title: "useWorkspace / useWorkspaceSnapshot",
    kicker: "hooks",
    body: "Read the controller imperatively, or subscribe to reactive snapshot state via useSyncExternalStore for re-render-on-change UI.",
  },
];

export const packageCards: readonly CardItem[] = [
  {
    title: "agent-wasm",
    kicker: "runtime",
    body: "Browser Node runtime, virtual filesystem, package install, command shims, framework dev servers, and service worker bridge.",
  },
  {
    title: "agent-wasm-sdk",
    kicker: "harness",
    body: "Workspace lifecycle, terminal sessions, preview orchestration, snapshots, agent adapters, and auth manifest entrypoints.",
  },
  {
    title: "agent-wasm-react",
    kicker: "optional UI",
    body: "React components and hooks for embedding terminal, preview, chat, and keychain controls without adopting Web IDE.",
  },
  {
    title: "codex-wasm",
    kicker: "agent runtime",
    body: "Codex browser CLI and host bridge pieces used by browser agent sessions.",
  },
  {
    title: "apps/web-ide",
    kicker: "reference app",
    body: "The full IDE product. It should prove public APIs rather than hide reusable runtime behavior inside app code.",
  },
  {
    title: "apps/sdk-showcase",
    kicker: "smoke app",
    body: "Small consumer app for proving package boundaries, examples, and public install flows.",
  },
];

export const featureCards: readonly CardItem[] = [
  {
    title: "Virtual filesystem",
    kicker: "Runtime",
    body: "Read, write, watch, snapshot, and restore workspace files in browser storage.",
  },
  {
    title: "NPM install",
    kicker: "Runtime",
    body: "Resolve packages and populate node_modules inside the virtual filesystem.",
  },
  {
    title: "Command shims",
    kicker: "Runtime",
    body: "Browser-safe node, npm, npx, tsc, git, gh, curl, rg, drizzle-kit, pglite, replayio, and provider CLI commands.",
  },
  {
    title: "Dev servers",
    kicker: "Runtime",
    body: "Run Vite, Next.js, and package-script servers behind the service worker bridge.",
  },
  {
    title: "OpenCode harness",
    kicker: "Agents",
    body: "Browser TUI, opencode.internal client, VFS sync, permission/question streams, and persistent history.",
  },
  {
    title: "Keychain",
    kicker: "Auth",
    body: "Credential slots, provider metadata, mirror rules, vault state, and OAuth-oriented provider flows.",
  },
  {
    title: "Preview orchestration",
    kicker: "Harness",
    body: "Start app servers, stream logs, detect ready URLs, and wire preview iframes.",
  },
  {
    title: "Snapshots",
    kicker: "Harness",
    body: "Persist and restore workspace file state across reloads and sandbox switches.",
  },
  {
    title: "React embed",
    kicker: "UI",
    body: "Optional product UI pieces for apps that want browser workspaces without the Web IDE shell.",
  },
];

export const docsPages: readonly DocsPage[] = [
  {
    path: "/overview",
    group: "Start",
    navTitle: "Overview",
    eyebrow: "Start here",
    title: "agent-wasm is a browser-native agent workspace platform.",
    summary:
      "It packages the pieces needed to run agent harnesses in the browser: a Node-like runtime, virtual files, package installs, command shims, previews, snapshots, and keychain-aware agents.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The Web IDE is the complete reference product, but it should not be the only way to use the platform. Reusable behavior belongs in packages; apps prove those package APIs.",
          "The public library shape starts with agent-wasm and agent-wasm-sdk. Consumers create a workspace, seed files, run commands, mount agents, expose a preview, and persist state.",
          "OpenCode is a first-class harness in this model. Its browser TUI, shared opencode server, VFS sync, and host-level history need explicit docs and package entrypoints.",
        ],
      },
      {
        type: "cards",
        items: [
          {
            title: "Runtime",
            kicker: "agent-wasm",
            body: "Virtual filesystem, package manager, service worker bridge, command shims, and browser-compatible Node APIs.",
          },
          {
            title: "Harness",
            kicker: "agent-wasm-sdk",
            body: "Workspace lifecycle, terminal sessions, previews, snapshots, auth metadata, and agent adapter registration.",
          },
          {
            title: "Examples",
            kicker: "apps",
            body: "Web IDE as the full reference app; SDK Showcase as the smallest install and embed smoke test.",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "overview-install",
          title: "Install",
          language: "sh",
          code: installCode,
        },
      },
    ],
  },
  {
    path: "/tutorials/quickstart",
    group: "Tutorials",
    navTitle: "Quickstart",
    eyebrow: "Tutorial",
    title: "Create a browser workspace and run a preview.",
    summary:
      "This is the smallest consumer path: create a workspace, write a file, and start the app preview.",
    status: "extracting",
    blocks: [
      {
        type: "steps",
        items: [
          {
            title: "Install the runtime packages",
            body: "Use agent-wasm for the browser runtime and agent-wasm-sdk for the workspace/harness API.",
          },
          {
            title: "Create a workspace",
            body: "The SDK creates a container, seeds the template, and exposes VFS, terminal, preview, snapshot, and agent APIs.",
          },
          {
            title: "Start a preview",
            body: "Run the project command through the preview API so the service worker bridge can expose a browser URL.",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "quickstart-install",
          title: "Install packages",
          language: "sh",
          code: installCode,
        },
      },
      {
        type: "code",
        example: {
          id: "quickstart-code",
          title: "Workspace quickstart",
          language: "ts",
          code: quickStartCode,
        },
      },
    ],
  },
  {
    path: "/tutorials/opencode",
    group: "Tutorials",
    navTitle: "Build an OpenCode Harness",
    eyebrow: "Tutorial",
    title: "Mount OpenCode inside a browser workspace.",
    summary:
      "OpenCode should be documented as a real browser harness: TUI mount, opencode.internal client, VFS synchronization, credentials, and persistent session history.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "OpenCode is not just a terminal command in this repo. The Web IDE already wires a browser TUI, an in-browser OpenCode server, command routing, VFS synchronization, and chat/session discovery.",
          "The package extraction should expose that as an adapter instead of requiring consumers to import Web IDE internals.",
        ],
      },
      {
        type: "steps",
        items: [
          {
            title: "Create the workspace",
            body: "Use createWorkspace so OpenCode runs against the same VFS, package manager, preview server, and snapshot store as the rest of the app.",
          },
          {
            title: "Register the adapter",
            body: "The OpenCode adapter owns the browser agent module, browser filesystem module, credential lookup, and mount lifecycle.",
          },
          {
            title: "Mount into a real element",
            body: "Consumers provide the DOM node and storage. The adapter renders OpenCode and keeps workspace files synchronized.",
          },
          {
            title: "Persist intentionally",
            body: "Workspace snapshots and OpenCode history are different stores. The docs need to be explicit about that distinction.",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "opencode-harness",
          title: "OpenCode harness",
          language: "ts",
          code: openCodeHarnessCode,
        },
      },
    ],
  },
  {
    path: "/tutorials/custom-agent",
    group: "Tutorials",
    navTitle: "Build a Custom Agent",
    eyebrow: "Tutorial",
    title: "Register your own agent adapter.",
    summary:
      "Any agent can participate if it can mount into a workspace, run commands, read/write files, and clean up its resources.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The adapter contract is intentionally small. It receives the target DOM element, workspace controller, optional browser environment, and optional storage.",
          "That means a provider-specific harness can be built without changing the runtime package or Web IDE shell.",
        ],
      },
      {
        type: "code",
        example: {
          id: "custom-agent",
          title: "Custom adapter",
          language: "ts",
          code: customAgentCode,
        },
      },
    ],
  },
  {
    path: "/tutorials/keychain",
    group: "Tutorials",
    navTitle: "Use Keychain Slots",
    eyebrow: "Tutorial",
    title: "Hydrate credentials into browser workspaces.",
    summary:
      "The auth package exposes credential slots, provider metadata, and mirror paths so harnesses can request credentials without depending on Web IDE sidebar code.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "Credential slots describe files such as OpenCode auth, Codex auth, Claude credentials, GitHub hosts.yml, Neon credentials, and provider configs.",
          "Mirror rules decide which credential files should be copied into new VFS instances by default. Synthetic or host-level state, such as Tailscale session state, should be handled deliberately.",
        ],
      },
      {
        type: "code",
        example: {
          id: "keychain-slots",
          title: "Inspect credential slots",
          language: "ts",
          code: keychainCode,
        },
      },
    ],
  },
  {
    path: "/tutorials/previews",
    group: "Tutorials",
    navTitle: "Run Previews",
    eyebrow: "Tutorial",
    title: "Start app servers and attach preview frames.",
    summary:
      "Preview orchestration should hide the service worker bridge details but still expose logs, state, and the resolved URL.",
    status: "current",
    blocks: [
      {
        type: "steps",
        items: [
          {
            title: "Run the project command",
            body: "Use workspace.preview.start instead of a random terminal command when the output should become a browser preview.",
          },
          {
            title: "Read preview state",
            body: "getSnapshot exposes status, command, URL, stdout, stderr, and any startup error.",
          },
          {
            title: "Bind an iframe",
            body: "Once the preview is running, assign the resolved URL to your product UI's preview frame.",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "preview-api",
          title: "Preview frame",
          language: "ts",
          code: previewCode,
        },
      },
    ],
  },
  {
    path: "/api/workspace",
    group: "API",
    navTitle: "Workspace",
    eyebrow: "API",
    title: "Workspace API",
    summary:
      "The workspace is the main public SDK object. It owns the runtime container and composes files, terminal sessions, previews, snapshots, and agents.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "createWorkspace",
            signature: "createWorkspace(options?: WorkspaceCreateOptions): WorkspaceController",
            description:
              "Creates a browser runtime container, seeds files, restores snapshots when configured, and returns the controller.",
            status: "current",
          },
          {
            name: "workspace.ready",
            signature: "Promise<void>",
            description:
              "Resolves after the workspace has initialized and optional preview startup has been requested.",
            status: "current",
          },
          {
            name: "workspace.readFile",
            signature: "readFile(path: string): string",
            description: "Reads UTF-8 file content from the virtual filesystem.",
            status: "current",
          },
          {
            name: "workspace.writeFile",
            signature: "writeFile(path: string, content: string): void",
            description: "Writes UTF-8 content to the virtual filesystem.",
            status: "current",
          },
          {
            name: "workspace.listFiles",
            signature: "listFiles(root?: string): string[]",
            description: "Lists project files, excluding generated directories such as node_modules and dist.",
            status: "current",
          },
          {
            name: "workspace.reseed",
            signature: "reseed(template?: WorkspaceTemplate): Promise<void>",
            description: "Replaces the workspace contents with a template and restarts initialization.",
            status: "current",
          },
        ],
      },
    ],
  },
  {
    path: "/api/agents",
    group: "API",
    navTitle: "Agents",
    eyebrow: "API",
    title: "Agent adapter API",
    summary:
      "Agents mount into workspaces through a small adapter contract. OpenCode, Codex, Claude Code, and custom harnesses should all converge here.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "AgentAdapter",
            signature: "{ id: string; label: string; mount(context): Disposable | Promise<Disposable> }",
            description:
              "A provider or custom agent integration that can render UI, use terminals, read/write files, and clean up.",
            status: "current",
          },
          {
            name: "workspace.agents.register",
            signature: "register(adapter: AgentAdapter): void",
            description: "Adds an adapter to the workspace registry.",
            status: "current",
          },
          {
            name: "workspace.agents.mount",
            signature: "mount(adapterId: string, context): Promise<AgentSession>",
            description: "Mounts a registered adapter into a DOM element.",
            status: "current",
          },
          {
            name: "createOpenCodeAgentAdapter",
            signature: "createOpenCodeAgentAdapter(options: OpenCodeAgentAdapterOptions): AgentAdapter",
            description:
              "Creates the current OpenCode SDK adapter using compatible browser agent and filesystem modules.",
            status: "current",
          },
          {
            name: "createCodexAgentAdapter",
            signature: "createCodexAgentAdapter(options): AgentAdapter",
            description:
              "Planned package-level Codex adapter that should move Web IDE Codex launch/session behavior behind the same contract.",
            status: "planned",
          },
          {
            name: "createClaudeCodeAgentAdapter",
            signature: "createClaudeCodeAgentAdapter(options): AgentAdapter",
            description:
              "Planned package-level Claude adapter for Claude credentials, IDE bridge, terminal launch, and session behavior.",
            status: "planned",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "custom-agent-api",
          title: "Custom agent",
          language: "ts",
          code: customAgentCode,
        },
      },
    ],
  },
  {
    path: "/api/terminal",
    group: "API",
    navTitle: "Terminal",
    eyebrow: "API",
    title: "Terminal session API",
    summary:
      "Terminal sessions run browser-safe commands through the agent-wasm runtime and stream output back to consumers.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "workspace.terminals.createSession",
            signature: "createSession(options?: TerminalSessionOptions): TerminalSessionHandle",
            description: "Creates a managed command session with a runtime-backed TerminalSession.",
            status: "current",
          },
          {
            name: "TerminalSession.run",
            signature: "run(command: string, options?: RunOptions): Promise<RunResult>",
            description: "Runs a command such as npm, npx, git, gh, rg, pglite, drizzle-kit, replayio, or opencode.",
            status: "current",
          },
          {
            name: "TerminalSessionHandle.dispose",
            signature: "dispose(): void",
            description: "Disposes the terminal resources and removes the session from the workspace list.",
            status: "current",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "terminal-code",
          title: "Run commands",
          language: "ts",
          code: terminalCode,
        },
      },
    ],
  },
  {
    path: "/api/preview",
    group: "API",
    navTitle: "Preview",
    eyebrow: "API",
    title: "Preview API",
    summary:
      "The preview API coordinates command execution and service worker routing for browser-visible app servers.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "workspace.preview.start",
            signature: "start(command?: string): Promise<RunResult>",
            description: "Starts the preview command and resolves once the server is ready or the command exits.",
            status: "current",
          },
          {
            name: "workspace.preview.stop",
            signature: "stop(): void",
            description: "Stops the active preview command and clears preview state.",
            status: "current",
          },
          {
            name: "workspace.getSnapshot().preview",
            signature: "{ status; command; url; stdout; stderr; error }",
            description: "Returns preview state for product UI and diagnostics.",
            status: "current",
          },
        ],
      },
    ],
  },
  {
    path: "/api/snapshots",
    group: "API",
    navTitle: "Snapshots",
    eyebrow: "API",
    title: "Snapshot API",
    summary:
      "Snapshots persist and restore workspace file state. They are separate from provider-specific history stores such as OpenCode's host-level browser DB.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "workspace.snapshots.save",
            signature: "save(): Promise<void>",
            description: "Persists the current VFS snapshot using the configured SnapshotStore.",
            status: "current",
          },
          {
            name: "workspace.snapshots.load",
            signature: "load(): Promise<void>",
            description: "Restores the VFS snapshot for the configured key.",
            status: "current",
          },
          {
            name: "createIndexedDbSnapshotStore",
            signature: "createIndexedDbSnapshotStore(dbName?, storeName?): SnapshotStore",
            description: "Creates the default IndexedDB-backed snapshot store.",
            status: "current",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "snapshots-code",
          title: "Save and restore",
          language: "ts",
          code: snapshotCode,
        },
      },
    ],
  },
  {
    path: "/api/auth",
    group: "API",
    navTitle: "Auth Manifest",
    eyebrow: "API",
    title: "Auth and keychain API",
    summary:
      "The auth manifest is the headless contract for credential slots, auth providers, and mirror rules.",
    status: "current",
    blocks: [
      {
        type: "api",
        items: [
          {
            name: "defaultAgentWasmAuthManifest",
            signature: "AgentWasmAuthManifest",
            description: "Built-in credential slots, provider definitions, and default mirror rules.",
            status: "current",
          },
          {
            name: "defaultCredentialSlots",
            signature: "readonly CredentialSlotDefinition[]",
            description: "Slots for OpenCode, Codex, Claude, GitHub, AWS, Infisical, Fly, Netlify, Cloudflare, Neon, Replay, Tailscale, and system config.",
            status: "current",
          },
          {
            name: "getDefaultCredentialMirrorPaths",
            signature: "(): string[]",
            description: "Returns credential file paths mirrored into new workspace VFS instances by default.",
            status: "current",
          },
          {
            name: "getCredentialPathsForSlots",
            signature: "(slots, slotIds): string[]",
            description: "Returns unique credential paths for selected slots.",
            status: "current",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "auth-code",
          title: "Credential slots",
          language: "ts",
          code: keychainCode,
        },
      },
    ],
  },
  {
    path: "/api/runtime",
    group: "API",
    navTitle: "Runtime",
    eyebrow: "API",
    title: "agent-wasm runtime surface",
    summary:
      "The runtime package owns browser-safe Node behavior. Higher-level SDK APIs should compose it instead of reimplementing platform work.",
    status: "current",
    blocks: [
      {
        type: "cards",
        items: [
          {
            title: "createContainer",
            kicker: "Runtime",
            body: "Creates the browser runtime container with VFS, shell command registration, service worker bridge, package install, and framework server support.",
          },
          {
            title: "VirtualFS",
            kicker: "Filesystem",
            body: "Read/write APIs, snapshots, watchers, and compatibility shims used by editors, command shims, and framework servers.",
          },
          {
            title: "Shell commands",
            kicker: "CLI",
            body: "Browser-safe command surface for node, npm, npx, tsc, git, gh, rg, curl, provider CLIs, pglite, drizzle-kit, and agent launch commands.",
          },
          {
            title: "Framework servers",
            kicker: "Preview",
            body: "Vite, Next.js, package-script, PGlite, and service-worker-backed URL routing for browser previews.",
          },
        ],
      },
    ],
  },
  {
    path: "/react/overview",
    group: "React",
    navTitle: "React Overview",
    eyebrow: "React",
    title: "Use agent-wasm from React.",
    summary:
      "agent-wasm-react wraps the workspace controller in idiomatic React: a context provider, ready-made panes, and reactive hooks. Bring your own layout, or drop in the prebuilt components.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The core SDK is framework-agnostic — agent-wasm-sdk hands you a WorkspaceController with imperative methods and a subscribable snapshot. agent-wasm-react adapts that controller to React so components re-render when workspace state changes, without you wiring up subscriptions by hand.",
          "Everything renders client-side. There is no server: the workspace, filesystem, package installs, and preview all live in the browser behind a service worker, so these components work inside any React app, including static hosts.",
        ],
      },
      {
        type: "steps",
        items: [
          {
            title: "Install the React package",
            body: "agent-wasm-react depends on agent-wasm-sdk and React 18+. Install all three alongside the runtime.",
          },
          {
            title: "Create a workspace in an effect",
            body: "createWorkspace is async. Kick it off in a useEffect, await ws.ready, then store the controller in state.",
          },
          {
            title: "Wrap your tree in AlmostnodeProvider",
            body: "Pass the controller once. Every pane and hook below it shares that single workspace instance via context.",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "react-install",
          title: "Install",
          language: "sh",
          code: reactInstallCode,
        },
      },
      {
        type: "code",
        example: {
          id: "react-provider",
          title: "Workbench.tsx",
          language: "ts",
          code: reactProviderCode,
        },
      },
    ],
  },
  {
    path: "/react/components",
    group: "React",
    navTitle: "Components & Hooks",
    eyebrow: "React",
    title: "Components and hooks reference.",
    summary:
      "The pieces exported by agent-wasm-react. Compose them freely — every component reads the same workspace from context.",
    status: "extracting",
    blocks: [
      {
        type: "cards",
        items: reactComponentCards,
      },
      {
        type: "paragraphs",
        items: [
          "Reactive state comes from useWorkspaceSnapshot, which subscribes to the controller with useSyncExternalStore. Read the current file, file list, preview status, preview URL, and errors — your component re-renders on every change.",
        ],
      },
      {
        type: "code",
        example: {
          id: "react-hooks",
          title: "Reactive state with hooks",
          language: "ts",
          code: reactHooksCode,
        },
      },
      {
        type: "paragraphs",
        items: [
          "AgentPanel mounts any registered agent adapter into a React-managed element and disposes it on unmount, so you can place a full OpenCode or Codex session next to your editor and preview.",
        ],
      },
      {
        type: "code",
        example: {
          id: "react-agent",
          title: "Agent + terminal panes",
          language: "ts",
          code: reactAgentCode,
        },
      },
    ],
  },
  {
    path: "/reference/packages",
    group: "Reference",
    navTitle: "Packages",
    eyebrow: "Reference",
    title: "Package ownership map",
    summary:
      "This is the package split that keeps the Web IDE as an example consumer instead of the hidden library implementation.",
    status: "extracting",
    blocks: [
      {
        type: "cards",
        items: packageCards,
      },
    ],
  },
  {
    path: "/reference/features",
    group: "Reference",
    navTitle: "Features",
    eyebrow: "Reference",
    title: "Feature coverage index",
    summary:
      "Every feature here should either have a package API page, a tutorial, or a reference note explaining why it remains app-local.",
    status: "extracting",
    blocks: [
      {
        type: "cards",
        items: featureCards,
      },
    ],
  },
  {
    path: "/reference/publishing",
    group: "Reference",
    navTitle: "Publishing",
    eyebrow: "Reference",
    title: "NPM publishing gate",
    summary:
      "Publish only after examples consume the public package entrypoints and npm pack output has been smoke-tested.",
    status: "planned",
    blocks: [
      {
        type: "checklist",
        items: [
          "Add dist output and declaration generation for each publishable package.",
          "Define export maps for root, auth, runtime, adapters, and React entrypoints.",
          "Run npm pack and install the tarballs into a fresh Vite consumer app.",
          "Make Web IDE and SDK Showcase import from public package paths only.",
          "Document browser requirements, service worker setup, and provider auth setup.",
        ],
      },
      {
        type: "code",
        example: {
          id: "publish-checks",
          title: "Publishing checks",
          language: "sh",
          code: publishChecklist,
        },
      },
    ],
  },
];

export const legacyHashRedirects: Record<string, string> = {
  overview: "/overview",
  architecture: "/overview",
  runtime: "/api/runtime",
  harness: "/api/agents",
  opencode: "/tutorials/opencode",
  auth: "/api/auth",
  "web-ide": "/reference/packages",
  publishing: "/reference/publishing",
  packages: "/reference/packages",
  examples: "/tutorials/quickstart",
  features: "/reference/features",
};
