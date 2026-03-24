// @ts-expect-error — no @types/react; works at runtime via Vite bundling
import { createElement, useState, useEffect, useRef, useCallback } from 'react';
// @ts-ignore — no @types/react-dom; works at runtime via Vite bundling
import { createRoot } from 'react-dom/client';

import type { PlaywrightCommandListener } from 'almostnode/internal';

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4'];
const SESSION_TIMEOUT_MS = 10_000;

// Commands that target specific elements (have elementRect)
const VISUAL_COMMANDS = new Set(['click', 'fill', 'hover', 'type']);

// ── Event bus (vanilla JS → React) ───────────────────────────────────────────

interface CursorCommand {
  subcommand: string;
  x: number;
  y: number;
  color: string;
}

const cursorBus = new EventTarget();

function dispatchCursorEvent(detail: CursorCommand): void {
  cursorBus.dispatchEvent(new CustomEvent('cursor', { detail }));
}

function dispatchHideEvent(): void {
  cursorBus.dispatchEvent(new CustomEvent('hide'));
}

// ── React component ──────────────────────────────────────────────────────────

function CursorOverlay() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState(COLORS[0]);
  const [animate, setAnimate] = useState(false); // false = jump, true = spring
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; color: string }>>([]);
  const rippleId = useRef(0);
  const isFirstMove = useRef(true);

  const handleCursor = useCallback((e: Event) => {
    const detail = (e as CustomEvent<CursorCommand>).detail;
    setColor(detail.color);

    if (isFirstMove.current) {
      // First position: jump instantly (no transition)
      setAnimate(false);
      isFirstMove.current = false;
    } else {
      setAnimate(true);
    }

    setPos({ x: detail.x, y: detail.y });
    setVisible(true);

    if (detail.subcommand === 'click') {
      const id = ++rippleId.current;
      setRipples((prev) => [...prev, { id, x: detail.x, y: detail.y, color: detail.color }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    }
  }, []);

  const handleHide = useCallback(() => {
    setVisible(false);
    isFirstMove.current = true;
  }, []);

  useEffect(() => {
    cursorBus.addEventListener('cursor', handleCursor);
    cursorBus.addEventListener('hide', handleHide);
    return () => {
      cursorBus.removeEventListener('cursor', handleCursor);
      cursorBus.removeEventListener('hide', handleHide);
    };
  }, [handleCursor, handleHide]);

  // The cursor SVG pointer
  const cursorSvg = createElement(
    'svg',
    {
      width: 20,
      height: 20,
      viewBox: '0 0 24 24',
      fill: color,
      style: { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))' },
    },
    createElement('path', {
      d: 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z',
    }),
  );

  // Color pill label
  const pill = createElement(
    'div',
    {
      style: {
        position: 'absolute' as const,
        left: 18,
        top: 16,
        background: color,
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        fontFamily: "'Instrument Sans', system-ui, sans-serif",
        padding: '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap' as const,
        lineHeight: '16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      },
    },
    'Agent',
  );

  // Build ripple elements
  const rippleEls = ripples.map((r) =>
    createElement('div', {
      key: r.id,
      style: {
        position: 'absolute' as const,
        left: r.x - 20,
        top: r.y - 20,
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: `2px solid ${r.color}`,
        opacity: 0,
        transform: 'scale(0.3)',
        animation: 'cursor-ripple 600ms ease-out forwards',
      },
    }),
  );

  // Cursor element — uses CSS transform + transition instead of motion values
  const cursorEl = visible
    ? createElement(
        'div',
        {
          key: 'cursor',
          style: {
            position: 'absolute' as const,
            left: 0,
            top: 0,
            transform: `translate(${pos.x}px, ${pos.y}px)`,
            transition: animate ? 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s' : 'none',
            opacity: 1,
            zIndex: 1,
            pointerEvents: 'none' as const,
          },
        },
        cursorSvg,
        pill,
      )
    : null;

  return createElement(
    'div',
    null,
    cursorEl,
    ...rippleEls,
  );
}

// ── Initialization ───────────────────────────────────────────────────────────

export function initCursorOverlay(
  body: HTMLDivElement,
  onPlaywrightCommand: (fn: PlaywrightCommandListener) => () => void,
): () => void {
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10000;';
  body.appendChild(overlay);

  // Inject ripple keyframe animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes cursor-ripple {
      0% { transform: scale(0.3); opacity: 0.7; }
      100% { transform: scale(2.5); opacity: 0; }
    }
  `;
  overlay.appendChild(style);

  // Mount React
  const reactContainer = document.createElement('div');
  overlay.appendChild(reactContainer);
  const root = createRoot(reactContainer);
  root.render(createElement(CursorOverlay));

  // Session state
  let colorIndex = 0;
  let sessionActive = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function resetTimeout(): void {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      sessionActive = false;
      dispatchHideEvent();
    }, SESSION_TIMEOUT_MS);
  }

  // Find the iframe inside the body to compute coordinate offsets
  function getIframe(): HTMLIFrameElement | null {
    return body.querySelector('iframe') as HTMLIFrameElement | null;
  }

  const removeListener = onPlaywrightCommand((subcommand, _args, _result, selectorContext) => {
    if (!VISUAL_COMMANDS.has(subcommand)) return;
    if (!selectorContext?.elementRect) return;

    const iframe = getIframe();
    if (!iframe) return;

    const rect = selectorContext.elementRect;

    // elementRect is from getBoundingClientRect() inside the iframe — coordinates
    // are relative to the iframe viewport.  The overlay covers the body div.
    // Compute the iframe's offset within the body to translate correctly.
    const iframeRect = iframe.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();

    const offsetX = iframeRect.left - bodyRect.left;
    const offsetY = iframeRect.top - bodyRect.top;

    const x = offsetX + rect.x + rect.width / 2;
    const y = offsetY + rect.y + rect.height / 2;

    // Debug: log coordinates to help diagnose positioning issues
    console.debug('[cursor-overlay]', subcommand, {
      elementRect: rect,
      iframeOffset: { x: offsetX, y: offsetY },
      iframeRect: { left: iframeRect.left, top: iframeRect.top, width: iframeRect.width, height: iframeRect.height },
      bodyRect: { left: bodyRect.left, top: bodyRect.top, width: bodyRect.width, height: bodyRect.height },
      cursor: { x, y },
    });

    // Start new session if needed
    if (!sessionActive) {
      sessionActive = true;
      colorIndex = (colorIndex + 1) % COLORS.length;
    }

    dispatchCursorEvent({
      subcommand,
      x,
      y,
      color: COLORS[colorIndex],
    });

    resetTimeout();
  });

  return () => {
    removeListener();
    if (timeoutHandle) clearTimeout(timeoutHandle);
    root.unmount();
    overlay.remove();
  };
}
