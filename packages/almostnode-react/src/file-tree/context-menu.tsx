import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, type ActionIconName } from "./file-icons";

export interface ContextMenuItem {
  label: string;
  icon?: ActionIconName;
  onSelect: () => void;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * A minimal pointer-anchored menu: opens at the click coordinates, traps focus
 * lightly, and dismisses on outside click / Escape / blur. Kept deliberately
 * small so the React Aria <Tree> stays the only heavy dependency.
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}): React.ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Clamp the menu inside the viewport once it has measured its own size.
  useLayoutEffect(() => {
    if (!state || !ref.current) {
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    setPos({
      left: Math.max(8, Math.min(state.x, maxLeft)),
      top: Math.max(8, Math.min(state.y, maxTop)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }
    ref.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [state, onClose]);

  if (!state) {
    return null;
  }

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="aw-ft-contextmenu"
      style={{ left: pos.left, top: pos.top }}
    >
      {state.items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          className={`aw-ft-contextmenu__item${item.danger ? " is-danger" : ""}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon ? <ActionIcon name={item.icon} className="aw-ft-contextmenu__icon" /> : null}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
