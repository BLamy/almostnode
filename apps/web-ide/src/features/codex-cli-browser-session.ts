import type { ContainerInstance, ShellCommandDefinition } from "almostnode";
import {
  createBrowserCodexCliShellCommand,
  createCodexCliBrowserSession,
  type CodexCliBrowserLoginHandler,
  type CodexCliBrowserSession,
  type CodexCliBrowserSessionOptions,
} from "codex-wasm";
import { createWebIdeCodexBrowserSession } from "./codex-browser-session";

declare const __CODEX_WASM_MODULE_URL__: string;

export interface WebIdeCodexCliBrowserSessionOptions {
  container: Pick<ContainerInstance, "vfs" | "network" | "createTerminalSession">;
  cwd?: string;
  env?: Record<string, string>;
  wasmModuleUrl?: string;
  wasmInitInput?: CodexCliBrowserSessionOptions["wasmInitInput"];
  requestBrowserLogin?: CodexCliBrowserLoginHandler;
}

export interface WebIdeCodexCliShellCommandContainer extends Pick<
  ContainerInstance,
  "vfs" | "network" | "createTerminalSession" | "registerShellCommand"
> {}

export interface RegisterWebIdeCodexCliShellCommandOptions extends Omit<
  WebIdeCodexCliBrowserSessionOptions,
  "container"
> {}

export function createWebIdeCodexCliWorker(): Worker {
  return new Worker(new URL("./codex-cli.worker.ts", import.meta.url), {
    name: "almostnode-codex-cli",
    type: "module",
  });
}

function getDefaultCodexCliWasmModuleUrl(): string {
  return typeof __CODEX_WASM_MODULE_URL__ === "string"
    ? __CODEX_WASM_MODULE_URL__
    : "/codex-wasm/codex_wasm.js";
}

export function createWebIdeCodexCliBrowserSession(
  options: WebIdeCodexCliBrowserSessionOptions,
): CodexCliBrowserSession {
  return createCodexCliBrowserSession({
    container: options.container,
    workerFactory: createWebIdeCodexCliWorker,
    defaultCwd: options.cwd,
    env: options.env,
    wasmModuleUrl: options.wasmModuleUrl ?? getDefaultCodexCliWasmModuleUrl(),
    wasmInitInput: options.wasmInitInput,
  });
}

export function createWebIdeCodexCliShellCommand(
  options: WebIdeCodexCliBrowserSessionOptions,
): ShellCommandDefinition {
  return createBrowserCodexCliShellCommand({
    container: options.container,
    workerFactory: createWebIdeCodexCliWorker,
    defaultCwd: options.cwd,
    env: options.env,
    wasmModuleUrl: options.wasmModuleUrl ?? getDefaultCodexCliWasmModuleUrl(),
    wasmInitInput: options.wasmInitInput,
    requestBrowserLogin: options.requestBrowserLogin,
    createAppServerSession(context) {
      return createWebIdeCodexBrowserSession({
        container: options.container,
        cwd: context.cwd,
        env: context.getEnv(),
        wasmModuleUrl:
          options.wasmModuleUrl ?? getDefaultCodexCliWasmModuleUrl(),
        wasmInitInput: options.wasmInitInput,
      });
    },
  });
}

export function registerWebIdeCodexCliShellCommand(
  container: WebIdeCodexCliShellCommandContainer,
  options: RegisterWebIdeCodexCliShellCommandOptions = {},
): void {
  container.registerShellCommand(
    createWebIdeCodexCliShellCommand({
      ...options,
      container,
    }),
  );
}
