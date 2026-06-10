import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const DRAWER_WIDTH_KEY = 'almostnode-workbench-drawer-width';
const DRAWER_MIN_WIDTH = 420;
const DRAWER_DEFAULT_WIDTH = 760;
/** Keep at least this much room for the chat column while resizing. */
const CHAT_MIN_WIDTH = 380;
/** Matches the CSS width transition on .webide-drawer. */
const DRAWER_TRANSITION_MS = 220;
/** Window event other surfaces dispatch to reveal the workbench drawer. */
export const DRAWER_OPEN_EVENT = 'webide:open-workbench-drawer';

function clampDrawerWidth(width: number): number {
  const max = Math.max(
    DRAWER_MIN_WIDTH,
    (typeof window !== 'undefined' ? window.innerWidth : 1600) - CHAT_MIN_WIDTH,
  );
  return Math.min(Math.max(width, DRAWER_MIN_WIDTH), max);
}

function readDrawerWidth(): number {
  try {
    const stored = Number.parseInt(localStorage.getItem(DRAWER_WIDTH_KEY) ?? '', 10);
    if (Number.isFinite(stored) && stored > 0) {
      return clampDrawerWidth(stored);
    }
  } catch {
    // Ignore storage failures.
  }
  return clampDrawerWidth(DRAWER_DEFAULT_WIDTH);
}

function writeDrawerWidth(width: number): void {
  try {
    localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Trigger Monaco layout reflow both immediately and after the drawer
 * transition completes — same pattern as the sidebar toggle.
 */
function dispatchLayoutResize(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
  window.setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, DRAWER_TRANSITION_MS);
}

export interface WorkbenchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Right-side drawer housing the full VS Code workbench. The children are
 * never unmounted: when closed, the outer region collapses to zero width and
 * clips the content, while the inner container keeps its last pixel width so
 * Monaco's grid never measures a 0x0 layout.
 */
export function WorkbenchDrawer({ open, onOpenChange, children }: WorkbenchDrawerProps) {
  const [width, setWidth] = useState(readDrawerWidth);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleToggle = useCallback(() => {
    onOpenChange(!open);
    dispatchLayoutResize();
  }, [open, onOpenChange]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = { startX: event.clientX, startWidth: width };
      setDragging(true);
    },
    [open, width],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const next = clampDrawerWidth(drag.startWidth + (drag.startX - event.clientX));
    setWidth(next);
    if (resizeRafRef.current === null) {
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        window.dispatchEvent(new Event('resize'));
      });
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be released.
      }
      writeDrawerWidth(width);
      dispatchLayoutResize();
    },
    [width],
  );

  // Keep the drawer within bounds when the window shrinks.
  useEffect(() => {
    const handler = () => {
      setWidth((current) => {
        const next = clampDrawerWidth(current);
        return next === current ? current : next;
      });
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => () => {
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
    }
  }, []);

  // Cmd+Shift+. / Ctrl+Shift+. toggles the drawer (plain ⌘J belongs to the
  // workbench panel). Also allow programmatic opening via a window event so
  // other surfaces (e.g. chat) can reveal the workbench.
  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '.' && !e.altKey) {
        e.preventDefault();
        handleToggle();
      }
    };
    const openHandler = () => {
      if (!open) {
        handleToggle();
      }
    };
    window.addEventListener('keydown', keyHandler);
    window.addEventListener(DRAWER_OPEN_EVENT, openHandler);
    return () => {
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener(DRAWER_OPEN_EVENT, openHandler);
    };
  }, [handleToggle, open]);

  return (
    <div
      className={`webide-drawer-region${open ? ' is-open' : ' is-closed'}${dragging ? ' is-dragging' : ''}`}
      data-open={open}
    >
      <div className="webide-drawer" style={{ width: open ? `${width}px` : '0px' }}>
        <div
          className="webide-drawer-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize workbench"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div className="webide-drawer-content" style={{ width: `${width}px` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
