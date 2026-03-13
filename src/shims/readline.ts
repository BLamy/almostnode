/**
 * readline shim - Terminal readline is not available in browser
 * Provides stubs for common usage patterns
 */

import { EventEmitter } from './events';

export interface ReadLineOptions {
  input?: unknown;
  output?: unknown;
  terminal?: boolean;
  prompt?: string;
}

export class Interface extends EventEmitter {
  private promptText: string;
  private input: any;
  private output: any;
  private closed = false;
  private questionCallback: ((answer: string) => void) | null = null;

  constructor(_options?: ReadLineOptions) {
    super();
    this.promptText = _options?.prompt ?? '';
    this.input = _options?.input ?? null;
    this.output = _options?.output ?? null;

    if (this.input && typeof this.input.on === 'function') {
      const onData = (data: string | Buffer) => {
        if (this.closed) return;
        const text = typeof data === 'string' ? data : data.toString();
        for (const ch of text) {
          if (ch === '\r' || ch === '\n') {
            const answer = this.line;
            this.line = '';
            this.cursor = 0;
            this.emit('line', answer);
            if (this.questionCallback) {
              const cb = this.questionCallback;
              this.questionCallback = null;
              cb(answer);
            }
          } else if (ch === '\u007F' || ch === '\b') {
            if (this.cursor > 0) {
              this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
              this.cursor--;
            }
          } else if (ch >= ' ') {
            this.line = this.line.slice(0, this.cursor) + ch + this.line.slice(this.cursor);
            this.cursor++;
          }
        }
      };
      this.input.on('data', onData);
    }
  }

  prompt(_preserveCursor?: boolean): void {
    if (this.output && typeof this.output.write === 'function') {
      this.output.write(this.promptText);
    }
  }

  setPrompt(prompt: string): void {
    this.promptText = prompt;
  }

  getPrompt(): string {
    return this.promptText;
  }

  question(query: string, callback: (answer: string) => void): void;
  question(query: string, options: object, callback: (answer: string) => void): void;
  question(query: string, optionsOrCallback: object | ((answer: string) => void), callback?: (answer: string) => void): void {
    const cb = (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!) as (answer: string) => void;
    if (this.output && typeof this.output.write === 'function') {
      this.output.write(query);
    }
    if (this.input && typeof this.input.on === 'function') {
      this.questionCallback = cb;
    } else {
      setTimeout(() => cb(''), 0);
    }
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }

  write(_data: string, _key?: { ctrl?: boolean; name?: string }): void {
    // No-op
  }

  line: string = '';
  cursor: number = 0;

  getCursorPos(): { rows: number; cols: number } {
    return { rows: 0, cols: 0 };
  }
}

export function createInterface(options?: ReadLineOptions): Interface {
  return new Interface(options);
}

export function clearLine(_stream: unknown, _dir: number, _callback?: () => void): boolean {
  _callback?.();
  return true;
}

export function clearScreenDown(_stream: unknown, _callback?: () => void): boolean {
  _callback?.();
  return true;
}

export function cursorTo(_stream: unknown, _x: number, _y?: number, _callback?: () => void): boolean {
  _callback?.();
  return true;
}

export function moveCursor(_stream: unknown, _dx: number, _dy: number, _callback?: () => void): boolean {
  _callback?.();
  return true;
}

export function emitKeypressEvents(stream: any, _interface?: Interface): void {
  if (!stream || typeof stream.on !== 'function') return;
  if (stream._keypressEventsEmitted) return;
  stream._keypressEventsEmitted = true;

  stream.on('data', (data: string | Buffer) => {
    const text = typeof data === 'string' ? data : data.toString();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const key: { sequence: string; name?: string; ctrl: boolean; meta: boolean; shift: boolean } = {
        sequence: ch,
        ctrl: false,
        meta: false,
        shift: false,
      };

      if (ch === '\r') {
        key.name = 'return';
        // Normalize \r\n to a single return keypress
        if (i + 1 < text.length && text[i + 1] === '\n') {
          key.sequence = '\r\n';
          i++;
        }
      } else if (ch === '\n') {
        key.name = 'return';
      } else if (ch === '\t') {
        key.name = 'tab';
      } else if (ch === '\u007F') {
        key.name = 'backspace';
      } else if (ch === '\u001b') {
        key.name = 'escape';
      } else if (ch < ' ') {
        key.ctrl = true;
        key.name = String.fromCharCode(ch.charCodeAt(0) + 96);
      } else {
        key.name = ch;
      }

      stream.emit('keypress', ch, key);
    }
  });
}

// Promises API
export const promises = {
  createInterface: (options?: ReadLineOptions) => {
    const rl = createInterface(options);
    return {
      question: (query: string) => new Promise<string>((resolve) => {
        rl.question(query, resolve);
      }),
      close: () => rl.close(),
      [Symbol.asyncIterator]: async function* () {
        // No lines in browser
      },
    };
  },
};

export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
  promises,
};
