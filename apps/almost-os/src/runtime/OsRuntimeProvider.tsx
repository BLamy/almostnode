import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceController } from "@agent-wasm/sdk";
import { getWorkspace } from "./runtime";
import { seedVirtualMediaLinks } from "../media/virtual-url-map";

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
      try {
        seedVirtualMediaLinks(workspace.vfs);
      } catch (error) {
        console.error("[almostos] virtual media links unavailable", error);
      }
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [workspace]);

  // Register the real agent CLI commands (`codex`, `opencode`) on the shared
  // container. Lazy-loaded + guarded so a heavy agent module can't block or
  // crash the desktop boot.
  // Expose the current Auth0 session on window so the `napster` CLI can use it
  // directly — no separate SoundCloud sign-in step.
  useEffect(() => {
    void import("../media/soundcloud-bridge")
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
    void import("../apps/terminal/register-tools")
      .then((m) => {
        if (!cancelled) m.registerCliTools(workspace.container);
      })
      .catch((error) => console.error("[almostos] ffmpeg/vim commands unavailable", error));
    void import("../apps/executor/register-executor")
      .then((m) => {
        if (!cancelled) m.registerExecutorCommands(workspace.container);
      })
      .catch((error) => console.error("[almostos] executor command unavailable", error));
    void import("../os/net-capture")
      .then((m) => {
        if (!cancelled) m.registerNetCaptureCommand(workspace.container);
      })
      .catch((error) => console.error("[almostos] netcapture command unavailable", error));
    void import("../os/register-osdriver")
      .then((m) => {
        if (!cancelled) m.registerOsDriverCommand(workspace.container);
      })
      .catch((error) => console.error("[almostos] desktop command unavailable", error));
    void import("../os/register-replay")
      .then((m) => {
        if (!cancelled) m.registerReplayCommand(workspace.container);
      })
      .catch((error) => console.error("[almostos] replay command unavailable", error));
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
