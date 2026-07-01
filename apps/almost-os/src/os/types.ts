import type { ComponentType } from "react";

export type AppId =
  | "finder"
  | "chrome"
  | "terminal"
  | "code"
  | "keychain"
  | "tailscale"
  | "winamp"
  | "napster"
  | "appstore"
  | "settings";

export interface AppDefinition {
  id: AppId;
  /** Menu-bar + dock display name. */
  name: string;
  /** Default window size when first opened. */
  defaultSize: { width: number; height: number };
  /** Minimum window size. */
  minSize?: { width: number; height: number };
  /** The window body. */
  component: ComponentType;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
