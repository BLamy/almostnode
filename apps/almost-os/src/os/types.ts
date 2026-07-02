import type { ComponentType } from "react";
import type { SystemActions } from "./system";

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
  | "executor"
  | "settings";

/** Template for a native app's MenuBar contribution (Electron-template-like). */
export interface NativeMenuItemTemplate {
  type?: "normal" | "separator" | "checkbox" | "radio";
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  click?: () => void;
  submenu?: NativeMenuItemTemplate[];
}

export interface AppDefinition {
  id: AppId;
  /** Menu-bar + dock display name. */
  name: string;
  /**
   * MenuBar menus shown while this app has focus, rendered through the same
   * dropdown path as Electron app menus. Standard Window/Help menus are
   * appended automatically when the template doesn't define them.
   */
  menu?: (ctx: { system: SystemActions }) => NativeMenuItemTemplate[];
  /** Default window size when first opened. */
  defaultSize: { width: number; height: number };
  /** Minimum window size. */
  minSize?: { width: number; height: number };
  /**
   * Render with no OS window chrome — no titlebar, traffic lights, border, or
   * background. The app supplies its own header/controls (e.g. Winamp uses
   * Webamp's own titlebar).
   */
  frameless?: boolean;
  /**
   * Stretch the window container over the whole work area and make it
   * click-through except over the app's own painted content (which re-enables
   * pointer events), so self-managed apps (Webamp) can float sub-windows
   * anywhere on the desktop. Usually combined with `frameless`.
   */
  overlay?: boolean;
  /** The window body. */
  component: ComponentType;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
