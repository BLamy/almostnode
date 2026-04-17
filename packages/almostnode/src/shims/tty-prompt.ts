import type { ShellCommandContext, ShellCommandKeyEvent } from '../shell-commands';

const ANSI_CURSOR_HIDE = '\u001b[?25l';
const ANSI_CURSOR_SHOW = '\u001b[?25h';
const ANSI_CLEAR_LINE = '\u001b[2K';
const ANSI_LINE_UP = '\u001b[A';
const ANSI_BOLD = '\u001b[1m';
const ANSI_CYAN = '\u001b[36m';
const ANSI_DIM = '\u001b[2m';
const ANSI_RESET = '\u001b[0m';

export interface SelectOption<T> {
  label: string;
  value: T;
}

export interface SelectPromptOptions<T> {
  ctx: ShellCommandContext;
  label: string;
  items: SelectOption<T>[];
  size?: number;
  defaultIndex?: number;
}

export class PromptAbortError extends Error {
  constructor() {
    super('prompt aborted');
    this.name = 'PromptAbortError';
  }
}

function writeErr(ctx: ShellCommandContext, data: string): void {
  ctx.writeStderr(data);
}

function isAborted(ctx: ShellCommandContext): boolean {
  return ctx.signal?.aborted === true;
}

function renderSelect<T>(
  ctx: ShellCommandContext,
  label: string,
  items: SelectOption<T>[],
  activeIndex: number,
  isFirstRender: boolean,
): void {
  if (!isFirstRender) {
    // Move cursor up by (items.length + 1) lines (label + each item) and clear.
    let erase = '';
    for (let i = 0; i < items.length + 1; i += 1) {
      erase += `${ANSI_CLEAR_LINE}\r${i === items.length ? '' : ANSI_LINE_UP}`;
    }
    writeErr(ctx, erase);
  }

  writeErr(ctx, `${ANSI_BOLD}? ${label}:${ANSI_RESET} ${ANSI_DIM}[Use arrows to move, enter to select]${ANSI_RESET}\r\n`);
  items.forEach((item, index) => {
    const isActive = index === activeIndex;
    const marker = isActive ? `${ANSI_CYAN}▸${ANSI_RESET}` : ' ';
    const text = isActive
      ? `${ANSI_CYAN}${item.label}${ANSI_RESET}`
      : item.label;
    const suffix = index === items.length - 1 ? '' : '\r\n';
    writeErr(ctx, `${marker} ${text}${suffix}`);
  });
}

export async function selectPrompt<T>(opts: SelectPromptOptions<T>): Promise<T> {
  const { ctx, label, items } = opts;
  if (items.length === 0) {
    throw new Error('selectPrompt: items must not be empty');
  }
  if (!ctx.onKeypress) {
    throw new Error('selectPrompt: shell context does not provide keypress input');
  }

  let activeIndex = Math.min(
    Math.max(opts.defaultIndex ?? 0, 0),
    items.length - 1,
  );

  writeErr(ctx, ANSI_CURSOR_HIDE);
  renderSelect(ctx, label, items, activeIndex, true);

  return new Promise<T>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      if (abortHandler && ctx.signal) {
        ctx.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
      writeErr(ctx, ANSI_CURSOR_SHOW);
    };

    const finish = (value: T): void => {
      cleanup();
      // Clear the rendered menu and replace with `? label: <chosen>\n`.
      let erase = '';
      for (let i = 0; i < items.length + 1; i += 1) {
        erase += `${ANSI_CLEAR_LINE}\r${i === items.length ? '' : ANSI_LINE_UP}`;
      }
      writeErr(ctx, erase);
      const chosen = items.find((item) => item.value === value)?.label ?? '';
      writeErr(ctx, `${ANSI_BOLD}? ${label}:${ANSI_RESET} ${ANSI_CYAN}${chosen}${ANSI_RESET}\r\n`);
      resolve(value);
    };

    const abort = (): void => {
      cleanup();
      reject(new PromptAbortError());
    };

    if (isAborted(ctx)) {
      abort();
      return;
    }
    if (ctx.signal) {
      abortHandler = abort;
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
    }

    unsubscribe = ctx.onKeypress!((ch, key: ShellCommandKeyEvent) => {
      if (key.ctrl && (key.name === 'c' || ch === '\u0003')) {
        abort();
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        renderSelect(ctx, label, items, activeIndex, false);
        return;
      }
      if (key.name === 'down' || key.name === 'j') {
        activeIndex = (activeIndex + 1) % items.length;
        renderSelect(ctx, label, items, activeIndex, false);
        return;
      }
      if (key.name === 'return' || key.name === 'enter' || ch === '\r' || ch === '\n') {
        finish(items[activeIndex].value);
      }
    });
  });
}

export interface TextPromptOptions {
  ctx: ShellCommandContext;
  label: string;
  defaultValue?: string;
}

export async function textPrompt(opts: TextPromptOptions): Promise<string> {
  const { ctx, label, defaultValue } = opts;
  if (!ctx.onKeypress) {
    throw new Error('textPrompt: shell context does not provide keypress input');
  }

  const hint = defaultValue ? ` ${ANSI_DIM}(${defaultValue})${ANSI_RESET}` : '';
  writeErr(ctx, `${ANSI_BOLD}? ${label}:${ANSI_RESET}${hint} `);

  return new Promise<string>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let abortHandler: (() => void) | null = null;
    let buffer = '';

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      if (abortHandler && ctx.signal) {
        ctx.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
    };

    const finish = (): void => {
      cleanup();
      writeErr(ctx, '\r\n');
      resolve(buffer || defaultValue || '');
    };

    const abort = (): void => {
      cleanup();
      writeErr(ctx, '\r\n');
      reject(new PromptAbortError());
    };

    if (isAborted(ctx)) {
      abort();
      return;
    }
    if (ctx.signal) {
      abortHandler = abort;
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
    }

    unsubscribe = ctx.onKeypress!((ch, key: ShellCommandKeyEvent) => {
      if (key.ctrl && (key.name === 'c' || ch === '\u0003')) {
        abort();
        return;
      }
      if (key.name === 'return' || key.name === 'enter' || ch === '\r' || ch === '\n') {
        finish();
        return;
      }
      if (key.name === 'backspace' || ch === '\u007F' || ch === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          writeErr(ctx, '\b \b');
        }
        return;
      }
      if (ch && ch >= ' ') {
        buffer += ch;
        writeErr(ctx, ch);
      }
    });
  });
}

export interface HiddenPromptOptions {
  ctx: ShellCommandContext;
  label: string;
  /** If true, echoes a star per character instead of nothing. */
  mask?: boolean;
}

export async function hiddenPrompt(opts: HiddenPromptOptions): Promise<string> {
  const { ctx, label, mask } = opts;
  if (!ctx.onKeypress) {
    throw new Error('hiddenPrompt: shell context does not provide keypress input');
  }

  writeErr(ctx, label);

  return new Promise<string>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let abortHandler: (() => void) | null = null;
    let buffer = '';

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      if (abortHandler && ctx.signal) {
        ctx.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
    };

    const finish = (): void => {
      cleanup();
      writeErr(ctx, '\r\n');
      resolve(buffer);
    };

    const abort = (): void => {
      cleanup();
      writeErr(ctx, '\r\n');
      reject(new PromptAbortError());
    };

    if (isAborted(ctx)) {
      abort();
      return;
    }
    if (ctx.signal) {
      abortHandler = abort;
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
    }

    unsubscribe = ctx.onKeypress!((ch, key: ShellCommandKeyEvent) => {
      if (key.ctrl && (key.name === 'c' || ch === '\u0003')) {
        abort();
        return;
      }
      if (key.name === 'return' || key.name === 'enter' || ch === '\r' || ch === '\n') {
        finish();
        return;
      }
      if (key.name === 'backspace' || ch === '\u007F' || ch === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          if (mask) {
            writeErr(ctx, '\b \b');
          }
        }
        return;
      }
      if (ch && ch >= ' ') {
        buffer += ch;
        if (mask) {
          writeErr(ctx, '*');
        }
      }
    });
  });
}
