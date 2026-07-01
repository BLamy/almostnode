import type { ContainerInstance } from "@agent-wasm/core";
import {
  createBrowserCodexCliShellCommand,
  createCodexBrowserSession,
} from "@agent-wasm/codex";

declare const __CODEX_WASM_MODULE_URL__: string;

function wasmModuleUrl(): string {
  return typeof __CODEX_WASM_MODULE_URL__ === "string"
    ? __CODEX_WASM_MODULE_URL__
    : "/codex-wasm/codex_wasm.js";
}

function createCliWorker(): Worker {
  return new Worker(new URL("./codex-cli.worker.ts", import.meta.url), {
    name: "almostos-codex-cli",
    type: "module",
  });
}

function createAppServerWorker(): Worker {
  return new Worker(new URL("./codex-app-server.worker.ts", import.meta.url), {
    name: "almostos-codex-app-server",
    type: "module",
  });
}

/**
 * Register the real `codex` command (Rust→WASM Codex) on the container so it
 * runs in the AlmostOS terminal. Auth is read from the VFS (`~/.codex/auth.json`,
 * managed by the Keychain); token refresh is a no-op in v1.
 */
export function registerCodexCommand(container: ContainerInstance): void {
  container.registerShellCommand(
    createBrowserCodexCliShellCommand({
      container,
      workerFactory: createCliWorker,
      wasmModuleUrl: wasmModuleUrl(),
      createAppServerSession(context) {
        const session = createCodexBrowserSession({
          container,
          worker: createAppServerWorker(),
          defaultCwd: context.cwd,
          env: context.getEnv(),
          auth: { refresh: async () => ({}) },
          clientInfo: {
            name: "almost_os",
            title: "AlmostOS",
            version: "0.1.0",
          },
          wasmModuleUrl: wasmModuleUrl(),
        });
        return {
          ready: session.ready,
          dispose: () => session.dispose(),
          peer: {
            initialize: session.peer.initialize.bind(session.peer),
            onNotification: session.peer.onNotification.bind(session.peer),
            request: (method: string, params?: unknown) =>
              session.peer.request(method, params),
          },
        };
      },
    }),
  );
}
