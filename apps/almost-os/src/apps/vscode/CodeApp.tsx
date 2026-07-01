import { useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { languageForPath, setupMonaco } from "./monaco-setup";

const PROJECT_ROOT = "/project";

function basename(path: string): string {
  return path.split("/").pop() || path;
}
function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/* --------------------------------------------------------------- File tree */
function FileExplorer({
  activeFile,
  onOpen,
}: {
  activeFile: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="code__explorer">
      <div className="code__explorer-title">Explorer — project</div>
      <div className="code__tree">
        <DirTree path={PROJECT_ROOT} depth={0} activeFile={activeFile} onOpen={onOpen} />
      </div>
    </div>
  );
}

function DirTree({
  path,
  depth,
  activeFile,
  onOpen,
}: {
  path: string;
  depth: number;
  activeFile: string | null;
  onOpen: (path: string) => void;
}) {
  const { workspace } = useOsRuntime();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fs = workspace.vfs;
    const refresh = () => setTick((t) => t + 1);
    fs.on("change", refresh);
    fs.on("delete", refresh);
    return () => {
      fs.off("change", refresh);
      fs.off("delete", refresh);
    };
  }, [workspace]);

  const nodes = useMemo(() => {
    void tick;
    try {
      const names = workspace.vfs.readdirSync(path) as string[];
      return names
        .map((name) => {
          const child = join(path, name);
          let isDir = false;
          try {
            isDir = workspace.vfs.statSync(child).isDirectory();
          } catch {
            /* ignore */
          }
          return { name, path: child, isDir };
        })
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
        );
    } catch {
      return [];
    }
  }, [workspace, path, tick]);

  return (
    <>
      {nodes.map((node) =>
        node.isDir ? (
          <Folder
            key={node.path}
            node={node}
            depth={depth}
            activeFile={activeFile}
            onOpen={onOpen}
          />
        ) : (
          <button
            key={node.path}
            type="button"
            className={`code__tree-row${activeFile === node.path ? " is-active" : ""}`}
            style={{ paddingLeft: 10 + depth * 12 + 14 }}
            onClick={() => onOpen(node.path)}
          >
            <span className="code__tree-file-dot" />
            <span className="code__tree-label">{node.name}</span>
          </button>
        ),
      )}
    </>
  );
}

function Folder({
  node,
  depth,
  activeFile,
  onOpen,
}: {
  node: { name: string; path: string };
  depth: number;
  activeFile: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <>
      <button
        type="button"
        className="code__tree-row"
        style={{ paddingLeft: 10 + depth * 12 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`code__tree-caret${open ? " is-open" : ""}`}>▸</span>
        <span className="code__tree-label">{node.name}</span>
      </button>
      {open && (
        <DirTree path={node.path} depth={depth + 1} activeFile={activeFile} onOpen={onOpen} />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- Code app */
export function CodeApp() {
  const { workspace, ready } = useOsRuntime();
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<ReturnType<typeof setupMonaco> | null>(null);
  const modelsRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());
  const saveTimers = useRef<Map<string, number>>(new Map());

  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  // Create the editor once.
  useEffect(() => {
    if (!ready || !editorHostRef.current || editorRef.current) return;
    const monaco = setupMonaco();
    monacoRef.current = monaco;
    const editor = monaco.editor.create(editorHostRef.current, {
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      tabSize: 2,
    });
    editorRef.current = editor;
    const sub = editor.onDidChangeCursorPosition((e) =>
      setCursor({ line: e.position.lineNumber, col: e.position.column }),
    );
    return () => {
      sub.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [ready]);

  const openFile = useMemo(
    () =>
      (path: string) => {
        const monaco = monacoRef.current;
        const editor = editorRef.current;
        if (!monaco || !editor) return;
        let model = modelsRef.current.get(path);
        if (!model) {
          let content = "";
          try {
            content = String(workspace.vfs.readFileSync(path, "utf8"));
          } catch {
            content = "";
          }
          const uri = monaco.Uri.parse(`inmemory:/${path.replace(/^\//, "")}`);
          model =
            monaco.editor.getModel(uri) ??
            monaco.editor.createModel(content, languageForPath(path), uri);
          model.onDidChangeContent(() => {
            const existing = saveTimers.current.get(path);
            if (existing) window.clearTimeout(existing);
            saveTimers.current.set(
              path,
              window.setTimeout(() => {
                try {
                  workspace.writeFile(path, model!.getValue());
                } catch {
                  /* ignore */
                }
              }, 400),
            );
          });
          modelsRef.current.set(path, model);
        }
        editor.setModel(model);
        setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
        setActive(path);
      },
    [workspace],
  );

  // Open the workspace's current file on mount and whenever it changes.
  useEffect(() => {
    if (!ready) return;
    const initial = workspace.getSnapshot().currentFile;
    if (initial) openFile(initial);
    const unsubscribe = workspace.subscribe(() => {
      const current = workspace.getSnapshot().currentFile;
      if (current) openFile(current);
    });
    return unsubscribe;
  }, [ready, workspace, openFile]);

  const closeTab = (path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      if (active === path) {
        const fallback = next[next.length - 1] ?? null;
        setActive(fallback);
        const editor = editorRef.current;
        if (editor) {
          if (fallback) editor.setModel(modelsRef.current.get(fallback) ?? null);
          else editor.setModel(null);
        }
      }
      return next;
    });
  };

  const switchTab = (path: string) => {
    const editor = editorRef.current;
    const model = modelsRef.current.get(path);
    if (editor && model) editor.setModel(model);
    setActive(path);
  };

  return (
    <div className="code">
      <div className="code__activity">
        <span className="code__activity-icon is-active" title="Explorer">
          ▤
        </span>
        <span className="code__activity-icon" title="Search">
          ⌕
        </span>
        <span className="code__activity-icon" title="Source Control">
          ⑂
        </span>
      </div>
      <FileExplorer activeFile={active} onOpen={openFile} />
      <div className="code__main">
        <div className="code__tabs">
          {openFiles.map((path) => (
            <div
              key={path}
              className={`code__tab${active === path ? " is-active" : ""}`}
              onClick={() => switchTab(path)}
            >
              <span className="code__tab-label">{basename(path)}</span>
              <button
                type="button"
                className="code__tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(path);
                }}
                aria-label="Close tab"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="code__editor" ref={editorHostRef} />
        {openFiles.length === 0 && (
          <div className="code__welcome">
            <p>Code</p>
            <span>Open a file from the Explorer or Finder.</span>
          </div>
        )}
        <div className="code__statusbar">
          <span>{active ? languageForPath(active) : "—"}</span>
          <span className="code__status-spacer" />
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>UTF-8</span>
          <span>almostnode</span>
        </div>
      </div>
    </div>
  );
}
