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

## `@agent-wasm/sdk/auth`

The credential manifest shared across agent-wasm: `defaultCredentialSlots`,
`defaultAuthProviders`, `agentWasmCredentialPaths`, and `createAuthManifest()` —
the single source of truth for where each provider's credentials live in the VFS.

## License

MIT
