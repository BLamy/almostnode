import { createContext, useContext, type ReactNode } from "react";
import type { AppId } from "./types";

export interface SystemActions {
  /** Open (or focus) an app window. */
  openApp: (id: AppId) => void;
  /** Open a file path in the Code editor and focus it. */
  openFile: (path: string) => void;
  /** Open the Terminal and run a command in it (e.g. an auth login flow). */
  runInTerminal: (command: string) => void;
  /** Open a URL in a new Chrome tab and focus the browser. */
  openUrl: (url: string) => void;
}

const SystemContext = createContext<SystemActions | null>(null);

export function SystemProvider({
  value,
  children,
}: {
  value: SystemActions;
  children: ReactNode;
}) {
  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystem(): SystemActions {
  const value = useContext(SystemContext);
  if (!value) {
    throw new Error("useSystem must be used within <SystemProvider>");
  }
  return value;
}
