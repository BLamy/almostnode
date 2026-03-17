import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

// ── Event listener system ────────────────────────────────────────────────────

export interface PlaywrightSelectorContext {
  role: string;
  name: string;
  tagName: string;
  testId?: string;
}

export type PlaywrightCommandListener = (
  subcommand: string,
  args: string[],
  result: JustBashExecResult,
  selectorContext?: PlaywrightSelectorContext,
) => void;

const listeners: PlaywrightCommandListener[] = [];

export function onPlaywrightCommand(fn: PlaywrightCommandListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emitCommand(
  subcommand: string,
  args: string[],
  result: JustBashExecResult,
  selectorContext?: PlaywrightSelectorContext,
): void {
  for (const fn of listeners) {
    try {
      fn(subcommand, args, result, selectorContext);
    } catch {
      // listener errors must not break command execution
    }
  }
}

function getSelectorContextForRef(refId: string): PlaywrightSelectorContext | undefined {
  const el = refMap.get(refId);
  if (!el) return undefined;
  const role = getRole(el);
  const name = getAccessibleName(el);
  const testId = el.getAttribute('data-testid') ?? undefined;
  return {
    role: role || el.tagName.toLowerCase(),
    name,
    tagName: el.tagName,
    testId,
  };
}

// ── Module-level state ──────────────────────────────────────────────────────

let refMap = new Map<string, Element>();
let refCounter = 0;
const consoleMessages: Array<{ level: string; text: string }> = [];
const networkRequests: Array<{
  method: string;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  size: number;
}> = [];

// ── Bridge listener ─────────────────────────────────────────────────────────

function installBridgeListener(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'almostnode-console') {
      if (consoleMessages.length < 1000) {
        const text = Array.isArray(data.args) ? data.args.join(' ') : String(data.args);
        consoleMessages.push({ level: data.level || 'log', text });
      }
    }

    if (data.type === 'almostnode-network') {
      if (networkRequests.length < 1000) {
        networkRequests.push({
          method: data.method || 'GET',
          url: data.url || '',
          status: data.status || 0,
          statusText: data.statusText || '',
          duration: data.duration || 0,
          size: data.size || 0,
        });
      }
    }
  });
}

installBridgeListener();

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPreviewIframe(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('webidePreview') as HTMLIFrameElement | null;
}

function getIframeDoc(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

function getIframeWindow(iframe: HTMLIFrameElement): Window | null {
  try {
    return iframe.contentWindow;
  } catch {
    return null;
  }
}

function resolveRef(ref: string): Element | null {
  return refMap.get(ref) ?? null;
}

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string): JustBashExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cross-iframe safe element type checks.
 * `el instanceof HTMLInputElement` fails when `el` comes from an iframe
 * because each frame has its own set of constructors.
 */
function isInputElement(el: Element): boolean {
  return el.tagName === 'INPUT';
}

function isTextAreaElement(el: Element): boolean {
  return el.tagName === 'TEXTAREA';
}

function isInputOrTextArea(el: Element): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

// ── Accessibility snapshot ──────────────────────────────────────────────────

const IMPLICIT_ROLES: Record<string, string> = {
  A: 'link',
  BUTTON: 'button',
  INPUT: 'textbox',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  IMG: 'img',
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  SECTION: 'region',
  ARTICLE: 'article',
  FORM: 'form',
  TABLE: 'table',
  TH: 'columnheader',
  TD: 'cell',
  TR: 'row',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  DIALOG: 'dialog',
  DETAILS: 'group',
  SUMMARY: 'button',
  PROGRESS: 'progressbar',
  METER: 'meter',
  OUTPUT: 'status',
};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'HEAD', 'META', 'LINK', 'BR', 'HR']);

function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (!htmlEl.style) return true;
  const style = htmlEl.style;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (htmlEl.hidden) return false;
  // Check offsetParent for non-fixed elements
  if (htmlEl.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') {
    // Could be invisible, but give benefit of doubt for body children
    if (el.parentElement && el.parentElement.tagName !== 'BODY') return false;
  }
  return true;
}

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  return IMPLICIT_ROLES[el.tagName] ?? null;
}

export function getAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const doc = el.ownerDocument;
    const parts = ariaLabelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  // For inputs, check associated label
  if (isInputOrTextArea(el) || el.tagName === 'SELECT') {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent?.trim() || '';
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
  }

  // For images, use alt
  if (el.tagName === 'IMG') {
    return (el as HTMLImageElement).alt || '';
  }

  return '';
}

export interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  attrs: string[];
  children: SnapshotNode[];
}

export function buildSnapshotTree(root: Element): SnapshotNode[] {
  refMap = new Map();
  refCounter = 0;
  const results: SnapshotNode[] = [];

  function walk(el: Element): SnapshotNode | null {
    if (SKIP_TAGS.has(el.tagName)) return null;
    if (!isVisible(el)) return null;

    const role = getRole(el);
    const children: SnapshotNode[] = [];

    for (const child of Array.from(el.children)) {
      const node = walk(child);
      if (node) children.push(node);
    }

    // Determine if this element is "interesting" — has a role or is a text leaf
    const hasRole = role !== null;
    const isTextLeaf =
      !hasRole &&
      children.length === 0 &&
      el.textContent?.trim() &&
      el.childElementCount === 0;

    if (!hasRole && !isTextLeaf) {
      // Transparent: pass children up
      return children.length === 1
        ? children[0]
        : children.length > 1
          ? { role: 'group', name: '', ref: '', attrs: [], children }
          : null;
    }

    refCounter++;
    const ref = `e${refCounter}`;
    refMap.set(ref, el);

    const name = getAccessibleName(el) || (isTextLeaf ? el.textContent!.trim() : '');
    const attrs: string[] = [];

    // Heading level
    if (/^H[1-6]$/.test(el.tagName)) {
      attrs.push(`level=${el.tagName[1]}`);
    }

    // Checkbox/radio state
    if (isInputElement(el)) {
      const inputEl = el as HTMLInputElement;
      const type = inputEl.type.toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        attrs.push(inputEl.checked ? 'checked' : 'unchecked');
      }
      if (type !== 'text' && type !== 'search' && type !== 'password' && type !== 'email' && type !== 'url' && type !== 'tel' && type !== 'number') {
        attrs.push(`type=${type}`);
      }
    }

    // Disabled
    if ((el as HTMLElement).hasAttribute?.('disabled')) {
      attrs.push('disabled');
    }

    // Value for inputs
    if (
      isInputOrTextArea(el) &&
      (el as any).value
    ) {
      const val = (el as any).value as string;
      const truncated = val.length > 40 ? val.slice(0, 40) + '...' : val;
      attrs.push(`value="${truncated}"`);
    }

    // Link href
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) {
        const truncated = href.length > 60 ? href.slice(0, 60) + '...' : href;
        attrs.push(`url="${truncated}"`);
      }
    }

    return {
      role: role || 'text',
      name: name.length > 80 ? name.slice(0, 80) + '...' : name,
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

function renderTree(nodes: SnapshotNode[], indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const node of nodes) {
    let line = `${prefix}- ${node.role}`;
    if (node.name) line += ` "${node.name}"`;
    for (const attr of node.attrs) line += ` [${attr}]`;
    if (node.ref) line += ` [ref=${node.ref}]`;
    lines.push(line);
    if (node.children.length > 0) {
      lines.push(renderTree(node.children, indent + 1));
    }
  }

  return lines.join('\n');
}

// ── URL resolution ──────────────────────────────────────────────────────────

/**
 * Convert localhost URLs to /__virtual__/{port}/ URLs so the service worker
 * intercepts them and the iframe stays same-origin with the host page.
 */
async function resolvePreviewUrl(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      const port = parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'), 10);
      const { getServerBridge } = await import('../server-bridge');
      const bridge = getServerBridge();
      const virtualBase = bridge.getServerUrl(port);
      return `${virtualBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Relative URL (e.g. "/notes") — resolve against the current virtual server
    if (url.startsWith('/')) {
      try {
        const { getServerBridge } = await import('../server-bridge');
        const bridge = getServerBridge();
        // Try to extract port from the iframe's current src
        const iframe = document.querySelector('iframe[src*="/__virtual__/"]') as HTMLIFrameElement | null;
        const iframeMatch = iframe?.src?.match(/\/__virtual__\/(\d+)/);
        const port = iframeMatch
          ? parseInt(iframeMatch[1], 10)
          : bridge.getServerPorts()[0];
        if (port) {
          return `${bridge.getServerUrl(port)}${url}`;
        }
      } catch {
        // Bridge not available, return as-is
      }
    }
  }
  return url;
}

/**
 * Show the preview iframe and hide the empty-state placeholder.
 */
function revealPreviewIframe(iframe: HTMLIFrameElement, url: string): void {
  // Hide empty state sibling
  const emptyState = iframe.parentElement?.querySelector(
    '.almostnode-preview-surface__empty'
  ) as HTMLElement | null;
  if (emptyState) {
    emptyState.hidden = true;
    emptyState.style.display = 'none';
  }

  // Show iframe
  iframe.hidden = false;
  iframe.style.display = 'block';

  // Update status bar
  const status = iframe.closest('.almostnode-preview-surface')?.querySelector(
    '.almostnode-preview-surface__status'
  ) as HTMLElement | null;
  if (status) {
    status.textContent = url;
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdOpen(args: string[]): Promise<JustBashExecResult> {
  const url = args[0];
  if (!url) return err('usage: playwright-cli open <url>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const resolvedUrl = await resolvePreviewUrl(url);
  revealPreviewIframe(iframe, resolvedUrl);

  iframe.src = resolvedUrl;
  await new Promise<void>((resolve) => {
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    setTimeout(resolve, 10000); // timeout after 10s
  });
  await delay(100);
  return ok(`Navigated to ${resolvedUrl}\n`);
}

async function cmdSnapshot(): Promise<JustBashExecResult> {
  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const doc = getIframeDoc(iframe);
  if (!doc || !doc.body) return err('preview iframe has no document. Wait for the page to load.\n');

  const tree = buildSnapshotTree(doc.body);
  if (tree.length === 0) {
    return ok('(empty page - no accessible elements found)\n');
  }

  const output = renderTree(tree);
  return ok(output + '\n');
}

async function cmdClick(args: string[]): Promise<JustBashExecResult> {
  const refId = args[0];
  if (!refId) return err('usage: playwright-cli click <ref>\n');

  const el = resolveRef(refId);
  if (!el) return err(`element ref '${refId}' not found. Run 'playwright-cli snapshot' first.\n`);
  if (!el.isConnected) return err(`element '${refId}' is no longer in the document.\n`);

  const iframe = getPreviewIframe();
  const doc = el.ownerDocument;
  const win = doc.defaultView || (iframe && getIframeWindow(iframe)) || window;

  // Scroll into view
  if (typeof (el as HTMLElement).scrollIntoView === 'function') {
    (el as HTMLElement).scrollIntoView({ block: 'center' });
  }
  await delay(0);

  if (typeof (el as HTMLElement).click === 'function') {
    (el as HTMLElement).click();
  } else {
    const ME = (win as any).MouseEvent || MouseEvent;
    el.dispatchEvent(
      new ME('click', { bubbles: true, cancelable: true, view: win })
    );
  }
  await delay(50);

  return ok(`Clicked ${refId}\n`);
}

async function cmdFill(args: string[]): Promise<JustBashExecResult> {
  const refId = args[0];
  const value = args.slice(1).join(' ');
  if (!refId || value === undefined) return err('usage: playwright-cli fill <ref> <text>\n');

  const el = resolveRef(refId);
  if (!el) return err(`element ref '${refId}' not found. Run 'playwright-cli snapshot' first.\n`);
  if (!el.isConnected) return err(`element '${refId}' is no longer in the document.\n`);

  if (
    !isInputOrTextArea(el) &&
    !el.hasAttribute('contenteditable')
  ) {
    return err(`element '${refId}' cannot be filled (not an input/textarea).\n`);
  }

  const iframe = getPreviewIframe();
  const doc = el.ownerDocument;
  const win = doc.defaultView || (iframe && getIframeWindow(iframe)) || window;

  if (typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();

  if (isInputOrTextArea(el)) {
    // React-compatible fill using native setter
    const isTextarea = isTextAreaElement(el);
    const proto = isTextarea
      ? (win as any)?.HTMLTextAreaElement?.prototype
      : (win as any)?.HTMLInputElement?.prototype;
    const nativeSetter = proto
      ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
      : null;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      (el as any).value = value;
    }

    // Reset React's _valueTracker so it detects the change
    const tracker = (el as any)._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }

    const InputEventCtor = (win as any).InputEvent || InputEvent;
    const EventCtor = (win as any).Event || Event;

    let inputEvent: Event;
    try {
      inputEvent = new InputEventCtor('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      });
    } catch {
      inputEvent = new EventCtor('input', { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(inputEvent);
    el.dispatchEvent(new EventCtor('change', { bubbles: true, cancelable: true }));
  } else {
    // contenteditable
    (el as HTMLElement).textContent = value;
    const EventCtor = (win as any).Event || Event;
    el.dispatchEvent(new EventCtor('input', { bubbles: true }));
  }

  await delay(50);
  return ok(`Filled ${refId} with "${value}"\n`);
}

async function cmdType(args: string[]): Promise<JustBashExecResult> {
  const text = args.join(' ');
  if (!text) return err('usage: playwright-cli type <text>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  const el = doc.activeElement;
  if (!el) return err('no element is focused. Click or fill an element first.\n');

  const win = doc.defaultView || getIframeWindow(iframe) || window;
  const KE = (win as any).KeyboardEvent || KeyboardEvent;

  const isTextarea = isTextAreaElement(el);
  const proto = isTextarea
    ? (win as any)?.HTMLTextAreaElement?.prototype
    : (win as any)?.HTMLInputElement?.prototype;
  const nativeSetter = isInputOrTextArea(el) && proto
    ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
    : null;

  for (const char of text) {
    el.dispatchEvent(new KE('keydown', { key: char, bubbles: true, cancelable: true }));

    if (isInputOrTextArea(el)) {
      const InputEventCtor = (win as any).InputEvent || InputEvent;

      // Dispatch beforeinput
      try {
        el.dispatchEvent(
          new InputEventCtor('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          })
        );
      } catch { /* beforeinput not supported */ }

      // Insert character using native setter for React compatibility
      const newValue = ((el as any).value || '') + char;
      if (nativeSetter) {
        nativeSetter.call(el, newValue);
      } else {
        (el as any).value = newValue;
      }

      // Reset React's _valueTracker
      const tracker = (el as any)._valueTracker;
      if (tracker) tracker.setValue('');

      try {
        el.dispatchEvent(
          new InputEventCtor('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: char,
          })
        );
      } catch {
        el.dispatchEvent(new ((win as any).Event || Event)('input', { bubbles: true }));
      }
    }

    el.dispatchEvent(new KE('keyup', { key: char, bubbles: true, cancelable: true }));
  }

  await delay(50);
  return ok(`Typed "${text}"\n`);
}

async function cmdPress(args: string[]): Promise<JustBashExecResult> {
  const key = args[0];
  if (!key) return err('usage: playwright-cli press <key>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  const el = doc.activeElement || doc.body;
  const win = doc.defaultView || getIframeWindow(iframe) || window;
  const KE = (win as any).KeyboardEvent || KeyboardEvent;

  if (typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();

  el.dispatchEvent(new KE('keydown', { key, bubbles: true, cancelable: true }));

  // For printable single characters, insert into focused input
  if (key.length === 1 && isInputOrTextArea(el)) {
    const InputEventCtor = (win as any).InputEvent || InputEvent;
    const isTextarea = isTextAreaElement(el);
    const proto = isTextarea
      ? (win as any)?.HTMLTextAreaElement?.prototype
      : (win as any)?.HTMLInputElement?.prototype;
    const nativeSetter = proto
      ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
      : null;

    try {
      el.dispatchEvent(
        new InputEventCtor('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: key,
        })
      );
    } catch { /* beforeinput not supported */ }

    const newValue = ((el as any).value || '') + key;
    if (nativeSetter) {
      nativeSetter.call(el, newValue);
    } else {
      (el as any).value = newValue;
    }

    const tracker = (el as any)._valueTracker;
    if (tracker) tracker.setValue('');

    try {
      el.dispatchEvent(
        new InputEventCtor('input', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: key,
        })
      );
    } catch {
      el.dispatchEvent(new ((win as any).Event || Event)('input', { bubbles: true }));
    }
  } else if (key === 'Enter') {
    el.dispatchEvent(new KE('keypress', { key, bubbles: true, cancelable: true }));
    // Submit form on Enter if applicable
    if (isInputElement(el) && (el as any).form && typeof (el as any).form.requestSubmit === 'function') {
      try { (el as any).form.requestSubmit(); } catch { /* ignore */ }
    }
  } else {
    el.dispatchEvent(new KE('keypress', { key, bubbles: true, cancelable: true }));
  }

  el.dispatchEvent(new KE('keyup', { key, bubbles: true, cancelable: true }));

  await delay(50);
  return ok(`Pressed ${key}\n`);
}

async function cmdHover(args: string[]): Promise<JustBashExecResult> {
  const refId = args[0];
  if (!refId) return err('usage: playwright-cli hover <ref>\n');

  const el = resolveRef(refId);
  if (!el) return err(`element ref '${refId}' not found. Run 'playwright-cli snapshot' first.\n`);
  if (!el.isConnected) return err(`element '${refId}' is no longer in the document.\n`);

  const iframe = getPreviewIframe();
  const doc = el.ownerDocument;
  const win = doc.defaultView || (iframe && getIframeWindow(iframe)) || window;
  const ME = (win as any).MouseEvent || MouseEvent;

  el.dispatchEvent(new ME('mouseover', { bubbles: true, cancelable: true, view: win }));
  el.dispatchEvent(new ME('mouseenter', { bubbles: false, cancelable: false, view: win }));

  await delay(0);
  return ok(`Hovered ${refId}\n`);
}

async function cmdEval(args: string[]): Promise<JustBashExecResult> {
  const expr = args.join(' ');
  if (!expr) return err('usage: playwright-cli eval <expression>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const win = getIframeWindow(iframe);
  if (!win) return err('preview iframe has no window.\n');

  try {
    const result = (win as any).eval(expr);
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return ok((output ?? 'undefined') + '\n');
  } catch (e) {
    return err(`eval error: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function cmdConsole(args: string[]): Promise<JustBashExecResult> {
  const levelFilter = args[0];
  const severityOrder = ['error', 'warn', 'warning', 'log', 'info', 'debug'];

  let filtered = consoleMessages;
  if (levelFilter) {
    const normalizedFilter = levelFilter === 'warning' ? 'warn' : levelFilter;
    const filterIdx = severityOrder.indexOf(normalizedFilter);
    if (filterIdx === -1) {
      return err(`unknown console level '${levelFilter}'. Use: error, warning, info, debug\n`);
    }
    const allowedLevels = new Set(severityOrder.slice(0, filterIdx + 1));
    // Map back: 'warn' entries should match 'warning' filter
    filtered = consoleMessages.filter((m) => {
      const normalized = m.level === 'warn' ? 'warn' : m.level;
      return allowedLevels.has(normalized);
    });
  }

  if (filtered.length === 0) {
    return ok('(no console messages)\n');
  }

  const lines = filtered.map((m) => `[${m.level}] ${m.text}`);
  return ok(lines.join('\n') + '\n');
}

async function cmdNetwork(): Promise<JustBashExecResult> {
  if (networkRequests.length === 0) {
    return ok('(no network requests)\n');
  }

  const lines = networkRequests.map((r) => {
    const sizeStr = r.size > 0 ? ` ${r.size}B` : '';
    return `[fetch] ${r.method} ${r.url} ${r.status} ${r.statusText} ${r.duration}ms${sizeStr}`;
  });
  return ok(lines.join('\n') + '\n');
}

// ── Cookie commands ─────────────────────────────────────────────────────────

function parseCookies(doc: Document): Array<{ name: string; value: string; domain?: string }> {
  const raw = doc.cookie;
  if (!raw) return [];
  return raw.split(';').map((c) => {
    const [name, ...rest] = c.trim().split('=');
    return { name, value: rest.join('=') };
  });
}

async function cmdCookieList(args: string[]): Promise<JustBashExecResult> {
  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found.\n');
  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  const domainFilter = args[0] === '--domain' ? args[1] : undefined;
  const cookies = parseCookies(doc);

  if (cookies.length === 0) return ok('(no cookies)\n');

  // document.cookie doesn't expose domain, so --domain is a name-contains filter
  const filtered = domainFilter
    ? cookies.filter((c) => c.name.includes(domainFilter))
    : cookies;

  if (filtered.length === 0) return ok('(no matching cookies)\n');

  const lines = filtered.map((c) => `${c.name}=${c.value}`);
  return ok(lines.join('\n') + '\n');
}

async function cmdCookieGet(args: string[]): Promise<JustBashExecResult> {
  const name = args[0];
  if (!name) return err('usage: playwright-cli cookie-get <name>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found.\n');
  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  const cookie = parseCookies(doc).find((c) => c.name === name);
  if (!cookie) return ok(`(cookie '${name}' not found)\n`);
  return ok(`${cookie.value}\n`);
}

async function cmdCookieSet(args: string[]): Promise<JustBashExecResult> {
  const name = args[0];
  const value = args.slice(1).join(' ');
  if (!name || value === undefined) return err('usage: playwright-cli cookie-set <name> <value>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found.\n');
  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  doc.cookie = `${name}=${value};path=/`;
  return ok(`Set cookie ${name}\n`);
}

async function cmdCookieDelete(args: string[]): Promise<JustBashExecResult> {
  const name = args[0];
  if (!name) return err('usage: playwright-cli cookie-delete <name>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found.\n');
  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  doc.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return ok(`Deleted cookie ${name}\n`);
}

async function cmdCookieClear(): Promise<JustBashExecResult> {
  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found.\n');
  const doc = getIframeDoc(iframe);
  if (!doc) return err('preview iframe has no document.\n');

  const cookies = parseCookies(doc);
  for (const c of cookies) {
    doc.cookie = `${c.name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
  return ok(`Cleared ${cookies.length} cookie(s)\n`);
}

// ── Storage commands (localStorage / sessionStorage) ────────────────────────

function getStorage(type: 'local' | 'session'): Storage | null {
  const iframe = getPreviewIframe();
  if (!iframe) return null;
  const win = getIframeWindow(iframe);
  if (!win) return null;
  return type === 'local' ? win.localStorage : win.sessionStorage;
}

function storageLabel(type: 'local' | 'session'): string {
  return type === 'local' ? 'localStorage' : 'sessionStorage';
}

async function cmdStorageList(type: 'local' | 'session'): Promise<JustBashExecResult> {
  const storage = getStorage(type);
  if (!storage) return err('no preview iframe found.\n');

  if (storage.length === 0) return ok(`(no ${storageLabel(type)} entries)\n`);

  const lines: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    const val = storage.getItem(key) ?? '';
    const truncated = val.length > 80 ? val.slice(0, 80) + '...' : val;
    lines.push(`${key} = ${truncated}`);
  }
  return ok(lines.join('\n') + '\n');
}

async function cmdStorageGet(type: 'local' | 'session', args: string[]): Promise<JustBashExecResult> {
  const key = args[0];
  if (!key) return err(`usage: playwright-cli ${storageLabel(type).toLowerCase()}-get <key>\n`);

  const storage = getStorage(type);
  if (!storage) return err('no preview iframe found.\n');

  const val = storage.getItem(key);
  if (val === null) return ok(`(key '${key}' not found)\n`);
  return ok(`${val}\n`);
}

async function cmdStorageSet(type: 'local' | 'session', args: string[]): Promise<JustBashExecResult> {
  const key = args[0];
  const value = args.slice(1).join(' ');
  if (!key || value === undefined) return err(`usage: playwright-cli ${storageLabel(type).toLowerCase()}-set <key> <value>\n`);

  const storage = getStorage(type);
  if (!storage) return err('no preview iframe found.\n');

  storage.setItem(key, value);
  return ok(`Set ${storageLabel(type)} key '${key}'\n`);
}

async function cmdStorageDelete(type: 'local' | 'session', args: string[]): Promise<JustBashExecResult> {
  const key = args[0];
  if (!key) return err(`usage: playwright-cli ${storageLabel(type).toLowerCase()}-delete <key>\n`);

  const storage = getStorage(type);
  if (!storage) return err('no preview iframe found.\n');

  storage.removeItem(key);
  return ok(`Deleted ${storageLabel(type)} key '${key}'\n`);
}

async function cmdStorageClear(type: 'local' | 'session'): Promise<JustBashExecResult> {
  const storage = getStorage(type);
  if (!storage) return err('no preview iframe found.\n');

  const count = storage.length;
  storage.clear();
  return ok(`Cleared ${count} ${storageLabel(type)} entry/entries\n`);
}

// ── Close / Reset ───────────────────────────────────────────────────────────

async function cmdClose(): Promise<JustBashExecResult> {
  refMap = new Map();
  consoleMessages.length = 0;
  networkRequests.length = 0;
  return ok('Cleared state.\n');
}

async function cmdResize(args: string[]): Promise<JustBashExecResult> {
  const w = parseInt(args[0], 10);
  const h = parseInt(args[1], 10);
  if (isNaN(w) || isNaN(h)) return err('usage: playwright-cli resize <width> <height>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  iframe.style.width = `${w}px`;
  iframe.style.height = `${h}px`;
  return ok(`Resized preview to ${w}x${h}\n`);
}

async function cmdScreenshot(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const doc = getIframeDoc(iframe);
  if (!doc || !doc.body) return err('preview iframe has no document. Wait for the page to load.\n');

  const outputPath = args[0] || '/tmp/screenshot.png';

  // Ensure parent directory exists
  const parentDir = outputPath.substring(0, outputPath.lastIndexOf('/')) || '/';
  if (!vfs.existsSync(parentDir)) {
    vfs.mkdirSync(parentDir, { recursive: true });
  }

  try {
    const html2canvas = (await import('html2canvas')).default;

    const canvas = await html2canvas(doc.body, {
      windowWidth: iframe.clientWidth || doc.documentElement.scrollWidth,
      windowHeight: iframe.clientHeight || doc.documentElement.scrollHeight,
      width: iframe.clientWidth || doc.documentElement.scrollWidth,
      height: iframe.clientHeight || doc.documentElement.scrollHeight,
      useCORS: true,
      allowTaint: true,
      foreignObjectRendering: false,
      logging: false,
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });

    const pngData = new Uint8Array(await blob.arrayBuffer());
    vfs.writeFileSync(outputPath, pngData);

    return ok(`Screenshot saved to ${outputPath} (${pngData.length} bytes)\n`);
  } catch (e) {
    return err(`screenshot failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

// ── Help ────────────────────────────────────────────────────────────────────

function cmdHelp(): JustBashExecResult {
  return ok(
    `playwright-cli — interact with the preview iframe

Commands:
  open <url>              Navigate the preview iframe to a URL
  snapshot                Build accessibility tree with element refs
  click <ref>             Click an element by ref (e.g. e3)
  fill <ref> <text>       Fill an input/textarea with text
  type <text>             Type text into the focused element
  press <key>             Press a keyboard key (e.g. Enter, ArrowDown)
  hover <ref>             Hover over an element
  eval <expression>       Evaluate JS in the preview iframe
  console [level]         Show captured console messages
  network                 Show captured network requests
  cookie-list [--domain]  List cookies
  cookie-get <name>       Get a cookie value
  cookie-set <name> <val> Set a cookie
  cookie-delete <name>    Delete a cookie
  cookie-clear            Clear all cookies
  localstorage-list       List localStorage entries
  localstorage-get <key>  Get localStorage value
  localstorage-set <k> <v> Set localStorage value
  localstorage-delete <k> Delete localStorage entry
  localstorage-clear      Clear all localStorage
  sessionstorage-list     List sessionStorage entries
  sessionstorage-get <k>  Get sessionStorage value
  sessionstorage-set <k> <v> Set sessionStorage value
  sessionstorage-delete <k> Delete sessionStorage entry
  sessionstorage-clear    Clear all sessionStorage
  resize <width> <height> Resize the preview iframe
  screenshot [path]       Capture preview as PNG (default: /tmp/screenshot.png)
  close                   Clear element refs and console state
  help                    Show this help message

Workflow:
  1. Start your dev server (npm run dev)
  2. playwright-cli snapshot    — get element refs
  3. playwright-cli click e3    — interact using refs
  4. playwright-cli snapshot    — re-snapshot after DOM changes
`
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runPlaywrightCommand(
  args: string[],
  _ctx: CommandContext,
  _vfs: VirtualFS
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return cmdHelp();
  }

  const subArgs = args.slice(1);
  let result: JustBashExecResult;
  let selectorContext: PlaywrightSelectorContext | undefined;

  // For ref-based commands, capture selector context before execution
  const refBasedCommands = new Set(['click', 'fill', 'hover']);
  if (refBasedCommands.has(subcommand) && subArgs[0]) {
    selectorContext = getSelectorContextForRef(subArgs[0]);
  }

  switch (subcommand) {
    case 'open':
      result = await cmdOpen(subArgs);
      break;
    case 'snapshot':
      result = await cmdSnapshot();
      break;
    case 'click':
      result = await cmdClick(subArgs);
      break;
    case 'fill':
      result = await cmdFill(subArgs);
      break;
    case 'type':
      result = await cmdType(subArgs);
      break;
    case 'press':
      result = await cmdPress(subArgs);
      break;
    case 'hover':
      result = await cmdHover(subArgs);
      break;
    case 'eval':
      result = await cmdEval(subArgs);
      break;
    case 'console':
      result = await cmdConsole(subArgs);
      break;
    case 'network':
      result = await cmdNetwork();
      break;
    case 'cookie-list':
      result = await cmdCookieList(subArgs);
      break;
    case 'cookie-get':
      result = await cmdCookieGet(subArgs);
      break;
    case 'cookie-set':
      result = await cmdCookieSet(subArgs);
      break;
    case 'cookie-delete':
      result = await cmdCookieDelete(subArgs);
      break;
    case 'cookie-clear':
      result = await cmdCookieClear();
      break;
    case 'localstorage-list':
      result = await cmdStorageList('local');
      break;
    case 'localstorage-get':
      result = await cmdStorageGet('local', subArgs);
      break;
    case 'localstorage-set':
      result = await cmdStorageSet('local', subArgs);
      break;
    case 'localstorage-delete':
      result = await cmdStorageDelete('local', subArgs);
      break;
    case 'localstorage-clear':
      result = await cmdStorageClear('local');
      break;
    case 'sessionstorage-list':
      result = await cmdStorageList('session');
      break;
    case 'sessionstorage-get':
      result = await cmdStorageGet('session', subArgs);
      break;
    case 'sessionstorage-set':
      result = await cmdStorageSet('session', subArgs);
      break;
    case 'sessionstorage-delete':
      result = await cmdStorageDelete('session', subArgs);
      break;
    case 'sessionstorage-clear':
      result = await cmdStorageClear('session');
      break;
    case 'close':
      result = await cmdClose();
      break;
    case 'resize':
      result = await cmdResize(subArgs);
      break;
    case 'screenshot':
      result = await cmdScreenshot(subArgs, _vfs);
      break;
    default:
      return err(`unknown command: ${subcommand}. Run 'playwright-cli help' for usage.\n`);
  }

  emitCommand(subcommand, subArgs, result, selectorContext);
  return result;
}
