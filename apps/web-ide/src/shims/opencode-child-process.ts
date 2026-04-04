import { EventEmitter } from "../../../../packages/almostnode/src/shims/events.ts";
import { AsyncLocalStorage } from "async_hooks";
import path from "path";
import { PassThrough } from "stream";
import { promisify } from "node:util";
import { _vfs_addDir, _vfs_getFile, _vfs_readdir } from "../../../../vendor/opencode/packages/browser/src/shims/fs.browser.ts";
import { listWorkspaceFiles, searchWorkspaceFiles } from "./opencode-ripgrep-shared.ts";

export interface BrowserProcessBridge {
  exec(input: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    shell?: boolean | string;
    signal?: AbortSignal;
  }): Promise<{ stdout: string; stderr: string; code: number }>;
  spawn?(input: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    shell?: boolean | string;
    signal?: AbortSignal;
    onStdout: (data: string) => void;
    onStderr: (data: string) => void;
    onExit: (code: number, signal: string | null) => void;
  }): BrowserSpawnHandle;
}

export interface BrowserSpawnHandle {
  write(data: string): void;
  end(): void;
  kill(signal?: string | number): void;
}

interface BrowserExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  shell?: boolean | string;
  signal?: AbortSignal;
  encoding?: BufferEncoding | "buffer" | null;
  maxBuffer?: number;
  timeout?: number;
}

type BrowserExecCallback = (
  error: (Error & {
    code?: number;
    killed?: boolean;
    signal?: string | null;
    cmd?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  }) | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

let processBridge: BrowserProcessBridge | null = null;
const scopedProcessBridge = new AsyncLocalStorage<BrowserProcessBridge>();

export function attachProcessBridge(bridge: BrowserProcessBridge): void {
  processBridge = bridge;
}

export function detachProcessBridge(): void {
  processBridge = null;
}

export function withProcessBridgeScope<T>(
  bridge: BrowserProcessBridge | null | undefined,
  fn: () => T,
): T {
  if (!bridge) {
    return fn();
  }

  return scopedProcessBridge.run(bridge, fn);
}

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  pid = 1;
  exitCode: number | null = null;
  killed = false;

  kill(_signal?: string | number) {
    this.killed = true;
    this.exitCode = 137;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 137, "SIGTERM");
    this.emit("close", 137, "SIGTERM");
  }
}

function normalizeSpawnInput(
  command: string,
  argsOrOpts?: string[] | Record<string, unknown>,
  maybeOpts?: Record<string, unknown>,
): { args: string[]; opts: Record<string, unknown> } {
  if (Array.isArray(argsOrOpts)) {
    return { args: argsOrOpts, opts: maybeOpts || {} };
  }

  return { args: [], opts: argsOrOpts || {} };
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeExecInput(
  optionsOrCallback?: BrowserExecOptions | BrowserExecCallback,
  maybeCallback?: BrowserExecCallback,
): {
  options: BrowserExecOptions;
  callback?: BrowserExecCallback;
} {
  if (typeof optionsOrCallback === "function") {
    return {
      options: {},
      callback: optionsOrCallback,
    };
  }

  return {
    options: optionsOrCallback ?? {},
    callback: maybeCallback,
  };
}

function toExecOutput(
  value: string,
  encoding?: BufferEncoding | "buffer" | null,
): string | Buffer {
  if (encoding === "buffer" || encoding === null) {
    return Buffer.from(value);
  }

  return value;
}

function createExecError(
  command: string,
  code: number,
  stdout: string | Buffer,
  stderr: string | Buffer,
): Error & {
  code?: number;
  killed?: boolean;
  signal?: string | null;
  cmd?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
} {
  const stderrText = typeof stderr === "string" ? stderr : stderr.toString();
  const error = new Error(stderrText || `Command failed: ${command}`) as Error & {
    code?: number;
    killed?: boolean;
    signal?: string | null;
    cmd?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  error.code = code;
  error.killed = false;
  error.signal = null;
  error.cmd = command;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function isRgCommand(command: string): boolean {
  const base = path.posix.basename(command).toLowerCase();
  return base === "rg" || base === "rg.exe";
}

function normalizeSearchPath(input: string | undefined, cwd: string): string {
  if (!input || input === ".") {
    return cwd;
  }
  if (input.startsWith("/")) {
    return input;
  }
  return path.posix.join(cwd, input);
}

function parseRipgrepArgs(args: string[], cwd: string) {
  const glob: string[] = [];
  let searchRoot = cwd;
  let hidden = false;
  let maxDepth: number | undefined;
  let limit: number | undefined;
  let pattern: string | undefined;
  let json = false;
  let separator = ":";
  let filesMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--files") {
      filesMode = true;
      continue;
    }
    if (arg === "--hidden") {
      hidden = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--glob=")) {
      glob.push(arg.slice("--glob=".length));
      continue;
    }
    if (arg === "--glob") {
      const next = args[index + 1];
      if (next) {
        glob.push(next);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--max-depth=")) {
      maxDepth = Number(arg.slice("--max-depth=".length));
      continue;
    }
    if (arg.startsWith("--max-count=")) {
      limit = Number(arg.slice("--max-count=".length));
      continue;
    }
    if (arg.startsWith("--field-match-separator=")) {
      separator = arg.slice("--field-match-separator=".length);
      continue;
    }
    if (arg === "--regexp") {
      pattern = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--") {
      pattern = args[index + 1];
      break;
    }
    if (!arg.startsWith("-")) {
      if (filesMode || pattern) {
        searchRoot = normalizeSearchPath(arg, cwd);
      } else if (!pattern) {
        pattern = arg;
      }
    }
  }

  return {
    filesMode,
    searchRoot,
    hidden,
    maxDepth,
    limit,
    pattern,
    json,
    separator,
    glob,
  };
}

function runRipgrep(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const parsed = parseRipgrepArgs(args, cwd);

    if (parsed.filesMode) {
      const files = listWorkspaceFiles({
        cwd: parsed.searchRoot,
        glob: parsed.glob,
        hidden: parsed.hidden,
        maxDepth: parsed.maxDepth,
      }).map((file) => file.relativePath);

      return {
        stdout: files.join("\n") + (files.length > 0 ? "\n" : ""),
        stderr: "",
        code: 0,
      };
    }

    if (!parsed.pattern) {
      return { stdout: "", stderr: "rg: missing pattern", code: 2 };
    }

    const matches = searchWorkspaceFiles({
      cwd: parsed.searchRoot,
      pattern: parsed.pattern,
      glob: parsed.glob,
      hidden: parsed.hidden,
      limit: parsed.limit,
    });

    if (matches.length === 0) {
      return { stdout: "", stderr: "", code: 1 };
    }

    if (parsed.json) {
      return {
        stdout:
          matches
            .map((match) =>
              JSON.stringify({
                type: "match",
                data: {
                  path: { text: match.absolutePath },
                  lines: { text: `${match.lineText}\n` },
                  line_number: match.lineNumber,
                  absolute_offset: match.absoluteOffset,
                  submatches: match.submatches.map((entry) => ({
                    match: { text: entry.text },
                    start: entry.start,
                    end: entry.end,
                  })),
                },
              }),
            )
            .join("\n") + "\n",
        stderr: "",
        code: 0,
      };
    }

    return {
      stdout:
        matches
          .map((match) => `${match.absolutePath}${parsed.separator}${match.lineNumber}${parsed.separator}${match.lineText}`)
          .join("\n") + "\n",
      stderr: "",
      code: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: message, code: 2 };
  }
}

async function executeCommand(
  command: string,
  args: string[],
  opts: Record<string, unknown> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cwd = typeof opts.cwd === "string"
    ? opts.cwd
    : typeof globalThis.process?.cwd === "function"
      ? globalThis.process.cwd()
      : "/workspace";

  if (isRgCommand(command)) {
    return runRipgrep(args, cwd);
  }

  const bridge = scopedProcessBridge.getStore() ?? processBridge;
  if (bridge) {
    return bridge.exec({
      command,
      args,
      cwd,
      env: typeof opts.env === "object" && opts.env ? (opts.env as Record<string, string>) : undefined,
      stdin: typeof opts.input === "string" ? opts.input : undefined,
      shell: typeof opts.shell === "string" || typeof opts.shell === "boolean" ? opts.shell : undefined,
      signal: opts.signal instanceof AbortSignal ? opts.signal : undefined,
    });
  }

  if ((command === "sh" || command === "bash") && args[0] === "-c" && args[1]) {
    return executeCommand(args[1], [], { ...opts, shell: true });
  }

  if (opts.shell) {
    return {
      stdout: "",
      stderr: `[browser sandbox] Shell execution is unavailable for '${command}'.`,
      code: 127,
    };
  }

  if (command === "echo") {
    return { stdout: `${args.join(" ")}\n`, stderr: "", code: 0 };
  }

  if (command === "cat") {
    const content = _vfs_getFile(normalizeSearchPath(args[0], cwd));
    if (content !== undefined) {
      return { stdout: content, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: `cat: ${args[0]}: No such file or directory`, code: 1 };
  }

  if (command === "ls") {
    try {
      const dir = normalizeSearchPath(args[0] || cwd, cwd);
      const entries = _vfs_readdir(dir);
      return { stdout: `${entries.map((entry) => entry.name).join("\n")}\n`, stderr: "", code: 0 };
    } catch {
      return { stdout: "", stderr: `ls: cannot access '${args[0]}': No such file or directory`, code: 1 };
    }
  }

  if (command === "pwd") {
    return { stdout: `${cwd}\n`, stderr: "", code: 0 };
  }

  if (command === "mkdir") {
    for (const arg of args.filter((value) => !value.startsWith("-"))) {
      _vfs_addDir(normalizeSearchPath(arg, cwd));
    }
    return { stdout: "", stderr: "", code: 0 };
  }

  if (command === "which" || command === "where") {
    return { stdout: "", stderr: `${args[0]}: not found`, code: 1 };
  }

  return {
    stdout: "",
    stderr: `[browser sandbox] Command '${[command, ...args].join(" ")}' is unavailable without a host bridge.`,
    code: 127,
  };
}

export async function runBrowserCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  shell?: boolean | string;
  signal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  return executeCommand(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: input.env,
    input: input.stdin,
    shell: input.shell,
    signal: input.signal,
  });
}

export function spawn(command: string, argsOrOpts?: unknown, maybeOpts?: Record<string, unknown>): FakeChildProcess {
  const { args, opts } = normalizeSpawnInput(command, argsOrOpts as string[] | Record<string, unknown>, maybeOpts);
  const bridge = scopedProcessBridge.getStore() ?? processBridge;
  if (bridge?.spawn) {
    const child = new FakeChildProcess();
    const cwd = typeof opts.cwd === "string"
      ? opts.cwd
      : typeof globalThis.process?.cwd === "function"
        ? globalThis.process.cwd()
        : "/workspace";

    const handle = bridge.spawn({
      command,
      args,
      cwd,
      env: typeof opts.env === "object" && opts.env ? (opts.env as Record<string, string>) : undefined,
      shell: typeof opts.shell === "string" || typeof opts.shell === "boolean" ? opts.shell : undefined,
      signal: opts.signal instanceof AbortSignal ? opts.signal : undefined,
      onStdout: (data) => {
        child.stdout.write(data);
      },
      onStderr: (data) => {
        child.stderr.write(data);
      },
      onExit: (code, signal) => {
        child.stdout.end();
        child.stderr.end();
        child.exitCode = code;
        child.emit("exit", code, signal);
        child.emit("close", code, signal);
      },
    });

    child.stdin.on("data", (data: Buffer | string) => {
      handle.write(data.toString());
    });
    child.stdin.on("end", () => {
      handle.end();
    });
    child.kill = (signal?: string | number) => {
      child.killed = true;
      handle.kill(signal);
      return true;
    };

    queueMicrotask(() => {
      child.emit("spawn");
    });

    return child;
  }

  const child = new FakeChildProcess();

  setTimeout(async () => {
    try {
      const result = await executeCommand(command, args, opts);
      if (result.stdout) {
        child.stdout.end(result.stdout);
      } else {
        child.stdout.end();
      }
      if (result.stderr) {
        child.stderr.end(result.stderr);
      } else {
        child.stderr.end();
      }
      child.exitCode = result.code;
      child.emit("exit", result.code, null);
      child.emit("close", result.code, null);
    } catch (error) {
      child.stderr.end(error instanceof Error ? error.message : String(error));
      child.stdout.end();
      child.exitCode = 1;
      child.emit("exit", 1, null);
      child.emit("close", 1, null);
    }
  }, 0);

  return child;
}

export function execSync(command: string): string {
  return `[browser] Command not available: ${command}`;
}

export function exec(
  command: string,
  optionsOrCallback?: BrowserExecOptions | BrowserExecCallback,
  maybeCallback?: BrowserExecCallback,
): FakeChildProcess {
  const { options, callback } = normalizeExecInput(optionsOrCallback, maybeCallback);
  const child = spawn("sh", ["-c", command], options as Record<string, unknown>);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer | string) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer | string) => {
    stderr += data.toString();
  });
  child.on("close", (code: number) => {
    if (callback) {
      const stdoutResult = toExecOutput(stdout, options.encoding);
      const stderrResult = toExecOutput(stderr, options.encoding);
      callback(
        code ? createExecError(command, code, stdoutResult, stderrResult) : null,
        stdoutResult,
        stderrResult,
      );
    }
  });
  return child;
}

(exec as typeof exec & {
  [promisify.custom]?: (
    command: string,
    options?: BrowserExecOptions,
  ) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
})[promisify.custom] = (
  command: string,
  options?: BrowserExecOptions,
) => new Promise((resolve, reject) => {
  exec(command, options, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }

    resolve({ stdout, stderr });
  });
});

export function execFile(
  file: string,
  argsOrOptions?: string[] | BrowserExecOptions | BrowserExecCallback,
  optionsOrCallback?: BrowserExecOptions | BrowserExecCallback,
  maybeCallback?: BrowserExecCallback,
): FakeChildProcess {
  let args: string[] = [];
  let options: BrowserExecOptions | undefined;
  let callback: BrowserExecCallback | undefined;

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    } else {
      options = optionsOrCallback;
      callback = maybeCallback;
    }
  } else if (typeof argsOrOptions === "function") {
    callback = argsOrOptions;
  } else {
    options = argsOrOptions;
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    } else {
      callback = maybeCallback;
    }
  }

  const command = [file, ...args.map(quoteShellArg)].join(" ");
  return exec(command, options, callback);
}

export function fork(): never {
  throw new Error("fork() not available in browser");
}

export function spawnSync(command: string, args: string[] = []) {
  if (isRgCommand(command)) {
    const cwd = typeof globalThis.process?.cwd === "function"
      ? globalThis.process.cwd()
      : "/workspace";
    const result = runRipgrep(args, cwd);
    return {
      status: result.code,
      stdout: Buffer.from(result.stdout),
      stderr: Buffer.from(result.stderr),
      error: null,
    };
  }

  return {
    status: 0,
    stdout: Buffer.from(`[browser] ${command} ${args.join(" ")}`),
    stderr: Buffer.from(""),
    error: null,
  };
}

export default {
  spawn,
  exec,
  execSync,
  execFile,
  fork,
  spawnSync,
  attachProcessBridge,
  detachProcessBridge,
  withProcessBridgeScope,
};
