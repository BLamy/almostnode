export const PROJECT_ROOT: "/project";
export const OPENCODE_AUTH_PATH: "/opencode/data/opencode/auth.json";
export const OPENCODE_MCP_AUTH_PATH: "/opencode/data/opencode/mcp-auth.json";
export const OPENCODE_CONFIG_PATH: "/opencode/config/opencode/opencode.json";
export const OPENCODE_CONFIG_JSONC_PATH: "/opencode/config/opencode/opencode.jsonc";
export const OPENCODE_LEGACY_CONFIG_PATH: "/opencode/config/opencode/config.json";

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

export interface MobileWorkspaceSnapshot {
  preview: PreviewStateSnapshot;
}

export interface MobileVfs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding?: "utf8"): string | Uint8Array;
  writeFileSync(path: string, content: string | Uint8Array): void;
  unlinkSync(path: string): void;
  renameSync(oldPath: string, newPath: string): void;
  rmSync?(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
  };
  readdirSync(path: string): string[];
  on(event: "change", listener: (path: string, content: string) => void): void;
  on(event: "delete", listener: (path: string) => void): void;
  off(event: "change", listener: (path: string, content: string) => void): void;
  off(event: "delete", listener: (path: string) => void): void;
}

export interface MobileWorkspace {
  ready: Promise<void>;
  vfs: MobileVfs;
  container: {
    run(
      command: string,
      options?: { cwd?: string; signal?: AbortSignal },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  preview: {
    start(command?: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    stop(): void;
  };
  subscribe(listener: () => void): () => void;
  getSnapshot(): MobileWorkspaceSnapshot;
  listFiles(root?: string): string[];
  destroy(): void;
}

export interface MobileWorkspaceOptions {
  projectId: string;
  files: SerializedFile[];
  runCommand: string;
  browserEnv?: {
    copy?: (text: string) => Promise<void> | void;
    openUrl?: (url: string) => void;
    setTitle?: (title: string) => void;
    themeMode?: ThemeMode;
  };
  autoStartPreview?: boolean;
  snapshotStore?: unknown;
}

export interface BrowserWorkspaceBridge {
  exists(path: string): boolean;
  mkdir(path: string): void;
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  readdir(path: string): Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  stat(path: string): unknown;
  remove(path: string, opts?: { recursive?: boolean }): void;
  rename(oldPath: string, newPath: string): void;
  listFiles(root?: string): string[];
}

export interface BrowserProcessBridge {
  exec(input: {
    command: string;
    args: string[];
    cwd?: string;
    signal?: AbortSignal;
    shell?: boolean | string;
  }): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>;
}

export interface BrowserTuiEnvironment {
  copy?: (text: string) => Promise<void> | void;
  openUrl?: (url: string) => void;
  setTitle?: (title: string) => void;
  themeMode?: ThemeMode;
}

export interface OpenCodeTuiSession {
  exited: Promise<void>;
  dispose(): void;
}

export interface MountMobileOpenCodeTuiOptions {
  container: HTMLElement;
  workspace: MobileWorkspace;
  env?: BrowserTuiEnvironment;
  directory?: string;
}

export function formatError(error: unknown): string;
export function serializedFilesToInitialFiles(files: SerializedFile[]): Record<string, string>;
export function ensureBrowserProcess(cwd?: string): void;
export function createMobileWorkspace(options: MobileWorkspaceOptions): MobileWorkspace;
export function syncSerializedFilesIntoWorkspace(workspace: MobileWorkspace, files: SerializedFile[]): void;
export function applyFileOpsToWorkspace(workspace: MobileWorkspace, ops: ProjectFileApplyOp[]): void;
export function serializeWorkspaceFiles(workspace: MobileWorkspace): SerializedFile[];
export function installOpenCodeSecrets(workspace: MobileWorkspace, secrets: MobileSecretFiles): void;
export function createOpenCodeWorkspaceBridge(workspace: MobileWorkspace): BrowserWorkspaceBridge;
export function createOpenCodeProcessBridge(workspace: MobileWorkspace): BrowserProcessBridge;
export function mountMobileOpenCodeTui(options: MountMobileOpenCodeTuiOptions): Promise<OpenCodeTuiSession>;
