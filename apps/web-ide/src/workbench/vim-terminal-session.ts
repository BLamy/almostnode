import { VimWasm, checkBrowserCompatibility } from "vim-wasm";

/**
 * Runs a real Vim (vim.wasm) session as an overlay on top of a terminal tab.
 *
 * vim.wasm is a *canvas GUI*, not a terminal program: it renders Vim to its own
 * `<canvas>` driven by a Web Worker + `SharedArrayBuffer`/`Atomics`, and does
 * NOT emit ANSI into xterm. So the `vim`/`vi` shell commands don't stream Vim
 * through stdout — they call {@link runVimTerminalSession}, which mounts the
 * canvas over the terminal, blocks until the user quits, and syncs saves back
 * to almostnode's VirtualFS (the source of truth the rest of the IDE reads).
 *
 * Cross-origin isolation (required for `SharedArrayBuffer`) is already set up in
 * this repo — Vite dev headers + the service worker inject COOP/COEP on every
 * response — so no extra header work is needed here.
 */

// Injected by the `__VIM_WASM_BASE__` define (see vite.config.ts). Points at the
// directory where `vimWasmAssets()` serves the runtime; `vim.js` is the normal
// build, `small/vim.js` the reduced build.
declare const __VIM_WASM_BASE__: string;

const VIM_WASM_BASE =
  typeof __VIM_WASM_BASE__ === "string" ? __VIM_WASM_BASE__ : "/vim-wasm/";

/** `vim` → full "normal" build; `vi` → lightweight "small" build. */
export type VimVariant = "vim" | "vi";

/**
 * The slice of almostnode's VirtualFS this module needs. Kept structural so the
 * module doesn't couple to the concrete `VirtualFS`/`ContainerInstance` types.
 */
export interface VimVfs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

export interface VimTerminalSessionOptions {
  /** Element to overlay the Vim canvas onto (the active terminal tab body). */
  host: HTMLElement;
  /** almostnode VirtualFS — the file is read from and written back to here. */
  vfs: VimVfs;
  /** Absolute path of the file to edit (created on `:w` if it doesn't exist). */
  absPath: string;
  variant: VimVariant;
  /** Aborting force-quits Vim (`:qall!`) and tears the overlay down. */
  signal?: AbortSignal;
  fontFamily?: string;
  fontSize?: number;
  /** Called after each `:w` that syncs bytes back to the VirtualFS. */
  onSaved?: (path: string) => void;
}

export interface VimTerminalSessionResult {
  status: number;
}

/**
 * @returns a human-readable reason when vim.wasm can't run in this browser
 * (needs Chromium-class `SharedArrayBuffer` + `Atomics`), or `undefined` when
 * it's supported.
 */
export function getVimWasmUnsupportedReason(): string | undefined {
  if (typeof Worker === "undefined") {
    return "vim requires Web Worker support, which is unavailable here.";
  }
  if (typeof SharedArrayBuffer === "undefined") {
    return "vim requires SharedArrayBuffer (cross-origin isolation). Reload the page and try again.";
  }
  try {
    return checkBrowserCompatibility();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return path.slice(0, idx);
}

/** Every ancestor directory of `path`, root-first: `/a/b/c` → `/a`, `/a/b`. */
function ancestorDirs(path: string): string[] {
  const dir = dirnameOf(path);
  const parts = dir.split("/").filter(Boolean);
  const dirs: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    dirs.push(acc);
  }
  return dirs;
}

/**
 * Mounts a Vim canvas over `host`, edits `absPath`, and resolves when the user
 * quits Vim. `:w`/`:wq` sync back to the VirtualFS via a `BufWritePost` → export
 * hook (see below). Always tears the overlay down before resolving/rejecting.
 */
export function runVimTerminalSession(
  options: VimTerminalSessionOptions,
): Promise<VimTerminalSessionResult> {
  const { host, vfs, absPath, variant, signal } = options;
  const fontFamily = options.fontFamily ?? "IBM Plex Mono, monospace";
  const fontSize = options.fontSize ?? 12;

  return new Promise<VimTerminalSessionResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }

    // --- overlay DOM -------------------------------------------------------
    const overlay = document.createElement("div");
    overlay.className = "almostnode-vim-overlay";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.zIndex = "5";
    overlay.style.background = "var(--webide-terminal-bg, #000)";
    overlay.style.overflow = "hidden";

    const canvas = document.createElement("canvas");
    canvas.className = "almostnode-vim-overlay__canvas";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    // vim.wasm's InputHandler binds keydown/IME to this input; the ScreenCanvas
    // focuses it on click. Keep it focusable but visually out of the way.
    const input = document.createElement("input");
    input.className = "almostnode-vim-overlay__input";
    input.autocomplete = "off";
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.spellcheck = false;
    input.style.position = "absolute";
    input.style.top = "0";
    input.style.left = "0";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    input.style.border = "0";
    input.style.padding = "0";

    overlay.append(canvas, input);

    // The overlay is absolutely positioned, so the host must be a positioned
    // ancestor. Restore whatever it was on teardown.
    const previousHostPosition = host.style.position;
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(overlay);

    let settled = false;
    let resizeObserver: ResizeObserver | null = null;
    let onAbort: (() => void) | null = null;

    const teardown = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (onAbort && signal) {
        signal.removeEventListener("abort", onAbort);
      }
      onAbort = null;
      overlay.remove();
      host.style.position = previousHostPosition;
    };

    const settle = (result: VimTerminalSessionResult) => {
      if (settled) return;
      settled = true;
      teardown();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      teardown();
      reject(error);
    };

    let vim: VimWasm;
    try {
      const workerScriptPath = `${VIM_WASM_BASE}${variant === "vi" ? "small/" : ""}vim.js`;
      vim = new VimWasm({ canvas, input, workerScriptPath });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    vim.onError = (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    };

    // Save-to-VFS bridge: vim.wasm's `:write` only touches its in-memory MEMFS.
    // `:export` is the one public read-back path — it fires onFileExport with the
    // buffer bytes. The BufWritePost autocmd (installed in onVimInit) runs
    // `:export` after every `:w`, so saves land in almostnode's VirtualFS, which
    // the explorer/Monaco already watch for `change` events.
    vim.onFileExport = (fullpath, contents) => {
      try {
        for (const dir of ancestorDirs(fullpath)) {
          if (!vfs.existsSync(dir)) {
            vfs.mkdirSync(dir, { recursive: true });
          }
        }
        vfs.writeFileSync(fullpath, new Uint8Array(contents));
        options.onSaved?.(fullpath);
      } catch (error) {
        // Surface the failure through Vim's error channel but keep editing.
        void vim.showError(
          `almostnode: failed to save ${fullpath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    vim.onVimInit = () => {
      // Make every `:w` also export back to the host VirtualFS, and match the
      // terminal font so the overlay blends in.
      void vim.cmdline("autocmd BufWritePost * export");
      void vim.cmdline(
        `set guifont=${fontFamily.split(",")[0]!.trim().replace(/ /g, "\\ ")}:h${fontSize}`,
      );
      input.focus();
      syncSize();
    };

    vim.onVimExit = (status) => {
      settle({ status });
    };

    // --- sizing ------------------------------------------------------------
    const syncSize = () => {
      if (settled || !vim.isRunning()) return;
      const width = Math.max(1, Math.floor(host.clientWidth));
      const height = Math.max(1, Math.floor(host.clientHeight));
      try {
        vim.resize(width, height);
      } catch {
        // Vim may not be ready yet; the next observer tick will retry.
      }
    };
    resizeObserver = new ResizeObserver(() => syncSize());
    resizeObserver.observe(host);

    // --- abort -------------------------------------------------------------
    if (signal) {
      onAbort = () => {
        if (settled) return;
        try {
          // Force-quit; onVimExit will still fire and settle the promise.
          void vim.cmdline("qall!");
        } catch {
          settle({ status: 130 });
        }
      };
      signal.addEventListener("abort", onAbort);
    }

    // --- start -------------------------------------------------------------
    const initialContent = vfs.existsSync(absPath)
      ? vfs.readFileSync(absPath, "utf8")
      : "";
    try {
      vim.start({
        clipboard: typeof navigator !== "undefined" && !!navigator.clipboard,
        dirs: ancestorDirs(absPath),
        files: { [absPath]: initialContent },
        cmdArgs: [absPath],
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
