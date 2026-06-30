# @agent-wasm/sdk

Workspace and agent-lifecycle layer over [`@agent-wasm/core`](https://www.npmjs.com/package/@agent-wasm/core).

```bash
npm install @agent-wasm/core @agent-wasm/sdk
```

```ts
import { createWorkspace } from "@agent-wasm/sdk";

const workspace = createWorkspace();
workspace.vfs.writeFileSync("/index.html", "<h1>hi</h1>");
await workspace.preview.start("npm run dev");
await workspace.snapshots.save();
```

## API

- **`createWorkspace` / `WorkspaceController`** — a container plus preview, terminal
  sessions, mounted agents, and persistence in one object.
- **`SnapshotStore` / `createIndexedDbSnapshotStore`** — persist a workspace VFS to
  IndexedDB (or an in-memory store).
- **`AgentAdapter` / `AgentSession`** — mount CLI agents into a workspace.
- **`WorkspaceTemplate` / `DEFAULT_WORKSPACE_TEMPLATE`** — seedable starter files.
- **`createOpenCodeAgentAdapter`** — an adapter for the OpenCode agent.
- **`@agent-wasm/sdk/plugins`** — load and merge Claude Code, Codex, and
  agent-wasm plugin manifests into one harness-agnostic contribution graph.

## `@agent-wasm/sdk/auth`

The credential manifest shared across agent-wasm: `defaultCredentialSlots`,
`defaultAuthProviders`, `agentWasmCredentialPaths`, and `createAuthManifest()` —
the single source of truth for where each provider's credentials live in the VFS.

## `@agent-wasm/sdk/plugins`

The plugin registry is the shared manifest layer for all harnesses. It accepts
canonical `plugin.json` files, `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, `.mcp.json`, `.lsp.json`, `settings.json`, and
folder conventions such as `skills/`, `commands/`, `agents/`, `hooks/`,
`monitors/`, and `bin/`.

```ts
import { loadPlugins } from "@agent-wasm/sdk/plugins";

const registry = await loadPlugins([
  { kind: "workspace", root: "/project/.claude-plugin", workspace },
  { kind: "workspace", root: "/project/.codex-plugin", workspace },
  { kind: "workspace", root: "/project/plugins/design-tools", workspace },
]);

for (const panel of registry.listPanels()) {
  console.log(panel.id, panel.location);
}
```

Canonical contributions are `skills`, `commands`, `agents`, `hooks`,
`mcpServers`, `lspServers`, `monitors`, `bin`, `settings`, `auth`,
`vscode.panels`, and `vscode.customEditors`. Multiple manifests merge by
contribution id. Duplicate ids use last-writer-wins and emit diagnostics.

## License

MIT
