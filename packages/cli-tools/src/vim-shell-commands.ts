import type { ShellCommandDefinition } from "@agent-wasm/core";
import {
  getVimWasmUnsupportedReason,
  runVimTerminalSession,
  type VimVariant,
  type VimVfs,
} from "./vim-terminal-session";

export interface VimShellCommandsOptions {
  /** almostnode VirtualFS the edited file is read from / written back to. */
  vfs: VimVfs;
  /** Base URL where the vim.wasm runtime is served (e.g. `/vim-wasm/`). */
  vimWasmBaseUrl: string;
  /**
   * Return the DOM element to overlay for the terminal that launched the
   * command (or `null` if none). The app supplies this — web-ide returns the
   * active tab body; almost-os returns the focused terminal's host element.
   */
  resolveHost: () => HTMLElement | null;
  /**
   * Resolve a user path arg against the shell cwd to an absolute VFS path.
   * Defaults to a plain posix resolve; apps may enforce a workspace root.
   * May throw to reject the path with a message.
   */
  resolveAbsPath?: (arg: string, cwd: string) => string;
  /** Called after the overlay tears down (e.g. to restore terminal focus). */
  onSessionEnd?: () => void;
  fontFamily?: string;
  fontSize?: number;
}

// vim.wasm is single-instance per page, so the guard is module-global — it must
// hold across every container/terminal, not per `createVimShellCommands` call.
let vimSessionActive = false;

function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

function defaultResolveAbsPath(arg: string, cwd: string): string {
  return arg.startsWith("/")
    ? normalizePosix(arg)
    : normalizePosix(`${cwd}/${arg}`);
}

/**
 * Builds the `vim` (full build) and `vi` ("small" build) shell commands. Each
 * is a thin launcher: it resolves the file, checks the single-instance +
 * browser-compat guards, then mounts a vim.wasm canvas over the terminal via
 * {@link runVimTerminalSession} and blocks until Vim exits.
 */
export function createVimShellCommands(
  options: VimShellCommandsOptions,
): ShellCommandDefinition[] {
  const resolveAbsPath = options.resolveAbsPath ?? defaultResolveAbsPath;

  const make = (name: string, variant: VimVariant): ShellCommandDefinition => ({
    name,
    execute: async (args, context) => {
      const fileArg = args.find((arg) => !arg.startsWith("-"));
      if (!fileArg) {
        return { stdout: "", stderr: `usage: ${name} <file>\n`, exitCode: 1 };
      }

      const unsupported = getVimWasmUnsupportedReason();
      if (unsupported) {
        return { stdout: "", stderr: `${name}: ${unsupported}\n`, exitCode: 1 };
      }
      if (vimSessionActive) {
        return {
          stdout: "",
          stderr: `${name}: another editor session is already open.\n`,
          exitCode: 1,
        };
      }

      let absPath: string;
      try {
        absPath = resolveAbsPath(fileArg, context.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout: "", stderr: `${name}: ${message}\n`, exitCode: 1 };
      }

      const host = options.resolveHost();
      if (!host) {
        return {
          stdout: "",
          stderr: `${name}: no active terminal to render into.\n`,
          exitCode: 1,
        };
      }

      vimSessionActive = true;
      try {
        const { status } = await runVimTerminalSession({
          host,
          vfs: options.vfs,
          absPath,
          variant,
          vimWasmBaseUrl: options.vimWasmBaseUrl,
          signal: context.signal,
          fontFamily: options.fontFamily,
          fontSize: options.fontSize,
        });
        return { stdout: "", stderr: "", exitCode: status };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "aborted") {
          return { stdout: "", stderr: "", exitCode: 130 };
        }
        return { stdout: "", stderr: `${name}: ${message}\n`, exitCode: 1 };
      } finally {
        vimSessionActive = false;
        options.onSessionEnd?.();
      }
    },
  });

  return [make("vim", "vim"), make("vi", "vi")];
}
