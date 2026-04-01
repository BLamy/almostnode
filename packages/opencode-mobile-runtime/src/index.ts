import { createProcess } from "almostnode";
import {
  createWorkspace,
  type AgentBrowserEnv,
  type SnapshotStore,
  type WorkspaceController,
  type WorkspaceCreateOptions,
  type WorkspaceTemplate,
} from "almostnode-sdk";
import {
  mountOpenCodeTui,
  type BrowserProcessBridge,
  type BrowserTuiEnvironment,
  type BrowserWorkspaceBridge,
  type OpenCodeTuiSession,
} from "opencode-browser-tui";
import { setWorkspaceRoot } from "../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { preloadYogaLayout } from "./yoga-layout-shim";

declare const __OPENTUI_WASM_URL__: string;

export const PROJECT_ROOT = "/project";
export const OPENCODE_AUTH_PATH = "/opencode/data/opencode/auth.json";
export const OPENCODE_MCP_AUTH_PATH = "/opencode/data/opencode/mcp-auth.json";
export const OPENCODE_CONFIG_PATH = "/opencode/config/opencode/opencode.json";
export const OPENCODE_CONFIG_JSONC_PATH = "/opencode/config/opencode/opencode.jsonc";
export const OPENCODE_LEGACY_CONFIG_PATH = "/opencode/config/opencode/config.json";

export type ThemeMode = "light" | "dark";

export interface SerializedFile {
  path: string;
  contentBase64: string;
}

export interface ProjectFileWriteOp {
  type: "write";
  path: string;
  contentBase64: string;
}

export interface ProjectFileDeleteOp {
  type: "delete";
  path: string;
}

export type ProjectFileApplyOp = ProjectFileWriteOp | ProjectFileDeleteOp;

export interface MobileSecretFiles {
  authJson: string | null;
  mcpAuthJson: string | null;
  configJson: string | null;
  configJsonc: string | null;
  legacyConfigJson: string | null;
}

export interface OpenCodeStatus {
  phase: "booting" | "starting" | "running" | "error" | "disposed";
  message?: string | null;
  error?: string | null;
}

export interface PreviewStateSnapshot {
  status: "idle" | "starting" | "running" | "error";
  command: string | null;
  url: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface MobileWorkspaceOptions {
  projectId: string;
  files: SerializedFile[];
  runCommand: string;
  browserEnv?: AgentBrowserEnv;
  autoStartPreview?: boolean;
  snapshotStore?: SnapshotStore;
}

export interface MountMobileOpenCodeTuiOptions {
  container: HTMLElement;
  workspace: WorkspaceController;
  env?: BrowserTuiEnvironment;
  directory?: string;
}

const IN_MEMORY_SNAPSHOT_STORE: SnapshotStore = {
  async load() {
    return null;
  },
  async save() {},
  async clear() {},
};

function decodeBase64(value: string): string {
  if (typeof atob === "function") {
    return atob(value);
  }
  return Buffer.from(value, "base64").toString("binary");
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = decodeBase64(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(value: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of value) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  return Buffer.from(value).toString("base64");
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function mapWorkspacePath(path: string): string {
  if (path === "/workspace") return PROJECT_ROOT;
  if (path.startsWith("/workspace/")) return `${PROJECT_ROOT}${path.slice("/workspace".length)}`;
  return path;
}

function toOpenCodePath(path: string): string {
  if (path === "/workspace") return PROJECT_ROOT;
  if (path.startsWith("/workspace/")) return `${PROJECT_ROOT}${path.slice("/workspace".length)}`;
  if (path === PROJECT_ROOT || path.startsWith(`${PROJECT_ROOT}/`)) {
    return path;
  }
  return PROJECT_ROOT;
}

function ensureDirectory(
  workspace: WorkspaceController,
  path: string,
): void {
  if (!path || path === "/") {
    return;
  }
  if (!workspace.vfs.existsSync(path)) {
    workspace.vfs.mkdirSync(path, { recursive: true });
  }
}

function createWorkspaceTemplate(options: MobileWorkspaceOptions): WorkspaceTemplate {
  const firstFile = options.files[0]?.path ?? `${PROJECT_ROOT}/package.json`;
  return {
    id: options.projectId,
    label: options.projectId,
    defaultFile: firstFile,
    runCommand: options.runCommand,
    directories: [PROJECT_ROOT],
    files: {},
  };
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

export function serializedFilesToInitialFiles(files: SerializedFile[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const file of files) {
    entries[normalizeWorkspacePath(file.path)] = decodeBase64(file.contentBase64);
  }
  return entries;
}

export function ensureBrowserProcess(cwd = PROJECT_ROOT): void {
  const current = globalThis.process as typeof globalThis.process | undefined;
  if (current && typeof current.on === "function" && typeof current.cwd === "function") {
    return;
  }

  globalThis.process = createProcess({
    cwd,
    env: {
      ...current?.env,
    },
  });
}

export function createMobileWorkspace(options: MobileWorkspaceOptions): WorkspaceController {
  const workspace = createWorkspace({
    template: createWorkspaceTemplate(options),
    installMode: "main-thread",
    autoStartPreview: options.autoStartPreview,
    browserEnv: options.browserEnv,
    snapshotStore: options.snapshotStore ?? IN_MEMORY_SNAPSHOT_STORE,
  } satisfies WorkspaceCreateOptions);

  syncSerializedFilesIntoWorkspace(workspace, options.files);
  return workspace;
}

export function syncSerializedFilesIntoWorkspace(
  workspace: WorkspaceController,
  files: SerializedFile[],
): void {
  const nextFiles = new Map(files.map((file) => [normalizeWorkspacePath(file.path), file.contentBase64]));
  const nextPaths = new Set(nextFiles.keys());
  const existingPaths = workspace.listFiles(PROJECT_ROOT);

  for (const existingPath of existingPaths) {
    if (!nextPaths.has(existingPath) && workspace.vfs.existsSync(existingPath)) {
      workspace.vfs.unlinkSync(existingPath);
    }
  }

  for (const [path, contentBase64] of nextFiles.entries()) {
    const currentBase64 = workspace.vfs.existsSync(path)
      ? (() => {
        const currentValue = workspace.vfs.readFileSync(path);
        const bytes = typeof currentValue === "string"
          ? new TextEncoder().encode(currentValue)
          : currentValue;
        return encodeBase64(bytes);
      })()
      : null;

    if (currentBase64 === contentBase64) {
      continue;
    }

    ensureDirectory(workspace, path.slice(0, path.lastIndexOf("/")));
    workspace.vfs.writeFileSync(path, decodeBase64Bytes(contentBase64));
  }
}

export function applyFileOpsToWorkspace(
  workspace: WorkspaceController,
  ops: ProjectFileApplyOp[],
): void {
  for (const op of ops) {
    if (op.type === "delete") {
      if (workspace.vfs.existsSync(op.path)) {
        workspace.vfs.unlinkSync(op.path);
      }
      continue;
    }

    ensureDirectory(workspace, op.path.slice(0, op.path.lastIndexOf("/")));
    workspace.vfs.writeFileSync(op.path, decodeBase64Bytes(op.contentBase64));
  }
}

export function serializeWorkspaceFiles(workspace: WorkspaceController): SerializedFile[] {
  return workspace.listFiles(PROJECT_ROOT).map((path) => {
    const value = workspace.vfs.readFileSync(path);
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    return {
      path,
      contentBase64: encodeBase64(bytes),
    };
  });
}

export function installOpenCodeSecrets(
  workspace: WorkspaceController,
  secrets: MobileSecretFiles,
): void {
  const entries: Array<[string, string | null]> = [
    [OPENCODE_AUTH_PATH, secrets.authJson],
    [OPENCODE_MCP_AUTH_PATH, secrets.mcpAuthJson],
    [OPENCODE_CONFIG_PATH, secrets.configJson],
    [OPENCODE_CONFIG_JSONC_PATH, secrets.configJsonc],
    [OPENCODE_LEGACY_CONFIG_PATH, secrets.legacyConfigJson],
  ];

  for (const [path, content] of entries) {
    if (content == null || content === "") {
      if (workspace.vfs.existsSync(path)) {
        workspace.vfs.unlinkSync(path);
      }
      continue;
    }

    ensureDirectory(workspace, path.slice(0, path.lastIndexOf("/")));
    workspace.vfs.writeFileSync(path, content);
  }
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createOpenCodeWorkspaceBridge(
  workspace: WorkspaceController,
): BrowserWorkspaceBridge {
  const vfs = workspace.vfs;

  return {
    exists(path: string): boolean {
      const mapped = mapWorkspacePath(path);
      return mapped === PROJECT_ROOT || vfs.existsSync(mapped);
    },
    mkdir(path: string): void {
      vfs.mkdirSync(mapWorkspacePath(path), { recursive: true });
    },
    readFile(path: string): string | undefined {
      const mapped = mapWorkspacePath(path);
      try {
        const stat = vfs.statSync(mapped);
        if (stat.isDirectory()) {
          return undefined;
        }
        return String(vfs.readFileSync(mapped, "utf8"));
      } catch {
        return undefined;
      }
    },
    writeFile(path: string, content: string): void {
      const mapped = mapWorkspacePath(path);
      ensureDirectory(workspace, mapped.slice(0, mapped.lastIndexOf("/")));
      vfs.writeFileSync(mapped, content);
    },
    readdir(path: string) {
      const mapped = mapWorkspacePath(path);
      if (!vfs.existsSync(mapped)) {
        return [];
      }

      return (vfs.readdirSync(mapped) as string[]).map((name) => {
        const stat = vfs.statSync(`${mapped}/${name}`);
        return {
          name,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile(),
        };
      });
    },
    stat(path: string) {
      const mapped = mapWorkspacePath(path);
      try {
        return vfs.statSync(mapped);
      } catch {
        return undefined;
      }
    },
    remove(path: string, opts?: { recursive?: boolean }): void {
      const mapped = mapWorkspacePath(path);
      if (!vfs.existsSync(mapped)) {
        return;
      }
      if (vfs.statSync(mapped).isDirectory()) {
        vfs.rmSync(mapped, { recursive: Boolean(opts?.recursive), force: true });
        return;
      }
      vfs.unlinkSync(mapped);
    },
    rename(oldPath: string, newPath: string): void {
      vfs.renameSync(mapWorkspacePath(oldPath), mapWorkspacePath(newPath));
    },
    listFiles(root = PROJECT_ROOT): string[] {
      const mappedRoot = mapWorkspacePath(root);
      if (!vfs.existsSync(mappedRoot)) {
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

        const relative = currentPath.slice(PROJECT_ROOT.length);
        files.push(`${PROJECT_ROOT}${relative}`);
      };

      visit(mappedRoot);
      files.sort((left, right) => left.localeCompare(right));
      return files;
    },
  };
}

export function createOpenCodeProcessBridge(
  workspace: WorkspaceController,
): BrowserProcessBridge {
  return {
    async exec(input) {
      const cwd = mapWorkspacePath(input.cwd || PROJECT_ROOT);
      const commandString =
        input.shell || input.args.length === 0
          ? input.command
          : [quoteShellArg(input.command), ...input.args.map(quoteShellArg)].join(" ");

      const result = await workspace.container.run(commandString, {
        cwd,
        signal: input.signal,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.exitCode,
      };
    },
  };
}

export async function mountMobileOpenCodeTui(
  options: MountMobileOpenCodeTuiOptions,
): Promise<OpenCodeTuiSession> {
  ensureBrowserProcess(PROJECT_ROOT);
  setWorkspaceRoot(PROJECT_ROOT);
  await preloadYogaLayout();
  return mountOpenCodeTui({
    container: options.container,
    directory: toOpenCodePath(options.directory ?? PROJECT_ROOT),
    wasmUrl: __OPENTUI_WASM_URL__,
    workspaceBridge: createOpenCodeWorkspaceBridge(options.workspace),
    processBridge: createOpenCodeProcessBridge(options.workspace),
    env: options.env,
  });
}
