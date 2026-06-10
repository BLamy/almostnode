import type { CodexHostOperation, CodexHostResponse } from "./host-bridge";
import { runBrowserExecPlan } from "./browser-exec";
import { installCodexZstdCompression } from "./zstd-compression";
import type {
  CodexCliBrowserExecPlan,
  CodexCliBrowserLoginRequest,
  CodexCliBrowserTuiAction,
  CodexCliBrowserTuiResult,
  CodexCliRunOptions,
  CodexCliRunResult,
  CodexCliWorkerErrorMessage,
  CodexCliWorkerMessage,
  CodexCliWorkerReadyMessage,
  CodexCliWorkerRunErrorMessage,
  CodexCliWorkerRunMessage,
  CodexCliWorkerRunResultMessage,
  CodexCliWorkerStartMessage,
} from "./types";

interface WasmCodexCli {
  start?(port: MessagePort): void | Promise<void>;
  run(
    args: string[],
    options?: CodexCliRunOptions,
  ): CodexCliRunResult | Promise<CodexCliRunResult>;
  dispose?(): void;
}

interface WasmCodexCliModule {
  default?: (input?: unknown) => Promise<unknown> | unknown;
  CodexCliWasm?: new () => WasmCodexCli;
  createCodexCliWasm?: () => WasmCodexCli | Promise<WasmCodexCli>;
}

let activeCli: WasmCodexCli | null = null;
let activeHostPort: MessagePort | null = null;
let detachHostPort: (() => void) | null = null;
let starting: Promise<void> | null = null;
let nextHostRequestId = 1;
const pendingHostRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }
>();

self.onmessage = (event: MessageEvent<CodexCliWorkerMessage>) => {
  const message = event.data;
  if (!message) return;

  if (message.type === "codex-cli/worker/start") {
    starting = startCodexCliWorker(message);
    return;
  }

  if (message.type === "codex-cli/worker/run") {
    void runCodexCli(message);
  }
};

async function startCodexCliWorker(
  message: CodexCliWorkerStartMessage,
): Promise<void> {
  try {
    activeCli?.dispose?.();
    activeCli = null;
    attachHostPort(message.port);

    if (!message.wasmModuleUrl) {
      throw new Error(
        "Codex CLI WASM adapter is not configured. Build the adapter and pass wasmModuleUrl before running codex.",
      );
    }

    const module = (await import(
      /* @vite-ignore */ message.wasmModuleUrl
    )) as WasmCodexCliModule;

    await installCodexZstdCompression();

    if (module.default) {
      await module.default({ module_or_path: message.wasmInitInput });
    }

    const cli = module.createCodexCliWasm
      ? await module.createCodexCliWasm()
      : module.CodexCliWasm
        ? new module.CodexCliWasm()
        : null;

    if (!cli) {
      throw new Error(
        "Codex CLI WASM module did not export CodexCliWasm or createCodexCliWasm.",
      );
    }

    await cli.start?.(message.port);
    activeCli = cli;
    self.postMessage({
      type: "codex-cli/worker/ready",
      supportsRealCodex: true,
    } satisfies CodexCliWorkerReadyMessage);
  } catch (error) {
    self.postMessage(serializeWorkerError(error));
  }
}

async function runCodexCli(message: CodexCliWorkerRunMessage): Promise<void> {
  try {
    if (starting) {
      await starting;
    }
    if (!activeCli) {
      throw new Error("Codex CLI WASM adapter is not ready.");
    }

    const options = {
      cwd: message.cwd,
      env: message.env,
      stdin: message.stdin,
      terminalSize: message.terminalSize,
    } satisfies CodexCliRunOptions;

    const codexResult = normalizeRunResult(
      await activeCli.run(message.args, options),
    );
    const result = codexResult.browserExec
      ? await runBrowserExecPlan(
          codexResult.browserExec,
          options,
          activeHostPort
            ? {
                request: requestHost,
              }
            : undefined,
        )
      : codexResult;

    self.postMessage({
      type: "codex-cli/worker/runResult",
      id: message.id,
      result,
    } satisfies CodexCliWorkerRunResultMessage);
  } catch (error) {
    self.postMessage({
      type: "codex-cli/worker/runError",
      id: message.id,
      error: serializeErrorPayload(error),
    } satisfies CodexCliWorkerRunErrorMessage);
  }
}

function attachHostPort(port: MessagePort): void {
  detachHostPort?.();
  for (const entry of pendingHostRequests.values()) {
    entry.reject(new Error("Codex CLI host bridge was restarted."));
  }
  pendingHostRequests.clear();

  activeHostPort = port;
  const listener = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isHostResponse(message)) return;

    const entry = pendingHostRequests.get(message.id);
    if (!entry) return;

    pendingHostRequests.delete(message.id);
    if (message.error) {
      entry.reject(new Error(message.error.message));
      return;
    }

    entry.resolve(message.result);
  };

  port.addEventListener("message", listener);
  port.start?.();
  detachHostPort = () => {
    port.removeEventListener("message", listener);
    if (activeHostPort === port) activeHostPort = null;
  };
}

function requestHost(
  op: CodexHostOperation,
  params?: unknown,
): Promise<unknown> {
  if (!activeHostPort) {
    return Promise.reject(new Error("Codex CLI host bridge is not attached."));
  }

  const id = `codex_cli_${nextHostRequestId++}`;
  return new Promise((resolve, reject) => {
    pendingHostRequests.set(id, { resolve, reject });
    activeHostPort?.postMessage({
      type: "codex/host/request",
      id,
      op,
      params,
    });
  });
}

function isHostResponse(value: unknown): value is CodexHostResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "codex/host/response" && typeof record.id === "string";
}

function normalizeRunResult(value: unknown): CodexCliRunResult {
  if (!value || typeof value !== "object") {
    throw new Error("Codex CLI WASM run() did not return an object.");
  }

  const record = value as Record<string, unknown>;
  const result: CodexCliRunResult = {
    stdout: typeof record.stdout === "string" ? record.stdout : "",
    stderr: typeof record.stderr === "string" ? record.stderr : "",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : 0,
  };
  const env = normalizeStringRecord(record.env);
  if (env) {
    result.env = env;
  }
  const browserExec = normalizeBrowserExecPlan(record.browserExec);
  if (browserExec) {
    result.browserExec = browserExec;
  }
  const browserLogin = normalizeBrowserLoginRequest(record.browserLogin);
  if (browserLogin) {
    result.browserLogin = browserLogin;
  }
  const browserTui = normalizeBrowserTuiResult(record.browserTui);
  if (browserTui) {
    result.browserTui = browserTui;
  }
  return result;
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (typeof rawValue === "string") {
      out[key] = rawValue;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBrowserExecPlan(
  value: unknown,
): CodexCliBrowserExecPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.prompt !== "string" ||
    typeof record.model !== "string" ||
    typeof record.instructions !== "string" ||
    typeof record.toolChoice !== "string" ||
    typeof record.parallelToolCalls !== "boolean" ||
    typeof record.store !== "boolean" ||
    typeof record.stream !== "boolean"
  ) {
    throw new Error(
      "Codex CLI browserExec plan must include prompt, model, instructions, toolChoice, parallelToolCalls, store, and stream.",
    );
  }
  const rawWarnings = record.warnings;
  return {
    prompt: record.prompt,
    model: record.model,
    instructions: record.instructions,
    toolChoice: record.toolChoice,
    parallelToolCalls: record.parallelToolCalls,
    store: record.store,
    stream: record.stream,
    json: record.json === true,
    outputLastMessagePath:
      typeof record.outputLastMessagePath === "string"
        ? record.outputLastMessagePath
        : undefined,
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    applyPatchGrammar:
      typeof record.applyPatchGrammar === "string"
        ? record.applyPatchGrammar
        : undefined,
    warnings: Array.isArray(rawWarnings)
      ? rawWarnings.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

function normalizeBrowserLoginRequest(
  value: unknown,
): CodexCliBrowserLoginRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "chatgpt") {
    return { type: "chatgpt" };
  }
  if (record.type === "deviceCode") {
    return { type: "deviceCode" };
  }
  throw new Error(
    "Codex CLI browserLogin request must include a supported type.",
  );
}

function normalizeBrowserTuiResult(
  value: unknown,
): CodexCliBrowserTuiResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.ansi !== "string") {
    throw new Error("Codex CLI browserTui result must include ansi output.");
  }
  const cursor = normalizeBrowserTuiCursor(record.cursor);
  const scrollbackAnsi =
    typeof record.scrollbackAnsi === "string" &&
    record.scrollbackAnsi.length > 0
      ? record.scrollbackAnsi
      : undefined;
  return {
    ansi: record.ansi,
    action: normalizeBrowserTuiAction(record.action),
    ...(scrollbackAnsi ? { scrollbackAnsi } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

function normalizeBrowserTuiCursor(
  value: unknown,
): CodexCliBrowserTuiResult["cursor"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : NaN;
  const y = typeof record.y === "number" ? record.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
  };
}

function normalizeBrowserTuiAction(value: unknown): CodexCliBrowserTuiAction {
  if (!value || typeof value !== "object") {
    return { type: "none" };
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "login":
      return { type: "login" };
    case "exec":
      if (typeof record.prompt !== "string") {
        throw new Error(
          "Codex CLI browserTui exec action must include prompt.",
        );
      }
      return { type: "exec", prompt: record.prompt };
    case "shell":
      if (typeof record.command !== "string") {
        throw new Error(
          "Codex CLI browserTui shell action must include command.",
        );
      }
      return { type: "shell", command: record.command };
    case "exit":
      return {
        type: "exit",
        exitCode: typeof record.exitCode === "number" ? record.exitCode : 0,
      };
    default:
      return { type: "none" };
  }
}

function serializeWorkerError(error: unknown): CodexCliWorkerErrorMessage {
  const payload = serializeErrorPayload(error);
  return {
    type: "codex-cli/worker/error",
    message: payload.message,
    stack: payload.stack,
  };
}

function serializeErrorPayload(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}
