// Renders the active Electron dialog (message box or VFS-backed file picker)
// as a modal sheet above the window layer, and resolves the pending
// dialog.show*Dialog promise with the outcome. Mounted once in Desktop.

import { useEffect, useMemo, useState } from "react";
import type { ElectronDialogRequest, ElectronDialogResult } from "@agent-wasm/core";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { resolveDialog, useActiveDialog, type ActiveDialog } from "./dialog-store";

const HOME = "/home/user";

function dirname(p: string): string {
  const cut = p.replace(/\/+$/, "").lastIndexOf("/");
  return cut <= 0 ? "/" : p.slice(0, cut);
}

function join(dir: string, name: string): string {
  return `${dir === "/" ? "" : dir}/${name}`;
}

function MessageBox({ dialog }: { dialog: ActiveDialog }) {
  const { request } = dialog;
  const buttons = request.buttons?.length ? request.buttons : ["OK"];
  const defaultId = request.defaultId ?? 0;
  const [checked, setChecked] = useState(!!request.checkboxChecked);
  const finish = (response: number) =>
    resolveDialog(dialog.id, { canceled: false, response, checkboxChecked: checked });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") finish(defaultId);
      if (e.key === "Escape") finish(request.cancelId ?? 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="os-dialog os-dialog--message" role="alertdialog">
      {request.title && <div className="os-dialog__title">{request.title}</div>}
      {request.message && <div className="os-dialog__message">{request.message}</div>}
      {request.detail && <div className="os-dialog__detail">{request.detail}</div>}
      {request.checkboxLabel && (
        <label className="os-dialog__checkbox">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          {request.checkboxLabel}
        </label>
      )}
      <div className="os-dialog__buttons">
        {buttons.map((label, i) => (
          <button
            key={`${i}-${label}`}
            type="button"
            className={`os-dialog__btn${i === defaultId ? " os-dialog__btn--primary" : ""}`}
            onClick={() => finish(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function FileDialog({ dialog }: { dialog: ActiveDialog }) {
  const { workspace } = useOsRuntime();
  const { request } = dialog;
  const isSave = request.kind === "save";
  const properties = request.properties ?? ["openFile"];
  const pickDirectory = properties.includes("openDirectory");
  const multi = properties.includes("multiSelections");

  const initialDir = useMemo(() => {
    const dp = request.defaultPath;
    if (dp) {
      try {
        if (workspace.vfs.existsSync(dp) && workspace.vfs.statSync(dp).isDirectory()) {
          return dp;
        }
      } catch {
        /* fall through */
      }
      return dirname(dp);
    }
    return HOME;
  }, [request.defaultPath, workspace]);

  const [dir, setDir] = useState(initialDir);
  const [selected, setSelected] = useState<string[]>([]);
  const [saveName, setSaveName] = useState(() =>
    isSave && request.defaultPath ? request.defaultPath.split("/").pop() ?? "" : "",
  );

  const allowedExtensions = useMemo(() => {
    const exts = (request.filters ?? []).flatMap((f) => f.extensions);
    return exts.length && !exts.includes("*")
      ? new Set(exts.map((e) => e.toLowerCase()))
      : null;
  }, [request.filters]);

  const entries = useMemo<Entry[]>(() => {
    try {
      const names = workspace.vfs.readdirSync(dir) as string[];
      const out: Entry[] = [];
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const path = join(dir, name);
        let isDirectory = false;
        try {
          isDirectory = workspace.vfs.statSync(path).isDirectory();
        } catch {
          continue;
        }
        if (!isDirectory && allowedExtensions) {
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          if (!allowedExtensions.has(ext)) continue;
        }
        out.push({ name, path, isDirectory });
      }
      return out.sort((a, b) =>
        a.isDirectory === b.isDirectory
          ? a.name.localeCompare(b.name)
          : a.isDirectory
            ? -1
            : 1,
      );
    } catch {
      return [];
    }
  }, [dir, workspace, allowedExtensions]);

  const cancel = () =>
    resolveDialog(dialog.id, {
      canceled: true,
      ...(isSave ? { filePath: undefined } : { filePaths: [] }),
    });

  const confirm = () => {
    if (isSave) {
      const name = saveName.trim();
      if (!name) return;
      resolveDialog(dialog.id, { canceled: false, filePath: join(dir, name) });
      return;
    }
    const paths = pickDirectory && selected.length === 0 ? [dir] : selected;
    if (paths.length === 0) return;
    resolveDialog(dialog.id, { canceled: false, filePaths: paths });
  };

  const select = (entry: Entry) => {
    if (pickDirectory && !entry.isDirectory) return;
    if (!pickDirectory && entry.isDirectory) return;
    if (isSave) {
      setSaveName(entry.name);
      return;
    }
    setSelected((prev) =>
      multi
        ? prev.includes(entry.path)
          ? prev.filter((p) => p !== entry.path)
          : [...prev, entry.path]
        : [entry.path],
    );
  };

  const confirmLabel = request.buttonLabel ?? (isSave ? "Save" : "Open");
  const canConfirm = isSave
    ? saveName.trim().length > 0
    : pickDirectory || selected.length > 0;

  return (
    <div className="os-dialog os-dialog--files" role="dialog" aria-label={request.title}>
      <div className="os-dialog__title">
        {request.title ?? (isSave ? "Save" : "Open")}
      </div>
      <div className="os-dialog__pathbar">
        <button
          type="button"
          className="os-dialog__up"
          onClick={() => setDir(dirname(dir))}
          disabled={dir === "/"}
          aria-label="Parent folder"
        >
          ‹
        </button>
        <span className="os-dialog__path">{dir}</span>
      </div>
      <div className="os-dialog__list">
        {entries.length === 0 && <div className="os-dialog__empty">Empty folder</div>}
        {entries.map((entry) => (
          <div
            key={entry.path}
            className={`os-dialog__entry${selected.includes(entry.path) ? " is-selected" : ""}`}
            onClick={() => select(entry)}
            onDoubleClick={() => entry.isDirectory && setDir(entry.path)}
          >
            <span className="os-dialog__entry-icon" aria-hidden="true">
              {entry.isDirectory ? "📁" : "📄"}
            </span>
            {entry.name}
          </div>
        ))}
      </div>
      {isSave && (
        <input
          className="os-dialog__savename"
          value={saveName}
          placeholder="File name"
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) confirm();
          }}
          autoFocus
        />
      )}
      <div className="os-dialog__buttons">
        <button type="button" className="os-dialog__btn" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="os-dialog__btn os-dialog__btn--primary"
          disabled={!canConfirm}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function ElectronDialogHost() {
  const dialog = useActiveDialog();
  if (!dialog) return null;
  return (
    <div className="os-dialog-backdrop">
      {dialog.request.kind === "message" ? (
        <MessageBox key={dialog.id} dialog={dialog} />
      ) : (
        <FileDialog key={dialog.id} dialog={dialog} />
      )}
    </div>
  );
}
