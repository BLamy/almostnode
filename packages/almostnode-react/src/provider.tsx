import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./workbench.css";
import type {
  AgentBrowserEnv,
  WorkspaceController,
} from "@agent-wasm/sdk";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FileTree } from "./file-tree";

const WorkspaceContext = createContext<WorkspaceController | null>(null);

export function AlmostnodeProvider(
  props: React.PropsWithChildren<{ workspace: WorkspaceController }>,
): React.ReactElement {
  return (
    <WorkspaceContext.Provider value={props.workspace}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceController {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("AlmostnodeProvider is missing");
  }
  return workspace;
}

export function useWorkspaceSnapshot() {
  const workspace = useWorkspace();
  return useSyncExternalStore(
    (listener) => workspace.subscribe(listener),
    () => workspace.getSnapshot(),
    () => workspace.getSnapshot(),
  );
}

export function EditorPane(): React.ReactElement {
  const workspace = useWorkspace();
  const snapshot = useWorkspaceSnapshot();
  const currentFile = snapshot.currentFile;
  const currentValue = currentFile ? workspace.readFile(currentFile) : "";
  const highlightedSource = useMemo(
    () => highlightSource(currentFile ?? "", currentValue),
    [currentFile, currentValue],
  );
  const [scroll, setScroll] = useState({ left: 0, top: 0 });

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Editor</strong>
        <span style={captionStyle}>{currentFile || "No file selected"}</span>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: 0, flex: 1 }}>
        <div style={{ minHeight: 0, borderRight: "1px solid rgba(148,163,184,.3)" }}>
          <FileTree />
        </div>
        <div className="aw-source-editor" data-agent-wasm-editor="source">
          <pre aria-hidden="true" className="aw-source-editor__highlight">
            <code
              style={{
                transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
              }}
            >
              {highlightedSource}
            </code>
          </pre>
          <textarea
            aria-label={currentFile ? `Edit ${currentFile}` : "Edit file"}
            className="aw-source-editor__textarea"
            value={currentValue}
            onChange={(event) => {
              if (currentFile) {
                workspace.writeFile(currentFile, event.target.value);
              }
            }}
            onScroll={(event) => {
              const target = event.currentTarget;
              setScroll({ left: target.scrollLeft, top: target.scrollTop });
            }}
            wrap="off"
            spellCheck={false}
          />
        </div>
      </div>
    </section>
  );
}

export function PreviewPane(
  props: { autoStart?: boolean } = {},
): React.ReactElement {
  const workspace = useWorkspace();
  const snapshot = useWorkspaceSnapshot();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewPort = useMemo(
    () => getVirtualPreviewPort(snapshot.preview.url),
    [snapshot.preview.url],
  );

  useEffect(() => {
    if (!props.autoStart || snapshot.preview.status !== "idle") {
      return;
    }
    void workspace.preview.start();
  }, [props.autoStart, snapshot.preview.status, workspace]);

  useEffect(() => {
    if (!previewPort) {
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    const bindHmrTarget = () => {
      workspace.container.setHMRTargetForPort(previewPort, iframe.contentWindow);
    };

    bindHmrTarget();
    iframe.addEventListener("load", bindHmrTarget);

    return () => {
      iframe.removeEventListener("load", bindHmrTarget);
      workspace.container.setHMRTargetForPort(previewPort, null);
    };
  }, [previewPort, snapshot.preview.url, workspace]);

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Preview</strong>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={captionStyle}>{snapshot.preview.status}</span>
          <button onClick={() => void workspace.preview.start()}>Start</button>
          <button onClick={() => workspace.preview.stop()}>Stop</button>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, background: "#0f172a" }}>
        {snapshot.preview.url ? (
          <iframe
            ref={iframeRef}
            src={snapshot.preview.url}
            title="Workspace preview"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <div style={emptyStateStyle}>
            <p>Run the preview to render the current workspace.</p>
            {snapshot.preview.error ? (
              <pre style={preStyle}>{snapshot.preview.error}</pre>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function getVirtualPreviewPort(url: string | null): number | null {
  if (!url) {
    return null;
  }
  try {
    const baseUrl = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const pathname = new URL(url, baseUrl).pathname;
    const match = pathname.match(/\/__virtual__\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }
    const port = Number(match[1]);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

export interface TerminalPaneProps {
  cwd?: string;
  env?: Record<string, string>;
  initialCommand?: string;
  initialCommandDelayMs?: number;
}

export function TerminalPane(
  props: TerminalPaneProps = {},
): React.ReactElement {
  const workspace = useWorkspace();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cwd = props.cwd ?? "/project";
  const env = props.env;
  const initialCommand = props.initialCommand?.trim() ?? "";
  const initialCommandDelayMs = props.initialCommandDelayMs ?? 0;

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }
    const terminal = new Terminal({
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
      },
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);

    const session = workspace.terminals.createSession({ cwd, env });
    let buffer = "";
    let running = false;
    let disposed = false;
    let initialCommandTimer: number | null = null;

    const renderPrompt = () => {
      const cwd = session.session.getState().cwd.replace("/project", "~");
      terminal.write(`\r\n${cwd} $ `);
    };

    const printChunk = (chunk: string) => {
      terminal.write(chunk.replace(/\n/g, "\r\n"));
    };

    const onResize = () => {
      fitAddon.fit();
      session.session.resize(terminal.cols, terminal.rows);
    };

    const runCommand = async (command: string) => {
      running = true;
      try {
        await session.session.run(command, {
          interactive: true,
          onStdout: printChunk,
          onStderr: printChunk,
        });
      } catch (caught) {
        if (!disposed) {
          const message = caught instanceof Error ? caught.message : String(caught);
          printChunk(`\n${message}\n`);
        }
      } finally {
        running = false;
        if (!disposed) {
          renderPrompt();
        }
      }
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(hostRef.current);
    onResize();
    terminal.write("almostnode terminal");
    renderPrompt();

    if (initialCommand) {
      const startInitialCommand = () => {
        if (disposed || running) {
          return;
        }
        terminal.write(initialCommand);
        terminal.write("\r\n");
        void runCommand(initialCommand);
      };
      if (initialCommandDelayMs > 0) {
        initialCommandTimer = window.setTimeout(
          startInitialCommand,
          initialCommandDelayMs,
        );
      } else {
        startInitialCommand();
      }
    }

    const disposable = terminal.onData(async (data) => {
      if (running) {
        if (data === "\u0003") {
          session.session.abort();
        } else {
          session.session.sendInput(data);
        }
        return;
      }
      if (data === "\r") {
        terminal.write("\r\n");
        const command = buffer.trim();
        buffer = "";
        if (!command) {
          renderPrompt();
          return;
        }
        await runCommand(command);
        return;
      }
      if (data === "\u007f") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          terminal.write("\b \b");
        }
        return;
      }
      if (data >= " ") {
        buffer += data;
        terminal.write(data);
      }
    });

    return () => {
      disposed = true;
      if (initialCommandTimer !== null) {
        window.clearTimeout(initialCommandTimer);
      }
      disposable.dispose();
      resizeObserver.disconnect();
      session.dispose();
      terminal.dispose();
    };
  }, [cwd, env, initialCommand, initialCommandDelayMs, workspace]);

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Terminal</strong>
      </header>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
    </section>
  );
}

export function AgentPanel(
  props: {
    adapterId?: string;
    browserEnv?: AgentBrowserEnv;
  } = {},
): React.ReactElement {
  const workspace = useWorkspace();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const adapters = useMemo(() => workspace.agents.list(), [workspace]);
  const adapterId = props.adapterId || adapters[0]?.id;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !adapterId) {
      return;
    }

    const mountRoot = document.createElement("div");
    mountRoot.style.height = "100%";
    mountRoot.style.minHeight = "0";
    mountRoot.style.minWidth = "0";
    host.replaceChildren(mountRoot);

    let disposed = false;
    let session: { dispose: () => void } | null = null;

    void workspace.agents.mount(adapterId, {
      element: mountRoot,
      browserEnv: props.browserEnv,
      storage: getBrowserStorage(),
    }).then((mounted) => {
      if (disposed) {
        mounted.dispose();
        return;
      }
      session = mounted;
    });

    return () => {
      disposed = true;
      session?.dispose();
      if (host.contains(mountRoot)) {
        host.replaceChildren();
      }
    };
  }, [adapterId, props.browserEnv, workspace]);

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Agent</strong>
        <span style={captionStyle}>{adapterId || "No adapters registered"}</span>
      </header>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
    </section>
  );
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
  border: "1px solid rgba(148,163,184,.35)",
  borderRadius: "18px",
  overflow: "hidden",
  background: "#f8fafc",
};

const paneHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  borderBottom: "1px solid rgba(148,163,184,.3)",
  background: "#e2e8f0",
};

const captionStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#475569",
};

const emptyStateStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  height: "100%",
  padding: "24px",
  color: "#cbd5e1",
  textAlign: "center",
};

const preStyle: React.CSSProperties = {
  maxWidth: "100%",
  whiteSpace: "pre-wrap",
  textAlign: "left",
};

const KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "var",
  "while",
]);

function highlightSource(path: string, source: string): React.ReactNode[] {
  const language = languageFromPath(path);
  const lines = source.split("\n");
  const nodes: React.ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    nodes.push(...highlightLine(line, language, `${lineIndex}`));
    if (lineIndex < lines.length - 1) {
      nodes.push("\n");
    }
  });
  return nodes.length ? nodes : [" "];
}

function languageFromPath(path: string): "css" | "html" | "json" | "md" | "ts" {
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md") || path.endsWith(".mdx")) return "md";
  return "ts";
}

function highlightLine(
  line: string,
  language: "css" | "html" | "json" | "md" | "ts",
  keyPrefix: string,
): React.ReactNode[] {
  if (language === "html") {
    return highlightWithPattern(
      line,
      keyPrefix,
      /(<\/?[\w-]+|<\/|\/?>|[\w-]+(?==)|"[^"]*"|'[^']*')/g,
    );
  }
  if (language === "css") {
    return highlightWithPattern(
      line,
      keyPrefix,
      /(\/\*.*?\*\/|[.#]?[\w-]+(?=\s*\{)|[\w-]+(?=\s*:)|#[0-9a-fA-F]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?|"[^"]*"|'[^']*')/g,
    );
  }
  if (language === "md") {
    return highlightWithPattern(
      line,
      keyPrefix,
      /(^#{1,6}\s.*|^\s*[-*+]\s+|^>\s.*|`[^`]*`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g,
    );
  }
  return highlightJavaScriptLike(line, language, keyPrefix);
}

function highlightWithPattern(
  line: string,
  keyPrefix: string,
  pattern: RegExp,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > cursor) {
      nodes.push(line.slice(cursor, match.index));
    }
    const value = match[0];
    nodes.push(
      <span className={classForPatternToken(value)} key={`${keyPrefix}-${match.index}`}>
        {value}
      </span>,
    );
    cursor = match.index + value.length;
  }
  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }
  return nodes.length ? nodes : [line || " "];
}

function classForPatternToken(value: string): string {
  if (/^#{1,6}\s/.test(value) || /^\s*[-*+]\s+/.test(value) || /^>\s/.test(value)) {
    return "aw-token-keyword";
  }
  if (value.startsWith("`")) return "aw-token-string";
  if (value.startsWith("**")) return "aw-token-property";
  if (value.startsWith("[") && value.includes("](")) return "aw-token-function";
  if (value.startsWith("\"") || value.startsWith("'")) return "aw-token-string";
  if (value.startsWith("#") || /^\d/.test(value)) return "aw-token-number";
  if (value.startsWith("<") || value === ">" || value === "/>") return "aw-token-keyword";
  if (value.startsWith(".") || value.startsWith("#")) return "aw-token-function";
  return "aw-token-property";
}

function highlightJavaScriptLike(
  line: string,
  language: "json" | "ts",
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  const pushToken = (className: string, value: string) => {
    nodes.push(
      <span className={className} key={`${keyPrefix}-${tokenIndex++}`}>
        {value}
      </span>,
    );
  };

  while (cursor < line.length) {
    const rest = line.slice(cursor);
    if (rest.startsWith("//")) {
      pushToken("aw-token-comment", rest);
      break;
    }
    const quote = line[cursor];
    if (quote === "\"" || quote === "'" || quote === "`") {
      let end = cursor + 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      const value = line.slice(cursor, end);
      const className =
        language === "json" && /^\s*:/.test(line.slice(end))
          ? "aw-token-property"
          : "aw-token-string";
      pushToken(className, value);
      cursor = end;
      continue;
    }

    const numberMatch = /^-?\d+(?:\.\d+)?/.exec(rest);
    if (numberMatch) {
      pushToken("aw-token-number", numberMatch[0]);
      cursor += numberMatch[0].length;
      continue;
    }

    const wordMatch = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (wordMatch) {
      const value = wordMatch[0];
      const after = line.slice(cursor + value.length);
      if (KEYWORDS.has(value)) {
        pushToken("aw-token-keyword", value);
      } else if (/^\s*\(/.test(after)) {
        pushToken("aw-token-function", value);
      } else {
        nodes.push(value);
      }
      cursor += value.length;
      continue;
    }

    nodes.push(line[cursor]);
    cursor += 1;
  }

  return nodes.length ? nodes : [line || " "];
}
