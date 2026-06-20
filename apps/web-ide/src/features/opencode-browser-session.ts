import type { TerminalSession } from "almostnode";
import {
  getShellCommandFromInvocation,
  quoteShellArg,
} from "./opencode-shell-invocation";
import { DETACH_DEV_SERVERS_ENV } from "almostnode/internal";
import { WORKSPACE_ROOT } from "./workspace-seed";
import type { ReturnTypeOfCreateContainer } from "../workbench/workbench-host";
import { configureBrowserProcess } from "../shims/node-process";
import "../../../../vendor/opencode/packages/browser/src/shims/bun.browser";
import { createOpencodeClient } from "../../../../vendor/opencode/packages/browser/src/shims/opencode-sdk.browser";
import {
  type BrowserProcessBridge,
  registerProcessBridgeForRoot,
  unregisterProcessBridgeForRoot,
  withProcessBridgeScope,
} from "../shims/opencode-child-process";
import {
  initBrowserDB,
  exportBrowserDBSnapshot,
  hasPersistedBrowserDB,
  importBrowserDBSnapshot,
  isRecoverableBrowserDBError,
  persistDB,
  resetBrowserDB,
  startAutoPersist,
} from "../../../../vendor/opencode/packages/browser/src/shims/db.browser";
import {
  registerWorkspaceBridgeForRoot,
  setWorkspaceRoot,
  unregisterWorkspaceBridgeForRoot,
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
  /**
   * OpenCode-side directory namespace for this session — the vendored
   * server keys its per-instance caches, project identity, and session
   * `directory` column by it. Sandbox sessions pass `/sandboxes/{sandboxId}`
   * (repo-base sessions `/repos/{repoId}`); paths under it map onto the
   * session container's `WORKSPACE_ROOT`. Defaults to the legacy
   * `WORKSPACE_ROOT` mapping when omitted.
   */
  opencodeDirectory?: string;
  themeMode: OpenCodeThemeMode;
  args?: OpenCodeBrowserLaunchArgs;
  onTitleChange?: (title: string) => void;
}

export interface OpenCodeBrowserSessionHandle {
  exited: Promise<void>;
  dispose(): void;
  getShellState(): OpenCodeBrowserShellState;
  setThemeMode(themeMode: OpenCodeThemeMode): void;
  /**
   * Last known "agent is processing" state for this session's directory,
   * from the opencode server's SessionStatus map (busy/retry vs idle).
   * Synchronous and cheap: reading it also kicks a throttled background
   * refresh, so periodic callers (the sidebar's 2s poll, the eviction
   * check) keep it current without awaiting.
   */
  isAgentBusy(): boolean;
  /** Forces a fresh status fetch — eviction uses this before disposing. */
  refreshAgentBusy(): Promise<boolean>;
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

// ── Host-level browser DB ─────────────────────────────────────────────────────
//
// OpenCode history lives in ONE host-level database shared by every project
// and sandbox (upstream OpenCode's model: a global store, projects keyed by
// directory). The single durable writer is db.browser's own IndexedDB,
// flushed by its `startAutoPersist` loop (also armed by the TUI bootstrap)
// plus a beforeunload flush below. The legacy per-project `openCodeDb`
// blobs in project-db are no longer written or imported on switches — they
// are kept untouched for one release as a migration seed / recovery
// fallback, and `collectOpenCodeBrowserSnapshot` remains available as a
// manual export for backups.

let legacyMigrationAttempted = false;
let activeLegacyOpenCodeDb: Uint8Array | null = null;
let unloadFlushRegistered = false;

function ensureGlobalDbWriters(): void {
  startAutoPersist();
  if (unloadFlushRegistered || typeof window === "undefined") {
    return;
  }
  unloadFlushRegistered = true;
  window.addEventListener("beforeunload", () => {
    void persistDB();
  });
}

/**
 * Registers the active project's legacy per-project OpenCode DB blob.
 * On first sight of a blob: if no host-level DB exists yet, the blob seeds
 * it (one-time migration). The blob is also cached so a recovery reset can
 * re-import at least the active project's history.
 */
export async function registerLegacyOpenCodeDbSnapshot(
  snapshot: Uint8Array | null | undefined,
): Promise<void> {
  activeLegacyOpenCodeDb =
    snapshot && snapshot.length > 0 ? snapshot : null;
  if (legacyMigrationAttempted || !activeLegacyOpenCodeDb) {
    return;
  }
  legacyMigrationAttempted = true;
  if (await hasPersistedBrowserDB()) {
    return;
  }
  console.warn(
    "[opencode-browser] Seeding the host-level OpenCode database from the active project's legacy snapshot.",
  );
  await importBrowserDBSnapshot(activeLegacyOpenCodeDb);
}

async function reimportLegacySnapshotAfterReset(): Promise<void> {
  if (!activeLegacyOpenCodeDb) {
    return;
  }
  try {
    await importBrowserDBSnapshot(activeLegacyOpenCodeDb);
    console.warn(
      "[opencode-browser] Re-imported the active project's legacy OpenCode snapshot after the reset.",
    );
  } catch (error) {
    console.warn(
      "[opencode-browser] Failed to re-import the legacy OpenCode snapshot after the reset.",
      error,
    );
  }
}

/**
 * Browser sandboxes are fully isolated per session, so agents run without
 * permission prompts: every rule that defaults to "ask" (external directory
 * access, .env reads, doom-loop) is set to "allow". Injected via
 * OPENCODE_CONFIG_CONTENT, which the vendored Config loads on every
 * instance init and merges over file-based config. Genuine agent questions
 * (the `question` permission) are left on their per-agent defaults so they
 * still surface as elicitations.
 */
const OPENCODE_AUTO_APPROVE_CONFIG = JSON.stringify({
  permission: {
    external_directory: "allow",
    read: "allow",
    doom_loop: "allow",
  },
});

function ensureBrowserProcess(cwd: string, env: Record<string, string>): void {
  globalThis.process = configureBrowserProcess({
    cwd,
    env: {
      OPENCODE_CONFIG_CONTENT: OPENCODE_AUTO_APPROVE_CONFIG,
      ...(globalThis.process?.env || {}),
      ...env,
    },
  }) as typeof globalThis.process;
}


function resolveOpenCodeDirectory(options: {
  opencodeDirectory?: string;
}): string {
  return options.opencodeDirectory ?? WORKSPACE_ROOT;
}

/**
 * Maps an OpenCode-side path (under `ocRoot`, or the legacy `/workspace`
 * alias) onto the session container's `WORKSPACE_ROOT`.
 */
function toContainerPath(path: string, ocRoot: string = WORKSPACE_ROOT): string {
  if (path === "/workspace") return WORKSPACE_ROOT;
  if (path.startsWith("/workspace/")) {
    return `${WORKSPACE_ROOT}${path.slice("/workspace".length)}`;
  }
  if (path === ocRoot) return WORKSPACE_ROOT;
  if (path.startsWith(`${ocRoot}/`)) {
    return `${WORKSPACE_ROOT}${path.slice(ocRoot.length)}`;
  }
  return path;
}

/** Inverse of {@link toContainerPath}: container path → OpenCode namespace. */
function toOpenCodePath(path: string, ocRoot: string = WORKSPACE_ROOT): string {
  if (path === "/workspace") return ocRoot;
  if (path.startsWith("/workspace/")) {
    return `${ocRoot}${path.slice("/workspace".length)}`;
  }
  if (path === WORKSPACE_ROOT) return ocRoot;
  if (path.startsWith(`${WORKSPACE_ROOT}/`)) {
    return `${ocRoot}${path.slice(WORKSPACE_ROOT.length)}`;
  }
  if (path === ocRoot || path.startsWith(`${ocRoot}/`)) {
    return path;
  }
  return ocRoot;
}

function createWorkspaceBridge(
  container: ReturnTypeOfCreateContainer,
  ocRoot: string = WORKSPACE_ROOT,
) {
  const vfs = container.vfs;

  return {
    exists(path: string): boolean {
      const mapped = toContainerPath(path, ocRoot);
      return mapped === WORKSPACE_ROOT || vfs.existsSync(mapped);
    },
    mkdir(path: string): void {
      vfs.mkdirSync(toContainerPath(path, ocRoot), { recursive: true });
    },
    readFile(path: string): string | undefined {
      const mapped = toContainerPath(path, ocRoot);
      try {
        if (vfs.statSync(mapped).isDirectory()) return undefined;
        return String(vfs.readFileSync(mapped, "utf8"));
      } catch {
        return undefined;
      }
    },
    writeFile(path: string, content: string): void {
      const mapped = toContainerPath(path, ocRoot);
      const directory = mapped.slice(0, mapped.lastIndexOf("/"));
      if (directory) {
        vfs.mkdirSync(directory, { recursive: true });
      }
      vfs.writeFileSync(mapped, content);
    },
    readdir(path: string) {
      const mapped = toContainerPath(path, ocRoot);
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
        return vfs.statSync(toContainerPath(path, ocRoot));
      } catch {
        return undefined;
      }
    },
    remove(path: string, options?: { recursive?: boolean }) {
      const mapped = toContainerPath(path, ocRoot);
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
      vfs.renameSync(
        toContainerPath(oldPath, ocRoot),
        toContainerPath(newPath, ocRoot),
      );
    },
    listFiles(root = ocRoot): string[] {
      const mapped = toContainerPath(root, ocRoot);
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

        files.push(toOpenCodePath(currentPath, ocRoot));
      };

      visit(mapped);
      files.sort((left, right) => left.localeCompare(right));
      return files;
    },
  };
}

function buildBridgeCommandInput(
  session: TerminalSession,
  input: {
    command: string;
    args: string[];
    cwd?: string;
    shell?: boolean | string;
  },
  ocRoot: string,
): { cwd: string; fullCommand: string } {
  const nextCwd = input.cwd ? toContainerPath(input.cwd, ocRoot) : null;
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
  return {
    cwd: nextCwd ?? state.cwd,
    fullCommand:
      nextCwd && nextCwd !== state.cwd
        ? `cd ${quoteShellArg(nextCwd)} && ${commandString}`
        : commandString,
  };
}

function createProcessBridge(
  container: ReturnTypeOfCreateContainer,
  session: TerminalSession,
  ocRoot: string = WORKSPACE_ROOT,
): BrowserProcessBridge {
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
        const { fullCommand } = buildBridgeCommandInput(session, input, ocRoot);

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
    spawn(input) {
      const { cwd, fullCommand } = buildBridgeCommandInput(session, input, ocRoot);
      const spawnedSession = container.createTerminalSession({
        cwd,
        // Agent-run dev servers detach (return after startup) instead of
        // holding the bash tool until abort — the managed server keeps
        // running for the preview while the turn continues.
        env: { ...input.env, [DETACH_DEV_SERVERS_ENV]: "1" },
      });
      let closed = false;

      void spawnedSession.run(fullCommand, {
        interactive: true,
        signal: input.signal,
        onStdout: input.onStdout,
        onStderr: input.onStderr,
      }).then((result) => {
        if (closed) {
          return;
        }
        closed = true;
        input.onExit(result.exitCode, null);
      }).catch((error) => {
        if (closed) {
          return;
        }
        closed = true;
        input.onStderr(`${error instanceof Error ? error.message : String(error)}\n`);
        input.onExit(1, null);
      }).finally(() => {
        spawnedSession.dispose();
      });

      return {
        write(data: string) {
          if (closed) {
            return;
          }
          spawnedSession.sendInput(data);
        },
        end() {
          if (closed) {
            return;
          }
          spawnedSession.sendInput("\u0004");
        },
        kill() {
          if (closed) {
            return;
          }
          closed = true;
          spawnedSession.abort();
          input.onExit(130, "SIGTERM");
          spawnedSession.dispose();
        },
      };
    },
  };
}

function withScopedBrowserBridges<T>(
  workspaceBridge: ReturnType<typeof createWorkspaceBridge>,
  processBridge: ReturnType<typeof createProcessBridge>,
  fn: () => T,
  ocRoot: string = WORKSPACE_ROOT,
): T {
  // The workspace root rides along with the request-scoped bridge so
  // interleaved requests from two sandboxes can't cross VFSes; the
  // container root stays aliased for legacy WORKSPACE_ROOT paths.
  return withWorkspaceBridgeScope(
    workspaceBridge,
    () => withProcessBridgeScope(processBridge, fn),
    { root: ocRoot, aliases: [WORKSPACE_ROOT] },
  );
}

/**
 * Pins this session's bridges to its namespace root until the returned
 * disposer runs. The fs and child_process shims resolve bridges by
 * path/cwd prefix from these registries FIRST, which is what actually keeps
 * concurrent sandboxes apart: the AsyncLocalStorage scope set by
 * {@link withScopedBrowserBridges} is a plain stack in the browser, and
 * under interleaved awaits its getStore() answers with whichever sandbox
 * entered a scope most recently — the wrong one half the time. The scope
 * remains as a fallback for un-namespaced paths (/opencode internals).
 */
function registerBridgesForRoot(
  ocDir: string,
  workspaceBridge: ReturnType<typeof createWorkspaceBridge>,
  processBridge: ReturnType<typeof createProcessBridge>,
): () => void {
  registerWorkspaceBridgeForRoot(ocDir, workspaceBridge);
  registerProcessBridgeForRoot(ocDir, processBridge);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unregisterWorkspaceBridgeForRoot(ocDir, workspaceBridge);
    unregisterProcessBridgeForRoot(ocDir, processBridge);
  };
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
  ocRoot: string = WORKSPACE_ROOT,
): typeof fetch {
  const runWithScope = <T>(fn: () => T) =>
    withScopedBrowserBridges(workspaceBridge, processBridge, fn, ocRoot);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await runWithScope(() => Server.Default().fetch(request));
    return scopeResponseBody(response, runWithScope);
  }) as typeof fetch;
}

type OpenCodeBrowserRuntimeOptions = Pick<
  OpenCodeBrowserSessionOptions,
  "container" | "cwd" | "env" | "opencodeDirectory"
>;

async function withOpenCodeBrowserRuntime<T>(
  options: OpenCodeBrowserRuntimeOptions,
  callback: (client: ReturnType<typeof createOpencodeClient>) => Promise<T>,
): Promise<T> {
  const ocDir = resolveOpenCodeDirectory(options);
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    env: options.env,
  });
  const workspaceBridge = createWorkspaceBridge(options.container, ocDir);
  const processBridge = createProcessBridge(
    options.container,
    bridgeSession,
    ocDir,
  );
  const unregisterBridges = registerBridgesForRoot(
    ocDir,
    workspaceBridge,
    processBridge,
  );

  ensureBrowserProcess(toOpenCodePath(options.cwd, ocDir), options.env);
  setWorkspaceRoot(ocDir, [options.cwd]);

  try {
    await initBrowserDB();
    ensureGlobalDbWriters();
    const client = createOpencodeClient({
      baseUrl: "http://opencode.internal",
      directory: ocDir,
      fetch: createInternalFetch(workspaceBridge, processBridge, ocDir),
    });
    return await callback(client);
  } finally {
    unregisterBridges();
    bridgeSession.dispose();
  }
}

export interface OpenCodeBrowserClientHandle {
  client: ReturnType<typeof createOpencodeClient>;
  /** Fetch bound to the in-browser opencode server (supports SSE bodies). */
  fetch: typeof fetch;
  dispose: () => void;
}

/**
 * Long-lived client against the shared in-browser opencode server — the same
 * server instance the mounted TUI uses, so reads/writes and Bus events are
 * fully shared. Caller owns disposal (unlike withOpenCodeBrowserRuntime).
 */
export async function createOpenCodeBrowserClient(
  options: OpenCodeBrowserRuntimeOptions,
): Promise<OpenCodeBrowserClientHandle> {
  const ocDir = resolveOpenCodeDirectory(options);
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    env: options.env,
  });
  const workspaceBridge = createWorkspaceBridge(options.container, ocDir);
  const processBridge = createProcessBridge(
    options.container,
    bridgeSession,
    ocDir,
  );
  const unregisterBridges = registerBridgesForRoot(
    ocDir,
    workspaceBridge,
    processBridge,
  );

  ensureBrowserProcess(toOpenCodePath(options.cwd, ocDir), options.env);
  setWorkspaceRoot(ocDir, [options.cwd]);
  await initBrowserDB();
  ensureGlobalDbWriters();

  const internalFetch = createInternalFetch(workspaceBridge, processBridge, ocDir);
  const client = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory: ocDir,
    fetch: internalFetch,
  });
  return {
    client,
    fetch: internalFetch,
    dispose: () => {
      unregisterBridges();
      bridgeSession.dispose();
    },
  };
}

export async function listOpenCodeBrowserSessions(
  options: OpenCodeBrowserRuntimeOptions,
): Promise<OpenCodeBrowserSessionSummary[]> {
  const ocDir = resolveOpenCodeDirectory(options);
  const listSessions = () => withOpenCodeBrowserRuntime(options, async (client) => {
    const sessions = await client.session.list({ directory: ocDir });
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
          "[opencode-browser] Recovering browser database after /session failed. " +
            "The browser database is the single host-level OpenCode store — " +
            "resetting it wipes OpenCode history for ALL projects and sandboxes.",
          error,
        );
        Database.Client.reset();
        await resetBrowserDB();
        // Best-effort: bring back at least the active project's history
        // from its legacy per-project snapshot, when one is registered.
        await reimportLegacySnapshotAfterReset();
      })().finally(() => {
        browserDbRecoveryPromise = null;
      });
    }

    await browserDbRecoveryPromise;
    return listSessions();
  }
}

/**
 * Disposes the in-browser opencode server's per-directory instance cache
 * for a sandbox session being torn down (POST /instance/dispose). Run it
 * BEFORE the session's container is disposed so fs/git lookups during the
 * dispose still resolve against the right VFS.
 */
export async function disposeOpenCodeInstance(
  options: OpenCodeBrowserRuntimeOptions,
): Promise<void> {
  const ocDir = resolveOpenCodeDirectory(options);
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    env: options.env,
  });
  const workspaceBridge = createWorkspaceBridge(options.container, ocDir);
  const processBridge = createProcessBridge(
    options.container,
    bridgeSession,
    ocDir,
  );

  const unregisterBridges = registerBridgesForRoot(
    ocDir,
    workspaceBridge,
    processBridge,
  );

  try {
    await initBrowserDB();
    const internalFetch = createInternalFetch(workspaceBridge, processBridge, ocDir);
    await internalFetch(
      `http://opencode.internal/instance/dispose?directory=${encodeURIComponent(ocDir)}`,
      { method: "POST" },
    );
  } finally {
    unregisterBridges();
    bridgeSession.dispose();
  }
}

/**
 * Manual export of the host-level OpenCode browser DB, for backups and the
 * legacy-blob migration path only. The live store persists itself (see
 * `ensureGlobalDbWriters`); project switches no longer call this.
 */
export async function collectOpenCodeBrowserSnapshot(): Promise<Uint8Array | null> {
  return exportBrowserDBSnapshot();
}

/**
 * Manual import over the host-level OpenCode browser DB. Replaces ALL
 * OpenCode history — backup restore / migration tooling only.
 */
export async function restoreOpenCodeBrowserSnapshot(
  snapshot: Uint8Array | null,
): Promise<void> {
  await importBrowserDBSnapshot(snapshot);
}

export async function mountOpenCodeBrowserSession(
  options: OpenCodeBrowserSessionOptions,
): Promise<OpenCodeBrowserSessionHandle> {
  const ocDir = resolveOpenCodeDirectory(options);
  const bridgeSession = options.container.createTerminalSession({
    cwd: options.cwd,
    // See createProcessBridge: agent-run dev servers detach after startup.
    env: { ...options.env, [DETACH_DEV_SERVERS_ENV]: "1" },
  });
  const workspaceBridge = createWorkspaceBridge(options.container, ocDir);
  const processBridge = createProcessBridge(
    options.container,
    bridgeSession,
    ocDir,
  );
  const unregisterBridges = registerBridgesForRoot(
    ocDir,
    workspaceBridge,
    processBridge,
  );
  let disposed = false;

  // Shell-replacement mounts can start in a subdirectory: keep the TUI's
  // directory at the mapped cwd (legacy behavior) inside the namespace.
  const ocCwd = toOpenCodePath(options.cwd, ocDir);
  ensureBrowserProcess(ocCwd, options.env);
  setWorkspaceRoot(ocDir, [options.cwd]);
  ensureGlobalDbWriters();

  // Busy probe against the shared in-browser server: any non-idle entry in
  // this directory's SessionStatus map means the agent is mid-task. The
  // session pool pins busy sandboxes, so this must reflect actual
  // processing — not merely "the tab is open".
  const statusFetch = createInternalFetch(workspaceBridge, processBridge, ocDir);
  let lastBusy = false;
  let lastBusyCheckAt = 0;
  let busyRefresh: Promise<boolean> | null = null;
  const refreshAgentBusy = (): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (busyRefresh) return busyRefresh;
    busyRefresh = (async () => {
      try {
        const response = await statusFetch(
          "http://opencode.internal/session/status",
          { headers: { "x-opencode-directory": ocDir } },
        );
        if (response.ok) {
          const statuses = (await response.json()) as Record<
            string,
            { type?: string } | undefined
          >;
          lastBusy = Object.values(statuses).some(
            (status) => status && status.type !== "idle",
          );
        }
      } catch {
        // Keep the previous answer; a failed probe must not flip a busy
        // agent to evictable.
      } finally {
        lastBusyCheckAt = Date.now();
        busyRefresh = null;
      }
      return lastBusy;
    })();
    return busyRefresh;
  };

  const { mountOpenCodeTui } =
    (await import("opencode-browser-tui")) as OpenCodeBrowserModule;
  const mounted = await mountOpenCodeTui({
    container: options.element,
    wasmUrl: __OPENTUI_WASM_URL__,
    directory: ocCwd,
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
      unregisterBridges();
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
    isAgentBusy() {
      if (!disposed && Date.now() - lastBusyCheckAt > 2_000) {
        void refreshAgentBusy();
      }
      return !disposed && lastBusy;
    },
    refreshAgentBusy,
  };
}
