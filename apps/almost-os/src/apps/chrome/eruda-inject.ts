// Eruda console injected straight into the browsed page. Tabs render as
// iframes served same-origin through our CORS/framing proxy
// (`/__api/cors-proxy?url=…`), so we can reach into `contentDocument` and drop
// the real Eruda devtools (console, network, elements, resources) onto the page.
import erudaSource from "eruda/eruda.js?raw";

interface ErudaApi {
  init: (opts?: unknown) => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
}

interface ErudaWindow extends Window {
  eruda?: ErudaApi;
}

/**
 * Inject (once) + open Eruda inside the iframe's document.
 * Returns false when the document is cross-origin (e.g. a non-proxied load),
 * in which case we can't reach into it.
 */
export function showEruda(iframe: HTMLIFrameElement): boolean {
  try {
    const win = iframe.contentWindow as ErudaWindow | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) return false;
    if (!win.eruda) {
      const script = doc.createElement("script");
      script.textContent = erudaSource;
      (doc.body ?? doc.documentElement).appendChild(script);
    }
    win.eruda?.init();
    win.eruda?.show();
    return Boolean(win.eruda);
  } catch {
    // Cross-origin document — SecurityError reaching contentWindow/contentDocument.
    return false;
  }
}

/** Fully remove Eruda from the iframe (leaves no floating entry button). */
export function hideEruda(iframe: HTMLIFrameElement): void {
  try {
    (iframe.contentWindow as ErudaWindow | null)?.eruda?.destroy();
  } catch {
    /* cross-origin — nothing to tear down */
  }
}
