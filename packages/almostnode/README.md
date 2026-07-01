# @agent-wasm/core

Node.js in your browser. Just like that.

The core runtime behind [agent-wasm](https://github.com/BLamy/agent-wasm): a
browser-native Node.js environment with an in-memory filesystem, a real npm
package manager (downloaded + ESM→CJS transformed via esbuild-wasm), HTTP servers
intercepted through a service worker, and dev servers for Vite and Next.js.

```bash
npm install @agent-wasm/core
```

```ts
import { createContainer } from "@agent-wasm/core";

const container = createContainer();
container.vfs.writeFileSync("/index.js", "console.log('hello from the browser')");
await container.run("node index.js");
```

## What's in the box

- **`VirtualFS`** — in-memory filesystem, exposed to code as `require('fs')`.
- **`Runtime` / `createRuntime` / `WorkerRuntime` / `SandboxRuntime`** — the JS
  execution engine with `require()`, ESM→CJS transforms, and 43 built-in module
  shims (`fs`, `path`, `http`, `net`, `stream`, `crypto`, `child_process`, …).
- **`PackageManager`** — installs real npm packages, served via `/_npm/`.
- **`ViteDevServer` / `NextDevServer`** — React + HMR, Next Pages + App Router.
- **`electron` shim + `setElectronHost` / `launchElectronApp`** — emulate the Electron
  main process (`app`, `BrowserWindow`, `ipcMain`) and run modern (contextIsolation +
  preload) Electron apps from source; each `BrowserWindow` renders as a host-supplied
  iframe with postMessage IPC. See `examples/electron-demo.*`.
- **`createContainer` / `ContainerInstance`** — orchestration: vfs, workspace,
  git, terminal sessions.
- **`ServerBridge`** — service-worker network interception for in-VFS servers.
- **`network`** — Tailscale-backed networking namespace.

## Subpaths

| Import | Purpose |
| --- | --- |
| `@agent-wasm/core` | the runtime API above |
| `@agent-wasm/core/internal` | internal helpers (OXC linter, Fly/Infisical, auth shims) |
| `@agent-wasm/core/vite` | `almostnodePlugin()` — serve the service worker in dev |
| `@agent-wasm/core/next` | `getServiceWorkerContent()` / `getServiceWorkerPath()` |

## License

MIT
