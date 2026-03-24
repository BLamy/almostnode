const files = new Map<string, string>();

export class BrowserAgent {
  constructor(
    private readonly _apiKey: string,
    private readonly terminal: {
      writeInfo(message: string): void;
      writeAgentHeader(agent: string, model: string): void;
      writeStreaming(text: string): void;
      writeln(text?: string): void;
    },
  ) {}

  async sendMessage(message: string): Promise<void> {
    this.terminal.writeAgentHeader("opencode", "fallback");
    this.terminal.writeStreaming(
      `OpenCode fallback is active in the production build.\nReceived: ${message}\n`,
    );
    this.terminal.writeln(
      "Run `pnpm dev:sdk-showcase` to use the sibling OpenCode browser compatibility loader.",
    );
  }
}

export function _vfs_addDir(_path: string): void {}

export function _vfs_getFile(path: string): string | undefined {
  return files.get(path);
}

export function _vfs_listAll(): Map<string, string> {
  return new Map(files);
}

export function _vfs_setFile(path: string, content: string): void {
  files.set(path, content);
}
