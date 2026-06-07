import type {
  CodexHostBridge,
  CodexHostContainer,
} from "./host-bridge";
import { createCodexHostBridge } from "./host-bridge";
import type {
  CodexCliRunOptions,
  CodexCliRunResult,
  CodexCliWorkerMessage,
} from "./types";

export interface CodexCliBrowserSessionOptions {
  container: CodexHostContainer;
  worker?: Worker;
  workerFactory?: () => Worker;
  defaultCwd?: string;
  env?: Record<string, string>;
  wasmModuleUrl?: string;
  wasmInitInput?: string | URL | Request | BufferSource | WebAssembly.Module;
  requestTimeoutMs?: number;
}

export interface CodexCliBrowserSession {
  hostBridge: CodexHostBridge;
  ready: Promise<void>;
  run(args: string[], options?: CodexCliRunOptions): Promise<CodexCliRunResult>;
  dispose(): void;
}

export function createDefaultCodexCliWorker(): Worker {
  return new Worker(new URL("./cli-browser-worker.ts", import.meta.url), {
    name: "almostnode-codex-cli",
    type: "module",
  });
}

export function createCodexCliBrowserSession(
  options: CodexCliBrowserSessionOptions,
): CodexCliBrowserSession {
  const worker = options.worker ?? options.workerFactory?.() ?? createDefaultCodexCliWorker();
  const channel = new MessageChannel();
  const hostBridge = createCodexHostBridge({
    container: options.container,
    defaultCwd: options.defaultCwd,
    env: options.env,
  });
  hostBridge.attach(channel.port1);

  let disposed = false;
  const pending = new Map<
    string,
    {
      resolve: (value: CodexCliRunResult) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  let nextRunId = 1;

  const ready = waitForWorkerReady(worker);
  worker.addEventListener("message", onWorkerMessage);
  worker.postMessage(
    {
      type: "codex-cli/worker/start",
      port: channel.port2,
      wasmModuleUrl: options.wasmModuleUrl,
      wasmInitInput: options.wasmInitInput,
    } satisfies CodexCliWorkerMessage,
    [channel.port2],
  );

  return {
    hostBridge,
    ready,
    async run(args, runOptions) {
      if (disposed) {
        throw new Error("Codex CLI browser session is disposed.");
      }
      await ready;

      const id = `run_${nextRunId++}`;
      const timeoutMs = options.requestTimeoutMs;
      return new Promise<CodexCliRunResult>((resolve, reject) => {
        const timer =
          typeof timeoutMs === "number" && timeoutMs > 0
            ? setTimeout(() => {
                pending.delete(id);
                reject(new Error("Codex CLI browser run timed out."));
              }, timeoutMs)
            : null;
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({
          type: "codex-cli/worker/run",
          id,
          args,
          cwd: runOptions?.cwd ?? options.defaultCwd,
          env: { ...options.env, ...runOptions?.env },
          stdin: runOptions?.stdin,
          terminalSize: runOptions?.terminalSize,
        } satisfies CodexCliWorkerMessage);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener("message", onWorkerMessage);
      for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error("Codex CLI browser session disposed."));
      }
      pending.clear();
      hostBridge.dispose();
      channel.port1.close();
      worker.terminate();
    },
  };

  function onWorkerMessage(event: MessageEvent<unknown>) {
    const message = event.data as CodexCliWorkerMessage;
    if (message?.type !== "codex-cli/worker/runResult" && message?.type !== "codex-cli/worker/runError") {
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;

    pending.delete(message.id);
    if (entry.timer) clearTimeout(entry.timer);

    if (message.type === "codex-cli/worker/runResult") {
      entry.resolve(message.result);
      return;
    }

    entry.reject(Object.assign(new Error(message.error.message), { stack: message.error.stack }));
  }
}

function waitForWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: string; message?: string; stack?: string };
      if (message?.type === "codex-cli/worker/ready") {
        cleanup();
        resolve();
        return;
      }

      if (message?.type === "codex-cli/worker/error") {
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
