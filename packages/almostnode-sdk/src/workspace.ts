import {
  createContainer,
  type RunResult,
  type ShellCommandDefinition,
  type TerminalSession,
  type TerminalSessionOptions,
  type VFSSnapshot,
} from "../../almostnode/src/index";

const DEFAULT_SNAPSHOT_KEY = "almostnode-sdk:workspace";
const PROJECT_ROOT = "/project";
const EXCLUDED_FILE_PREFIXES = [
  `${PROJECT_ROOT}/node_modules`,
  `${PROJECT_ROOT}/dist`,
  `${PROJECT_ROOT}/.git`,
] as const;

export interface WorkspaceTemplate {
  id: string;
  label: string;
  defaultFile: string;
  runCommand: string;
  directories?: string[];
  files: Record<string, string>;
}

export interface SnapshotStore {
  load(key: string): Promise<VFSSnapshot | null>;
  save(key: string, snapshot: VFSSnapshot): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface AgentBrowserEnv {
  copy?: (text: string) => Promise<void> | void;
  openUrl?: (url: string) => void;
  setTitle?: (title: string) => void;
  themeMode?: "light" | "dark";
}

export interface AgentMountContext {
  element: HTMLElement;
  workspace: WorkspaceController;
  browserEnv?: AgentBrowserEnv;
  storage?: Storage;
}

export interface AgentSession {
  id: string;
  adapterId: string;
  dispose: () => void;
}

export interface AgentAdapter {
  id: string;
  label: string;
  mount: (
    context: AgentMountContext,
  ) => Promise<{ dispose: () => void }> | { dispose: () => void };
}

export interface TerminalSessionHandle {
  id: string;
  session: TerminalSession;
  dispose: () => void;
}

export interface WorkspaceSnapshot {
  ready: boolean;
  currentFile: string | null;
  files: string[];
  preview: {
    status: "idle" | "starting" | "running" | "error";
    command: string | null;
    url: string | null;
    stdout: string;
    stderr: string;
    error: string | null;
  };
  templateId: string;
}

export interface WorkspaceCreateOptions {
  template?: WorkspaceTemplate;
  initialFiles?: Record<string, string>;
  shellCommands?: ShellCommandDefinition[];
  snapshotKey?: string;
  snapshotStore?: SnapshotStore;
  autoStartPreview?: boolean;
  browserEnv?: AgentBrowserEnv;
  installMode?: "auto" | "eager" | "lazy";
}

export interface WorkspaceController {
  ready: Promise<void>;
  container: ReturnType<typeof createContainer>;
  vfs: ReturnType<typeof createContainer>["vfs"];
  preview: {
    start: (command?: string) => Promise<RunResult>;
    stop: () => void;
  };
  terminals: {
    createSession: (options?: TerminalSessionOptions) => TerminalSessionHandle;
    list: () => TerminalSessionHandle[];
  };
  snapshots: {
    save: () => Promise<void>;
    load: () => Promise<void>;
    clear: () => Promise<void>;
  };
  agents: {
    register: (adapter: AgentAdapter) => void;
    unregister: (adapterId: string) => void;
    list: () => AgentAdapter[];
    mount: (
      adapterId: string,
      context: Omit<AgentMountContext, "workspace">,
    ) => Promise<AgentSession>;
  };
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WorkspaceSnapshot;
  setCurrentFile: (path: string) => void;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  listFiles: (root?: string) => string[];
  reseed: (template?: WorkspaceTemplate) => Promise<void>;
  destroy: () => void;
}

export const DEFAULT_WORKSPACE_TEMPLATE: WorkspaceTemplate = {
  id: "vanilla-vite",
  label: "Vanilla Vite",
  defaultFile: `${PROJECT_ROOT}/src/main.js`,
  runCommand: "npm run dev",
  directories: [`${PROJECT_ROOT}/src`],
  files: {
    [`${PROJECT_ROOT}/package.json`]: JSON.stringify(
      {
        name: "almostnode-sdk-demo",
        private: true,
        type: "module",
        scripts: {
          dev: "vite --host 0.0.0.0 --port 4173",
          build: "vite build",
        },
        dependencies: {
          vite: "^7.3.1",
        },
      },
      null,
      2,
    ),
    [`${PROJECT_ROOT}/index.html`]: [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "    <title>almostnode-sdk</title>",
      '    <script type="module" src="/src/main.js"></script>',
      "  </head>",
      '  <body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#111827;color:#e5e7eb;">',
      '    <div id="app"></div>',
      "  </body>",
      "</html>",
    ].join("\n"),
    [`${PROJECT_ROOT}/src/main.js`]: [
      "const root = document.getElementById('app')",
      "root.innerHTML = `",
      "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at top,#1f2937,#0f172a 60%);\">",
      "    <section style=\"max-width:560px;text-align:center;\">",
      "      <p style=\"letter-spacing:.18em;text-transform:uppercase;color:#93c5fd;font-size:12px;\">almostnode sdk</p>",
      "      <h1 style=\"font-size:48px;line-height:1.05;margin:16px 0 12px;\">Edit files, run commands, preview instantly.</h1>",
      "      <p style=\"font-size:18px;line-height:1.6;color:#cbd5e1;\">This project is running entirely inside almostnode. Update <code>src/main.js</code> from the SDK editor or the OpenCode terminal.</p>",
      "    </section>",
      "  </main>`",
    ].join("\n"),
  },
};

interface OpenCodeCompatModule {
  BrowserAgent: new (
    apiKey: string,
    terminal: OpenCodeTerminalSurface,
  ) => {
    sendMessage(message: string, signal: AbortSignal): Promise<void>;
  };
}

interface OpenCodeCompatFsModule {
  _vfs_addDir(path: string): void;
  _vfs_getFile(path: string): string | undefined;
  _vfs_listAll(): Map<string, string>;
  _vfs_setFile(path: string, content: string): void;
}

export interface OpenCodeAgentAdapterOptions {
  loadModule: () => Promise<OpenCodeCompatModule>;
  loadFsModule: () => Promise<OpenCodeCompatFsModule>;
  apiKeyStorageKey?: string;
}

export function createIndexedDbSnapshotStore(
  dbName = "almostnode-sdk",
  storeName = "workspace-snapshots",
): SnapshotStore {
  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

  const transact = async <T,>(
    mode: IDBTransactionMode,
    handler: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> => {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = handler(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    });
  };

  return {
    load: async (key) => {
      const raw = await transact<string>("readonly", (store) => store.get(key));
      return raw ? JSON.parse(raw) as VFSSnapshot : null;
    },
    save: async (key, snapshot) => {
      await transact("readwrite", (store) => store.put(JSON.stringify(snapshot), key));
    },
    clear: async (key) => {
      await transact("readwrite", (store) => store.delete(key));
    },
  };
}

function createInMemorySnapshotStore(): SnapshotStore {
  let snapshot: VFSSnapshot | null = null;
  return {
    load: async () => snapshot,
    save: async (_key, value) => {
      snapshot = value;
    },
    clear: async () => {
      snapshot = null;
    },
  };
}

function ensureDirectory(
  vfs: ReturnType<typeof createContainer>["vfs"],
  path: string,
): void {
  if (!vfs.existsSync(path)) {
    vfs.mkdirSync(path, { recursive: true });
  }
}

function seedTemplateIntoVfs(
  vfs: ReturnType<typeof createContainer>["vfs"],
  template: WorkspaceTemplate,
  initialFiles?: Record<string, string>,
): void {
  ensureDirectory(vfs, PROJECT_ROOT);
  for (const directory of template.directories || []) {
    ensureDirectory(vfs, directory);
  }
  for (const [path, content] of Object.entries(template.files)) {
    vfs.writeFileSync(path, content);
  }
  for (const [path, content] of Object.entries(initialFiles || {})) {
    ensureDirectory(vfs, path.slice(0, path.lastIndexOf("/")));
    vfs.writeFileSync(path, content);
  }
}

function applySnapshot(
  vfs: ReturnType<typeof createContainer>["vfs"],
  snapshot: VFSSnapshot,
): void {
  for (const entry of snapshot.files) {
    if (!entry.path.startsWith(`${PROJECT_ROOT}/`) && entry.path !== PROJECT_ROOT) {
      continue;
    }
    if (entry.type === "directory") {
      ensureDirectory(vfs, entry.path);
      continue;
    }
    ensureDirectory(vfs, entry.path.slice(0, entry.path.lastIndexOf("/")));
    vfs.writeFileSync(entry.path, entry.content ? atob(entry.content) : "");
  }
}

function collectSnapshot(
  vfs: ReturnType<typeof createContainer>["vfs"],
): VFSSnapshot {
  return {
    files: vfs.toSnapshot().files.filter((entry) => {
      return !EXCLUDED_FILE_PREFIXES.some((prefix) => (
        entry.path === prefix || entry.path.startsWith(`${prefix}/`)
      ));
    }),
  };
}

function collectFiles(
  vfs: ReturnType<typeof createContainer>["vfs"],
  root = PROJECT_ROOT,
): string[] {
  if (!vfs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const visit = (currentPath: string): void => {
    if (EXCLUDED_FILE_PREFIXES.some((prefix) => (
      currentPath === prefix || currentPath.startsWith(`${prefix}/`)
    ))) {
      return;
    }
    const stat = vfs.statSync(currentPath);
    if (!stat.isDirectory()) {
      files.push(currentPath);
      return;
    }
    for (const entry of vfs.readdirSync(currentPath) as string[]) {
      visit(`${currentPath}/${entry}`);
    }
  };
  visit(root);
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function normalizePreviewOutput(value: string): string {
  return value.replace(/\r?\n/g, "\n");
}

class WorkspaceControllerImpl implements WorkspaceController {
  readonly container;
  readonly vfs;
  readonly ready;
  readonly preview;
  readonly terminals;
  readonly snapshots;
  readonly agents;

  private readonly browserEnv?: AgentBrowserEnv;
  private readonly listeners = new Set<() => void>();
  private readonly snapshotKey: string;
  private readonly snapshotStore: SnapshotStore;
  private readonly template: WorkspaceTemplate;
  private readonly terminalSessions = new Map<string, TerminalSessionHandle>();
  private readonly registeredAgents = new Map<string, AgentAdapter>();
  private readonly mountedAgents = new Map<string, AgentSession>();
  private snapshotCache: WorkspaceSnapshot;
  private currentFile: string | null;
  private previewSession: TerminalSessionHandle | null = null;
  private previewAbortController: AbortController | null = null;
  private previewStartPromise: Promise<RunResult> | null = null;
  private previewRunVersion = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private previewState: WorkspaceSnapshot["preview"] = {
    status: "idle",
    command: null,
    url: null,
    stdout: "",
    stderr: "",
    error: null,
  };

  constructor(private readonly options: WorkspaceCreateOptions) {
    this.browserEnv = options.browserEnv;
    this.snapshotKey = options.snapshotKey || DEFAULT_SNAPSHOT_KEY;
    this.snapshotStore = options.snapshotStore
      || (typeof indexedDB === "undefined"
        ? createInMemorySnapshotStore()
        : createIndexedDbSnapshotStore());
    this.template = options.template || DEFAULT_WORKSPACE_TEMPLATE;
    this.container = createContainer({
      installMode: options.installMode,
      shellCommands: options.shellCommands,
    });
    this.vfs = this.container.vfs;
    this.currentFile = this.template.defaultFile;
    this.snapshotCache = this.buildSnapshot();

    this.preview = {
      start: async (command) => this.startPreview(command),
      stop: () => this.stopPreview(),
    };

    this.terminals = {
      createSession: (sessionOptions) => {
        const session = this.container.createTerminalSession(sessionOptions);
        const handle: TerminalSessionHandle = {
          id: crypto.randomUUID(),
          session,
          dispose: () => {
            session.dispose();
            this.terminalSessions.delete(handle.id);
          },
        };
        this.terminalSessions.set(handle.id, handle);
        return handle;
      },
      list: () => Array.from(this.terminalSessions.values()),
    };

    this.snapshots = {
      save: async () => {
        await this.snapshotStore.save(this.snapshotKey, collectSnapshot(this.vfs));
      },
      load: async () => {
        await this.restoreSnapshot();
      },
      clear: async () => {
        await this.snapshotStore.clear(this.snapshotKey);
      },
    };

    this.agents = {
      register: (adapter) => {
        this.registeredAgents.set(adapter.id, adapter);
      },
      unregister: (adapterId) => {
        this.registeredAgents.delete(adapterId);
      },
      list: () => Array.from(this.registeredAgents.values()),
      mount: async (adapterId, context) => {
        const adapter = this.registeredAgents.get(adapterId);
        if (!adapter) {
          throw new Error(`Unknown agent adapter: ${adapterId}`);
        }
        const mounted = await adapter.mount({
          ...context,
          workspace: this,
        });
        const session: AgentSession = {
          id: crypto.randomUUID(),
          adapterId,
          dispose: mounted.dispose,
        };
        this.mountedAgents.set(session.id, session);
        return session;
      },
    };

    this.container.on("server-ready", (_port, url) => {
      if (typeof url === "string") {
        this.previewState = {
          ...this.previewState,
          status: "running",
          url,
          error: null,
        };
        this.emit();
      }
    });

    const onVfsChange = () => {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        void this.snapshots.save();
      }, 300);
      this.emit();
    };
    this.vfs.on("change", onVfsChange);
    this.vfs.on("delete", onVfsChange);

    this.ready = this.initialize();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.snapshotCache;
  }

  setCurrentFile(path: string): void {
    this.currentFile = path;
    this.emit();
  }

  readFile(path: string): string {
    try {
      return String(this.vfs.readFileSync(path, "utf8"));
    } catch {
      return "";
    }
  }

  writeFile(path: string, content: string): void {
    ensureDirectory(this.vfs, path.slice(0, path.lastIndexOf("/")));
    this.vfs.writeFileSync(path, content);
    this.currentFile = path;
    this.emit();
  }

  listFiles(root = PROJECT_ROOT): string[] {
    return collectFiles(this.vfs, root);
  }

  async reseed(template = this.template): Promise<void> {
    this.stopPreview();
    for (const path of collectFiles(this.vfs)) {
      this.vfs.unlinkSync(path);
    }
    seedTemplateIntoVfs(this.vfs, template, this.options.initialFiles);
    this.currentFile = template.defaultFile;
    await this.snapshots.save();
    this.emit();
  }

  destroy(): void {
    this.stopPreview();
    for (const session of this.terminalSessions.values()) {
      session.dispose();
    }
    for (const session of this.mountedAgents.values()) {
      session.dispose();
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  private emit(): void {
    this.snapshotCache = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildSnapshot(): WorkspaceSnapshot {
    return {
      ready: this.vfs.existsSync(PROJECT_ROOT),
      currentFile: this.currentFile,
      files: collectFiles(this.vfs),
      preview: this.previewState,
      templateId: this.template.id,
    };
  }

  private async initialize(): Promise<void> {
    const restored = await this.restoreSnapshot();
    if (!restored) {
      seedTemplateIntoVfs(this.vfs, this.template, this.options.initialFiles);
    }
    const files = collectFiles(this.vfs);
    if (!files.includes(this.currentFile || "")) {
      this.currentFile = files[0] || null;
    }
    this.emit();
    if (this.options.autoStartPreview) {
      void this.startPreview();
    }
  }

  private async restoreSnapshot(): Promise<boolean> {
    const snapshot = await this.snapshotStore.load(this.snapshotKey);
    if (!snapshot) {
      return false;
    }
    applySnapshot(this.vfs, snapshot);
    return true;
  }

  private async startPreview(command = this.template.runCommand): Promise<RunResult> {
    await this.ready;
    if (
      this.previewStartPromise
      && this.previewState.status === "starting"
      && this.previewState.command === command
    ) {
      return this.previewStartPromise;
    }

    this.stopPreview();
    const runVersion = ++this.previewRunVersion;

    this.previewState = {
      status: "starting",
      command,
      url: null,
      stdout: "",
      stderr: "",
      error: null,
    };
    this.emit();

    const session = this.terminals.createSession({ cwd: PROJECT_ROOT });
    const abortController = new AbortController();
    this.previewSession = session;
    this.previewAbortController = abortController;

    const appendStdout = (chunk: string) => {
      if (this.previewRunVersion !== runVersion) {
        return;
      }
      this.previewState = {
        ...this.previewState,
        stdout: `${this.previewState.stdout}${normalizePreviewOutput(chunk)}`.slice(-6000),
      };
      this.emit();
    };
    const appendStderr = (chunk: string) => {
      if (this.previewRunVersion !== runVersion) {
        return;
      }
      this.previewState = {
        ...this.previewState,
        stderr: `${this.previewState.stderr}${normalizePreviewOutput(chunk)}`.slice(-6000),
      };
      this.emit();
    };

    let previewStartPromise: Promise<RunResult> | null = null;
    previewStartPromise = (async () => {
      try {
        if (this.vfs.existsSync(`${PROJECT_ROOT}/package.json`) && !this.vfs.existsSync(`${PROJECT_ROOT}/node_modules`)) {
          const installResult = await session.session.run("npm install", {
            signal: abortController.signal,
            onStdout: appendStdout,
            onStderr: appendStderr,
          });
          if (installResult.exitCode !== 0) {
            if (this.previewRunVersion !== runVersion) {
              return installResult;
            }
            this.previewState = {
              ...this.previewState,
              status: "error",
              error: installResult.stderr || "npm install failed",
            };
            this.emit();
            return installResult;
          }
        }

        const result = await session.session.run(command, {
          signal: abortController.signal,
          interactive: true,
          onStdout: appendStdout,
          onStderr: appendStderr,
        });

        if (this.previewRunVersion !== runVersion) {
          return result;
        }

        if (result.exitCode !== 0 && result.exitCode !== 130) {
          this.previewState = {
            ...this.previewState,
            status: "error",
            error: result.stderr || `Preview exited with code ${result.exitCode}`,
          };
        } else if (result.exitCode === 130) {
          this.previewState = {
            ...this.previewState,
            status: "idle",
          };
        }
        this.emit();
        return result;
      } finally {
        if (this.previewSession === session) {
          this.previewSession = null;
        }
        if (this.previewAbortController === abortController) {
          this.previewAbortController = null;
        }
        if (this.previewStartPromise === previewStartPromise) {
          this.previewStartPromise = null;
        }
      }
    })();

    this.previewStartPromise = previewStartPromise;
    return previewStartPromise;
  }

  private stopPreview(): void {
    this.previewRunVersion += 1;
    this.previewStartPromise = null;
    this.previewAbortController?.abort();
    this.previewAbortController = null;
    this.previewSession?.dispose();
    this.previewSession = null;
    this.previewState = {
      ...this.previewState,
      status: "idle",
      command: null,
      url: null,
    };
    this.emit();
  }
}

export function createWorkspace(
  options: WorkspaceCreateOptions = {},
): WorkspaceController {
  return new WorkspaceControllerImpl(options);
}

class OpenCodeTerminalSurface {
  private readonly output: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly apiKeyInput: HTMLInputElement;
  private readonly connectButton: HTMLButtonElement;
  private history: string[] = [];
  private historyIndex = -1;

  constructor(
    root: HTMLElement,
    private readonly onMessage: (message: string) => void,
    private readonly onCancel: () => void,
    private readonly onConnect: (apiKey: string) => void,
    savedApiKey: string,
  ) {
    root.innerHTML = "";
    root.className = "almostnode-agent-panel";
    root.style.display = "grid";
    root.style.gridTemplateRows = "auto 1fr auto";
    root.style.height = "100%";
    root.style.background = "#08111f";
    root.style.color = "#dbeafe";
    root.style.border = "1px solid #1d4ed8";
    root.style.borderRadius = "16px";
    root.style.overflow = "hidden";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.padding = "12px";
    header.style.background = "#0f172a";
    header.style.borderBottom = "1px solid rgba(59,130,246,.35)";

    const title = document.createElement("strong");
    title.textContent = "OpenCode";
    title.style.fontSize = "13px";
    title.style.letterSpacing = ".12em";
    title.style.textTransform = "uppercase";

    const connectForm = document.createElement("form");
    connectForm.style.display = "flex";
    connectForm.style.flex = "1";
    connectForm.style.gap = "8px";
    connectForm.onsubmit = (event) => {
      event.preventDefault();
      this.onConnect(this.apiKeyInput.value.trim());
    };

    this.apiKeyInput = document.createElement("input");
    this.apiKeyInput.type = "password";
    this.apiKeyInput.placeholder = "Anthropic API key";
    this.apiKeyInput.value = savedApiKey;
    this.apiKeyInput.style.flex = "1";

    this.connectButton = document.createElement("button");
    this.connectButton.type = "submit";
    this.connectButton.textContent = savedApiKey ? "Reconnect" : "Connect";

    connectForm.append(this.apiKeyInput, this.connectButton);
    header.append(title, connectForm);

    this.output = document.createElement("div");
    this.output.style.padding = "12px";
    this.output.style.overflow = "auto";
    this.output.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
    this.output.style.fontSize = "13px";
    this.output.style.lineHeight = "1.5";

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "8px";
    footer.style.padding = "12px";
    footer.style.borderTop = "1px solid rgba(59,130,246,.2)";
    footer.style.background = "#0f172a";

    this.input = document.createElement("input");
    this.input.placeholder = "Ask OpenCode to inspect or edit the workspace";
    this.input.style.flex = "1";
    this.input.onkeydown = (event) => {
      if (event.key === "Enter") {
        this.handleSubmit();
      }
      if (event.key === "ArrowUp") {
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex += 1;
          this.input.value = this.history[this.historyIndex];
        }
      }
      if (event.key === "ArrowDown") {
        if (this.historyIndex > 0) {
          this.historyIndex -= 1;
          this.input.value = this.history[this.historyIndex];
        } else {
          this.historyIndex = -1;
          this.input.value = "";
        }
      }
    };

    this.submitButton = document.createElement("button");
    this.submitButton.textContent = "Send";
    this.submitButton.onclick = () => this.handleSubmit();

    this.cancelButton = document.createElement("button");
    this.cancelButton.textContent = "Cancel";
    this.cancelButton.onclick = () => this.onCancel();

    footer.append(this.input, this.submitButton, this.cancelButton);
    root.append(header, this.output, footer);
  }

  showPrompt(): void {
    this.input.focus();
  }

  write(text: string): void {
    this.output.append(document.createTextNode(text));
    this.output.scrollTop = this.output.scrollHeight;
  }

  writeln(text = ""): void {
    this.write(`${text}\n`);
  }

  writeInfo(message: string): void {
    this.writeln(`[info] ${message}`);
  }

  writeError(message: string): void {
    this.writeln(`[error] ${message}`);
  }

  writeToolResult(icon: string, title: string, description?: string, output?: string): void {
    this.writeln(`${icon} ${title}${description ? ` ${description}` : ""}`);
    if (output) {
      this.writeln(output);
    }
  }

  writeAgentHeader(agent: string, model: string): void {
    this.writeln(`\n> ${agent} · ${model}`);
  }

  writeStreaming(text: string): void {
    this.write(text);
  }

  private handleSubmit(): void {
    const message = this.input.value.trim();
    if (!message) {
      return;
    }
    this.history.unshift(message);
    this.historyIndex = -1;
    this.input.value = "";
    this.writeln(`\n$ ${message}`);
    this.onMessage(message);
  }
}

function syncWorkspaceToOpenCodeFs(
  workspace: WorkspaceController,
  fsModule: OpenCodeCompatFsModule,
): void {
  fsModule._vfs_addDir("/workspace");
  for (const filePath of workspace.listFiles(PROJECT_ROOT)) {
    const relativePath = filePath.slice(PROJECT_ROOT.length);
    fsModule._vfs_setFile(`/workspace${relativePath}`, workspace.readFile(filePath));
  }
}

function syncOpenCodeFsToWorkspace(
  workspace: WorkspaceController,
  fsModule: OpenCodeCompatFsModule,
): void {
  for (const [path, content] of fsModule._vfs_listAll()) {
    if (!path.startsWith("/workspace/")) {
      continue;
    }
    const relativePath = path.slice("/workspace".length);
    workspace.writeFile(`${PROJECT_ROOT}${relativePath}`, content);
  }
}

export function createOpenCodeAgentAdapter(
  options: OpenCodeAgentAdapterOptions,
): AgentAdapter {
  const apiKeyStorageKey = options.apiKeyStorageKey || "almostnode-sdk:opencode-api-key";
  return {
    id: "opencode",
    label: "OpenCode",
    mount: async ({ element, workspace, storage }) => {
      const [module, fsModule] = await Promise.all([
        options.loadModule(),
        options.loadFsModule(),
      ]);

      let agent: InstanceType<OpenCodeCompatModule["BrowserAgent"]> | null = null;
      let abortController: AbortController | null = null;
      const resolvedStorage = storage || window.localStorage;
      const terminal = new OpenCodeTerminalSurface(
        element,
        async (message) => {
          if (!agent) {
            terminal.writeError("Connect an Anthropic API key first.");
            return;
          }
          syncWorkspaceToOpenCodeFs(workspace, fsModule);
          abortController = new AbortController();
          try {
            await agent.sendMessage(message, abortController.signal);
            syncOpenCodeFsToWorkspace(workspace, fsModule);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== "Aborted") {
              terminal.writeError(message);
            }
          } finally {
            abortController = null;
            terminal.showPrompt();
          }
        },
        () => {
          abortController?.abort();
        },
        (apiKey) => {
          if (!apiKey) {
            terminal.writeError("Enter an Anthropic API key to connect OpenCode.");
            return;
          }
          resolvedStorage.setItem(apiKeyStorageKey, apiKey);
          agent = new module.BrowserAgent(apiKey, terminal);
          terminal.writeInfo("OpenCode connected.");
          terminal.writeInfo("Ask it to inspect or edit files inside /project.");
          terminal.showPrompt();
        },
        resolvedStorage.getItem(apiKeyStorageKey) || "",
      );

      if (resolvedStorage.getItem(apiKeyStorageKey)) {
        agent = new module.BrowserAgent(
          resolvedStorage.getItem(apiKeyStorageKey) || "",
          terminal,
        );
        terminal.writeInfo("OpenCode restored from local storage.");
      } else {
        terminal.writeInfo("Provide an Anthropic API key to activate OpenCode.");
      }
      terminal.showPrompt();

      return {
        dispose: () => {
          abortController?.abort();
          element.innerHTML = "";
        },
      };
    },
  };
}
