'use dom';

import React, { useEffect, useRef, useState } from "react";
import type { DOMProps } from "expo/dom";
import {
  createMobileWorkspace,
  formatError,
  installOpenCodeSecrets,
  mountMobileOpenCodeTui,
  syncSerializedFilesIntoWorkspace,
  type MobileSecretFiles,
  type OpenCodeStatus,
  type ProjectFileApplyOp,
  type SerializedFile,
  type ThemeMode,
} from "opencode-mobile-runtime";

interface OpenCodeDomProps {
  ref?: unknown;
  style?: unknown;
  dom?: DOMProps;
  projectId: string;
  files: SerializedFile[];
  runCommand: string;
  themeMode: ThemeMode;
  persistOps: (ops: ProjectFileApplyOp[]) => Promise<void>;
  flushProject: () => Promise<SerializedFile[]>;
  loadSecrets: () => Promise<MobileSecretFiles>;
  copyText: (text: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  onStatusChange: (status: OpenCodeStatus) => Promise<void>;
}

type MobileWorkspace = ReturnType<typeof createMobileWorkspace>;

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toBase64(workspace: MobileWorkspace, path: string): string {
  const content = workspace.vfs.readFileSync(path);
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return bytesToBase64(bytes);
}

export default function OpenCodeDom(props: OpenCodeDomProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<MobileWorkspace | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const pendingOpsRef = useRef(new Map<string, ProjectFileApplyOp>());
  const persistSuppressedRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<OpenCodeStatus["phase"]>("booting");

  useEffect(() => {
    const workspace = createMobileWorkspace({
      projectId: props.projectId,
      files: props.files,
      runCommand: props.runCommand,
      autoStartPreview: false,
      browserEnv: {
        copy: (text) => props.copyText(text),
        openUrl: (url) => {
          void props.openExternalUrl(url);
        },
        setTitle: (title) => {
          document.title = title || "OpenCode";
        },
        themeMode: props.themeMode,
      },
    });
    workspaceRef.current = workspace;
    setPhase("booting");
    setError(null);
    void props.onStatusChange({ phase: "booting" });

    const queuePersist = (op: ProjectFileApplyOp) => {
      if (persistSuppressedRef.current > 0) {
        return;
      }

      pendingOpsRef.current.set(op.path, op);
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
      }

      persistTimerRef.current = window.setTimeout(() => {
        const ops = [...pendingOpsRef.current.values()];
        pendingOpsRef.current.clear();
        if (ops.length > 0) {
          void props.persistOps(ops);
        }
      }, 250);
    };

    const handleChange = (path: string) => {
      if (!path.startsWith("/project/")) {
        return;
      }

      queuePersist({
        type: "write",
        path,
        contentBase64: toBase64(workspace, path),
      });
    };

    const handleDelete = (path: string) => {
      if (!path.startsWith("/project/")) {
        return;
      }

      queuePersist({
        type: "delete",
        path,
      });
    };

    workspace.vfs.on("change", handleChange);
    workspace.vfs.on("delete", handleDelete);

    let active = true;
    let session: Awaited<ReturnType<typeof mountMobileOpenCodeTui>> | null = null;

    void (async () => {
      try {
        await workspace.ready;
        persistSuppressedRef.current += 1;
        try {
          const secrets = await props.loadSecrets();
          installOpenCodeSecrets(workspace, secrets);
        } finally {
          persistSuppressedRef.current -= 1;
        }

        if (!active || !hostRef.current) {
          return;
        }

        setPhase("starting");
        void props.onStatusChange({ phase: "starting" });

        session = await mountMobileOpenCodeTui({
          container: hostRef.current,
          workspace,
          env: {
            copy: (text: string) => props.copyText(text),
            openUrl: (url: string) => {
              void props.openExternalUrl(url);
            },
            setTitle: (title: string) => {
              document.title = title || "OpenCode";
            },
            themeMode: props.themeMode,
          },
        });

        if (!active) {
          session.dispose();
          return;
        }

        setPhase("running");
        void props.onStatusChange({ phase: "running" });

        void session.exited.catch((sessionError: unknown) => {
          if (!active) {
            return;
          }
          const message = formatError(sessionError);
          setError(message);
          setPhase("error");
          void props.onStatusChange({
            phase: "error",
            error: message,
          });
        });
      } catch (mountError) {
        if (!active) {
          return;
        }
        const message = formatError(mountError);
        setError(message);
        setPhase("error");
        void props.onStatusChange({
          phase: "error",
          error: message,
        });
      }
    })();

    return () => {
      active = false;
      const pendingOps = [...pendingOpsRef.current.values()];
      if (pendingOps.length > 0) {
        void props.persistOps(pendingOps);
      }
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      pendingOpsRef.current.clear();
      session?.dispose();
      hostRef.current?.replaceChildren();
      workspace.vfs.off("change", handleChange);
      workspace.vfs.off("delete", handleDelete);
      workspace.destroy();
      workspaceRef.current = null;
      void props.onStatusChange({ phase: "disposed" });
    };
  }, [props.projectId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    persistSuppressedRef.current += 1;
    try {
      syncSerializedFilesIntoWorkspace(workspace, props.files);
    } finally {
      persistSuppressedRef.current -= 1;
    }
  }, [props.files, props.projectId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    persistSuppressedRef.current += 1;
    void props.loadSecrets()
      .then((secrets) => {
        installOpenCodeSecrets(workspace, secrets);
      })
      .finally(() => {
        persistSuppressedRef.current -= 1;
      });
  }, [props.loadSecrets]);

  return (
    <div style={styles.root}>
      <div style={styles.statusRow}>
        <strong>OpenCode</strong>
        <span style={styles.statusPill}>{phase}</span>
      </div>
      <div ref={hostRef} style={styles.host} />
      {error ? (
        <pre style={styles.error}>{error}</pre>
      ) : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: "#020617",
    color: "#e2e8f0",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  statusRow: {
    alignItems: "center",
    borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 16px",
  },
  statusPill: {
    background: "rgba(56, 189, 248, 0.16)",
    borderRadius: 999,
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 10px",
    textTransform: "uppercase",
  },
  host: {
    flex: 1,
    minHeight: 0,
  },
  error: {
    background: "rgba(185, 28, 28, 0.18)",
    color: "#fecaca",
    margin: 0,
    maxHeight: 160,
    overflow: "auto",
    padding: 16,
    whiteSpace: "pre-wrap",
  },
};
