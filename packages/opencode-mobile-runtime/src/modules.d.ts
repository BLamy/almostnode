declare module "opencode-browser-tui" {
  export interface BrowserWorkspaceBridge {
    exists(path: string): boolean;
    mkdir(path: string): void;
    readFile(path: string): string | undefined;
    writeFile(path: string, content: string): void;
    readdir(path: string): Array<{
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
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
    themeMode?: "dark" | "light";
  }

  export interface OpenCodeTuiSession {
    exited: Promise<void>;
    dispose(): void;
  }

  export function mountOpenCodeTui(options: {
    container: HTMLElement;
    workspaceBridge: BrowserWorkspaceBridge;
    processBridge?: BrowserProcessBridge;
    wasmUrl?: string | URL;
    directory?: string;
    args?: unknown;
    env?: BrowserTuiEnvironment;
  }): Promise<OpenCodeTuiSession>;
}
