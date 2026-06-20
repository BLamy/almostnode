import { createCodexHostBridge, type CodexHostBridge } from "./host-bridge";
import type { CodexHostAuthController, CodexHostContainer } from "./host-bridge";
import {
  CodexJsonRpcPeer,
  type CodexClientInfo,
  type CodexInitializeParams,
} from "./json-rpc";
import { createMessagePortTransport } from "./message-port-transport";

export interface CodexBrowserSessionOptions {
  container: CodexHostContainer;
  worker: Worker;
  defaultCwd?: string;
  env?: Record<string, string>;
  auth?: CodexHostAuthController;
  wasmModuleUrl?: string;
  wasmInitInput?: string | URL | Request | BufferSource | WebAssembly.Module;
  initialize?: CodexInitializeParams;
  clientInfo?: CodexClientInfo;
}

export interface CodexBrowserSession {
  peer: CodexJsonRpcPeer;
  hostBridge: CodexHostBridge;
  ready: Promise<void>;
  dispose(): void;
}

export function createCodexBrowserSession(
  options: CodexBrowserSessionOptions,
): CodexBrowserSession {
  const channel = new MessageChannel();
  const hostBridge = createCodexHostBridge({
    container: options.container,
    defaultCwd: options.defaultCwd,
    env: options.env,
    auth: options.auth,
  });
  hostBridge.attach(channel.port1);

  const peer = new CodexJsonRpcPeer(createMessagePortTransport(channel.port1));
  const initialize =
    options.initialize ??
    (options.clientInfo
      ? {
          clientInfo: options.clientInfo,
          capabilities: { experimentalApi: true },
        }
      : undefined);

  const ready = waitForWorkerReady(options.worker);
  options.worker.postMessage(
    {
      type: "codex/worker/start",
      port: channel.port2,
      wasmModuleUrl: options.wasmModuleUrl,
      wasmInitInput: options.wasmInitInput,
      initialize,
    },
    [channel.port2],
  );

  return {
    peer,
    hostBridge,
    ready,
    dispose() {
      peer.dispose();
      hostBridge.dispose();
      channel.port1.close();
      options.worker.terminate();
    },
  };
}

function waitForWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: string; message?: string; stack?: string };
      if (message?.type === "codex/worker/ready") {
        cleanup();
        resolve();
        return;
      }

      if (message?.type === "codex/worker/error") {
        cleanup();
        reject(Object.assign(new Error(message.message), { stack: message.stack }));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error instanceof Error ? event.error : new Error(event.message));
    };

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}
