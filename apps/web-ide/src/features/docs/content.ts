export type DocsGroup = "Start" | "Tutorials" | "React" | "Editors" | "API" | "Reference";

export type CodeLanguage = "ts" | "sh";

export interface CodeExample {
  readonly id: string;
  readonly title: string;
  readonly language: CodeLanguage;
  readonly code: string;
  readonly demo?: CodeDemo;
}

export type CodeDemo =
  | {
      readonly kind: "runtime-output";
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "react-workbench";
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "agent-editor";
      readonly agentId: "project-agent";
      readonly agentLabel: string;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "codex-cli-editor";
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "opencode-tui-editor";
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "terminal-agent-editor";
      readonly agentId: "claude" | "pi";
      readonly title: string;
      readonly description: string;
    };

function runtimeOutputDemo(title: string, description: string): CodeDemo {
  return { kind: "runtime-output", title, description };
}

function reactWorkbenchDemo(title: string, description: string): CodeDemo {
  return { kind: "react-workbench", title, description };
}

function agentEditorDemo(
  agentId: "project-agent",
  agentLabel: string,
  title: string,
  description: string,
): CodeDemo {
  return { kind: "agent-editor", agentId, agentLabel, title, description };
}

function codexCliEditorDemo(title: string, description: string): CodeDemo {
  return { kind: "codex-cli-editor", title, description };
}

function opencodeTuiEditorDemo(title: string, description: string): CodeDemo {
  return { kind: "opencode-tui-editor", title, description };
}

function terminalAgentEditorDemo(
  agentId: "claude" | "pi",
  title: string,
  description: string,
): CodeDemo {
  return { kind: "terminal-agent-editor", agentId, title, description };
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

export const installCode = `npm install @agent-wasm/core @agent-wasm/sdk

# Add React UI when you want ready-made panes
npm install @agent-wasm/react`;

export const compositionInstallCode = `npm install @agent-wasm/core @agent-wasm/sdk
npm install @agent-wasm/react @agent-wasm/vscode @agent-wasm/chat-core
npm install @agent-wasm/code @agent-wasm/codex @agent-wasm/keychain`;

export const runtimePlaygroundCode = `import { createContainer } from "@agent-wasm/core";

const container = createContainer();

container.vfs.writeFileSync("/index.js", "console.log('hello')");
await container.run("node /index.js");`;

export const composeWorkspaceCode = `import { createWorkspace } from "@agent-wasm/sdk";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "my-product:workspace",
});

await workspace.ready;
workspace.writeFile(
  "/project/src/main.js",
  "document.body.textContent = 'agent-wasm';",
);

await workspace.preview.start("npm run dev");
previewFrame.src = workspace.getSnapshot().preview.url ?? "about:blank";`;

export const composeAgentChatCode = `import { ChatScreen } from "@agent-wasm/react/chat";
import type { AgentHarness } from "@agent-wasm/chat-core";

export function AgentChat({ host }: { host: AgentHost }) {
  return (
    <ChatScreen
      startAgentSession={(harness: AgentHarness) =>
        host.startAgentSession(harness)
      }
      createAdapter={(session) => host.createConversationAdapter(session)}
    />
  );
}`;

export const composeCredentialCode = `import {
  CODEX_AUTH_PATH,
  CredentialMirror,
  Keychain,
  OPENCODE_AUTH_PATH,
  TAILSCALE_SESSION_KEYCHAIN_PATH,
} from "@agent-wasm/keychain";

const keychain = new Keychain({
  vfs: workspace.vfs,
  isAgentLaunchCommand: (cmd) => /\\b(claude|codex|opencode)\\b/.test(cmd),
});

keychain.registerSlot("agents", [OPENCODE_AUTH_PATH, CODEX_AUTH_PATH]);

const mirror = new CredentialMirror({
  vfs: workspace.vfs,
  paths: [OPENCODE_AUTH_PATH, CODEX_AUTH_PATH, TAILSCALE_SESSION_KEYCHAIN_PATH],
});

mirror.hydrateFromStorage();
mirror.startWatching();`;

export const composePluginRegistryCode = `import { loadPlugins } from "@agent-wasm/sdk/plugins";

const plugins = await loadPlugins([
  { kind: "workspace", root: "/project/.claude-plugin", workspace },
  { kind: "workspace", root: "/project/.codex-plugin", workspace },
  { kind: "workspace", root: "/project/plugins/design-tools", workspace },
]);

for (const panel of plugins.listPanels()) {
  console.log(panel.id, panel.location);
}

for (const editor of plugins.listCustomEditors()) {
  console.log(editor.id, editor.filePatterns);
}`;

export const composeVSCodeShellCode = `import { createWorkspace } from "@agent-wasm/sdk";
import { loadPlugins } from "@agent-wasm/sdk/plugins";
import {
  VSCode,
  defineVSCodeCustomEditor,
  defineVSCodePanel,
} from "@agent-wasm/vscode";

const workspace = createWorkspace({ autoStartPreview: true });
await workspace.ready;

const plugins = await loadPlugins([
  { kind: "workspace", root: "/project/.claude-plugin", workspace },
  { kind: "workspace", root: "/project/.codex-plugin", workspace },
]);

export function IdeShell() {
  return (
    <VSCode
      workspace={workspace}
      plugins={plugins}
      panels={[
        defineVSCodePanel({
          id: "outline",
          title: "Outline",
          location: "sidebar",
          render({ container }) {
            container.textContent = "Plugin outline";
          },
        }),
      ]}
      customEditors={[
        defineVSCodeCustomEditor({
          id: "schema-editor",
          displayName: "Schema Editor",
          filePatterns: ["**/*.schema.json"],
          render({ container, resource, workspace }) {
            container.textContent = workspace.readFile(resource);
          },
        }),
      ]}
    />
  );
}`;

export const vscodePlaywrightTargetCode = `const opened = shell.openResource("/project/schema.graph.json");

if (opened.kind === "customEditor") {
  const target = shell.getPlaywrightTarget({
    editorId: opened.customEditor.id,
    resource: opened.resource,
  });

  await page
    .locator(target!.selector)
    .getByRole("button", { name: "Add field" })
    .click();
}`;

export const quickStartCode = `import { createWorkspace } from "@agent-wasm/sdk";

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

export const openCodeHarnessCode = `import { createWorkspace } from "@agent-wasm/sdk";
import { mountOpenCodeBrowserSession } from "./opencode-browser-session";

const workspace = await createWorkspace({
  snapshotKey: "demo:opencode-workspace",
  autoStartPreview: true,
  initialFiles: {
    "/project/docs/brief.md": "# Demo brief\\n\\nAsk OpenCode to edit this document after login.\\n",
  },
});

await workspace.ready;
workspace.setCurrentFile("/project/docs/brief.md");

const session = await mountOpenCodeBrowserSession({
  container: workspace.container,
  element: document.querySelector("#agent")!,
  cwd: "/project",
  env: {},
  opencodeDirectory: "/docs/opencode-editor",
  themeMode: "dark",
});

window.addEventListener("beforeunload", () => session.dispose());`;

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
} from "@agent-wasm/sdk/auth";

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
pnpm nx test @agent-wasm/sdk
pnpm nx build docs
pnpm pack --pack-destination /tmp/agent-wasm-packs`;

export const reactInstallCode = `npm install @agent-wasm/core @agent-wasm/sdk @agent-wasm/react`;

export const reactProviderCode = `import { useEffect, useState } from "react";
import { createWorkspace, type WorkspaceController } from "@agent-wasm/sdk";
import { AlmostnodeProvider, EditorPane, PreviewPane } from "@agent-wasm/react/workbench";

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

export const reactHooksCode = `import { useWorkspace, useWorkspaceSnapshot } from "@agent-wasm/react/workbench";

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

export const reactAgentCode = `import { AlmostnodeProvider, AgentPanel, TerminalPane } from "@agent-wasm/react/workbench";

export function AgentWorkbench({ workspace }) {
  workspace.agents.register({
    id: "project-agent",
    label: "Project agent",
    async mount({ element }) {
      element.textContent = "Mount your provider UI here.";
      return { dispose: () => element.replaceChildren() };
    },
  });

  return (
    <AlmostnodeProvider workspace={workspace}>
      <AgentPanel adapterId="project-agent" />
      <TerminalPane />
    </AlmostnodeProvider>
  );
}`;

export const workbenchEditorCode = `import { createWorkspace, type WorkspaceController } from "@agent-wasm/sdk";
import { AlmostnodeProvider, EditorPane, PreviewPane } from "@agent-wasm/react/workbench";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
});

await workspace.ready;

export function WorkbenchEditor() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <EditorPane />
      <PreviewPane autoStart />
    </AlmostnodeProvider>
  );
}`;

export const opencodeEditorCode = `import { useEffect, useRef } from "react";
import { createWorkspace } from "@agent-wasm/sdk";
import {
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
} from "@agent-wasm/react/workbench";
import { mountOpenCodeBrowserSession } from "./opencode-browser-session";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "opencode-editor",
  initialFiles: {
    "/project/docs/brief.md": "# Demo brief\\n\\nAsk OpenCode to edit this document after login.\\n",
  },
});

await workspace.ready;
workspace.setCurrentFile("/project/docs/brief.md");

function OpenCodePane() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    let session: { dispose(): void } | null = null;
    mountOpenCodeBrowserSession({
      container: workspace.container,
      element: hostRef.current,
      cwd: "/project",
      env: {},
      opencodeDirectory: "/docs/opencode-editor",
      themeMode: "dark",
    }).then((mounted) => {
      session = mounted;
    });
    return () => session?.dispose();
  }, []);

  return <section ref={hostRef} />;
}

export function OpenCodeEditor() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <OpenCodePane />
      <EditorPane />
      <PreviewPane autoStart />
    </AlmostnodeProvider>
  );
}`;

export const codexEditorCode = `import { createWorkspace } from "@agent-wasm/sdk";
import {
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
  TerminalPane,
} from "@agent-wasm/react/workbench";
import { createWebIdeCodexCliShellCommand } from "./codex-cli-browser-session";
import { runCodexBrowserLogin } from "./codex-auth";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "codex-editor",
  initialFiles: {
    "/project/docs/brief.md": "# Demo brief\\n\\nAsk Codex to edit this document after login.\\n",
  },
});

workspace.container.registerShellCommand(
  createWebIdeCodexCliShellCommand({
    container: workspace.container,
    cwd: "/project",
    requestBrowserLogin: ({ login, context }) =>
      runCodexBrowserLogin({
        method: login.type,
        vfs: workspace.vfs,
        signal: context.signal,
        writeStdout: context.writeStdout,
      }),
  }),
);

await workspace.ready;
workspace.setCurrentFile("/project/docs/brief.md");

export function CodexEditor() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <TerminalPane cwd="/project" initialCommand="codex --help" />
      <EditorPane />
      <PreviewPane autoStart />
    </AlmostnodeProvider>
  );
}`;

export const claudeEditorCode = `import { createWorkspace } from "@agent-wasm/sdk";
import {
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
  TerminalPane,
} from "@agent-wasm/react/workbench";

const claudePluginFiles = {
  "/project/.claude-plugin/plugin.json": JSON.stringify(
    {
      name: "almostnode-lsp",
      version: "0.1.0",
      description: "Workspace-local oxlint and tsgo LSP wiring for Claude Code.",
      lspServers: "./.lsp.json",
    },
    null,
    2,
  ),
  "/project/.claude-plugin/.lsp.json": JSON.stringify(
    {
      oxlint: {
        command: "almostnode-lsp-bridge",
        args: ["oxlint"],
        transport: "stdio",
      },
      tsgo: {
        command: "almostnode-lsp-bridge",
        args: ["tsgo"],
        transport: "stdio",
      },
    },
    null,
    2,
  ),
};

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "claude-code-editor",
  initialFiles: {
    ...claudePluginFiles,
    "/project/docs/brief.md": "# Demo brief\\n\\nAsk Claude Code to edit this document after login.\\n",
  },
});

await workspace.ready;
workspace.setCurrentFile("/project/docs/brief.md");

const claudeCommand = [
  "/usr/local/bin/claude-wrapper",
  "--plugin-dir /project/.claude-plugin",
  "--permission-mode bypassPermissions",
].join(" ");

export function ClaudeCodeEditor() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <TerminalPane
        cwd="/project"
        initialCommand={claudeCommand + " --help"}
      />
      <EditorPane />
      <PreviewPane autoStart />
    </AlmostnodeProvider>
  );
}`;

export const piEditorCode = `import { PI_AGENT_DIR } from "@agent-wasm/keychain";
import { createWorkspace } from "@agent-wasm/sdk";
import {
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
  TerminalPane,
} from "@agent-wasm/react/workbench";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "pi-editor",
  initialFiles: {
    "/project/docs/brief.md": "# Demo brief\\n\\nAsk Pi to edit this document after login.\\n",
  },
});

await workspace.ready;
workspace.setCurrentFile("/project/docs/brief.md");

export function PiEditor() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <TerminalPane
        cwd="/project"
        env={{ PI_CODING_AGENT_DIR: PI_AGENT_DIR }}
        initialCommand="npx @earendil-works/pi-coding-agent --version"
      />
      <EditorPane />
      <PreviewPane autoStart />
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
    title: "@agent-wasm/core",
    kicker: "runtime",
    body: "Browser Node runtime, virtual filesystem, package install, command shims, framework dev servers, service worker bridge, and network primitives.",
  },
  {
    title: "@agent-wasm/sdk",
    kicker: "harness",
    body: "Workspace lifecycle over core: templates, terminal sessions, preview orchestration, snapshots, agent adapters, auth metadata, and @agent-wasm/sdk/plugins.",
  },
  {
    title: "@agent-wasm/react",
    kicker: "react ui",
    body: "React subpaths for provider/panes, chat shell, and Radix UI primitives: @agent-wasm/react/workbench, /chat, and /ui.",
  },
  {
    title: "@agent-wasm/vscode",
    kicker: "vscode shell",
    body: "VS Code-shaped shell primitives for panels, custom editors, command routing, VFS file access, and Playwright target metadata.",
  },
  {
    title: "@agent-wasm/chat-core",
    kicker: "chat domain",
    body: "Framework-free conversation types, tool-call encoders, session registry, and adapter contracts shared by UI and agent packages.",
  },
  {
    title: "@agent-wasm/code",
    kicker: "claude code",
    body: "Claude Code transcript parsing, conversation adapter, and IDE bridge helpers over the shared chat-core contract.",
  },
  {
    title: "@agent-wasm/codex",
    kicker: "codex wasm",
    body: "Codex WASM browser sessions, CLI worker entrypoints, and host bridge contracts for browser-hosted Codex.",
  },
  {
    title: "@agent-wasm/keychain",
    kicker: "credentials",
    body: "Headless vault, OAuth orchestration, credential mirroring, provider slots, and Tailscale session persistence.",
  },
  {
    title: "@agent-wasm/tailscale-connect",
    kicker: "private network",
    body: "WASM Tailscale client consumed by the core network adapter for tailnet access from browser workspaces.",
  },
  {
    title: "@replayio/app-building",
    kicker: "worker control",
    body: "Local and Fly worker orchestration for generated app building. Web IDE adds the product control plane around it.",
  },
  {
    title: "apps/web-ide",
    kicker: "reference app",
    body: "The full IDE product. It composes the packages above and keeps host-specific routing, Monaco, launch, and dashboard code app-local.",
  },
  {
    title: "apps/sdk-showcase",
    kicker: "smoke app",
    body: "Small consumer app for proving package boundaries, examples, and public install flows.",
  },
];

export const compositionCards: readonly CardItem[] = [
  {
    title: "Runtime playground",
    kicker: "@agent-wasm/core",
    body: "Use core directly for tutorials, code runners, command-shim tests, and package-manager or dev-server experiments.",
  },
  {
    title: "Workspace app",
    kicker: "@agent-wasm/core + @agent-wasm/sdk",
    body: "Add the SDK when the product has project files, templates, terminal sessions, snapshots, and preview state.",
  },
  {
    title: "React workbench",
    kicker: "@agent-wasm/react/workbench",
    body: "Use the React workbench subpath for provider/hooks/panes when a host wants workspace UI without the full Web IDE shell.",
  },
  {
    title: "Plugin IDE shell",
    kicker: "@agent-wasm/sdk/plugins + @agent-wasm/vscode",
    body: "Load one merged plugin graph, then let plugins contribute commands, panels, custom editors, MCP/LSP config, skills, bins, and settings.",
  },
  {
    title: "Agent chat",
    kicker: "@agent-wasm/chat-core",
    body: "Use chat-core plus @agent-wasm/react/chat so Claude, Codex, OpenCode, and custom agents can render through one conversation contract.",
  },
  {
    title: "Credentialed private workspace",
    kicker: "@agent-wasm/keychain + @agent-wasm/tailscale-connect",
    body: "Add keychain and network support when the workspace needs provider credentials, OAuth tokens, Tailscale state, or private APIs.",
  },
  {
    title: "Full IDE",
    kicker: "apps/web-ide",
    body: "Compose every layer, then keep product-specific navigation, Monaco wiring, launch dialogs, and app-builder dashboards in the host app.",
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
          "The public library shape starts with @agent-wasm/core and @agent-wasm/sdk. Consumers create a workspace, seed files, run commands, mount agents, expose a preview, persist state, and load shared plugin manifests.",
          "@agent-wasm/sdk/plugins normalizes Claude Code, Codex, and agent-wasm plugin roots into one contribution graph. @agent-wasm/vscode consumes that graph to register panels, custom editors, commands, and Playwright-addressable custom editor roots.",
          "Agent packages compose through @agent-wasm/chat-core. Provider-specific packages translate Claude Code, Codex, OpenCode, or custom sessions into the same conversation contract while React stays host-agnostic.",
        ],
      },
      {
        type: "cards",
        items: [
          {
            title: "Runtime",
            kicker: "@agent-wasm/core",
            body: "Virtual filesystem, package manager, service worker bridge, command shims, and browser-compatible Node APIs.",
          },
          {
            title: "Harness",
            kicker: "@agent-wasm/sdk",
            body: "Workspace lifecycle, terminal sessions, previews, snapshots, auth metadata, plugin registry, and agent adapter registration.",
          },
          {
            title: "UI and agents",
            kicker: "@agent-wasm/react + chat-core",
            body: "Reusable panes, chat surfaces, and agent conversation contracts that hosts can compose without importing Web IDE internals.",
          },
          {
            title: "Plugin IDE shell",
            kicker: "@agent-wasm/vscode",
            body: "Runtime panels, file-pattern custom editors, command routing, VFS write-through, and Playwright target metadata.",
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
    path: "/tutorials/compose-apps",
    group: "Tutorials",
    navTitle: "Compose Apps",
    eyebrow: "Tutorial",
    title: "Compose apps from package layers.",
    summary:
      "Pick the smallest package layer that owns the behavior you need, then add workspace, React, agent, keychain, and network pieces as the product grows.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The Web IDE is a consumer of the package stack, not the only way to use it. Start with the runtime, add the SDK for workspace lifecycle, add React for UI, and add agent/keychain/network packages only when the host needs those capabilities.",
          "Use @agent-wasm/sdk/plugins when the host needs Claude Code, Codex, or agent-wasm plugin manifests. Load them once, merge by contribution id, then pass the PluginRegistry to whichever harness owns the UI.",
          "Use @agent-wasm/vscode when that UI is VS Code-shaped: plugin panels map to sidebar, panel, or auxiliary bar regions; custom editors route by file pattern and write back to the same workspace VFS as agent edits.",
          "Host apps still own their product shell: routing, navigation, Monaco service boot, launch buttons, account onboarding, app-builder dashboards, analytics, and deployment-specific configuration.",
        ],
      },
      {
        type: "cards",
        items: compositionCards,
      },
      {
        type: "code",
        example: {
          id: "composition-install",
          title: "Install package layers",
          language: "sh",
          code: compositionInstallCode,
        },
      },
      {
        type: "code",
        example: {
          id: "runtime-playground",
          title: "Runtime playground",
          language: "ts",
          code: runtimePlaygroundCode,
          demo: runtimeOutputDemo(
            "Runtime output",
            "Runs the same file through @agent-wasm/core and streams the command result.",
          ),
        },
      },
      {
        type: "code",
        example: {
          id: "workspace-composition",
          title: "Workspace with preview",
          language: "ts",
          code: composeWorkspaceCode,
        },
      },
      {
        type: "code",
        example: {
          id: "agent-chat-composition",
          title: "Agent chat",
          language: "ts",
          code: composeAgentChatCode,
        },
      },
      {
        type: "code",
        example: {
          id: "credential-composition",
          title: "Credentials",
          language: "ts",
          code: composeCredentialCode,
        },
      },
      {
        type: "code",
        example: {
          id: "plugin-registry-composition",
          title: "Load plugin contributions",
          language: "ts",
          code: composePluginRegistryCode,
        },
      },
      {
        type: "code",
        example: {
          id: "vscode-shell-composition",
          title: "Plugin-powered VSCode shell",
          language: "ts",
          code: composeVSCodeShellCode,
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
            body: "Use @agent-wasm/core for the browser runtime and @agent-wasm/sdk for the workspace/harness API.",
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
          demo: reactWorkbenchDemo(
            "Quickstart preview",
            "Boots the SDK workspace, renders the editor, and starts the preview from the same VFS.",
          ),
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
          "The live demo below mounts that real browser TUI beside a markdown editor and preview. After credentials are available, OpenCode can edit docs/brief.md through the same workspace VFS the human editor uses.",
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
            title: "Mount the TUI session",
            body: "Call mountOpenCodeBrowserSession with the workspace container, target element, cwd, env, and an OpenCode history namespace.",
          },
          {
            title: "Share the VFS",
            body: "The OpenCode workspace bridge maps browser OpenCode file operations back to the workspace VFS, so agent writes and editor writes converge.",
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
          demo: opencodeTuiEditorDemo(
            "OpenCode harness",
            "Mounts the real browser OpenCode TUI against docs/brief.md, with the editor and preview reading from the same VFS.",
          ),
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
          demo: reactWorkbenchDemo(
            "Running preview",
            "Starts the default Vite preview and renders the live iframe beside the VFS-backed editor.",
          ),
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
    path: "/api/plugins",
    group: "API",
    navTitle: "Plugins",
    eyebrow: "API",
    title: "Plugin registry API",
    summary:
      "The plugin registry normalizes Claude Code, Codex, and agent-wasm plugin manifests into one merged contribution graph.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "Use @agent-wasm/sdk/plugins when multiple harnesses should consume the same plugin root. The loader accepts manifest-only sources, workspace-backed directories, local folder readers, and package-style sources.",
          "Canonical contributions are skills, commands, agents, hooks, mcpServers, lspServers, monitors, bin, settings, auth, vscode.panels, and vscode.customEditors. Duplicate contribution ids are last-writer-wins and reported through diagnostics.",
        ],
      },
      {
        type: "api",
        items: [
          {
            name: "loadPlugins",
            signature: "loadPlugins(sources: PluginSource[]): Promise<PluginRegistry>",
            description:
              "Discovers plugin.json, .claude-plugin/plugin.json, .codex-plugin/plugin.json, sidecars, and folder conventions, then returns a registry.",
            status: "current",
          },
          {
            name: "mergePluginManifests",
            signature: "mergePluginManifests(manifests): PluginMergeResult",
            description:
              "Normalizes manifests and merges contributions by id with diagnostics for duplicate ids and settings.",
            status: "current",
          },
          {
            name: "PluginRegistry",
            signature: "new PluginRegistry(manifests?)",
            description:
              "Holds the merged manifest plus source manifests and exposes listPanels, listCustomEditors, listContributions, and getContribution helpers.",
            status: "current",
          },
          {
            name: "AgentWasmPluginManifest",
            signature: "{ skills; commands; agents; hooks; mcpServers; lspServers; vscode: { panels; customEditors } }",
            description:
              "Canonical manifest shape. Existing Claude and Codex fields are accepted and normalized into this contribution graph.",
            status: "current",
          },
          {
            name: "Plugin diagnostics",
            signature: "{ level; code; message; pluginId?; contributionId? }",
            description:
              "Non-fatal warnings and errors emitted during discovery, parse, and merge. Hosts can show these in settings or plugin management UI.",
            status: "current",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "plugin-registry-api",
          title: "Load plugins",
          language: "ts",
          code: composePluginRegistryCode,
        },
      },
    ],
  },
  {
    path: "/api/vscode",
    group: "API",
    navTitle: "VSCode Shell",
    eyebrow: "API",
    title: "VSCode wrapper API",
    summary:
      "@agent-wasm/vscode provides a reusable VS Code-shaped shell for panels, custom editors, commands, VFS file access, and Playwright-targetable editor UI.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "Use <VSCode> in React harnesses and createVSCodeShell in non-React harnesses. Both consume the same PluginRegistry and runtime panel/custom editor definitions.",
          "The shell owns command registration, file-pattern custom editor routing, and a VFS-backed file provider. Text and custom editor edits call workspace.writeFile(), so previews and watchers see the same changes as agent writes.",
          "Every mounted custom editor root gets stable plugin id, editor id, resource, and test id metadata. Harnesses can hand agents the selector returned by getPlaywrightTarget() for raw Playwright interaction.",
        ],
      },
      {
        type: "api",
        items: [
          {
            name: "VSCode",
            signature: "<VSCode workspace={workspace} plugins={registry} panels customEditors />",
            description:
              "React wrapper that renders registered panels and the matching custom editor or VFS-backed text fallback for the current file.",
            status: "current",
          },
          {
            name: "createVSCodeShell",
            signature: "createVSCodeShell(options): VSCodeShell",
            description:
              "Creates the non-React shell with plugin registry, command registry, file provider, panel/custom editor registration, and openResource routing.",
            status: "current",
          },
          {
            name: "defineVSCodePanel",
            signature: "defineVSCodePanel({ id; title; location; render })",
            description:
              "Defines a runtime panel. Locations map to sidebar, panel, or auxiliarybar.",
            status: "current",
          },
          {
            name: "defineVSCodeCustomEditor",
            signature: "defineVSCodeCustomEditor({ id; filePatterns; render })",
            description:
              "Defines a file-pattern custom editor that can render UI and write back through the workspace VFS.",
            status: "current",
          },
          {
            name: "shell.getPlaywrightTarget",
            signature: "getPlaywrightTarget(editorId | { editorId?, resource? })",
            description:
              "Returns a stable selector and metadata for a mounted custom editor root so an agent can interact with the real UI through Playwright.",
            status: "current",
          },
        ],
      },
      {
        type: "code",
        example: {
          id: "vscode-shell-api",
          title: "VSCode shell",
          language: "ts",
          code: composeVSCodeShellCode,
        },
      },
      {
        type: "code",
        example: {
          id: "vscode-playwright-target",
          title: "Playwright target",
          language: "ts",
          code: vscodePlaywrightTargetCode,
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
      "@agent-wasm/react wraps the workspace controller in idiomatic React: a context provider, ready-made panes, and reactive hooks. Bring your own layout, or drop in the prebuilt components.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The core SDK is framework-agnostic — @agent-wasm/sdk hands you a WorkspaceController with imperative methods and a subscribable snapshot. @agent-wasm/react adapts that controller to React so components re-render when workspace state changes, without you wiring up subscriptions by hand.",
          "Everything renders client-side. There is no server: the workspace, filesystem, package installs, and preview all live in the browser behind a service worker, so these components work inside any React app, including static hosts.",
        ],
      },
      {
        type: "steps",
        items: [
          {
            title: "Install the React package",
            body: "@agent-wasm/react depends on @agent-wasm/sdk and React 18+. Install all three alongside the runtime.",
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
          demo: reactWorkbenchDemo(
            "Live workbench",
            "Boots a real SDK workspace and renders the reusable React panes from @agent-wasm/react/workbench.",
          ),
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
      "The pieces exported by @agent-wasm/react. Compose them freely — every component reads the same workspace from context.",
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
          demo: agentEditorDemo(
            "project-agent",
            "Project agent",
            "Custom agent panel",
            "Mounts a local agent adapter beside the highlighted editor and running preview.",
          ),
        },
      },
    ],
  },
  {
    path: "/editors/workbench",
    group: "Editors",
    navTitle: "Workbench Editor",
    eyebrow: "Editor",
    title: "Build a VFS-backed workbench editor.",
    summary:
      "Compose EditorPane and PreviewPane when the app needs a syntax-highlighted editor that writes back to the workspace VFS and lets the preview server hot reload.",
    status: "current",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "EditorPane reads the selected file from the WorkspaceController and writes every edit with workspace.writeFile(). Because the SDK VFS emits normal change events, Vite and other preview servers see the same updates that agent writes produce.",
          "Use this page as the smallest reusable editor shell: no Web IDE routing, no provider auth, just workspace files, syntax highlighting, and preview.",
        ],
      },
      {
        type: "code",
        example: {
          id: "workbench-editor-demo",
          title: "WorkbenchEditor.tsx",
          language: "ts",
          code: workbenchEditorCode,
          demo: reactWorkbenchDemo(
            "VFS editor",
            "Edits save through workspace.writeFile(), and the running preview observes the same VFS change events.",
          ),
        },
      },
    ],
  },
  {
    path: "/editors/opencode",
    group: "Editors",
    navTitle: "OpenCode Editor",
    eyebrow: "Editor",
    title: "Compose an OpenCode editor.",
    summary:
      "Mount the OpenCode browser TUI beside the reusable editor and preview panes so agent writes and human edits share one workspace VFS.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The production OpenCode path mounts the browser TUI and in-browser OpenCode server with mountOpenCodeBrowserSession. The live demo below uses that path directly instead of a docs-only mock.",
          "OpenCode, the human editor, and the preview all see docs/brief.md through WorkspaceController, so provider-authenticated turns and manual edits converge on the same VFS and reload path.",
        ],
      },
      {
        type: "code",
        example: {
          id: "opencode-editor-demo",
          title: "OpenCodeEditor.tsx",
          language: "ts",
          code: opencodeEditorCode,
          demo: opencodeTuiEditorDemo(
            "OpenCode TUI editor",
            "Mounts the real browser OpenCode TUI against the workspace VFS. Login enables agent turns that can edit docs/brief.md.",
          ),
        },
      },
    ],
  },
  {
    path: "/editors/codex",
    group: "Editors",
    navTitle: "Codex Editor",
    eyebrow: "Editor",
    title: "Compose a Codex editor.",
    summary:
      "Use the Codex WASM package as an agent runtime while keeping editor, preview, and VFS ownership in the shared workspace.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "@agent-wasm/codex owns the browser Codex worker/session pieces. The consuming app still decides how to register the shell command, how login is handled, and how to pair the CLI with editor and preview panes.",
          "The live demo registers the same browser Codex CLI path used by the Web IDE. It starts with codex --help so the page does not force a login; run codex login, then codex, and ask it to edit docs/brief.md.",
        ],
      },
      {
        type: "code",
        example: {
          id: "codex-editor-demo",
          title: "CodexEditor.tsx",
          language: "ts",
          code: codexEditorCode,
          demo: codexCliEditorDemo(
            "Codex CLI editor",
            "Runs the real browser Codex CLI against the workspace VFS. Login enables agent turns that can edit docs/brief.md.",
          ),
        },
      },
    ],
  },
  {
    path: "/editors/claude-code",
    group: "Editors",
    navTitle: "Claude Code Editor",
    eyebrow: "Editor",
    title: "Compose a Claude Code editor.",
    summary:
      "Keep Claude-specific transcript and IDE bridge behavior in @agent-wasm/code while sharing the same editor, preview, and workspace controller.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "@agent-wasm/code owns Claude transcript parsing and bridge helpers. The host still composes those pieces with a real terminal, EditorPane, and PreviewPane so Claude Code writes and human edits land in the same workspace.",
          "The live demo starts the same browser claude-wrapper path used by the Web IDE with --help so the page does not force a login. After credentials are restored, run the wrapper command without --help and ask Claude Code to edit docs/brief.md.",
        ],
      },
      {
        type: "code",
        example: {
          id: "claude-editor-demo",
          title: "ClaudeCodeEditor.tsx",
          language: "ts",
          code: claudeEditorCode,
          demo: terminalAgentEditorDemo(
            "claude",
            "Claude Code CLI editor",
            "Runs the real browser Claude wrapper against the workspace VFS. Login enables agent turns that can edit docs/brief.md.",
          ),
        },
      },
    ],
  },
  {
    path: "/editors/pi",
    group: "Editors",
    navTitle: "Pi Editor",
    eyebrow: "Editor",
    title: "Compose a Pi editor.",
    summary:
      "Run Pi coding agent beside the reusable editor and preview panes so agent writes and human edits share one workspace VFS.",
    status: "extracting",
    blocks: [
      {
        type: "paragraphs",
        items: [
          "The Web IDE launches Pi as a terminal-backed agent harness with npx @earendil-works/pi-coding-agent and PI_CODING_AGENT_DIR pointed at /home/user/.pi/agent.",
          "The live demo starts the real package command with --version so the docs page can boot without forcing auth. After Pi auth and config are in the keychain, run npx @earendil-works/pi-coding-agent in the same terminal and ask it to edit docs/brief.md.",
        ],
      },
      {
        type: "code",
        example: {
          id: "pi-editor-demo",
          title: "PiEditor.tsx",
          language: "ts",
          code: piEditorCode,
          demo: terminalAgentEditorDemo(
            "pi",
            "Pi CLI editor",
            "Runs the real Pi coding agent command against the workspace VFS. Login enables agent turns that can edit docs/brief.md.",
          ),
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
  opencode: "/editors/opencode",
  codex: "/editors/codex",
  claude: "/editors/claude-code",
  "claude-code": "/editors/claude-code",
  pi: "/editors/pi",
  "pi-editor": "/editors/pi",
  workbench: "/editors/workbench",
  editor: "/editors/workbench",
  editors: "/editors/workbench",
  auth: "/api/auth",
  "web-ide": "/reference/packages",
  publishing: "/reference/publishing",
  packages: "/reference/packages",
  compose: "/tutorials/compose-apps",
  composition: "/tutorials/compose-apps",
  examples: "/tutorials/quickstart",
  features: "/reference/features",
};
