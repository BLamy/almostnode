import type { ContainerInstance } from "@agent-wasm/core";
import { createFfmpegShellCommands, createVimShellCommands } from "@agent-wasm/cli-tools";
import { terminalOverlayHost } from "./terminal-overlay-host";

declare const __VIM_WASM_BASE__: string;
declare const __FFMPEG_CORE_URL__: string;
declare const __FFMPEG_WASM_URL__: string;

const VIM_WASM_BASE =
  typeof __VIM_WASM_BASE__ === "string" ? __VIM_WASM_BASE__ : "/vim-wasm/";
const FFMPEG_CORE_URL =
  typeof __FFMPEG_CORE_URL__ === "string"
    ? __FFMPEG_CORE_URL__
    : "/ffmpeg-core/ffmpeg-core.js";
const FFMPEG_WASM_URL =
  typeof __FFMPEG_WASM_URL__ === "string"
    ? __FFMPEG_WASM_URL__
    : "/ffmpeg-core/ffmpeg-core.wasm";

/**
 * Register `ffmpeg`/`ffprobe` (ffmpeg.wasm) and `vim`/`vi` (vim.wasm) on the
 * shared workspace container so they run in the AlmostOS Terminal, ported
 * from `apps/web-ide` via `@agent-wasm/cli-tools`.
 *
 * ffmpeg is headless (file-in/file-out + logs) — a plain shell command.
 * vim.wasm is a canvas GUI, not a terminal program: the `vim`/`vi` command
 * mounts a Vim canvas over the terminal that launched it (found via
 * `terminalOverlayHost`, since the command itself runs in `container`, which
 * has no window/DOM context of its own) and blocks until the user quits.
 */
export function registerCliTools(container: ContainerInstance): void {
  for (const command of createFfmpegShellCommands({
    coreURL: FFMPEG_CORE_URL,
    wasmURL: FFMPEG_WASM_URL,
  })) {
    container.registerShellCommand(command);
  }

  for (const command of createVimShellCommands({
    vfs: container.vfs,
    vimWasmBaseUrl: VIM_WASM_BASE,
    resolveHost: () => terminalOverlayHost.get(),
  })) {
    container.registerShellCommand(command);
  }
}
