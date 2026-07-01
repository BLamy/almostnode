import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceController } from "@agent-wasm/sdk";
import { getWorkspace } from "./runtime";

interface OsRuntimeValue {
  /** The single, central almostnode workspace shared by every window. */
  workspace: WorkspaceController;
  /** True once the workspace VFS + container have finished booting. */
  ready: boolean;
}

const OsRuntimeContext = createContext<OsRuntimeValue | null>(null);

export function OsRuntimeProvider({ children }: { children: ReactNode }) {
  const [workspace] = useState(() => getWorkspace());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void workspace.ready.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [workspace]);

  // Register the real agent CLI commands (`codex`, `opencode`) on the shared
  // container. Lazy-loaded + guarded so a heavy agent module can't block or
  // crash the desktop boot.
  // Expose the SoundCloud OAuth popup flow on window so the `sc login` CLI and
  // the Napster/Keychain "Sign in" buttons can start it.
  useEffect(() => {
    void import("../media/soundcloud-oauth")
      .then((m) => m.installSoundcloudBridge())
      .catch((error) => console.error("[almostos] soundcloud bridge unavailable", error));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import("../apps/terminal/codex/register-codex")
      .then((m) => {
        if (!cancelled) m.registerCodexCommand(workspace.container);
      })
      .catch((error) => console.error("[almostos] codex command unavailable", error));
    void import("../apps/chrome/register-chrome")
      .then((m) => {
        if (!cancelled) m.registerChromeCommands(workspace.container);
      })
      .catch((error) => console.error("[almostos] chrome commands unavailable", error));
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  return (
    <OsRuntimeContext.Provider value={{ workspace, ready }}>
      {children}
    </OsRuntimeContext.Provider>
  );
}

export function useOsRuntime(): OsRuntimeValue {
  const value = useContext(OsRuntimeContext);
  if (!value) {
    throw new Error("useOsRuntime must be used within <OsRuntimeProvider>");
  }
  return value;
}
