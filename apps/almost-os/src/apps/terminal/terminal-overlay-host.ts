/**
 * Tracks the DOM element of the terminal that most recently ran a command, so
 * a globally-registered `vim`/`vi` shell command can find the *specific*
 * terminal window to overlay its canvas onto (almost-os can have several
 * Terminal windows open at once; the shell command itself has no window
 * context — it only sees the container).
 *
 * `TerminalApp` calls `set()` right before running a command and `set(null)`
 * on unmount. Vim is single-instance per page (enforced by
 * `@agent-wasm/cli-tools`), so only one terminal can be mid-`vi` at a time —
 * whichever terminal most recently called `set()` is the right one.
 */
let activeHost: HTMLElement | null = null;

export const terminalOverlayHost = {
  set(host: HTMLElement | null): void {
    activeHost = host;
  },
  get(): HTMLElement | null {
    return activeHost;
  },
};
