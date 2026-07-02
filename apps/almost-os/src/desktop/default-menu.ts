// Fallback application menu shown when the focused app publishes no menu of
// its own (native apps without AppDefinition.menu, Electron apps that never
// call Menu.setApplicationMenu, or an empty desktop → Finder). Window actions
// are wired to the WindowManager; edit items go through document.execCommand,
// which works for focused inputs since native apps share the host DOM.

import type { SerializedMenuItem } from "@agent-wasm/core";
import type { ResolvedMenu } from "./menu-store";

export interface DefaultMenuActions {
  close?: () => void;
  minimize?: () => void;
  zoom?: () => void;
}

let commandSeq = 0;

export function buildDefaultMenu(
  appName: string,
  actions: DefaultMenuActions = {},
): ResolvedMenu {
  const handlers = new Map<string, () => void>();
  const item = (
    label: string,
    options: Partial<SerializedMenuItem> & { onClick?: () => void } = {},
  ): SerializedMenuItem => {
    const { onClick, ...rest } = options;
    const commandId = `default-${++commandSeq}`;
    if (onClick) handlers.set(commandId, onClick);
    return {
      commandId,
      type: "normal",
      label,
      enabled: !!onClick,
      visible: true,
      ...rest,
    };
  };
  const separator = (): SerializedMenuItem => ({
    commandId: `default-${++commandSeq}`,
    type: "separator",
    label: "",
    enabled: false,
    visible: true,
  });
  const submenu = (label: string, items: SerializedMenuItem[]): SerializedMenuItem => ({
    commandId: `default-${++commandSeq}`,
    type: "submenu",
    label,
    enabled: true,
    visible: true,
    submenu: items,
  });
  const exec = (command: string) => () => {
    try {
      document.execCommand(command);
    } catch {
      /* best effort */
    }
  };

  const items: SerializedMenuItem[] = [
    submenu("File", [
      item("New Window"),
      separator(),
      item("Close Window", { accelerator: "CmdOrCtrl+W", onClick: actions.close }),
    ]),
    submenu("Edit", [
      item("Undo", { accelerator: "CmdOrCtrl+Z", onClick: exec("undo") }),
      item("Redo", { accelerator: "Shift+CmdOrCtrl+Z", onClick: exec("redo") }),
      separator(),
      item("Cut", { accelerator: "CmdOrCtrl+X", onClick: exec("cut") }),
      item("Copy", { accelerator: "CmdOrCtrl+C", onClick: exec("copy") }),
      item("Paste", { accelerator: "CmdOrCtrl+V", onClick: exec("paste") }),
      item("Select All", { accelerator: "CmdOrCtrl+A", onClick: exec("selectAll") }),
    ]),
    submenu("View", [item("Reload")]),
    submenu("Window", [
      item("Minimize", { accelerator: "CmdOrCtrl+M", onClick: actions.minimize }),
      item("Zoom", { onClick: actions.zoom }),
      separator(),
      item("Close", { accelerator: "CmdOrCtrl+W", onClick: actions.close }),
    ]),
    submenu("Help", [item(`${appName} Help`)]),
  ];

  return {
    appName,
    items,
    onCommand: (commandId) => handlers.get(commandId)?.(),
  };
}
