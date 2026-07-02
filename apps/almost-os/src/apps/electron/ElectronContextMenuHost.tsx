import { useEffect } from "react";
import type { SerializedMenuItem } from "@agent-wasm/core";
import {
  closeContextMenu,
  trackPointer,
  useContextMenu,
} from "./context-menu-store";

/**
 * Renders the active Electron `Menu.popup()` context menu at the cursor,
 * reusing the MenuBar dropdown styling. Mounted once in Desktop. Also tracks the
 * desktop cursor so no-arg popups appear where the pointer is.
 */
function ContextItem({
  item,
  onCommand,
}: {
  item: SerializedMenuItem;
  onCommand: (commandId: string) => void;
}) {
  const disabled = item.enabled === false;
  const checked = (item.type === "checkbox" || item.type === "radio") && item.checked;
  return (
    <div
      className={`os-menubar__menu-item${disabled ? " is-disabled" : ""}`}
      role="menuitem"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        onCommand(item.commandId);
      }}
    >
      <span className="os-menubar__menu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="os-menubar__menu-label">{item.label}</span>
    </div>
  );
}

export function ElectronContextMenuHost() {
  const active = useContextMenu();

  // Track the desktop cursor for cursor-positioned popups.
  useEffect(() => {
    const onMove = (e: PointerEvent) => trackPointer(e.clientX, e.clientY);
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    if (!active) return;
    const close = () => closeContextMenu();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);

  if (!active) return null;

  // Keep the menu on screen (rough clamp; menus are small).
  const x = Math.min(active.x, window.innerWidth - 220);
  const y = Math.min(active.y, window.innerHeight - 40);

  return (
    <div
      className="os-menubar__dropdown os-context-menu"
      style={{ position: "fixed", left: Math.max(0, x), top: Math.max(0, y) }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {active.menu.items
        .filter((item) => item.visible !== false)
        .map((item) =>
          item.type === "separator" ? (
            <div key={item.commandId} className="os-menubar__menu-sep" />
          ) : (
            <ContextItem
              key={item.commandId}
              item={item}
              onCommand={(commandId) => {
                active.menu.onCommand(commandId);
                closeContextMenu();
              }}
            />
          ),
        )}
    </div>
  );
}
