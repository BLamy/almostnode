/**
 * os-driver — the AI's view of, and control over, the running desktop.
 *
 * Gives the agent four capabilities over any open app window:
 *   - listApps()          what's open (id, title, rect, focused/minimized)
 *   - snapshot(appId)      an accessibility ref-tree of the app's UI
 *   - screenshot(appId)    a PNG of the app's painted content (html2canvas)
 *   - act(appId, ref, …)   click / type / etc. against a ref from the snapshot
 *
 * Modeled on `packages/almostnode/src/shims/playwright-command.ts`, but it
 * resolves the target from the live DOM (every window carries
 * `data-app-id` / `data-window-id`, see `windows/Window.tsx`) instead of a
 * single hard-coded preview iframe. That keeps it store-independent and
 * realm-safe: native apps render directly in the window body (same realm),
 * and Electron apps expose a same-origin virtual `contentDocument`.
 *
 * refMaps are kept per app so `act` resolves against the app's most recent
 * snapshot — the model reads a snapshot, then acts on the refs it saw.
 */

export interface OsAppInfo {
  appId: string;
  windowId: string;
  title: string;
  focused: boolean;
  minimized: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface OsSnapshotNode {
  role: string;
  name: string;
  ref: string;
  attrs: string[];
  children: OsSnapshotNode[];
}

export type OsActionResult =
  | { ok: true; detail?: string }
  | { ok: false; error: string };

export type OsAction =
  | { type: "click" }
  | { type: "fill"; value: string }
  | { type: "type"; value: string }
  | { type: "clear" }
  | { type: "focus" }
  | { type: "select"; value: string };

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"]);

const IMPLICIT_ROLES: Record<string, string> = {
  A: "link",
  BUTTON: "button",
  INPUT: "textbox",
  TEXTAREA: "textbox",
  SELECT: "combobox",
  IMG: "img",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  NAV: "navigation",
  MAIN: "main",
  HEADER: "banner",
  FOOTER: "contentinfo",
  UL: "list",
  OL: "list",
  LI: "listitem",
  TABLE: "table",
  FORM: "form",
  SUMMARY: "button",
};

// Per-app ref → element map, rebuilt on every snapshot of that app.
const refMaps = new Map<string, Map<string, Element>>();

function isVisible(el: Element): boolean {
  const win = el.ownerDocument?.defaultView;
  if (!win) return true; // jsdom without layout — treat as visible
  const style = win.getComputedStyle(el as HTMLElement);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  return true;
}

function isInput(el: Element): el is HTMLInputElement {
  return el.tagName === "INPUT";
}
function isInputOrTextArea(el: Element): boolean {
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA";
}

function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (v: string) => string } };
  if (typeof g.CSS?.escape === "function") return g.CSS.escape(value);
  // Minimal fallback for environments without CSS.escape (older jsdom).
  return value.replace(/["\\\]]/g, "\\$&");
}

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  return IMPLICIT_ROLES[el.tagName] ?? null;
}

export function getAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = el.ownerDocument;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }

  if (isInputOrTextArea(el) || el.tagName === "SELECT") {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
  }

  if (el.tagName === "IMG") return (el as HTMLImageElement).alt || "";
  return "";
}

/** Build the ref-tree for one root element, populating `refMap`. */
export function buildTree(root: Element, refMap: Map<string, Element>): OsSnapshotNode[] {
  let counter = 0;
  const results: OsSnapshotNode[] = [];

  function walk(el: Element): OsSnapshotNode | null {
    if (SKIP_TAGS.has(el.tagName)) return null;
    if (!isVisible(el)) return null;

    const role = getRole(el);
    const children: OsSnapshotNode[] = [];
    for (const child of Array.from(el.children)) {
      const node = walk(child);
      if (node) children.push(node);
    }

    const hasRole = role !== null;
    const isTextLeaf =
      !hasRole && children.length === 0 && !!el.textContent?.trim() && el.childElementCount === 0;

    if (!hasRole && !isTextLeaf) {
      if (children.length === 1) return children[0];
      if (children.length > 1) return { role: "group", name: "", ref: "", attrs: [], children };
      return null;
    }

    counter += 1;
    const ref = `e${counter}`;
    refMap.set(ref, el);

    const name = getAccessibleName(el) || (isTextLeaf ? el.textContent!.trim() : "");
    const attrs: string[] = [];

    if (/^H[1-6]$/.test(el.tagName)) attrs.push(`level=${el.tagName[1]}`);
    if (isInput(el)) {
      const type = el.type.toLowerCase();
      if (type === "checkbox" || type === "radio") attrs.push(el.checked ? "checked" : "unchecked");
    }
    if ((el as HTMLElement).hasAttribute?.("disabled")) attrs.push("disabled");
    if (isInputOrTextArea(el) && (el as HTMLInputElement).value) {
      const val = (el as HTMLInputElement).value;
      attrs.push(`value="${val.length > 40 ? `${val.slice(0, 40)}…` : val}"`);
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href) attrs.push(`url="${href.length > 60 ? `${href.slice(0, 60)}…` : href}"`);
    }

    return {
      role: role ?? "text",
      name: name.length > 80 ? `${name.slice(0, 80)}…` : name,
      ref,
      attrs,
      children,
    };
  }

  for (const child of Array.from(root.children)) {
    const node = walk(child);
    if (node) results.push(node);
  }
  return results;
}

/** Render a ref-tree as the indented text the model reads. */
export function renderTree(nodes: OsSnapshotNode[], indent = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const prefix = "  ".repeat(indent);
    const bits = [node.role];
    if (node.name) bits.push(JSON.stringify(node.name));
    if (node.ref) bits.push(`[${node.ref}]`);
    for (const attr of node.attrs) bits.push(attr);
    lines.push(`${prefix}- ${bits.join(" ")}`);
    if (node.children.length) lines.push(renderTree(node.children, indent + 1));
  }
  return lines.filter(Boolean).join("\n");
}

// ── DOM resolution ───────────────────────────────────────────────────────────

function windowEls(doc: Document = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(".os-window[data-app-id]"));
}

function windowElFor(appId: string): HTMLElement | null {
  const matches = windowEls();
  // Prefer the focused window when several share an app id.
  const focused = matches.find((el) => el.dataset.appId === appId && el.classList.contains("is-focused"));
  return focused ?? matches.find((el) => el.dataset.appId === appId) ?? null;
}

/**
 * The element to snapshot/act within: the app body, or — for Electron apps —
 * the same-origin virtual iframe's document body when reachable.
 */
function appRoot(windowEl: HTMLElement): Element | null {
  const body = windowEl.querySelector<HTMLElement>(".os-window__body") ?? windowEl;
  const iframe = body.querySelector("iframe");
  if (iframe) {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc?.body) return doc.body;
    } catch {
      // Cross-origin iframe (e.g. a real Chrome tab) — opaque to the DOM.
      return null;
    }
  }
  return body;
}

// ── public API ───────────────────────────────────────────────────────────────

export function listApps(): OsAppInfo[] {
  return windowEls().map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      appId: el.dataset.appId ?? "",
      windowId: el.dataset.windowId ?? "",
      title: el.getAttribute("aria-label") ?? el.querySelector(".os-window__title")?.textContent?.trim() ?? "",
      focused: el.classList.contains("is-focused"),
      minimized: el.classList.contains("is-minimized"),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  });
}

export interface OsSnapshot {
  appId: string;
  opaque?: boolean;
  tree: OsSnapshotNode[];
  text: string;
}

export function snapshot(appId: string): OsSnapshot | { error: string } {
  const windowEl = windowElFor(appId);
  if (!windowEl) return { error: `No open window for app "${appId}". Use listApps() first.` };
  const root = appRoot(windowEl);
  if (!root) {
    return { appId, opaque: true, tree: [], text: "(cross-origin content — not inspectable)" };
  }
  const refMap = new Map<string, Element>();
  refMaps.set(appId, refMap);
  const tree = buildTree(root, refMap);
  return { appId, tree, text: renderTree(tree) };
}

export async function screenshot(appId: string): Promise<{ dataUrl: string } | { error: string }> {
  const windowEl = windowElFor(appId);
  if (!windowEl) return { error: `No open window for app "${appId}".` };
  const root = appRoot(windowEl);
  if (!root || !(root as HTMLElement).ownerDocument?.defaultView) {
    return { error: `App "${appId}" content is not capturable (cross-origin or detached).` };
  }
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(root as HTMLElement, {
      backgroundColor: null,
      logging: false,
      useCORS: true,
    });
    return { dataUrl: canvas.toDataURL("image/png") };
  } catch (error) {
    return { error: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function dispatch(el: Element, type: string, init: EventInit = { bubbles: true }): void {
  // Construct the event with the element's OWN realm's constructor so events
  // dispatched into an Electron app iframe are trusted by its listeners.
  const view = el.ownerDocument?.defaultView as (Window & typeof globalThis) | undefined;
  const Ctor = (view?.Event ?? Event) as typeof Event;
  el.dispatchEvent(new Ctor(type, init));
}

export function act(appId: string, ref: string, action: OsAction): OsActionResult {
  const refMap = refMaps.get(appId);
  if (!refMap) return { ok: false, error: `No snapshot for "${appId}". Call snapshot() first.` };
  const el = refMap.get(ref);
  if (!el) return { ok: false, error: `Ref "${ref}" not found. Re-snapshot "${appId}".` };
  if (!el.isConnected) return { ok: false, error: `Ref "${ref}" is stale (element removed). Re-snapshot.` };

  const view = el.ownerDocument?.defaultView as (Window & typeof globalThis) | undefined;
  const MouseCtor = (view?.MouseEvent ?? MouseEvent) as typeof MouseEvent;

  switch (action.type) {
    case "click": {
      (el as HTMLElement).dispatchEvent(new MouseCtor("mousedown", { bubbles: true }));
      (el as HTMLElement).dispatchEvent(new MouseCtor("mouseup", { bubbles: true }));
      (el as HTMLElement).click?.();
      return { ok: true, detail: `clicked ${describe(el)}` };
    }
    case "focus": {
      (el as HTMLElement).focus?.();
      return { ok: true };
    }
    case "clear":
    case "fill":
    case "type": {
      if (!isInputOrTextArea(el)) {
        return { ok: false, error: `Ref "${ref}" is a <${el.tagName.toLowerCase()}>, not a text field.` };
      }
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      input.focus?.();
      const next =
        action.type === "clear"
          ? ""
          : action.type === "fill"
            ? action.value
            : `${input.value}${action.value}`;
      setNativeValue(input, next);
      dispatch(input, "input");
      dispatch(input, "change");
      return { ok: true, detail: `${action.type} ${describe(el)}` };
    }
    case "select": {
      if (el.tagName !== "SELECT") return { ok: false, error: `Ref "${ref}" is not a <select>.` };
      (el as HTMLSelectElement).value = action.value;
      dispatch(el, "input");
      dispatch(el, "change");
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown action.` };
  }
}

function describe(el: Element): string {
  const name = getAccessibleName(el) || el.textContent?.trim()?.slice(0, 30) || "";
  return `<${el.tagName.toLowerCase()}${name ? ` "${name}"` : ""}>`;
}

/**
 * Set a React-controlled input's value: React overrides the value setter and
 * tracks the last value it wrote, so a plain `.value =` is reverted on the
 * next render. Call the prototype's native setter, then fire input, so React's
 * onChange sees the new value. (Same trick playwright-command uses.)
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/** Clear cached refMaps (test isolation / app close). */
export function resetOsDriver(): void {
  refMaps.clear();
}
