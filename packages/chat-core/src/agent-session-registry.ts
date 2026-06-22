import type { AgentHarness } from './conversation-types';

/**
 * A handle to an interactive agent CLI session running in a workbench
 * terminal. `sendInput` feeds the exact same channel xterm key input uses,
 * so anything sent here echoes in the terminal TUI as if typed.
 */
export interface ActiveAgentSession {
  harness: AgentHarness;
  tabId: string;
  startedAt: number;
  /** Sandbox whose container runs this session; absent for legacy callers. */
  sandboxId?: string;
  /** Resumable thread this session maps to, when known. */
  threadId?: string | null;
  /** Session/thread id when known up front (e.g. `claude --resume <id>`). */
  resumeToken: string | null;
  sendInput: (data: string) => void;
  /**
   * True while the agent is actually processing (streaming, running tools)
   * — NOT merely while its tab exists. The session pool pins sandboxes by
   * this answer; an always-true implementation makes its sandbox immortal
   * and the pool grows without bound.
   */
  isRunning: () => boolean;
  /**
   * Authoritative async busy probe (e.g. a fresh opencode /session/status
   * fetch). Eviction awaits this before disposing a sandbox so a cached
   * `isRunning()` can never let a mid-task agent be torn down. Falls back
   * to `isRunning()` when absent.
   */
  isBusy?: () => Promise<boolean>;
  /**
   * Resolves when the agent TUI is ready to accept input (e.g. Claude's MCP
   * client connected to the IDE bridge). Input injected before this point is
   * flushed by the TUI's raw-mode initialization and silently lost.
   */
  ready?: Promise<void>;
}

type RegistryListener = (session: ActiveAgentSession | null) => void;
type SessionsListener = (sessions: ActiveAgentSession[]) => void;

const BRACKETED_PASTE_START = '[200~';
const BRACKETED_PASTE_END = '[201~';
/** Give the TUI a beat to ingest pasted text before pressing Enter. */
const SUBMIT_DELAY_MS = 60;

/**
 * Tracks every interactive agent CLI session across sandboxes. The workbench
 * host registers sessions as they launch (whether started from chat, the AI
 * launcher, or typed into a terminal); the chat surface subscribes to the
 * `active` session and routes sends through it, while the sidebar subscribes
 * to the full list for running-agent indicators.
 *
 * Invariants:
 * - At most one session per terminal tab (`sessions` is keyed by tabId);
 *   re-registering a tab replaces its previous session.
 * - `active` is always null or one of the registered sessions.
 * - Detaching the chat (`deactivate`, `beginLaunch`) never unregisters a
 *   session — background agents keep running and stay visible to
 *   `subscribeAll`. Only `clearActive` (the session's CLI ended or its tab
 *   closed) removes a session.
 * - Every mutation notifies both `subscribe` and `subscribeAll` listeners.
 */
export class AgentSessionRegistry {
  private readonly sessions = new Map<string, ActiveAgentSession>();
  private active: ActiveAgentSession | null = null;
  private listeners = new Set<RegistryListener>();
  private allListeners = new Set<SessionsListener>();
  private sendChain: Promise<void> = Promise.resolve();
  private launching = false;
  private launchGeneration = 0;
  /** Sandbox where the user explicitly started a fresh chat; suppresses
   * auto-reattach to that sandbox's running agent until a session activates. */
  private newChatSandboxId: string | null = null;

  getActive(): ActiveAgentSession | null {
    return this.active;
  }

  /** Registers the session (replacing the tab's previous one) and routes chat to it. */
  setActive(session: ActiveAgentSession): void {
    this.sessions.set(session.tabId, session);
    this.active = session;
    this.launching = false;
    this.newChatSandboxId = null;
    this.notify();
  }

  /**
   * Registers a session without stealing chat focus — used for launches in
   * background sandboxes. If the tab currently holds the active session, the
   * replacement becomes active so `active` stays a registered session.
   */
  register(session: ActiveAgentSession): void {
    const replacesActive = this.active?.tabId === session.tabId;
    this.sessions.set(session.tabId, session);
    if (replacesActive) {
      this.active = session;
    }
    this.notify();
  }

  /**
   * Unregisters the given tab's session and, if it was the active one,
   * detaches the chat. No-op (and no notification) when the tab has no
   * registered session.
   */
  clearActive(tabId: string): void {
    const removed = this.sessions.delete(tabId);
    const wasActive = this.active?.tabId === tabId;
    if (wasActive) {
      this.active = null;
    }
    if (removed || wasActive) {
      this.notify();
    }
  }

  /** Routes chat to an already-registered session (e.g. focusing its tab). */
  setActiveByTab(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session || session === this.active) {
      return;
    }
    this.active = session;
    this.launching = false;
    this.newChatSandboxId = null;
    this.notify();
  }

  getSessionsForSandbox(sandboxId: string): ActiveAgentSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.sandboxId === sandboxId,
    );
  }

  /** Sandboxes with at least one session whose CLI is still running. */
  getRunningSandboxes(): Set<string> {
    const running = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.sandboxId !== undefined && session.isRunning()) {
        running.add(session.sandboxId);
      }
    }
    return running;
  }

  /**
   * Detach the chat from the current session without ending it (the CLI
   * keeps running in its terminal tab and stays registered). Used when
   * starting a fresh thread or switching sandboxes.
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
   * The user explicitly started a fresh chat in the given sandbox: detach
   * the chat and remember the intent so attaching that sandbox does NOT
   * auto-route chat back to an agent still running there. The intent clears
   * as soon as any session activates (the fresh chat's launch registering,
   * or the user resuming/clicking another thread).
   */
  startNewChat(sandboxId: string): void {
    this.newChatSandboxId = sandboxId;
    this.deactivate();
  }

  /**
   * True when auto-routing chat to a running agent in this sandbox should
   * be skipped: either the user just started a fresh chat there, or a new
   * session launch is already in flight. Consumes the new-chat intent.
   */
  shouldSuppressAutoActivate(sandboxId: string): boolean {
    if (this.launching) {
      return true;
    }
    if (this.newChatSandboxId === sandboxId) {
      this.newChatSandboxId = null;
      return true;
    }
    return false;
  }

  /**
   * Mark that a new session launch is in flight (e.g. resuming a thread).
   * Detaches the previous active session immediately (it stays registered)
   * so chat sends can never route to the thread the user just navigated
   * away from; `setActive` ends the launch window when the new session
   * registers. Returns a token for `endLaunch`.
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
   * Subscribe to the full session list across all sandboxes. Emits
   * immediately and after every registry mutation (including active-only
   * changes, whose list contents are unchanged).
   */
  subscribeAll(listener: SessionsListener): () => void {
    this.allListeners.add(listener);
    listener(this.snapshotSessions());
    return () => {
      this.allListeners.delete(listener);
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

  private snapshotSessions(): ActiveAgentSession[] {
    return Array.from(this.sessions.values());
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.active);
    }
    const sessions = this.snapshotSessions();
    for (const listener of this.allListeners) {
      listener(sessions);
    }
  }
}

export const agentSessionRegistry = new AgentSessionRegistry();
