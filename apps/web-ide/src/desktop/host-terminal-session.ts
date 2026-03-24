import type { DesktopBridge } from './bridge';

interface TerminalCreateResponse {
  terminalId: string;
  shell: string;
  cwd: string;
}

interface TerminalDataEvent {
  terminalId: string;
  data: string;
}

interface TerminalExitEvent {
  terminalId: string;
  exitCode: number;
  signal: number;
}

export interface HostTerminalInitOptions {
  cols: number;
  rows: number;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  initialCommand?: string | null;
  routeCommandsToBridge?: boolean;
}

export class HostTerminalSession {
  private terminalId: string | null = null;
  private shell = '';
  private cwd = '';
  private running = false;
  private unsubscribeData: (() => void) | null = null;
  private unsubscribeExit: (() => void) | null = null;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalExitEvent) => void>();

  constructor(private readonly bridge: DesktopBridge) {}

  async init(options: HostTerminalInitOptions): Promise<{ shell: string; cwd: string }> {
    const response = await this.bridge.invoke<TerminalCreateResponse>('terminal:create', {
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      shell: options.shell,
      env: options.env,
      routeCommandsToBridge: options.routeCommandsToBridge === true,
    });

    this.terminalId = response.terminalId;
    this.shell = response.shell;
    this.cwd = response.cwd;
    this.running = true;

    this.unsubscribeData = this.bridge.on<TerminalDataEvent>('terminal:data', (payload) => {
      if (!payload || payload.terminalId !== this.terminalId) return;
      for (const listener of this.dataListeners) {
        listener(payload.data);
      }
    });

    this.unsubscribeExit = this.bridge.on<TerminalExitEvent>('terminal:exit', (payload) => {
      if (!payload || payload.terminalId !== this.terminalId) return;
      this.running = false;
      for (const listener of this.exitListeners) {
        listener(payload);
      }
    });

    if (typeof options.initialCommand === 'string' && options.initialCommand.trim().length > 0) {
      this.sendInput(`${options.initialCommand.trim()}\r`);
    }

    return { shell: this.shell, cwd: this.cwd };
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: (event: TerminalExitEvent) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  sendInput(data: string): void {
    if (!this.terminalId) return;
    this.bridge.send('terminal:write', { terminalId: this.terminalId, data });
  }

  resize(cols: number, rows: number): void {
    if (!this.terminalId) return;
    this.bridge.send('terminal:resize', { terminalId: this.terminalId, cols, rows });
  }

  abort(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.terminalId) {
      this.bridge.send('terminal:kill', { terminalId: this.terminalId });
    }
    this.terminalId = null;
    this.running = false;
    this.unsubscribeData?.();
    this.unsubscribeExit?.();
    this.unsubscribeData = null;
    this.unsubscribeExit = null;
    this.dataListeners.clear();
    this.exitListeners.clear();
  }

  getState(): { cwd: string; env: Record<string, string>; running: boolean } {
    return {
      cwd: this.cwd,
      env: {},
      running: this.running,
    };
  }
}
