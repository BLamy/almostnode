import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

// ── Module-level state ──────────────────────────────────────────────────────

let refMap = new Map<string, Element>();
let refCounter = 0;
const consoleMessages: Array<{ level: string; text: string }> = [];
let consoleHooked = false;

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

// ── Console hook ────────────────────────────────────────────────────────────

function installConsoleHook(iframe: HTMLIFrameElement): void {
  if (consoleHooked) return;
  const win = getIframeWindow(iframe);
  if (!win) return;
  consoleHooked = true;

  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const level of levels) {
    const winConsole = (win as any).console;
    const original = winConsole[level];
    winConsole[level] = (...args: any[]) => {
      if (consoleMessages.length < 1000) {
        consoleMessages.push({
          level,
          text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        });
      }
      if (typeof original === 'function') {
        original.apply(winConsole, args);
      }
    };
  }
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
  if (!(el instanceof HTMLElement)) return true;
  const style = el.style;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.hidden) return false;
  // Check offsetParent for non-fixed elements
  if (el.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') {
    // Could be invisible, but give benefit of doubt for body children
    if (el.parentElement && el.parentElement.tagName !== 'BODY') return false;
  }
  return true;
}

function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  return IMPLICIT_ROLES[el.tagName] ?? null;
}

function getAccessibleName(el: Element): string {
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
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
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

interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  attrs: string[];
  children: SnapshotNode[];
}

function buildSnapshotTree(root: Element): SnapshotNode[] {
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
    if (el instanceof HTMLInputElement) {
      const type = el.type.toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        attrs.push(el.checked ? 'checked' : 'unchecked');
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
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.value
    ) {
      const truncated = el.value.length > 40 ? el.value.slice(0, 40) + '...' : el.value;
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

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdOpen(args: string[]): Promise<JustBashExecResult> {
  const url = args[0];
  if (!url) return err('usage: playwright-cli open <url>\n');

  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  iframe.src = url;
  await new Promise<void>((resolve) => {
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    setTimeout(resolve, 10000); // timeout after 10s
  });
  await delay(100);
  installConsoleHook(iframe);
  return ok(`Navigated to ${url}\n`);
}

async function cmdSnapshot(): Promise<JustBashExecResult> {
  const iframe = getPreviewIframe();
  if (!iframe) return err('no preview iframe found. Run your dev server first.\n');

  const doc = getIframeDoc(iframe);
  if (!doc || !doc.body) return err('preview iframe has no document. Wait for the page to load.\n');

  installConsoleHook(iframe);

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
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !el.hasAttribute('contenteditable')
  ) {
    return err(`element '${refId}' cannot be filled (not an input/textarea).\n`);
  }

  const iframe = getPreviewIframe();
  const doc = el.ownerDocument;
  const win = doc.defaultView || (iframe && getIframeWindow(iframe)) || window;

  if (typeof (el as HTMLElement).focus === 'function') (el as HTMLElement).focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // React-compatible fill using native setter
    const nativeInputValueSetter = (win as any)?.HTMLInputElement?.prototype
      ? Object.getOwnPropertyDescriptor(
          (win as any).HTMLInputElement.prototype,
          'value'
        )?.set
      : null;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
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

  for (const char of text) {
    el.dispatchEvent(new KE('keydown', { key: char, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KE('keypress', { key: char, bubbles: true, cancelable: true }));

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value += char;
      const InputEventCtor = (win as any).InputEvent || InputEvent;
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
  el.dispatchEvent(new KE('keypress', { key, bubbles: true, cancelable: true }));
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
  const severityOrder = ['error', 'warn', 'warning', 'info', 'log', 'debug'];

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

async function cmdClose(): Promise<JustBashExecResult> {
  refMap = new Map();
  consoleMessages.length = 0;
  consoleHooked = false;
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

  switch (subcommand) {
    case 'open':
      return cmdOpen(args.slice(1));
    case 'snapshot':
      return cmdSnapshot();
    case 'click':
      return cmdClick(args.slice(1));
    case 'fill':
      return cmdFill(args.slice(1));
    case 'type':
      return cmdType(args.slice(1));
    case 'press':
      return cmdPress(args.slice(1));
    case 'hover':
      return cmdHover(args.slice(1));
    case 'eval':
      return cmdEval(args.slice(1));
    case 'console':
      return cmdConsole(args.slice(1));
    case 'close':
      return cmdClose();
    case 'resize':
      return cmdResize(args.slice(1));
    case 'screenshot':
      return cmdScreenshot(args.slice(1), _vfs);
    default:
      return err(`unknown command: ${subcommand}. Run 'playwright-cli help' for usage.\n`);
  }
}
