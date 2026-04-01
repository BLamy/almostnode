import type { TerminalSession } from "almostnode";
import { WORKSPACE_ROOT } from "./workspace-seed";
import type { ReturnTypeOfCreateContainer } from "../workbench/workbench-host";
import { configureBrowserProcess } from "../shims/node-process";
import "../../../../vendor/opencode/packages/browser/src/shims/bun.browser";
import { createOpencodeClient } from "../../../../vendor/opencode/packages/browser/src/shims/opencode-sdk.browser";
import {
  withProcessBridgeScope,
} from "../shims/opencode-child-process";
import {
  initBrowserDB,
  exportBrowserDBSnapshot,
  importBrowserDBSnapshot,
  isRecoverableBrowserDBError,
  resetBrowserDB,
} from "../../../../vendor/opencode/packages/browser/src/shims/db.browser";
import {
  withWorkspaceBridgeScope,
} from "../../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { Server } from "../../../../vendor/opencode/packages/opencode/src/server/server";
import { Database } from "../../../../vendor/opencode/packages/opencode/src/storage/db";

declare const __OPENTUI_WASM_URL__: string;

type OpenCodeBrowserModule = typeof import("opencode-browser-tui");

export type OpenCodeThemeMode = "dark" | "light";

export interface OpenCodeBrowserShellState {
  cwd: string;
  env: Record<string, string>;
}

export interface OpenCodeBrowserLaunchArgs {
  continue?: boolean;
  sessionID?: string;
  fork?: boolean;
}

export interface OpenCodeBrowserSessionOptions {
  container: ReturnTypeOfCreateContainer;
  element: HTMLElement;
  cwd: string;
  env: Record<string, string>;
  themeMode: OpenCodeThemeMode;
  args?: OpenCodeBrowserLaunchArgs;
  onTitleChange?: (title: string) => void;
}

export interface OpenCodeBrowserSessionHandle {
  exited: Promise<void>;
  dispose(): void;
  getShellState(): OpenCodeBrowserShellState;
  setThemeMode(themeMode: OpenCodeThemeMode): void;
}

export interface OpenCodeBrowserSessionSummary {
  id: string;
  title: string;
  parentID?: string;
  time?: {
    created: number;
    updated: number;
  };
}

let browserDbRecoveryPromise: Promise<void> | null = null;

function ensureBrowserProcess(cwd: string, env: Record<string, string>): void {
  globalThis.process = configureBrowserProcess({
    cwd,
    env: {
      ...(globalThis.process?.env || {}),
      ...env,
    },
  }) as typeof globalThis.process;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getShellCommandFromInvocation(
  command: string,
  args: string[],
): string | null {
  const base = command.split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  const normalizedBase = base.endsWith(".exe") ? base.slice(0, -4) : base;
  const isShell =
    normalizedBase === "sh" ||
    normalizedBase === "bash" ||
    normalizedBase === "zsh" ||
    normalizedBase === "fish" ||
    normalizedBase === "nu" ||
    normalizedBase === "cmd" ||
    normalizedBase === "powershell" ||
    normalizedBase === "pwsh";

  if (!isShell || args.length === 0) {
    return null;
  }

  if (normalizedBase === "bash" || normalizedBase === "zsh") {
    const script = args.at(-1);
    if (!script) {
      return null;
    }

    const evalMatch = /eval\s+("(?:(?:\\.|[^"])*)"|'(?:\\.|[^'])*')\s*$/s.exec(
      script,
    );
    if (!evalMatch) {
      return script;
    }

    const quotedCommand = evalMatch[1];
    if (quotedCommand.startsWith('"')) {
      try {
        return JSON.parse(quotedCommand) as string;
      } catch {
        return script;
      }
    }

    return quotedCommand.slice(1, -1);
  }

  if (args.includes("-c") || args.includes("/c") || args.includes("-Command")) {
    return args.at(-1) ?? null;
  }

  return null;
}

function toContainerPath(path: string): string {
  if (path === "/workspace") return WORKSPACE_ROOT;
  if (path.startsWith("/workspace/")) {
    return `${WORKSPACE_ROOT}${path.slice("/workspace".length)}`;
  }
  return path;
}

function toOpenCodePath(path: string): string {
  if (path === WORKSPACE_ROOT) return "/workspace";
  if (path.startsWith(`${WORKSPACE_ROOT}/`)) {
    return `/workspace${path.slice(WORKSPACE_ROOT.length)}`;
  }
  return "/workspace";
}

function createWorkspaceBridge(container: ReturnTypeOfCreateContainer) {
  const vfs = container.vfs;

  return {
    exists(path: string): boolean {
      const mapped = toContainerPath(path);
      return mapped === WORKSPACE_ROOT || vfs.existsSync(mapped);
    },
    mkdir(path: string): void {
      vfs.mkdirSync(toContainerPath(path), { recursive: true });
    },
    readFile(path: string): string | undefined {
      const mapped = toContainerPath(path);
      try {
        if (vfs.statSync(mapped).isDirectory()) return undefined;
        return String(vfs.readFileSync(mapped, "utf8"));
      } catch {
        return undefined;
      }
    },
    writeFile(path: string, content: string): void {
      const mapped = toContainerPath(path);
      const directory = mapped.slice(0, mapped.lastIndexOf("/"));
      if (directory) {
        vfs.mkdirSync(directory, { recursive: true });
      }
      vfs.writeFileSync(mapped, content);
    },
    readdir(path: string) {
      const mapped = toContainerPath(path);
      if (!vfs.existsSync(mapped)) {
        return [];
      }

      return (vfs.readdirSync(mapped) as string[]).map((name) => {
        const stat = vfs.statSync(`${mapped}/${name}`);
        return {
          name,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile(),
          isSymbolicLink: () => false,
        };
      });
    },
    stat(path: string) {
      try {
        return vfs.statSync(toContainerPath(path));
      } catch {
        return undefined;
      }
    },
    remove(path: string, options?: { recursive?: boolean }) {
      const mapped = toContainerPath(path);
      if (!vfs.existsSync(mapped)) {
        return;
      }

      if (vfs.statSync(mapped).isDirectory()) {
        vfs.rmSync(mapped, {
          recursive: Boolean(options?.recursive),
          force: true,
        });
        return;
      }

      vfs.unlinkSync(mapped);
    },
    rename(oldPath: string, newPath: string) {
      vfs.renameSync(toContainerPath(oldPath), toContainerPath(newPath));
    },
    listFiles(root = "/workspace"): string[] {
      const mapped = toContainerPath(root);
      if (!vfs.existsSync(mapped)) {
        return [];
      }

      const files: string[] = [];
      const visit = (currentPath: string) => {
        const stat = vfs.statSync(currentPath);
        if (stat.isDirectory()) {
          for (const entry of vfs.readdirSync(currentPath) as string[]) {
            visit(`${currentPath}/${entry}`);
          }
          return;
        }

        files.push(toOpenCodePath(currentPath));
      };

      visit(mapped);
      files.sort((left, right) => left.localeCompare(right));
      return files;
    },
  };
}

function createProcessBridge(session: TerminalSession) {
  let pending = Promise.resolve<void>(undefined);

  return {
    async exec(input: {
      command: string;
      args: string[];
      cwd?: string;
      signal?: AbortSignal;
      shell?: boolean | string;
    }) {
      const run = async () => {
        const nextCwd = input.cwd ? toContainerPath(input.cwd) : null;
        const state = session.getState();
        const shellCommand = getShellCommandFromInvocation(
          input.command,
          input.args,
        );
        const commandString =
          shellCommand ??
          (input.shell || input.args.length === 0
            ? input.command
            : [
                quoteShellArg(input.command),
                ...input.args.map(quoteShellArg),
              ].join(" "));
        const fullCommand =
          nextCwd && nextCwd !== state.cwd
            ? `cd ${quoteShellArg(nextCwd)} && ${commandString}`
            : commandString;

        const result = await session.run(fullCommand, {
          signal: input.signal,
        });

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.exitCode,
        };
      };

      const resultPromise = pending.then(run, run);
      pending = resultPromise.then(
        () => undefined,
        () => undefined,
      );
      return resultPromise;
    },
  };
}

function withScopedBrowserBridges<T>(
  workspaceBridge: ReturnType<typeof createWorkspaceBridge>,
  processBridge: ReturnType<typeof createProcessBridge>,
  fn: () => T,
): T {
  return withWorkspaceBridgeScope(workspaceBridge, () =>
    withProcessBridgeScope(processBridge, fn),
  );
}

function scopeResponseBody(
  response: Response,
  runWithScope: <T>(fn: () => T) => T,
): Response {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const scopedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await runWithScope(() => reader.read());
      if (result.done) {
        controller.close();
        return;
      }

      controller.enqueue(result.value);
    },
    async cancel(reason) {
      await runWithScope(() => reader.cancel(reason));
    },
  });

  return new Response(scopedBody, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

function createInternalFetch(
  workspaceBridge: ReturnType<typeof createWorkspaceBridge>,
  processBridge: ReturnType<typeof createProcessBridge>,
): typeof fetch {
  const runWithScope = <T>(fn: () => T) =>
    withScopedBrowserBridges(workspaceBridge, processBridge, fn);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await runWithScope(() => Server.Default().fetch(request));
    return scopeResponseBody(response, runWithScope);
  }) as typeof fetch;
}

async function withOpenCodeBrowserRuntime<T>(
  options: Pick<OpenCodeBrowserSessionOptions, "container" | "cwd" | "env">,
  callback: (client: ReturnType<typeof createOpencodeClient>) => Promise<T>,
): Promise<T> {
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    env: options.env,
  });
  const workspaceBridge = createWorkspaceBridge(options.container);
  const processBridge = createProcessBridge(bridgeSession);

  ensureBrowserProcess(options.cwd, options.env);

  try {
    await initBrowserDB();
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      directory: toOpenCodePath(options.cwd),
      fetch: createInternalFetch(workspaceBridge, processBridge),
    });
    return await callback(client);
  } finally {
    bridgeSession.dispose();
  }
}

export async function listOpenCodeBrowserSessions(
  options: Pick<OpenCodeBrowserSessionOptions, "container" | "cwd" | "env">,
): Promise<OpenCodeBrowserSessionSummary[]> {
  const listSessions = () => withOpenCodeBrowserRuntime(options, async (client) => {
    const sessions = await client.session.list();
    return Array.isArray(sessions)
      ? sessions as OpenCodeBrowserSessionSummary[]
      : [];
  });

  try {
    return await listSessions();
  } catch (error) {
    if (!isRecoverableBrowserDBError(error)) {
      throw error;
    }

    if (!browserDbRecoveryPromise) {
      browserDbRecoveryPromise = (async () => {
        console.warn(
          "[opencode-browser] Recovering browser database after /session failed.",
          error,
        );
        Database.Client.reset();
        await resetBrowserDB();
      })().finally(() => {
        browserDbRecoveryPromise = null;
      });
    }

    await browserDbRecoveryPromise;
    return listSessions();
  }
}

export async function collectOpenCodeBrowserSnapshot(): Promise<Uint8Array | null> {
  return exportBrowserDBSnapshot();
}

export async function restoreOpenCodeBrowserSnapshot(
  snapshot: Uint8Array | null,
): Promise<void> {
  await importBrowserDBSnapshot(snapshot);
}

export async function mountOpenCodeBrowserSession(
  options: OpenCodeBrowserSessionOptions,
): Promise<OpenCodeBrowserSessionHandle> {
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    env: options.env,
  });
  const workspaceBridge = createWorkspaceBridge(options.container);
  const processBridge = createProcessBridge(bridgeSession);
  let disposed = false;

  ensureBrowserProcess(options.cwd, options.env);

  const { mountOpenCodeTui } =
    (await import("opencode-browser-tui")) as OpenCodeBrowserModule;
  const mounted = await mountOpenCodeTui({
    container: options.element,
    wasmUrl: __OPENTUI_WASM_URL__,
    directory: toOpenCodePath(options.cwd),
    workspaceBridge,
    processBridge,
    args: options.args ?? {},
    env: {
      copy: async (text) => navigator.clipboard.writeText(text),
      openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"),
      setTitle: (title) => {
        options.onTitleChange?.(title);
        if (title) {
          document.title = title;
        }
      },
      themeMode: options.themeMode,
    },
  });

  return {
    exited: mounted.exited,
    dispose() {
      if (disposed) return;
      disposed = true;
      mounted.dispose();
      bridgeSession.dispose();
      options.element.replaceChildren();
    },
    getShellState() {
      const state = bridgeSession.getState();
      return {
        cwd: state.cwd,
        env: state.env,
      };
    },
    setThemeMode(themeMode) {
      mounted.setThemeMode(themeMode);
    },
  };
}
