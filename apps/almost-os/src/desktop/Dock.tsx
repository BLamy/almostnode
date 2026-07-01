import { useRef, useState } from "react";
import { APPS, APP_ICONS, DOCK_APP_ORDER } from "../os/apps";
import { useOpenAppIds, useWindowManager } from "../windows/WindowManager";

const AMPLITUDE = 0.55;
const SPREAD = 90;
const LIFT = 22;

export function Dock() {
  const wm = useWindowManager();
  const openIds = useOpenAppIds();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const scaleFor = (index: number): number => {
    if (mouseX == null) return 1;
    const el = itemsRef.current[index];
    if (!el) return 1;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const d = mouseX - center;
    return 1 + AMPLITUDE * Math.exp(-(d * d) / (2 * SPREAD * SPREAD));
  };

  return (
    <div className="os-dock-wrap">
      <div
        className="os-dock"
        onMouseMove={(e) => setMouseX(e.clientX)}
        onMouseLeave={() => setMouseX(null)}
      >
        {DOCK_APP_ORDER.map((id, index) => {
          const Icon = APP_ICONS[id];
          const scale = scaleFor(index);
          const running = openIds.has(id);
          return (
            <button
              key={id}
              type="button"
              ref={(el) => {
                itemsRef.current[index] = el;
              }}
              className="os-dock__item"
              style={{ transform: `translateY(${-(scale - 1) * LIFT}px) scale(${scale})` }}
              onClick={() => wm.openApp(APPS[id])}
              aria-label={APPS[id].name}
            >
              <span className="os-dock__label">{APPS[id].name}</span>
              <span className="os-dock__icon">
                <Icon />
              </span>
              <span className={`os-dock__dot${running ? " is-running" : ""}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
