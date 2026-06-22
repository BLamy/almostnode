import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionRegistry,
  type ActiveAgentSession,
} from '@agent-wasm/chat-core';

function makeSession(
  overrides: Partial<ActiveAgentSession> = {},
): ActiveAgentSession & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    harness: 'claude',
    tabId: 'tab-1',
    startedAt: 1000,
    resumeToken: null,
    sendInput: (data: string) => inputs.push(data),
    isRunning: () => true,
    inputs,
    ...overrides,
  };
}

describe('agent session registry', () => {
  it('notifies subscribers about session lifecycle', () => {
    const registry = new AgentSessionRegistry();
    const seen: Array<string | null> = [];
    registry.subscribe((session) => seen.push(session?.tabId ?? null));

    const session = makeSession();
    registry.setActive(session);
    registry.clearActive('other-tab');
    registry.clearActive('tab-1');

    expect(seen).toEqual([null, 'tab-1', null]);
    expect(registry.getActive()).toBeNull();
  });

  it('sends text wrapped in bracketed paste followed by Enter', async () => {
    vi.useFakeTimers();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);

    const send = registry.sendUserText('hello world');
    await vi.advanceTimersByTimeAsync(0); // flush the send chain microtask
    expect(session.inputs).toEqual(['[200~hello world[201~']);

    await vi.advanceTimersByTimeAsync(100);
    await send;
    expect(session.inputs).toEqual(['[200~hello world[201~', '\r']);
    vi.useRealTimers();
  });

  it('normalizes CRLF line endings inside the paste payload', async () => {
    vi.useFakeTimers();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);

    const send = registry.sendUserText('line1\r\nline2');
    await vi.advanceTimersByTimeAsync(100);
    await send;
    expect(session.inputs[0]).toBe('[200~line1\nline2[201~');
    vi.useRealTimers();
  });

  it('serializes concurrent sends', async () => {
    vi.useFakeTimers();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);

    const first = registry.sendUserText('first');
    const second = registry.sendUserText('second');
    await vi.advanceTimersByTimeAsync(0); // flush the send chain microtask
    // Second paste must not start before the first send completed.
    expect(session.inputs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    await first;
    expect(session.inputs.slice(0, 2)).toEqual([
      '[200~first[201~',
      '\r',
    ]);

    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(session.inputs).toEqual([
      '[200~first[201~',
      '\r',
      '[200~second[201~',
      '\r',
    ]);
    vi.useRealTimers();
  });

  it('routes queued sends to the session active when they execute', async () => {
    vi.useFakeTimers();
    const registry = new AgentSessionRegistry();
    const first = makeSession({ tabId: 'tab-1' });
    const second = makeSession({ tabId: 'tab-2' });
    registry.setActive(first);

    // Queue two sends, then switch threads while the first is mid-flight.
    const sendA = registry.sendUserText('to current thread');
    const sendB = registry.sendUserText('after switch');
    await vi.advanceTimersByTimeAsync(0);
    registry.setActive(second);

    await vi.advanceTimersByTimeAsync(100);
    await sendA;
    await vi.advanceTimersByTimeAsync(100);
    await sendB;

    // The first send started on tab-1; the queued one must follow the
    // switch instead of leaking into the previous thread's session.
    expect(first.inputs).toEqual([
      '[200~to current thread[201~',
      '\r',
    ]);
    expect(second.inputs).toEqual(['[200~after switch[201~', '\r']);
    vi.useRealTimers();
  });

  it('tracks launch windows and detaches the active session on beginLaunch', () => {
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);

    const token = registry.beginLaunch();
    expect(registry.isLaunching()).toBe(true);
    expect(registry.getActive()).toBeNull();

    // Registration of the launched session ends the launch window.
    registry.setActive(makeSession({ tabId: 'tab-2' }));
    expect(registry.isLaunching()).toBe(false);

    // A stale failure token can't cancel a newer launch.
    const newer = registry.beginLaunch();
    registry.endLaunch(token);
    expect(registry.isLaunching()).toBe(true);
    registry.endLaunch(newer);
    expect(registry.isLaunching()).toBe(false);
  });

  it('deactivate detaches the chat regardless of tab', () => {
    const registry = new AgentSessionRegistry();
    registry.setActive(makeSession());
    registry.deactivate();
    expect(registry.getActive()).toBeNull();
  });

  it('rejects sends when no session is running', async () => {
    const registry = new AgentSessionRegistry();
    await expect(registry.sendUserText('hello')).rejects.toThrow(
      /No agent session/,
    );

    registry.setActive(makeSession({ isRunning: () => false }));
    await expect(registry.sendUserText('hello')).rejects.toThrow();
  });

  it('tracks sessions from multiple sandboxes; register does not steal focus', () => {
    const registry = new AgentSessionRegistry();
    const main = makeSession({ tabId: 'tab-main', sandboxId: 'sb-main' });
    const background = makeSession({ tabId: 'tab-bg', sandboxId: 'sb-bg' });
    registry.setActive(main);
    registry.register(background);

    expect(registry.getActive()).toBe(main);
    expect(registry.getSessionsForSandbox('sb-main')).toEqual([main]);
    expect(registry.getSessionsForSandbox('sb-bg')).toEqual([background]);
    expect(registry.getSessionsForSandbox('sb-other')).toEqual([]);
  });

  it('getRunningSandboxes reflects isRunning flips', () => {
    const registry = new AgentSessionRegistry();
    let aRunning = true;
    let bRunning = true;
    registry.register(
      makeSession({ tabId: 'tab-a', sandboxId: 'sb-a', isRunning: () => aRunning }),
    );
    registry.register(
      makeSession({ tabId: 'tab-b', sandboxId: 'sb-b', isRunning: () => bRunning }),
    );
    // Sessions without a sandboxId never contribute to running sandboxes.
    registry.register(makeSession({ tabId: 'tab-legacy' }));

    expect(registry.getRunningSandboxes()).toEqual(new Set(['sb-a', 'sb-b']));
    aRunning = false;
    expect(registry.getRunningSandboxes()).toEqual(new Set(['sb-b']));
    bRunning = false;
    expect(registry.getRunningSandboxes()).toEqual(new Set());
  });

  it('clearActive of a background tab does not disturb the active session', () => {
    const registry = new AgentSessionRegistry();
    const main = makeSession({ tabId: 'tab-main', sandboxId: 'sb-main' });
    const background = makeSession({ tabId: 'tab-bg', sandboxId: 'sb-bg' });
    registry.setActive(main);
    registry.register(background);

    registry.clearActive('tab-bg');
    expect(registry.getActive()).toBe(main);
    expect(registry.getSessionsForSandbox('sb-bg')).toEqual([]);
    expect(registry.getSessionsForSandbox('sb-main')).toEqual([main]);
  });

  it('deactivate detaches the chat but keeps the session registered', () => {
    const registry = new AgentSessionRegistry();
    const session = makeSession({ tabId: 'tab-1', sandboxId: 'sb-1' });
    registry.setActive(session);
    registry.deactivate();

    expect(registry.getActive()).toBeNull();
    expect(registry.getSessionsForSandbox('sb-1')).toEqual([session]);
    expect(registry.getRunningSandboxes()).toEqual(new Set(['sb-1']));
  });

  it('setActiveByTab routes chat to a registered background session', () => {
    const registry = new AgentSessionRegistry();
    const main = makeSession({ tabId: 'tab-main' });
    const background = makeSession({ tabId: 'tab-bg' });
    registry.setActive(main);
    registry.register(background);

    registry.setActiveByTab('tab-bg');
    expect(registry.getActive()).toBe(background);

    // Unknown tabs are ignored.
    registry.setActiveByTab('tab-missing');
    expect(registry.getActive()).toBe(background);
  });

  it('subscribeAll emits immediately and after every mutation', () => {
    const registry = new AgentSessionRegistry();
    const emissions: string[][] = [];
    const unsubscribe = registry.subscribeAll((sessions) =>
      emissions.push(sessions.map((session) => session.tabId)),
    );
    expect(emissions).toEqual([[]]);

    registry.register(makeSession({ tabId: 'tab-1', sandboxId: 'sb-1' }));
    registry.setActive(makeSession({ tabId: 'tab-2', sandboxId: 'sb-2' }));
    registry.clearActive('tab-1');
    // deactivate changes the active session only; the list re-emits unchanged.
    registry.deactivate();
    expect(emissions).toEqual([
      [],
      ['tab-1'],
      ['tab-1', 'tab-2'],
      ['tab-2'],
      ['tab-2'],
    ]);

    unsubscribe();
    registry.register(makeSession({ tabId: 'tab-3' }));
    expect(emissions).toHaveLength(5);
  });

  it('startNewChat suppresses auto-activate for that sandbox once', () => {
    const registry = new AgentSessionRegistry();
    const running = makeSession({ tabId: 'tab-old', sandboxId: 'sb-1' });
    registry.setActive(running);

    registry.startNewChat('sb-1');
    expect(registry.getActive()).toBeNull();
    // The session stays registered, but attaching the sandbox must not
    // route chat back to it.
    expect(registry.shouldSuppressAutoActivate('sb-1')).toBe(true);
    // The intent is consumed: a later attach reattaches as usual.
    expect(registry.shouldSuppressAutoActivate('sb-1')).toBe(false);
  });

  it('startNewChat does not suppress auto-activate for other sandboxes', () => {
    const registry = new AgentSessionRegistry();
    registry.startNewChat('sb-1');
    expect(registry.shouldSuppressAutoActivate('sb-other')).toBe(false);
    // Intent for sb-1 survives an attach of another sandbox.
    expect(registry.shouldSuppressAutoActivate('sb-1')).toBe(true);
  });

  it('activating any session clears the pending new-chat intent', () => {
    const registry = new AgentSessionRegistry();
    const background = makeSession({ tabId: 'tab-bg', sandboxId: 'sb-1' });
    registry.register(background);

    registry.startNewChat('sb-1');
    registry.setActiveByTab('tab-bg');
    expect(registry.shouldSuppressAutoActivate('sb-1')).toBe(false);

    registry.startNewChat('sb-1');
    registry.setActive(makeSession({ tabId: 'tab-new', sandboxId: 'sb-1' }));
    expect(registry.shouldSuppressAutoActivate('sb-1')).toBe(false);
  });

  it('suppresses auto-activate while a launch is in flight', () => {
    const registry = new AgentSessionRegistry();
    registry.beginLaunch();
    expect(registry.shouldSuppressAutoActivate('sb-any')).toBe(true);

    registry.setActive(makeSession({ tabId: 'tab-1', sandboxId: 'sb-any' }));
    expect(registry.shouldSuppressAutoActivate('sb-any')).toBe(false);
  });

  it('sendUserText routes to the active session only', async () => {
    vi.useFakeTimers();
    const registry = new AgentSessionRegistry();
    const main = makeSession({ tabId: 'tab-main', sandboxId: 'sb-main' });
    const background = makeSession({ tabId: 'tab-bg', sandboxId: 'sb-bg' });
    registry.setActive(main);
    registry.register(background);

    const send = registry.sendUserText('hello');
    await vi.advanceTimersByTimeAsync(100);
    await send;
    expect(main.inputs).toEqual(['[200~hello[201~', '\r']);
    expect(background.inputs).toEqual([]);
    vi.useRealTimers();
  });
});
