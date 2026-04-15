import { SpriteExecConnection } from "../../../../packages/almostnode/src/shims/sprite-api";

export interface SpriteTerminalInitOptions {
  apiUrl: string;
  token: string;
  spriteName: string;
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpriteTerminalExitEvent {
  exitCode: number;
}

export class SpriteTerminalSession {
  private connection: SpriteExecConnection | null = null;
  private cwd = "/";
  private env: Record<string, string> = {};
  private running = false;
  private disposed = false;
  private readonly decoder = new TextDecoder();
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: SpriteTerminalExitEvent) => void>();

  constructor(initialState?: { cwd?: string; env?: Record<string, string> }) {
    this.cwd = initialState?.cwd ?? "/";
    this.env = { ...(initialState?.env ?? {}) };
  }

  async init(options: SpriteTerminalInitOptions): Promise<void> {
    if (this.disposed) {
      throw new Error("Sprite terminal session has been disposed");
    }
    if (this.connection) {
      throw new Error("Sprite terminal session already initialized");
    }

    this.cwd = options.cwd ?? this.cwd;
    this.env = {
      ...this.env,
      ...(options.env ?? {}),
      COLUMNS: String(Math.max(1, Math.floor(options.cols))),
      LINES: String(Math.max(1, Math.floor(options.rows))),
    };

    const connection = new SpriteExecConnection({
      apiUrl: options.apiUrl,
      token: options.token,
      spriteName: options.spriteName,
      cwd: options.cwd,
      tty: true,
      cols: options.cols,
      rows: options.rows,
    });

    connection.on("stdout", (chunk: Uint8Array) => {
      const text = this.decoder.decode(chunk, { stream: true });
      if (!text) {
        return;
      }
      for (const listener of this.dataListeners) {
        listener(text);
      }
    });
    connection.on("message", (message: unknown) => {
      if (typeof message !== "string" || !message) {
        return;
      }
      for (const listener of this.dataListeners) {
        listener(message);
      }
    });
    connection.on("error", (error: Error) => {
      for (const listener of this.dataListeners) {
        listener(`\r\nSprite console error: ${error.message}\r\n`);
      }
    });
    connection.on("exit", (exitCode: number) => {
      this.running = false;
      const flush = this.decoder.decode();
      if (flush) {
        for (const listener of this.dataListeners) {
          listener(flush);
        }
      }
      for (const listener of this.exitListeners) {
        listener({ exitCode });
      }
    });

    this.connection = connection;
    this.running = true;
    await connection.start();
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: (event: SpriteTerminalExitEvent) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  sendInput(data: string): void {
    this.connection?.sendInput(data);
  }

  resize(cols: number, rows: number): void {
    const normalizedCols = Math.max(1, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));
    this.env = {
      ...this.env,
      COLUMNS: String(normalizedCols),
      LINES: String(normalizedRows),
    };
    this.connection?.resize(normalizedCols, normalizedRows);
  }

  abort(): void {
    this.connection?.signal("SIGINT");
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    this.connection?.close();
    this.connection = null;
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  getState(): { cwd: string; env: Record<string, string>; running: boolean } {
    return {
      cwd: this.cwd,
      env: { ...this.env },
      running: this.running,
    };
  }
}
