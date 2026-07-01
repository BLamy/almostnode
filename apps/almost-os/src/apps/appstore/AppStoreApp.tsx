import { useCallback, useEffect, useState } from "react";
import { CATALOG, type AppStoreEntry } from "./catalog";
import {
  installApp,
  isInstalled,
  isRunning,
  launchApp,
  stopApp,
  uninstallApp,
} from "./appstore-store";
import { getWorkspace } from "../../runtime/runtime";
import "./appstore.css";

type Phase = "idle" | "installing";

export function AppStoreApp() {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Record<string, Phase>>({});

  const refreshInstalled = useCallback(() => {
    setInstalled(new Set(CATALOG.filter((a) => isInstalled(a.id)).map((a) => a.id)));
  }, []);

  // Installed apps persist in the workspace VFS — recompute once it has booted.
  useEffect(() => {
    refreshInstalled();
    let cancelled = false;
    void getWorkspace().ready.then(() => {
      if (!cancelled) refreshInstalled();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshInstalled]);

  const install = async (entry: AppStoreEntry) => {
    setPhase((p) => ({ ...p, [entry.id]: "installing" }));
    try {
      await installApp(entry);
      refreshInstalled();
    } finally {
      setPhase((p) => ({ ...p, [entry.id]: "idle" }));
    }
  };

  const open = (entry: AppStoreEntry) => {
    launchApp(entry.id);
    setRunning((r) => new Set(r).add(entry.id));
  };

  const quit = (entry: AppStoreEntry) => {
    stopApp(entry.id);
    setRunning((r) => {
      const next = new Set(r);
      next.delete(entry.id);
      return next;
    });
  };

  const remove = (entry: AppStoreEntry) => {
    uninstallApp(entry.id);
    setRunning((r) => {
      const next = new Set(r);
      next.delete(entry.id);
      return next;
    });
    refreshInstalled();
  };

  return (
    <div className="appstore">
      <div className="appstore__hero">
        <h1>App Store</h1>
        <p>
          Install real, open-source Electron apps and run them from source — right here in the
          browser. Each opens as its own desktop window with live IPC to a Node.js main process.
        </p>
      </div>
      <div className="appstore__grid">
        {CATALOG.map((entry) => {
          const isInst = installed.has(entry.id);
          const isRun = running.has(entry.id) || isRunning(entry.id);
          const busy = phase[entry.id] === "installing";
          return (
            <div className="appstore__card" key={entry.id}>
              <div className="appstore__card-head">
                <div
                  className="appstore__icon"
                  style={{ background: `${entry.accent}22`, color: entry.accent }}
                >
                  {entry.emoji}
                </div>
                <div className="appstore__card-title">
                  <b>{entry.name}</b>
                  <span>{entry.tagline}</span>
                </div>
              </div>
              <div className="appstore__desc">{entry.description}</div>
              <div className="appstore__meta">
                <a
                  className="appstore__repo"
                  href={entry.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {entry.repoUrl.replace("https://github.com/", "")} ↗
                </a>
                <div className="appstore__actions">
                  {!isInst ? (
                    <button
                      className="appstore__btn"
                      onClick={() => void install(entry)}
                      disabled={busy}
                    >
                      {busy ? "Installing…" : "Install"}
                    </button>
                  ) : (
                    <>
                      <button
                        className="appstore__btn appstore__btn--ghost"
                        onClick={() => remove(entry)}
                        title="Uninstall"
                      >
                        Remove
                      </button>
                      {isRun ? (
                        <button
                          className="appstore__btn appstore__btn--installed"
                          onClick={() => quit(entry)}
                        >
                          Quit
                        </button>
                      ) : (
                        <button className="appstore__btn" onClick={() => open(entry)}>
                          Open
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
