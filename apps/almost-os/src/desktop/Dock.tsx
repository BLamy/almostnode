import { useEffect, useRef, useState } from "react";
import { LiquidGlass } from "liquid-glass-web-react";
import { CATALOG } from "../apps/appstore/catalog";
import { useRunning } from "../apps/electron/electron-app-manager";
import { APPS, APP_ICONS, DOCK_APP_ORDER } from "../os/apps";
import type { AppId } from "../os/types";
import { useOpenAppIds, useWindowManager } from "../windows/WindowManager";

const AMPLITUDE = 0.55;
const SPREAD = 90;
const LIFT = 22;

/** A permanent native app or a transient running-Electron app. */
type DockItem =
  | { kind: "native"; id: AppId }
  | { kind: "electron"; id: string; name: string; emoji: string };

function electronMeta(id: string): { name: string; emoji: string } {
  const entry = CATALOG.find((c) => c.id === id);
  return { name: entry?.name ?? id, emoji: entry?.emoji ?? "▢" };
}

export function Dock() {
  const wm = useWindowManager();
  const openIds = useOpenAppIds();
  const running = useRunning();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const dockRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Measure the resting dock so the liquid-glass lens matches its size. Icon
  // magnification uses transforms (no reflow), so this size stays stable.
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Running Electron apps that aren't already permanent native dock apps get a
  // transient dock presence (icon + running dot + click-to-focus).
  const electronItems: DockItem[] = [...running]
    .filter((id) => !(id in APPS))
    .map((id) => ({ kind: "electron" as const, id, ...electronMeta(id) }));
  const items: DockItem[] = [
    ...DOCK_APP_ORDER.map((id) => ({ kind: "native" as const, id })),
    ...electronItems,
  ];

  const scaleFor = (index: number): number => {
    if (mouseX == null) return 1;
    const el = itemsRef.current[index];
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const d = mouseX - center;
    return 1 + AMPLITUDE * Math.exp(-(d * d) / (2 * SPREAD * SPREAD));
  };

  const focusElectronApp = (id: string): void => {
    // Raise the frontmost window that belongs to this Electron app.
    const win = wm.state.windows
      .filter((w) => w.frame?.appId === id)
      .sort((a, b) => b.z - a.z)[0];
    if (win) wm.focus(win.id);
  };

  const dock = (
    <div
      className="os-dock"
      ref={dockRef}
      onMouseMove={(e) => setMouseX(e.clientX)}
      onMouseLeave={() => setMouseX(null)}
    >
      {renderItems()}
    </div>
  );

  return (
    <div className="os-dock-wrap">
      {size.w > 0 ? (
        <LiquidGlass
          width={size.w}
          height={size.h}
          radius="auto"
          strength={0.06}
          chromaticAberration={0.18}
          curvature={0.6}
          depth={18}
          glow={0.16}
          edgeHighlight={0.4}
          blur={0}
          shadow={false}
          style={{ overflow: "visible" }}
        >
          {dock}
        </LiquidGlass>
      ) : (
        dock
      )}
    </div>
  );

  function renderItems() {
    return (
      <>
        {items.map((item, index) => {
          const scale = scaleFor(index);
          const style = {
            transform: `translateY(${-(scale - 1) * LIFT}px) scale(${scale})`,
          };
          const setRef = (el: HTMLButtonElement | null) => {
            itemsRef.current[index] = el;
          };
          if (item.kind === "native") {
            const Icon = APP_ICONS[item.id];
            const isRunning = openIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                ref={setRef}
                className="os-dock__item"
                style={style}
                onClick={() => wm.openApp(APPS[item.id])}
                aria-label={APPS[item.id].name}
              >
                <span className="os-dock__label">{APPS[item.id].name}</span>
                <span className="os-dock__icon">
                  <Icon />
                </span>
                <span className={`os-dock__dot${isRunning ? " is-running" : ""}`} />
              </button>
            );
          }
          return (
            <button
              key={`electron-${item.id}`}
              type="button"
              ref={setRef}
              className="os-dock__item"
              style={style}
              onClick={() => focusElectronApp(item.id)}
              aria-label={item.name}
            >
              <span className="os-dock__label">{item.name}</span>
              <span className="os-dock__icon os-dock__icon--emoji">{item.emoji}</span>
              <span className="os-dock__dot is-running" />
            </button>
          );
        })}
      </>
    );
  }
}
