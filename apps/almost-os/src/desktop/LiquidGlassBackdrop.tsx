import { useEffect } from "react";
import { LiquidGlassEngine, type LiquidGlassOptions } from "liquid-glass-web-react";

/**
 * Real liquid-glass edge refraction on a panel's *backdrop*.
 *
 * `liquid-glass-web-react`'s engine bakes a rounded-rect displacement map that
 * refracts only at the edge bevel (neutral center) — exactly the iOS look — but
 * it's built to filter an element's *content*. We want it on the backdrop, so:
 *
 *  - an invisible overlay (inset:0 in the target) gives the engine a coordinate
 *    space identical to the target's border-box;
 *  - the engine writes `overlay.style.filter = url(#lg-N)` and bumps the id each
 *    frame (Safari cache-busting), so a MutationObserver mirrors that filter onto
 *    the *target's* backdrop-filter (composed with a frost blur);
 *  - the target's own CSS `backdrop-filter` (the #liquid-glass fallback) stays as
 *    a graceful degrade if this never mounts.
 */
export function LiquidGlassBackdrop({
  selector,
  frost,
  options,
}: {
  selector: string;
  /** Frost prepended to the engine filter, e.g. "blur(7px) saturate(190%)". */
  frost: string;
  options?: Partial<LiquidGlassOptions>;
}) {
  useEffect(() => {
    let engine: LiquidGlassEngine | null = null;
    let overlay: HTMLDivElement | null = null;
    let defsHost: HTMLDivElement | null = null;
    let mo: MutationObserver | null = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let cancelled = false;

    const attach = () => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) {
        raf = requestAnimationFrame(attach);
        return;
      }
      if (cancelled) return;

      overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:-1;";
      target.appendChild(overlay);

      defsHost = document.createElement("div");
      defsHost.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
      document.body.appendChild(defsHost);

      // The engine derives the lens size from options.width/height (halfWidth =
      // width/2), so feed it the panel's measured size and keep it in sync.
      const measure = () => {
        const r = target.getBoundingClientRect();
        return { width: Math.round(r.width), height: Math.round(r.height) };
      };

      try {
        engine = new LiquidGlassEngine(
          { container: target, filtered: overlay, defsHost },
          { ...options, ...measure() },
        );
      } catch {
        overlay.remove();
        defsHost.remove();
        return; // fall back to CSS #liquid-glass
      }

      const sync = () => {
        const f = overlay?.style.filter;
        if (f) target.style.backdropFilter = `${frost} ${f}`;
      };
      mo = new MutationObserver(sync);
      mo.observe(overlay, { attributes: true, attributeFilter: ["style"] });

      // The panel height tracks the viewport — re-fit the lens on resize.
      ro = new ResizeObserver(() => engine?.setOptions(measure()));
      ro.observe(target);

      engine.setOptions(measure());
      sync();
    };

    attach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      mo?.disconnect();
      ro?.disconnect();
      engine?.destroy();
      const target = document.querySelector<HTMLElement>(selector);
      if (target) target.style.backdropFilter = "";
      overlay?.remove();
      defsHost?.remove();
    };
  }, [selector, frost, options]);

  return null;
}
