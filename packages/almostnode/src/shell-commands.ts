import type { VirtualFS } from "./virtual-fs";

export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  env?: Record<string, string>;
  stdoutEncoding?: "binary";
}

export interface ShellCommandExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  replaceEnv?: boolean;
  stdin?: string;
  signal?: AbortSignal;
  args?: string[];
}

export interface ShellCommandKeyEvent {
  sequence?: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export interface ShellCommandContext {
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal?: AbortSignal;
  vfs: VirtualFS;
  writeStdout: (data: string) => void;
  writeStderr: (data: string) => void;
  setEnv: (name: string, value: string | null | undefined) => void;
  getEnv: () => Record<string, string>;
  setCwd: (cwd: string) => void;
  exec: (
    command: string,
    options?: ShellCommandExecOptions,
  ) => Promise<ShellCommandResult>;
  /**
   * Subscribe to raw keystrokes delivered to the running command while it owns
   * the terminal. Only fires once the command's execution has `activeProcessStdin`
   * set (which `adaptShellCommandDefinition` does for every registered shell
   * command). Returns an unsubscribe function.
   */
  onInput?: (handler: (data: string) => void) => () => void;
  /**
   * Like {@link onInput} but delivers decoded keypress events (arrow keys, enter,
   * ctrl+c, etc.). Useful for building select menus and other TUI widgets.
   */
  onKeypress?: (
    handler: (ch: string | undefined, key: ShellCommandKeyEvent) => void,
  ) => () => void;
  /**
   * Terminal dimensions reported to the running command (columns, rows). Mirrors
   * the values `process.stdout.columns` / `process.stdout.rows` would expose to a
   * Node child process running in the same terminal.
   */
  terminalSize?: { columns: number; rows: number };
}

export interface ShellCommandDefinition {
  name: string;
  trusted?: boolean;
  /**
   * When true, dispatch the command directly before the shell parser runs.
   * Use this for CLIs with arguments that tend to confuse the shell lexer.
   */
  interceptShellParsing?: boolean;
  execute: (
    args: string[],
    context: ShellCommandContext,
  ) => Promise<ShellCommandResult> | ShellCommandResult;
}
