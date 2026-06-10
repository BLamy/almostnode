import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionRegistry,
  type ActiveAgentSession,
} from '../src/chat/agent-session-registry';

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
});
