import type { CodexInitializeParams } from "./json-rpc";
import { installCodexZstdCompression } from "./zstd-compression";

export interface CodexWorkerStartMessage {
  type: "codex/worker/start";
  port: MessagePort;
  wasmModuleUrl?: string;
  wasmInitInput?: string | URL | Request | BufferSource | WebAssembly.Module;
  initialize?: CodexInitializeParams;
}

export interface CodexWorkerReadyMessage {
  type: "codex/worker/ready";
  supportsRealCodex: boolean;
}

export interface CodexWorkerErrorMessage {
  type: "codex/worker/error";
  message: string;
  stack?: string;
}

type CodexWorkerMessage =
  | CodexWorkerStartMessage
  | CodexWorkerReadyMessage
  | CodexWorkerErrorMessage;

interface WasmCodexAppServer {
  start(port: MessagePort, initialize?: CodexInitializeParams): void | Promise<void>;
  dispose?(): void;
}

interface WasmCodexModule {
  default?: (input?: unknown) => Promise<unknown> | unknown;
  CodexAppServerWasm?: new () => WasmCodexAppServer;
  createCodexAppServerWasm?: () => WasmCodexAppServer | Promise<WasmCodexAppServer>;
}

let activeServer: WasmCodexAppServer | null = null;
let hostRequestSeq = 0;
let detachHostRequestBridge: (() => void) | null = null;

declare global {
  // Upstream codex-exec-server's wasm host calls this function for filesystem,
  // process, and HTTP operations. The main thread answers through CodexHostBridge.
  // eslint-disable-next-line no-var
  var __almostnodeCodexHostRequest:
    | ((op: string, params?: unknown) => Promise<unknown>)
    | undefined;
}

self.onmessage = (event: MessageEvent<CodexWorkerMessage>) => {
  const message = event.data;
  if (!message || message.type !== "codex/worker/start") return;
  void startCodexWorker(message);
};

async function startCodexWorker(message: CodexWorkerStartMessage): Promise<void> {
  try {
    activeServer?.dispose?.();
    activeServer = null;

    if (!message.wasmModuleUrl) {
      throw new Error(
        "Codex WASM adapter is not configured. Build the adapter and pass wasmModuleUrl before starting Codex.",
      );
    }

    const module = (await import(
      /* @vite-ignore */ message.wasmModuleUrl
    )) as WasmCodexModule;

    await installCodexZstdCompression();

    if (module.default) {
      await module.default(message.wasmInitInput);
    }

    const server = module.createCodexAppServerWasm
      ? await module.createCodexAppServerWasm()
      : module.CodexAppServerWasm
        ? new module.CodexAppServerWasm()
        : null;

    if (!server) {
      throw new Error(
        "Codex WASM module did not export CodexAppServerWasm or createCodexAppServerWasm.",
      );
    }

    activeServer = server;
    detachHostRequestBridge?.();
    detachHostRequestBridge = installAlmostnodeCodexHostRequest(message.port);
    await server.start(message.port, message.initialize);

    self.postMessage({
      type: "codex/worker/ready",
      supportsRealCodex: true,
    } satisfies CodexWorkerReadyMessage);
  } catch (error) {
    self.postMessage(serializeWorkerError(error));
  }
}

function installAlmostnodeCodexHostRequest(port: MessagePort): () => void {
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(reason?: unknown): void }
  >();

  const listener = (event: MessageEvent<unknown>) => {
    const message = event.data as {
      type?: string;
      id?: string;
      result?: unknown;
      error?: { code?: string; message?: string };
    };
    if (message?.type !== "codex/host/response" || !message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) {
      callbacks.reject(
        Object.assign(
          new Error(message.error.message ?? "Codex host request failed"),
          message.error.code ? { code: message.error.code } : {},
        ),
      );
      return;
    }
    callbacks.resolve(message.result);
  };

  port.addEventListener("message", listener);
  port.start();

  globalThis.__almostnodeCodexHostRequest = (op: string, params?: unknown) => {
    const id = `codex_wasm_host_${++hostRequestSeq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        port.postMessage({
          type: "codex/host/request",
          id,
          op,
          params,
        });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };

  return () => {
    port.removeEventListener("message", listener);
    for (const callbacks of pending.values()) {
      callbacks.reject(new Error("Codex host request bridge was disposed"));
    }
    pending.clear();
    if (globalThis.__almostnodeCodexHostRequest) {
      delete globalThis.__almostnodeCodexHostRequest;
    }
  };
}

function serializeWorkerError(error: unknown): CodexWorkerErrorMessage {
  if (error instanceof Error) {
    return {
      type: "codex/worker/error",
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    type: "codex/worker/error",
    message: String(error),
  };
}
