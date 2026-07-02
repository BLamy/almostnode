import type { ComponentType } from "react";
import { AppStoreApp } from "../apps/appstore/AppStoreApp";
import { ChromeApp } from "../apps/chrome/ChromeApp";
import { ExecutorApp } from "../apps/executor/ExecutorApp";
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
  ExecutorIcon,
  FinderIcon,
  KeychainIcon,
  NapsterIcon,
  SettingsIcon,
  TailscaleIcon,
  TerminalIcon,
  WinampIcon,
} from "./icons";
import { nativeEditMenu } from "../desktop/native-menu";
import type { AppDefinition, AppId } from "./types";

export const APPS: Record<AppId, AppDefinition> = {
  finder: {
    id: "finder",
    name: "Finder",
    defaultSize: { width: 1170, height: 750 },
    minSize: { width: 480, height: 320 },
    component: FinderApp,
    menu: ({ system }) => [
      {
        label: "File",
        submenu: [
          {
            label: "New Finder Window",
            accelerator: "CmdOrCtrl+N",
            click: () => system.openApp("finder"),
          },
          { type: "separator" },
          { label: "Get Info", accelerator: "CmdOrCtrl+I" },
        ],
      },
      nativeEditMenu(),
      {
        label: "Go",
        submenu: [
          { label: "Terminal", click: () => system.openApp("terminal") },
          { label: "Applications", click: () => system.openApp("appstore") },
        ],
      },
    ],
  },
  chrome: {
    id: "chrome",
    name: "Chrome",
    defaultSize: { width: 1500, height: 990 },
    minSize: { width: 560, height: 380 },
    component: ChromeApp,
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    defaultSize: { width: 1020, height: 630 },
    minSize: { width: 360, height: 220 },
    component: TerminalApp,
    menu: ({ system }) => [
      {
        label: "Shell",
        submenu: [
          {
            label: "New Window",
            accelerator: "CmdOrCtrl+N",
            click: () => system.openApp("terminal"),
          },
        ],
      },
      nativeEditMenu(),
    ],
  },
  code: {
    id: "code",
    name: "Code",
    defaultSize: { width: 1410, height: 900 },
    minSize: { width: 540, height: 340 },
    component: CodeApp,
  },
  keychain: {
    id: "keychain",
    name: "Keychain Access",
    defaultSize: { width: 960, height: 720 },
    minSize: { width: 440, height: 320 },
    component: KeychainApp,
  },
  tailscale: {
    id: "tailscale",
    name: "Tailscale",
    defaultSize: { width: 690, height: 840 },
    minSize: { width: 380, height: 420 },
    component: TailscaleApp,
  },
  winamp: {
    id: "winamp",
    name: "Winamp",
    // Frameless + overlay: Webamp draws its own titlebar/controls, so we drop
    // the OS window chrome entirely, and the overlay container fills the work
    // area click-through (see `.os-window.is-overlay` in os.css), so Webamp's
    // windows can be dragged anywhere on screen by their own titlebars, like a
    // real Winamp on the desktop. defaultSize is a fallback only — the CSS
    // stretches the container to full screen.
    defaultSize: { width: 560, height: 500 },
    minSize: { width: 280, height: 320 },
    frameless: true,
    overlay: true,
    component: WinampApp,
  },
  napster: {
    id: "napster",
    name: "Napster 4.0",
    defaultSize: { width: 1500, height: 1020 },
    minSize: { width: 720, height: 460 },
    component: NapsterApp,
  },
  appstore: {
    id: "appstore",
    name: "App Store",
    defaultSize: { width: 1350, height: 930 },
    minSize: { width: 560, height: 400 },
    component: AppStoreApp,
  },
  executor: {
    id: "executor",
    name: "executor.sh",
    defaultSize: { width: 1280, height: 840 },
    minSize: { width: 720, height: 480 },
    component: ExecutorApp,
    menu: ({ system }) => [
      {
        label: "File",
        submenu: [
          { label: "Keychain Access…", click: () => system.openApp("keychain") },
          { type: "separator" },
          { label: "Open Terminal", click: () => system.openApp("terminal") },
        ],
      },
      nativeEditMenu(),
    ],
  },
  settings: {
    id: "settings",
    name: "System Settings",
    defaultSize: { width: 1290, height: 930 },
    minSize: { width: 620, height: 420 },
    component: SystemSettingsApp,
    menu: ({ system }) => [
      {
        label: "File",
        submenu: [
          { label: "Keychain Access…", click: () => system.openApp("keychain") },
        ],
      },
      nativeEditMenu(),
    ],
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
  executor: ExecutorIcon,
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
  "executor",
  "settings",
];

export function getApp(id: AppId): AppDefinition {
  return APPS[id];
}
