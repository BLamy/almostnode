import type { AgentHarness } from './conversation-types';

/**
 * A handle to the interactive agent CLI session currently running in a
 * workbench terminal. `sendInput` feeds the exact same channel xterm key
 * input uses, so anything sent here echoes in the terminal TUI as if typed.
 */
export interface ActiveAgentSession {
  harness: AgentHarness;
  tabId: string;
  startedAt: number;
  /** Session/thread id when known up front (e.g. `claude --resume <id>`). */
  resumeToken: string | null;
  sendInput: (data: string) => void;
  isRunning: () => boolean;
  /**
   * Resolves when the agent TUI is ready to accept input (e.g. Claude's MCP
   * client connected to the IDE bridge). Input injected before this point is
   * flushed by the TUI's raw-mode initialization and silently lost.
   */
  ready?: Promise<void>;
}

type RegistryListener = (session: ActiveAgentSession | null) => void;

const BRACKETED_PASTE_START = '[200~';
const BRACKETED_PASTE_END = '[201~';
/** Give the TUI a beat to ingest pasted text before pressing Enter. */
const SUBMIT_DELAY_MS = 60;

/**
 * Tracks the single active agent CLI session shared by the chat UI and the
 * drawer terminal. The workbench host registers sessions as they launch
 * (whether started from chat, the AI launcher, or typed into a terminal);
 * the chat surface subscribes and routes sends through it.
 */
export class AgentSessionRegistry {
  private active: ActiveAgentSession | null = null;
  private listeners = new Set<RegistryListener>();
  private sendChain: Promise<void> = Promise.resolve();
  private launching = false;
  private launchGeneration = 0;

  getActive(): ActiveAgentSession | null {
    return this.active;
  }

  setActive(session: ActiveAgentSession): void {
    this.active = session;
    this.launching = false;
    this.notify();
  }

  /** Clears the active session if it still belongs to the given tab. */
  clearActive(tabId: string): void {
    if (this.active?.tabId !== tabId) {
      return;
    }
    this.active = null;
    this.notify();
  }

  /**
   * Detach the chat from the current session without ending it (the CLI
   * keeps running in its terminal tab). Used when starting a fresh thread.
   */
  deactivate(): void {
    this.launching = false;
    if (!this.active) {
      return;
    }
    this.active = null;
    this.notify();
  }

  /**
   * Mark that a new session launch is in flight (e.g. resuming a thread).
   * Clears the previous active session immediately so chat sends can never
   * route to the thread the user just navigated away from; `setActive`
   * ends the launch window when the new session registers. Returns a token
   * for `endLaunch`.
   */
  beginLaunch(): number {
    this.launching = true;
    this.launchGeneration += 1;
    if (this.active) {
      this.active = null;
      this.notify();
    }
    return this.launchGeneration;
  }

  /**
   * Ends a launch window that never produced a session (launch failed). A
   * token from a superseded `beginLaunch` is ignored so a stale failure
   * can't cancel a newer in-flight launch.
   */
  endLaunch(token: number): void {
    if (token !== this.launchGeneration) {
      return;
    }
    this.launching = false;
  }

  /** True while a launch started via `beginLaunch` has not registered yet. */
  isLaunching(): boolean {
    return this.launching;
  }

  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    listener(this.active);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Type a user message into the active session's terminal and submit it.
   * Sends are serialized so two chat submissions can never interleave.
   */
  sendUserText(text: string): Promise<void> {
    if (!this.active || !this.active.isRunning()) {
      return Promise.reject(
        new Error('No agent session is running in the workbench terminal.'),
      );
    }
    const result = this.sendChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          try {
            // Resolve the target when the queued send actually executes —
            // the active session may have changed (thread switch) since the
            // send was queued, and the text must go to the session the chat
            // is showing now, never a previous one.
            const session = this.active;
            if (!session || !session.isRunning()) {
              throw new Error('The agent session has ended.');
            }
            const normalized = text.replace(/\r\n?/g, '\n');
            // Bracketed paste keeps multiline text from submitting early and
            // lets TUIs treat the payload as one paste instead of keystrokes.
            session.sendInput(
              `${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}`,
            );
            setTimeout(() => {
              try {
                session.sendInput('\r');
                resolve();
              } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
              }
            }, SUBMIT_DELAY_MS);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }),
    );
    // Keep the chain alive even when a send fails.
    this.sendChain = result.catch(() => {});
    return result;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.active);
    }
  }
}

export const agentSessionRegistry = new AgentSessionRegistry();
