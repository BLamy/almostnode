import { createProcess, type TerminalSession } from "almostnode";
import { WORKSPACE_ROOT } from "./workspace-seed";
import type { ReturnTypeOfCreateContainer } from "../workbench/workbench-host";
import "../../../../vendor/opencode/packages/browser/src/shims/bun.browser";
import { createOpencodeClient } from "../../../../vendor/opencode/packages/browser/src/shims/opencode-sdk.browser";
import {
  attachProcessBridge,
  detachProcessBridge,
} from "../../../../vendor/opencode/packages/browser/src/shims/child-process.browser";
import {
  initBrowserDB,
  exportBrowserDBSnapshot,
  importBrowserDBSnapshot,
} from "../../../../vendor/opencode/packages/browser/src/shims/db.browser";
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
} from "../../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { Server } from "../../../../vendor/opencode/packages/opencode/src/server/server";

declare const __OPENTUI_WASM_URL__: string;

type OpenCodeBrowserModule = typeof import("opencode-browser-tui");

export type OpenCodeThemeMode = "dark" | "light";

export interface OpenCodeBrowserShellState {
  cwd: string;
  env: Record<string, string>;
}

export interface OpenCodeBrowserSessionOptions {
  container: ReturnTypeOfCreateContainer;
  element: HTMLElement;
  cwd: string;
  env: Record<string, string>;
  themeMode: OpenCodeThemeMode;
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

function ensureBrowserProcess(cwd: string, env: Record<string, string>): void {
  const current = globalThis.process as typeof globalThis.process | undefined;
  if (
    current &&
    typeof current.on === "function" &&
    typeof current.cwd === "function"
  ) {
    return;
  }

  globalThis.process = createProcess({
    cwd,
    env: {
      ...current?.env,
      ...env,
    },
  });
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

function createInternalFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return Server.Default().fetch(request);
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

  ensureBrowserProcess(options.cwd, options.env);
  attachWorkspaceBridge(createWorkspaceBridge(options.container));
  attachProcessBridge(createProcessBridge(bridgeSession));

  try {
    await initBrowserDB();
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      directory: toOpenCodePath(options.cwd),
      fetch: createInternalFetch(),
    });
    return await callback(client);
  } finally {
    detachWorkspaceBridge();
    detachProcessBridge();
    bridgeSession.dispose();
  }
}

export async function listOpenCodeBrowserSessions(
  options: Pick<OpenCodeBrowserSessionOptions, "container" | "cwd" | "env">,
): Promise<OpenCodeBrowserSessionSummary[]> {
  return withOpenCodeBrowserRuntime(options, async (client) => {
    const sessions = await client.session.list();
    return Array.isArray(sessions)
      ? sessions as OpenCodeBrowserSessionSummary[]
      : [];
  });
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
  let disposed = false;

  ensureBrowserProcess(options.cwd, options.env);

  const { mountOpenCodeTui } =
    (await import("opencode-browser-tui")) as OpenCodeBrowserModule;
  const mounted = await mountOpenCodeTui({
    container: options.element,
    wasmUrl: __OPENTUI_WASM_URL__,
    directory: toOpenCodePath(options.cwd),
    workspaceBridge: createWorkspaceBridge(options.container),
    processBridge: createProcessBridge(bridgeSession),
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
