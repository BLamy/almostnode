import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSession } from "@agent-wasm/core";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { terminalBus } from "./terminal-bus";
import { terminalOverlayHost } from "./terminal-overlay-host";

const THEME = {
  background: "#1d1f21",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  selectionBackground: "rgba(255,255,255,0.25)",
  black: "#1d1f21",
  brightBlack: "#666666",
  green: "#7ec96b",
  brightGreen: "#9af07f",
  blue: "#6aa0ff",
  cyan: "#54c7c7",
  yellow: "#e6c07b",
  red: "#ff6b6b",
  magenta: "#c678dd",
  white: "#e6e6e6",
};

const CTRL_C = "\x03";
const BACKSPACE = "\x7f";
const ENTER = "\r";
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";

function basename(path: string): string {
  if (path === "/" || path === "") return "/";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "/";
}

export function TerminalApp() {
  const { workspace, ready } = useOsRuntime();
  const system = useSystem();
  const systemRef = useRef(system);
  systemRef.current = system;
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // ⌘/Ctrl-click a URL → open it in a new Chrome tab.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.metaKey || event.ctrlKey) systemRef.current.openUrl(uri);
      }),
    );
    term.open(host);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* host not measured yet */
      }
    });

    const session: TerminalSession = workspace.container.createTerminalSession({
      cwd: "/project",
    });

    let line = "";
    const history: string[] = [];
    let historyIndex = -1;
    let running = false;
    let runningAbort: AbortController | null = null;
    let disposed = false;

    const promptText = () => {
      const cwd = session.getState().cwd || "/project";
      return `\x1b[1;32m${basename(cwd)}\x1b[0m \x1b[2m${cwd}\x1b[0m $ `;
    };
    const prompt = () => term.write(`\r\n${promptText()}`);
    const redrawLine = (value: string) => {
      term.write(`\r\x1b[K${promptText()}${value}`);
      line = value;
    };

    const runCommand = async (command: string) => {
      running = true;
      runningAbort = new AbortController();
      // Registers this terminal as the overlay target for `vim`/`vi` — the
      // command runs inside `container`, which has no window context of its
      // own, so it asks this registry for the terminal that launched it.
      terminalOverlayHost.set(host);
      try {
        await session.run(command, {
          interactive: true,
          signal: runningAbort.signal,
          onStdout: (d) => term.write(d.replace(/\n/g, "\r\n")),
          onStderr: (d) => term.write(d.replace(/\n/g, "\r\n")),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        term.write(`\r\n\x1b[31m${message}\x1b[0m`);
      } finally {
        running = false;
        runningAbort = null;
        if (!disposed) prompt();
      }
    };

    const onData = term.onData((data) => {
      if (running) {
        if (data === CTRL_C) {
          runningAbort?.abort();
          session.sendInput(data);
          term.write("^C");
          return;
        }
        session.sendInput(data);
        return;
      }

      switch (data) {
        case ENTER: {
          const command = line.trim();
          term.write("\r\n");
          if (command) history.unshift(command);
          historyIndex = -1;
          line = "";
          if (command) {
            void runCommand(command);
          } else {
            prompt();
          }
          return;
        }
        case CTRL_C:
          line = "";
          historyIndex = -1;
          term.write("^C");
          prompt();
          return;
        case BACKSPACE:
          if (line.length > 0) {
            line = line.slice(0, -1);
            term.write("\b \b");
          }
          return;
        case ARROW_UP:
          if (history.length > 0) {
            historyIndex = Math.min(historyIndex + 1, history.length - 1);
            redrawLine(history[historyIndex] ?? "");
          }
          return;
        case ARROW_DOWN:
          if (historyIndex > 0) {
            historyIndex -= 1;
            redrawLine(history[historyIndex] ?? "");
          } else {
            historyIndex = -1;
            redrawLine("");
          }
          return;
        default:
          if (data >= " " || data === "\t") {
            line += data;
            term.write(data);
          }
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        session.resize(term.cols, term.rows);
      } catch {
        /* not measurable */
      }
    });
    resizeObserver.observe(host);

    term.write(
      "\x1b[1;32mAlmostOS Terminal\x1b[0m \x1b[2m— almostnode in your browser\x1b[0m\r\n" +
        '\x1b[2mTry: ls, cat package.json, node -e "console.log(1+1)", npm install\x1b[0m\r\n',
    );
    prompt();
    term.focus();

    // Let other surfaces (e.g. Keychain "Log in") run a command here.
    const unsubscribeBus = terminalBus.subscribe((command) => {
      if (running || disposed) return;
      term.write(command);
      term.write("\r\n");
      line = "";
      void runCommand(command);
    });

    return () => {
      disposed = true;
      unsubscribeBus();
      onData.dispose();
      resizeObserver.disconnect();
      runningAbort?.abort();
      session.dispose();
      term.dispose();
      // Only clear the overlay registry if this terminal is still the active
      // one — another terminal may have taken over since this one last ran a
      // command, and its host shouldn't be clobbered by this unmount.
      if (terminalOverlayHost.get() === host) {
        terminalOverlayHost.set(null);
      }
    };
  }, [ready, workspace]);

  return <div className="os-terminal" ref={hostRef} />;
}
