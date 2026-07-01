import type { ComponentType } from "react";
import { AppStoreApp } from "../apps/appstore/AppStoreApp";
import { ChromeApp } from "../apps/chrome/ChromeApp";
import { FinderApp } from "../apps/finder/FinderApp";
import { KeychainApp } from "../apps/keychain/KeychainApp";
import { SystemSettingsApp } from "../apps/settings/SystemSettingsApp";
import { TailscaleApp } from "../apps/tailscale/TailscaleApp";
import { TerminalApp } from "../apps/terminal/TerminalApp";
import { CodeApp } from "../apps/vscode/CodeApp";
import { WinampApp } from "../apps/winamp/WinampApp";
import { NapsterApp } from "../apps/napster/NapsterApp";
import {
  AppStoreIcon,
  ChromeIcon,
  CodeIcon,
  FinderIcon,
  KeychainIcon,
  NapsterIcon,
  SettingsIcon,
  TailscaleIcon,
  TerminalIcon,
  WinampIcon,
} from "./icons";
import type { AppDefinition, AppId } from "./types";

export const APPS: Record<AppId, AppDefinition> = {
  finder: {
    id: "finder",
    name: "Finder",
    defaultSize: { width: 780, height: 500 },
    minSize: { width: 480, height: 320 },
    component: FinderApp,
  },
  chrome: {
    id: "chrome",
    name: "Chrome",
    defaultSize: { width: 1000, height: 660 },
    minSize: { width: 560, height: 380 },
    component: ChromeApp,
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    defaultSize: { width: 680, height: 420 },
    minSize: { width: 360, height: 220 },
    component: TerminalApp,
  },
  code: {
    id: "code",
    name: "Code",
    defaultSize: { width: 940, height: 600 },
    minSize: { width: 540, height: 340 },
    component: CodeApp,
  },
  keychain: {
    id: "keychain",
    name: "Keychain Access",
    defaultSize: { width: 640, height: 480 },
    minSize: { width: 440, height: 320 },
    component: KeychainApp,
  },
  tailscale: {
    id: "tailscale",
    name: "Tailscale",
    defaultSize: { width: 460, height: 560 },
    minSize: { width: 380, height: 420 },
    component: TailscaleApp,
  },
  winamp: {
    id: "winamp",
    name: "Winamp",
    defaultSize: { width: 300, height: 440 },
    minSize: { width: 280, height: 320 },
    component: WinampApp,
  },
  napster: {
    id: "napster",
    name: "Napster 4.0",
    defaultSize: { width: 1000, height: 680 },
    minSize: { width: 720, height: 460 },
    component: NapsterApp,
  },
  appstore: {
    id: "appstore",
    name: "App Store",
    defaultSize: { width: 900, height: 620 },
    minSize: { width: 560, height: 400 },
    component: AppStoreApp,
  },
  settings: {
    id: "settings",
    name: "System Settings",
    defaultSize: { width: 860, height: 620 },
    minSize: { width: 620, height: 420 },
    component: SystemSettingsApp,
  },
};

export const APP_ICONS: Record<AppId, ComponentType> = {
  finder: FinderIcon,
  chrome: ChromeIcon,
  terminal: TerminalIcon,
  code: CodeIcon,
  keychain: KeychainIcon,
  tailscale: TailscaleIcon,
  winamp: WinampIcon,
  napster: NapsterIcon,
  appstore: AppStoreIcon,
  settings: SettingsIcon,
};

/** Left-to-right order of permanent dock apps. */
export const DOCK_APP_ORDER: AppId[] = [
  "finder",
  "chrome",
  "terminal",
  "code",
  "keychain",
  "tailscale",
  "winamp",
  "napster",
  "appstore",
  "settings",
];

export function getApp(id: AppId): AppDefinition {
  return APPS[id];
}
