import type { ContainerInstance, ShellCommandDefinition } from "almostnode";
import {
  createBrowserCodexCliShellCommand,
  createCodexCliBrowserSession,
  type CodexCliBrowserLoginHandler,
  type CodexCliBrowserSession,
  type CodexCliBrowserSessionOptions,
} from "codex-wasm";
import { createWebIdeCodexBrowserSession } from "./codex-browser-session";
import { codexConversationBus } from "../chat/codex-conversation-bus";

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
      const session = createWebIdeCodexBrowserSession({
        container: options.container,
        cwd: context.cwd,
        env: context.getEnv(),
        wasmModuleUrl:
          options.wasmModuleUrl ?? getDefaultCodexCliWasmModuleUrl(),
        wasmInitInput: options.wasmInitInput,
      });
      // Tee the app-server traffic into the chat conversation bus — the WASM
      // build writes no rollout files, so this is the chat surface's only
      // window into the codex conversation.
      codexConversationBus.reset();
      const unsubscribe = session.peer.onNotification((notification) => {
        codexConversationBus.emitNotification(notification);
      });
      return {
        ready: session.ready,
        dispose() {
          unsubscribe();
          session.dispose();
        },
        peer: {
          initialize: session.peer.initialize.bind(session.peer),
          onNotification: session.peer.onNotification.bind(session.peer),
          request: async (method: string, params?: unknown) => {
            const result = await session.peer.request(method, params);
            codexConversationBus.emitRequest(method, params, result);
            return result;
          },
        },
      };
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
