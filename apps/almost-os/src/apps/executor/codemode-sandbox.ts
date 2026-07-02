/**
 * The code-mode sandbox: model/user-written TypeScript runs inside a QuickJS
 * WASM VM (the same interpreter just-bash already ships in this bundle).
 *
 * Containment model (mirrors executor / Cloudflare Code Mode):
 *  - `fetch`/`XMLHttpRequest`/`WebSocket` throw; QuickJS has no other I/O.
 *  - the ONLY bridge out is the host function `__invokeTool(path, argsJson)`,
 *    reached through a concrete `tools` object built from the catalog
 *    (`await tools.github.createIssue({...})`).
 *  - auth is attached host-side by the invoker; secrets never enter the VM,
 *    and host failures arrive as structured, secret-free `{ok:false,error}`.
 *  - a wall-clock interrupt + memory limit bound runaway code.
 *
 * Async model: a SYNCHRONOUS QuickJS context where `__invokeTool` returns a
 * VM Promise resolved on the host, and `runtime.executePendingJobs()` is
 * pumped on each settlement. This (not asyncify) is what lets user code
 * `await` many tool calls — the release-asyncify build corrupts its stack
 * when an asyncified call follows an `await` suspension.
 *
 * TypeScript is stripped with sucrase before eval (type-only; no imports —
 * everything the code needs is on `tools`, `console`).
 */

import type { ExecutorRunLogEntry } from "./executor-types";

export interface CodeModeInvoker {
  (path: string, args: unknown): Promise<unknown>;
}

export interface ExecuteCodeOptions {
  code: string;
  invokeTool: CodeModeInvoker;
  /**
   * Dotted tool paths to expose on `tools` (source tools + the built-ins
   * `search`, `describe.tool`, `executor.sources.list`). Any path the code
   * calls that isn't here throws in-VM ("not a function") rather than
   * silently no-op'ing.
   */
  toolPaths: string[];
  /** Wall-clock budget including in-flight tool calls. Default 60s. */
  timeoutMs?: number;
  /** VM heap cap. Default 128 MiB. */
  memoryLimitBytes?: number;
}

export interface ExecuteCodeResult {
  ok: boolean;
  /** JSON-safe value returned by the code (via `return …`). */
  value?: unknown;
  error?: string;
  logs: ExecutorRunLogEntry[];
}

/** Console capture, the `tools` object, and disabled network primitives. */
const SANDBOX_PRELUDE = `
const __format = (args) => args.map((a) => {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}).join(" ");
const console = {
  log: (...a) => __consoleWrite("log", __format(a)),
  info: (...a) => __consoleWrite("log", __format(a)),
  debug: (...a) => __consoleWrite("log", __format(a)),
  warn: (...a) => __consoleWrite("warn", __format(a)),
  error: (...a) => __consoleWrite("error", __format(a)),
};
const __mkTool = (fullPath) => (arg) =>
  __invokeTool(fullPath, JSON.stringify(arg === undefined ? null : arg))
    .then((s) => (s === undefined || s === null ? undefined : JSON.parse(s)));
const tools = {};
for (const __p of JSON.parse(__TOOL_PATHS)) {
  const __parts = __p.split(".");
  let __node = tools;
  for (let __i = 0; __i < __parts.length - 1; __i++) {
    __node[__parts[__i]] = __node[__parts[__i]] || {};
    __node = __node[__parts[__i]];
  }
  __node[__parts[__parts.length - 1]] = __mkTool(__p);
}
const fetch = () => { throw new Error("fetch is disabled in the executor sandbox — call tools.* instead"); };
const XMLHttpRequest = fetch;
const WebSocket = fetch;
`;

/** Strip TypeScript types with sucrase (no imports/bundling). */
export async function stripTypes(code: string): Promise<string> {
  const { transform } = await import("sucrase");
  return transform(code, { transforms: ["typescript"] }).code;
}

/**
 * Execute one code-mode program. Fresh VM per run; every `tools.*` call goes
 * through `invokeTool` on the host.
 */
export async function executeCodeMode(options: ExecuteCodeOptions): Promise<ExecuteCodeResult> {
  const logs: ExecutorRunLogEntry[] = [];
  const timeoutMs = options.timeoutMs ?? 60_000;
  const memoryLimit = options.memoryLimitBytes ?? 128 * 1024 * 1024;

  let js: string;
  try {
    js = await stripTypes(options.code);
  } catch (error) {
    return {
      ok: false,
      error: `TypeScript parse error: ${error instanceof Error ? error.message : String(error)}`,
      logs,
    };
  }

  const { getQuickJS, shouldInterruptAfterDeadline } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const ctx = QuickJS.newContext();
  let disposed = false;
  let inflight = 0;

  try {
    ctx.runtime.setMemoryLimit(memoryLimit);
    ctx.runtime.setMaxStackSize(1024 * 1024);
    ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

    const consoleWrite = ctx.newFunction("__consoleWrite", (levelHandle, textHandle) => {
      const level = ctx.getString(levelHandle);
      logs.push({
        level: level === "warn" || level === "error" ? level : "log",
        text: ctx.getString(textHandle),
      });
    });
    ctx.setProp(ctx.global, "__consoleWrite", consoleWrite);
    consoleWrite.dispose();

    const invoke = ctx.newFunction("__invokeTool", (pathHandle, argsHandle) => {
      const path = ctx.getString(pathHandle);
      const argsJson = ctx.getString(argsHandle);
      let args: unknown;
      try {
        args = argsJson ? JSON.parse(argsJson) : undefined;
      } catch {
        args = undefined;
      }
      const promise = ctx.newPromise();
      inflight += 1;
      void Promise.resolve(options.invokeTool(path, args === null ? undefined : args))
        .then(
          (result) => {
            if (disposed) return;
            const handle = ctx.newString(JSON.stringify(result ?? null));
            promise.resolve(handle);
            handle.dispose();
          },
          (error) => {
            if (disposed) return;
            const handle = ctx.newString(error instanceof Error ? error.message : String(error));
            promise.reject(handle);
            handle.dispose();
          },
        )
        .finally(() => {
          inflight -= 1;
        });
      // Pump the VM job queue whenever a tool call settles so the awaiting
      // user code resumes (README §resolvePromise deadlock avoidance).
      promise.settled.then(() => {
        if (!disposed) ctx.runtime.executePendingJobs();
      });
      return promise.handle;
    });
    ctx.setProp(ctx.global, "__invokeTool", invoke);
    invoke.dispose();

    const pathsHandle = ctx.newString(JSON.stringify(options.toolPaths));
    ctx.setProp(ctx.global, "__TOOL_PATHS", pathsHandle);
    pathsHandle.dispose();

    // In-VM try/catch → a tagged result so a throw never becomes an
    // unhandled VM rejection (which trips a teardown refcount assert).
    const wrapped = `${SANDBOX_PRELUDE}\n`
      + `globalThis.__out = (async () => {\n`
      + `  try {\n`
      + `    const __run = async () => {\n${js}\n};\n`
      + `    return { __ok: true, value: await __run() };\n`
      + `  } catch (e) {\n`
      + `    const msg = e && e.message ? (e.name || "Error") + ": " + e.message : String(e);\n`
      + `    return { __ok: false, error: e && e.stack ? msg + "\\n" + e.stack : msg };\n`
      + `  }\n`
      + `})();`;

    const evalResult = ctx.evalCode(wrapped, "executor-codemode.mjs");
    if (evalResult.error) {
      const dumped = ctx.dump(evalResult.error);
      evalResult.error.dispose();
      return { ok: false, error: describeVmError(dumped), logs };
    }
    evalResult.value.dispose();
    ctx.runtime.executePendingJobs();

    const outHandle = ctx.getProp(ctx.global, "__out");
    const settled = ctx.resolvePromise(outHandle);
    ctx.runtime.executePendingJobs();

    // Guard against a host tool call that never resolves: the VM interrupt
    // handler only fires during VM execution, not while we await host work.
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const raced = await Promise.race([settled.then(() => "settled" as const), timeout]);
    outHandle.dispose();
    if (raced === "timeout") {
      return { ok: false, error: "Execution timed out waiting on a tool call.", logs };
    }
    const resolved = await settled;
    if (resolved.error) {
      const dumped = ctx.dump(resolved.error);
      resolved.error.dispose();
      return { ok: false, error: describeVmError(dumped), logs };
    }
    const outcome = ctx.dump(resolved.value) as { __ok: boolean; value?: unknown; error?: string };
    resolved.value.dispose();
    if (outcome && outcome.__ok === false) {
      return { ok: false, error: describeVmError(outcome.error ?? "Error"), logs };
    }
    return { ok: true, value: outcome?.value, logs };
  } finally {
    disposed = true;
    try {
      ctx.dispose();
    } catch {
      // A leaked-handle assert must not mask the run's actual result.
    }
  }
}

function describeVmError(dumped: unknown): string {
  if (typeof dumped === "object" && dumped !== null) {
    const err = dumped as { name?: string; message?: string; stack?: string };
    const name = err.name ?? "Error";
    const message = err.message ?? JSON.stringify(dumped);
    const stack = typeof err.stack === "string" ? `\n${err.stack.trim()}` : "";
    if (name === "InternalError" && /interrupted/i.test(message)) {
      return "Execution interrupted — the run exceeded its time budget.";
    }
    return `${name}: ${message}${stack}`;
  }
  const text = String(dumped);
  if (/interrupted/i.test(text)) {
    return "Execution interrupted — the run exceeded its time budget.";
  }
  return text;
}
