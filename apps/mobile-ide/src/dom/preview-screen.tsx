'use dom';

import React, { useEffect, useRef, useState } from "react";
import {
  createMobileWorkspace,
  syncSerializedFilesIntoWorkspace,
  type PreviewStateSnapshot,
  type SerializedFile,
  type ThemeMode,
} from "opencode-mobile-runtime";

interface PreviewDomProps {
  ref?: unknown;
  style?: unknown;
  projectId: string;
  files: SerializedFile[];
  revision: number;
  runCommand: string;
  themeMode: ThemeMode;
  onPreviewStateChange: (state: PreviewStateSnapshot) => Promise<void>;
}

type MobileWorkspace = ReturnType<typeof createMobileWorkspace>;

const EMPTY_PREVIEW: PreviewStateSnapshot = {
  status: "idle",
  command: null,
  url: null,
  stdout: "",
  stderr: "",
  error: null,
};

export default function PreviewDom(props: PreviewDomProps): React.ReactElement {
  const workspaceRef = useRef<MobileWorkspace | null>(null);
  const [preview, setPreview] = useState<PreviewStateSnapshot>(EMPTY_PREVIEW);

  useEffect(() => {
    const workspace = createMobileWorkspace({
      projectId: props.projectId,
      files: props.files,
      runCommand: props.runCommand,
      autoStartPreview: true,
      browserEnv: {
        themeMode: props.themeMode,
      },
    });

    workspaceRef.current = workspace;
    setPreview(EMPTY_PREVIEW);

    let active = true;
    const emitPreview = () => {
      const snapshot = workspace.getSnapshot().preview;
      setPreview(snapshot);
      void props.onPreviewStateChange(snapshot);
    };

    const unsubscribe = workspace.subscribe(() => {
      if (!active) {
        return;
      }
      emitPreview();
    });

    void workspace.ready.then(() => {
      if (!active) {
        return;
      }
      emitPreview();
    });

    return () => {
      active = false;
      unsubscribe();
      workspace.destroy();
      workspaceRef.current = null;
      void props.onPreviewStateChange(EMPTY_PREVIEW);
    };
  }, [props.projectId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    syncSerializedFilesIntoWorkspace(workspace, props.files);
  }, [props.files, props.projectId, props.revision]);

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <div>
          <strong>Preview</strong>
          <div style={styles.meta}>{preview.command || props.runCommand}</div>
        </div>
        <div style={styles.buttonRow}>
          <button
            onClick={() => {
              void workspaceRef.current?.preview.start(props.runCommand);
            }}
            style={styles.primaryButton}
            type="button"
          >
            Restart
          </button>
          <button
            onClick={() => {
              workspaceRef.current?.preview.stop();
            }}
            style={styles.secondaryButton}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>
      <div style={styles.statusStrip}>
        <span style={styles.statusPill}>{preview.status}</span>
        {preview.url ? <span style={styles.meta}>{preview.url}</span> : null}
      </div>
      <div style={styles.previewPane}>
        {preview.url ? (
          <iframe
            src={preview.url}
            style={styles.iframe}
            title="Workspace preview"
          />
        ) : (
          <div style={styles.emptyState}>
            Waiting for the workspace preview server.
          </div>
        )}
      </div>
      {(preview.stderr || preview.error) ? (
        <pre style={styles.logPane}>{preview.error || preview.stderr}</pre>
      ) : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: "#ffffff",
    color: "#0f172a",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  toolbar: {
    alignItems: "center",
    background: "#f8fafc",
    borderBottom: "1px solid #dbe4ee",
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 16px",
  },
  meta: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 4,
    wordBreak: "break-all",
  },
  buttonRow: {
    display: "flex",
    gap: 8,
  },
  primaryButton: {
    background: "#0f172a",
    border: "none",
    borderRadius: 12,
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    padding: "10px 14px",
  },
  secondaryButton: {
    background: "#e2e8f0",
    border: "none",
    borderRadius: 12,
    color: "#0f172a",
    cursor: "pointer",
    fontWeight: 700,
    padding: "10px 14px",
  },
  statusStrip: {
    alignItems: "center",
    display: "flex",
    gap: 10,
    padding: "10px 16px",
  },
  statusPill: {
    background: "#dbeafe",
    borderRadius: 999,
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 10px",
    textTransform: "uppercase",
  },
  previewPane: {
    background: "#e2e8f0",
    flex: 1,
    minHeight: 0,
  },
  iframe: {
    border: "none",
    height: "100%",
    width: "100%",
  },
  emptyState: {
    alignItems: "center",
    color: "#64748b",
    display: "flex",
    height: "100%",
    justifyContent: "center",
  },
  logPane: {
    background: "#0f172a",
    color: "#e2e8f0",
    margin: 0,
    maxHeight: 180,
    overflow: "auto",
    padding: 16,
    whiteSpace: "pre-wrap",
  },
};
