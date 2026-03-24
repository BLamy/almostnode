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
