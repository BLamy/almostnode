# Composing agent-wasm apps

agent-wasm is split into packages so hosts can choose the smallest layer that
matches the product they are building. The Web IDE is the full reference app,
but the reusable behavior should come from packages instead of app-local imports.

## Package layers

| Package | Owns | Use it when |
| --- | --- | --- |
| `@agent-wasm/core` | Browser Node runtime, VFS, npm install, command shims, service-worker routing, framework servers, and the Tailscale-backed network namespace | You need to run files, packages, shell commands, git, or dev servers in the browser |
| `@agent-wasm/sdk` | Workspace lifecycle over core: templates, previews, terminal sessions, snapshots, agent adapters, auth manifest metadata, and the plugin registry subpath | You are building an app that embeds a browser workspace or loads reusable agent/plugin contributions |
| `@agent-wasm/react` | React provider, hooks, panes, chat shell, and Radix UI primitives. Use `@agent-wasm/react/workbench` for provider/pane-only imports, `@agent-wasm/react/chat` for chat, and `@agent-wasm/react/ui` for primitives. | You want workspace UI without copying Web IDE components |
| `@agent-wasm/vscode` | VS Code-shaped shell primitives: `<VSCode>`, `createVSCodeShell`, runtime panels, custom editors, command routing, VFS file provider, and Playwright target metadata | You want a reusable Monaco/VS Code-like harness that plugins can extend |
| `@agent-wasm/chat-core` | Framework-free chat types, conversation adapter contracts, tool-call encoders, and session registry | You need agent/chat state shared by UI and provider packages |
| `@agent-wasm/code` | Claude Code transcript parsing, conversation adapter, and IDE bridge helpers | You want Claude Code sessions to appear in the shared chat surface |
| `@agent-wasm/codex` | Codex WASM sessions, CLI worker entrypoints, and host bridge contracts | You want Codex to run as a browser-hosted agent |
| `@agent-wasm/keychain` | Headless vault, credential mirroring, OAuth orchestration, provider slot constants, and Tailscale session persistence | You need credentials, OAuth services, or durable auth state |
| `@agent-wasm/tailscale-connect` | WASM Tailscale client used by the core network adapter | You need private-network access from a browser workspace |
| `@replayio/app-building` | Local/Fly worker orchestration for generated app building | You need a control plane for remote app-building workers |

## Composition rules

1. Start with `@agent-wasm/core` only when you are building a runtime primitive:
   code playgrounds, command shims, package-manager behavior, virtual dev
   servers, or network support.
2. Add `@agent-wasm/sdk` when the product has a workspace concept: project
   templates, file persistence, preview state, terminal sessions, or mounted
   agents.
3. Add `@agent-wasm/react` only for React UI. Keep product-specific layout,
   navigation, Monaco wiring, provider launch flows, and app-builder dashboards
   in the host app.
4. Add `@agent-wasm/vscode` when the host wants a reusable editor shell with
   runtime panel and custom-editor registration. Keep product navigation and
   provider onboarding in the host, but let the package own contribution
   routing, file-pattern matching, VFS writes, and Playwright target metadata.
5. Use `@agent-wasm/sdk/plugins` when a harness needs to load Claude Code,
   Codex, or agent-wasm plugin manifests. Merge manifests once, then hand the
   resulting `PluginRegistry` to any harness that needs skills, commands, MCP,
   LSP, bins, settings, panels, or custom editors.
6. Use `@agent-wasm/chat-core` as the shared agent conversation contract.
   Provider packages should implement adapters over this package instead of
   depending on React or Web IDE internals.
7. Use `@agent-wasm/keychain` for credentials and OAuth. Hosts decide which
   credential slots are visible, when to unlock, and which paths are mirrored
   into a workspace.
8. Fix platform gaps in `@agent-wasm/core` or package adapters. Avoid adding
   package-specific fallbacks in `apps/web-ide` when the missing behavior should
   work for every host.

## App recipes

### Runtime playground

Use `@agent-wasm/core` directly when the app is just a code runner, tutorial, or
small playground.

```ts
import { createContainer } from "@agent-wasm/core";

const container = createContainer();

container.vfs.writeFileSync("/index.js", "console.log('hello')");
await container.run("node /index.js");
```

This app owns its editor and output UI. Core owns the virtual filesystem,
execution, package install, and shell compatibility.

### Embedded workspace with preview

Use `@agent-wasm/sdk` when the app has files, commands, previews, and persistent
workspace state.

```ts
import { createWorkspace } from "@agent-wasm/sdk";

const workspace = await createWorkspace({
  autoStartPreview: true,
  installMode: "lazy",
  snapshotKey: "my-product:workspace",
});

await workspace.ready;
workspace.writeFile("/project/src/main.js", "document.body.textContent = 'hi'");
await workspace.preview.start("npm run dev");

const snapshot = workspace.getSnapshot();
previewFrame.src = snapshot.preview.url ?? "about:blank";
```

The host owns the product chrome and persistence policy. The SDK owns workspace
state, preview orchestration, terminal sessions, snapshots, and agent adapter
mounting.

### React workbench

Use `@agent-wasm/react/workbench` when a React host wants ready-made workspace panes
without also importing the chat shell or UI primitive barrels.

```tsx
import { createWorkspace } from "@agent-wasm/sdk";
import {
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
  TerminalPane,
} from "@agent-wasm/react/workbench";

const workspace = createWorkspace();
await workspace.ready;

export function Workbench() {
  return (
    <AlmostnodeProvider workspace={workspace}>
      <EditorPane />
      <PreviewPane autoStart />
      <TerminalPane />
    </AlmostnodeProvider>
  );
}
```

This is the right shape for docs demos, SDK showcase apps, and embedded
developer tools that do not need the whole Web IDE shell.

### Plugin-powered VS Code shell

Use `@agent-wasm/sdk/plugins` plus `@agent-wasm/vscode` when the app should load
one merged contribution graph and let plugins add commands, panels, or custom
editors.

```tsx
import { createWorkspace } from "@agent-wasm/sdk";
import { loadPlugins } from "@agent-wasm/sdk/plugins";
import {
  VSCode,
  defineVSCodeCustomEditor,
  defineVSCodePanel,
} from "@agent-wasm/vscode";

const workspace = createWorkspace();
await workspace.ready;
const plugins = await loadPlugins([
  {
    kind: "workspace",
    root: "/project/.agent-wasm-plugin",
    workspace,
  },
  {
    kind: "workspace",
    root: "/project/.claude-plugin",
    workspace,
  },
  {
    kind: "workspace",
    root: "/project/.codex-plugin",
    workspace,
  },
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
            container.textContent = "Plugin panel";
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
}
```

The shell writes through `workspace.writeFile()`, so human edits, plugin custom
editors, and agent writes hit the same VFS watcher path and can trigger preview
reloads. Mounted custom editors also receive stable DOM metadata, so a harness
can call `shell.getPlaywrightTarget({ resource })` and hand an agent a scoped
locator for raw Playwright interaction.

### Agent chat surface

Use `@agent-wasm/chat-core` plus `@agent-wasm/react/chat` when the app needs a
shared conversation view across agents.

```tsx
import { ChatScreen } from "@agent-wasm/react/chat";
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
}
```

Provider-specific packages such as `@agent-wasm/code` and `@agent-wasm/codex`
should translate their sessions into the chat-core adapter contract. The React
chat UI should stay provider-agnostic.

### Credentialed private-network workspace

Use `@agent-wasm/keychain` when a workspace needs provider credentials, OAuth
tokens, or persistent Tailscale state. Use `@agent-wasm/tailscale-connect` through the core
network adapter when private APIs or internal preview URLs must be reachable
from the browser runtime.

```ts
import {
  CODEX_AUTH_PATH,
  CredentialMirror,
  Keychain,
  OPENCODE_AUTH_PATH,
  TAILSCALE_SESSION_KEYCHAIN_PATH,
} from "@agent-wasm/keychain";

const keychain = new Keychain({
  vfs: workspace.vfs,
  isAgentLaunchCommand: (cmd) => /\b(claude|codex|opencode)\b/.test(cmd),
});

keychain.registerSlot("agents", [OPENCODE_AUTH_PATH, CODEX_AUTH_PATH]);

const mirror = new CredentialMirror({
  vfs: workspace.vfs,
  paths: [OPENCODE_AUTH_PATH, CODEX_AUTH_PATH, TAILSCALE_SESSION_KEYCHAIN_PATH],
});

mirror.hydrateFromStorage();
mirror.startWatching();
```

The host owns unlock UX, provider selection, and consent. Keychain owns vault
state, credential slots, OAuth helpers, and mirroring mechanics.

### Full Web IDE

`apps/web-ide` composes nearly every layer:

- `@agent-wasm/core` for runtime, command shims, git, framework servers, and
  Tailscale-backed network behavior
- `@agent-wasm/sdk` for workspace lifecycle and agent adapter contracts
- `@agent-wasm/sdk/plugins` for merged Claude Code, Codex, and agent-wasm plugin
  manifests
- `@agent-wasm/react/workbench` for reusable panes, `@agent-wasm/react/chat`
  for chat, and `@agent-wasm/react/ui` for UI primitives
- `@agent-wasm/vscode` for reusable VS Code-shaped panels, custom editors,
  command routing, VFS-backed file access, and Playwright target metadata
- `@agent-wasm/chat-core` for conversation state
- `@agent-wasm/code` and `@agent-wasm/codex` for agent-specific adapters and
  browser session bridges
- `@agent-wasm/keychain` for credential slots, vault state, OAuth, and session
  persistence
- `@replayio/app-building` and app-local Web IDE code for the app-builder
  control plane

Host-specific behavior belongs in `apps/web-ide`: routing, launch buttons,
Monaco/workbench wiring, product navigation, app-builder screens, and any
provider UX that has not yet become reusable.

## What stays app-local

Keep these in the consuming app unless more than one host needs them:

- Product navigation, route trees, landing pages, and docs presentation
- Host-specific Monaco service boot and workbench product state. Reusable panel
  and custom-editor contracts belong in `@agent-wasm/vscode`.
- Provider launch dialogs and account-specific onboarding flows
- App-builder dashboard screens and project management
- Analytics, telemetry, branding, and deployment-specific configuration

When another host needs the same behavior, move the reusable contract into a
package first, then update Web IDE to consume that package entrypoint.

## Plugin manifest shape

`@agent-wasm/sdk/plugins` normalizes Claude Code, Codex, and agent-wasm plugin
roots into one `AgentWasmPluginManifest`. The canonical root manifest is
`plugin.json`, but loaders also accept `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, `.mcp.json`, `.lsp.json`, `settings.json`, and
folder conventions such as `skills/`, `commands/`, `agents/`, `hooks/`,
`monitors/`, and `bin/`.

```json
{
  "id": "design-tools",
  "version": "0.1.0",
  "skills": {
    "audit": { "path": "skills/audit/SKILL.md" }
  },
  "commands": {
    "formatDesign": { "command": "node ./bin/format-design.js" }
  },
  "mcpServers": {
    "figma": { "type": "http", "url": "https://example.invalid/mcp" }
  },
  "lspServers": {
    "oxlint": {
      "command": "almostnode-lsp-bridge",
      "args": ["oxlint"],
      "transport": "stdio"
    }
  },
  "vscode": {
    "panels": {
      "designInspector": {
        "title": "Design Inspector",
        "location": "sidebar",
        "module": "./panels/design-inspector.tsx"
      }
    },
    "customEditors": {
      "schemaEditor": {
        "displayName": "Schema Editor",
        "filePatterns": ["**/*.schema.json"],
        "module": "./editors/schema-editor.tsx"
      }
    }
  }
}
```

Multiple manifests merge by contribution id. Duplicate ids use
last-writer-wins and produce diagnostics so hosts can show warnings without
blocking plugin loading.
