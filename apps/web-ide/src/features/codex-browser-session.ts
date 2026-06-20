import type { ContainerInstance } from "almostnode";
import {
  createCodexBrowserSession,
  type CodexBrowserSession,
  type CodexBrowserSessionOptions,
  type CodexClientInfo,
  type CodexInitializeParams,
} from "codex-wasm";
import { refreshCodexAuth } from "./codex-auth";

declare const __CODEX_WASM_MODULE_URL__: string;

export interface WebIdeCodexBrowserSessionOptions {
  container: Pick<ContainerInstance, "vfs" | "network" | "createTerminalSession">;
  cwd?: string;
  env?: Record<string, string>;
  clientInfo?: CodexClientInfo;
  initialize?: CodexInitializeParams;
  wasmModuleUrl?: string;
  wasmInitInput?: CodexBrowserSessionOptions["wasmInitInput"];
}

export function createWebIdeCodexAppServerWorker(): Worker {
  return new Worker(new URL("./codex-app-server.worker.ts", import.meta.url), {
    name: "almostnode-codex-app-server",
    type: "module",
  });
}

export function getDefaultCodexAppServerWasmModuleUrl(): string {
  return typeof __CODEX_WASM_MODULE_URL__ === "string"
    ? __CODEX_WASM_MODULE_URL__
    : "/codex-wasm/codex_wasm.js";
}

export function createWebIdeCodexBrowserSession(
  options: WebIdeCodexBrowserSessionOptions,
): CodexBrowserSession {
  const worker = createWebIdeCodexAppServerWorker();

  return createCodexBrowserSession({
    container: options.container,
    worker,
    defaultCwd: options.cwd,
    env: options.env,
    auth: {
      refresh: () => refreshCodexAuth({ vfs: options.container.vfs }),
    },
    clientInfo: options.clientInfo ?? {
      name: "agent_wasm_web_ide",
      title: "agent-wasm Web IDE",
      version: "0.1.0",
    },
    initialize: options.initialize,
    wasmModuleUrl: options.wasmModuleUrl ?? getDefaultCodexAppServerWasmModuleUrl(),
    wasmInitInput: options.wasmInitInput,
  });
}
