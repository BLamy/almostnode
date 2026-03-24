import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type {
  AgentBrowserEnv,
  WorkspaceController,
} from "../../almostnode-sdk/src/index";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

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

  return (
    <section style={paneStyle}>
      <header style={paneHeaderStyle}>
        <strong>Editor</strong>
        <span style={captionStyle}>{currentFile || "No file selected"}</span>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 0, flex: 1 }}>
        <div style={sidebarStyle}>
          {snapshot.files.map((filePath) => (
            <button
              key={filePath}
              onClick={() => workspace.setCurrentFile(filePath)}
              style={{
                ...fileButtonStyle,
                background: filePath === currentFile ? "#dbeafe" : "transparent",
                color: filePath === currentFile ? "#0f172a" : "#1e293b",
              }}
            >
              {filePath.replace("/project/", "")}
            </button>
          ))}
        </div>
        <textarea
          value={currentValue}
          onChange={(event) => {
            if (currentFile) {
              workspace.writeFile(currentFile, event.target.value);
            }
          }}
          spellCheck={false}
          style={editorStyle}
        />
      </div>
    </section>
  );
}

export function PreviewPane(
  props: { autoStart?: boolean } = {},
): React.ReactElement {
  const workspace = useWorkspace();
  const snapshot = useWorkspaceSnapshot();

  useEffect(() => {
    if (!props.autoStart || snapshot.preview.status !== "idle") {
      return;
    }
    void workspace.preview.start();
  }, [props.autoStart, snapshot.preview.status, workspace]);

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

export function TerminalPane(): React.ReactElement {
  const workspace = useWorkspace();
  const hostRef = useRef<HTMLDivElement | null>(null);

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

    const session = workspace.terminals.createSession({ cwd: "/project" });
    let buffer = "";
    let running = false;

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

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(hostRef.current);
    onResize();
    terminal.write("almostnode terminal");
    renderPrompt();

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
        running = true;
        try {
          await session.session.run(command, {
            interactive: true,
            onStdout: printChunk,
            onStderr: printChunk,
          });
        } finally {
          running = false;
          renderPrompt();
        }
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
      disposable.dispose();
      resizeObserver.disconnect();
      session.dispose();
      terminal.dispose();
    };
  }, [workspace]);

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
      storage: window.localStorage,
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

const sidebarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "10px",
  borderRight: "1px solid rgba(148,163,184,.3)",
  overflow: "auto",
};

const fileButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: "10px",
  padding: "8px 10px",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "13px",
};

const editorStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  resize: "none",
  padding: "16px",
  minHeight: 0,
  width: "100%",
  height: "100%",
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "13px",
  lineHeight: 1.5,
  background: "#ffffff",
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
