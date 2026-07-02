// Resolves a native app's NativeMenuItemTemplate (AppDefinition.menu) into the
// ResolvedMenu shape the MenuBar consumes — same rendering path as Electron
// app menus, with commandIds assigned here and clicks kept in a local map.

import type { SerializedMenuItem } from "@agent-wasm/core";
import type { NativeMenuItemTemplate } from "../os/types";
import type { ResolvedMenu } from "./menu-store";

let commandSeq = 0;

export function resolveNativeMenu(
  appName: string,
  template: NativeMenuItemTemplate[],
): ResolvedMenu {
  const handlers = new Map<string, () => void>();
  const resolveItems = (items: NativeMenuItemTemplate[]): SerializedMenuItem[] =>
    items.map((item) => {
      const commandId = `native-${++commandSeq}`;
      if (item.click) handlers.set(commandId, item.click);
      const type = item.type ?? (item.submenu ? "submenu" : "normal");
      return {
        commandId,
        type,
        label: item.label ?? "",
        // Items with no behavior render disabled, like the default menu.
        enabled: item.enabled ?? !!(item.click || item.submenu),
        visible: true,
        checked: item.checked,
        accelerator: item.accelerator,
        submenu: item.submenu ? resolveItems(item.submenu) : undefined,
      };
    });
  return {
    appName,
    items: resolveItems(template),
    onCommand: (commandId) => handlers.get(commandId)?.(),
  };
}

/** Standard Edit menu backed by document.execCommand (native apps share the host DOM). */
export function nativeEditMenu(): NativeMenuItemTemplate {
  const exec = (command: string) => () => {
    try {
      document.execCommand(command);
    } catch {
      /* best effort */
    }
  };
  return {
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: exec("undo") },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: exec("redo") },
      { type: "separator" },
      { label: "Cut", accelerator: "CmdOrCtrl+X", click: exec("cut") },
      { label: "Copy", accelerator: "CmdOrCtrl+C", click: exec("copy") },
      { label: "Paste", accelerator: "CmdOrCtrl+V", click: exec("paste") },
      { label: "Select All", accelerator: "CmdOrCtrl+A", click: exec("selectAll") },
    ],
  };
}
