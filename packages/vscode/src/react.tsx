import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AgentWasmPluginManifest, NormalizedAgentWasmPluginManifest } from "@agent-wasm/sdk/plugins";
import {
  createVSCodeShell,
  type DisposableLike,
  type VSCodeContributionModuleLoader,
  type VSCodeCustomEditorDefinition,
  type VSCodePanelDefinition,
  type VSCodeShell,
  type VSCodeWorkspaceController,
} from "./shell";

export interface VSCodeProps {
  workspace: VSCodeWorkspaceController;
  plugins?: Parameters<typeof createVSCodeShell>[0]["plugins"] | AgentWasmPluginManifest[] | NormalizedAgentWasmPluginManifest[];
  panels?: VSCodePanelDefinition[];
  customEditors?: VSCodeCustomEditorDefinition[];
  moduleLoader?: VSCodeContributionModuleLoader;
  initialResource?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const VSCodeShellContext = createContext<VSCodeShell | null>(null);

export function useVSCodeShell(): VSCodeShell {
  const shell = useContext(VSCodeShellContext);
  if (!shell) {
    throw new Error("useVSCodeShell must be used under <VSCode>.");
  }
  return shell;
}

export function VSCode({
  workspace,
  plugins,
  panels = [],
  customEditors = [],
  moduleLoader,
  initialResource,
  className,
  style,
  children,
}: VSCodeProps): React.ReactElement {
  const shell = useMemo(
    () => createVSCodeShell({ workspace, plugins, panels, customEditors, moduleLoader }),
    [workspace, plugins, panels, customEditors, moduleLoader],
  );

  useEffect(() => () => shell.dispose(), [shell]);

  useEffect(() => {
    if (initialResource) {
      shell.openResource(initialResource);
    }
  }, [initialResource, shell]);

  const snapshot = useShellSnapshot(shell);
  const resource = snapshot.currentFile ?? initialResource ?? workspace.getSnapshot().currentFile;
  const sidebarPanels = shell.getPanels("sidebar");
  const panelPanels = shell.getPanels("panel");
  const auxiliaryPanels = shell.getPanels("auxiliarybar");

  return (
    <VSCodeShellContext.Provider value={shell}>
      <div
        className={className}
        data-agent-wasm-vscode-shell=""
        style={{
          minHeight: 0,
          height: "100%",
          display: "grid",
          gridTemplateColumns: auxiliaryPanels.length > 0
            ? "minmax(180px, 260px) minmax(0, 1fr) minmax(180px, 260px)"
            : "minmax(180px, 260px) minmax(0, 1fr)",
          gridTemplateRows: panelPanels.length > 0
            ? "minmax(0, 1fr) minmax(160px, 28%)"
            : "minmax(0, 1fr)",
          background: "#0f172a",
          color: "#e5e7eb",
          overflow: "hidden",
          ...style,
        }}
      >
        <SurfaceRegion panels={sidebarPanels} region="sidebar" />
        <EditorRegion shell={shell} resource={resource} />
        {auxiliaryPanels.length > 0 ? (
          <SurfaceRegion panels={auxiliaryPanels} region="auxiliarybar" />
        ) : null}
        {panelPanels.length > 0 ? (
          <div
            data-agent-wasm-vscode-region="panel"
            style={{
              gridColumn: auxiliaryPanels.length > 0 ? "1 / 4" : "1 / 3",
              minHeight: 0,
              borderTop: "1px solid rgba(148, 163, 184, 0.35)",
              overflow: "hidden",
            }}
          >
            <SurfaceRegion panels={panelPanels} region="panel" compact />
          </div>
        ) : null}
        {children}
      </div>
    </VSCodeShellContext.Provider>
  );
}

function useShellSnapshot(shell: VSCodeShell): { currentFile: string | null; version: number } {
  const [snapshot, setSnapshot] = useState(() => ({
    currentFile: shell.workspace.getSnapshot().currentFile,
    version: 0,
  }));

  useEffect(() => {
    const disposable = shell.subscribe(() => {
      setSnapshot((previous) => ({
        currentFile: shell.workspace.getSnapshot().currentFile,
        version: previous.version + 1,
      }));
    });
    return () => disposable.dispose();
  }, [shell]);

  return snapshot;
}

function SurfaceRegion({
  panels,
  region,
  compact = false,
}: {
  panels: VSCodePanelDefinition[];
  region: string;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div
      data-agent-wasm-vscode-region={region}
      style={{
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridAutoRows: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr)",
        borderRight: region === "sidebar" ? "1px solid rgba(148, 163, 184, 0.35)" : undefined,
        borderLeft: region === "auxiliarybar" ? "1px solid rgba(148, 163, 184, 0.35)" : undefined,
        overflow: "hidden",
      }}
    >
      {panels.map((panel) => (
        <PanelHost key={panel.id} panel={panel} />
      ))}
    </div>
  );
}

function PanelHost({ panel }: { panel: VSCodePanelDefinition }): React.ReactElement {
  const shell = useVSCodeShell();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let disposable: DisposableLike | null = null;
    if (!ref.current) {
      return;
    }
    void shell.mountPanel(panel.id, ref.current).then((value) => {
      if (disposed) {
        value.dispose();
        return;
      }
      disposable = value;
    });
    return () => {
      disposed = true;
      disposable?.dispose();
    };
  }, [panel.id, shell]);

  return (
    <div
      ref={ref}
      data-agent-wasm-vscode-panel-host={panel.id}
      style={{
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
      }}
    />
  );
}

function EditorRegion({
  shell,
  resource,
}: {
  shell: VSCodeShell;
  resource: string | null;
}): React.ReactElement {
  const editor = resource ? shell.matchCustomEditor(resource) : undefined;

  return (
    <main
      data-agent-wasm-vscode-region="editor"
      style={{
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: "#111827",
      }}
    >
      {resource && editor ? (
        <CustomEditorHost editor={editor} resource={resource} />
      ) : (
        <TextEditorFallback resource={resource} />
      )}
    </main>
  );
}

function CustomEditorHost({
  editor,
  resource,
}: {
  editor: VSCodeCustomEditorDefinition;
  resource: string;
}): React.ReactElement {
  const shell = useVSCodeShell();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let disposable: DisposableLike | null = null;
    if (!ref.current) {
      return;
    }
    void shell.mountCustomEditor(editor.id, resource, ref.current).then((value) => {
      if (disposed) {
        value.dispose();
        return;
      }
      disposable = value;
    });
    return () => {
      disposed = true;
      disposable?.dispose();
    };
  }, [editor.id, resource, shell]);

  return (
    <div
      ref={ref}
      data-agent-wasm-vscode-custom-editor-host={editor.id}
      style={{
        minWidth: 0,
        minHeight: 0,
        width: "100%",
        height: "100%",
        overflow: "auto",
      }}
    />
  );
}

function TextEditorFallback({ resource }: { resource: string | null }): React.ReactElement {
  const shell = useVSCodeShell();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!resource) {
      setValue("");
      return;
    }
    try {
      setValue(shell.fileProvider.readFile(resource));
    } catch {
      setValue("");
    }
  }, [resource, shell]);

  return (
    <textarea
      aria-label={resource ? `Editor ${resource}` : "Editor"}
      data-agent-wasm-vscode-text-editor=""
      spellCheck={false}
      value={value}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setValue(nextValue);
        if (resource) {
          shell.fileProvider.writeFile(resource, nextValue);
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        resize: "none",
        border: 0,
        outline: 0,
        padding: 16,
        background: "transparent",
        color: "inherit",
        font: "13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    />
  );
}
