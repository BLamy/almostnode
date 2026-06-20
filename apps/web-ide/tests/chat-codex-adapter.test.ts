import { describe, expect, it, vi } from 'vitest';
import { CodexConversationAdapter } from '../src/chat/adapters/codex-conversation-adapter';
import { CodexConversationBus } from '../src/chat/codex-conversation-bus';
import {
  AgentSessionRegistry,
  type ActiveAgentSession,
} from '../src/chat/agent-session-registry';
import type { ConversationState } from '../src/chat/conversation-types';

function makeSession(
  overrides: Partial<ActiveAgentSession> = {},
): ActiveAgentSession & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    harness: 'codex',
    tabId: 'tab-1',
    startedAt: Date.now(),
    resumeToken: null,
    sendInput: (data: string) => inputs.push(data),
    isRunning: () => true,
    inputs,
    ...overrides,
  };
}

function setup() {
  const bus = new CodexConversationBus();
  const registry = new AgentSessionRegistry();
  const session = makeSession();
  registry.setActive(session);
  const adapter = new CodexConversationAdapter({ session, registry, bus });
  let state: ConversationState | null = null;
  adapter.subscribe((next) => {
    state = next;
  });
  return { bus, registry, session, adapter, getState: () => state! };
}

describe('codex conversation adapter', () => {
  it('maps item/completed notifications to chat messages', () => {
    const { bus, adapter, getState } = setup();

    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'userMessage',
          id: 'item-1',
          content: [{ type: 'text', text: 'build a todo app' }],
        },
      },
    });
    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-2', text: 'On it.' },
      },
    });

    const state = getState();
    expect(state.sessionId).toBe('thread-1');
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: 'build a todo app' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: 'On it.' });
    adapter.dispose();
  });

  it('streams agent message deltas and finalizes on item/completed', () => {
    const { bus, adapter, getState } = setup();

    bus.emitNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 't', turnId: 'turn-1', itemId: 'item-2', delta: 'Hel' },
    });
    bus.emitNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 't', turnId: 'turn-1', itemId: 'item-2', delta: 'lo' },
    });
    expect(getState().messages).toHaveLength(1);
    expect(getState().messages[0].text).toBe('Hello');

    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-2', text: 'Hello there' },
      },
    });
    expect(getState().messages).toHaveLength(1);
    expect(getState().messages[0].text).toBe('Hello there');
    adapter.dispose();
  });

  it('tracks busy state from turn lifecycle notifications', () => {
    const { bus, adapter, getState } = setup();

    bus.emitNotification({ method: 'turn/started', params: { turn: { id: 'turn-1' } } });
    expect(getState().busy).toBe(true);
    bus.emitNotification({ method: 'turn/completed', params: { turn: { id: 'turn-1' } } });
    expect(getState().busy).toBe(false);
    adapter.dispose();
  });

  it('renders commandExecution at item/started and finalizes at item/completed', () => {
    const { bus, adapter, getState } = setup();

    bus.emitNotification({
      method: 'item/started',
      params: {
        threadId: 't',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'npm run typecheck',
          status: 'inProgress',
        },
      },
    });

    let message = getState().messages.find((m) => m.id === 'cmd-1');
    expect(message?.tool?.command).toBe('npm run typecheck');
    expect(message?.tool?.status).toBe('running');

    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'npm run typecheck',
          status: 'completed',
          exitCode: 0,
          aggregatedOutput: 'done\n',
        },
      },
    });

    message = getState().messages.find((m) => m.id === 'cmd-1');
    expect(message?.tool?.status).toBe('success');
    expect(message?.tool?.output).toContain('done');
    expect(getState().messages.filter((m) => m.id === 'cmd-1')).toHaveLength(1);
    adapter.dispose();
  });

  it('replays buffered events when attaching mid-session', () => {
    const bus = new CodexConversationBus();
    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'item-1', text: 'earlier reply' },
      },
    });

    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);
    const adapter = new CodexConversationAdapter({ session, registry, bus });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    expect(state!.messages.map((m) => m.text)).toEqual(['earlier reply']);
    adapter.dispose();
  });

  it('clears history on bus reset (new app-server session)', () => {
    const { bus, adapter, getState } = setup();
    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'i1', text: 'old' },
      },
    });
    expect(getState().messages).toHaveLength(1);
    bus.reset();
    expect(getState().messages).toHaveLength(0);
    adapter.dispose();
  });

  it('reconciles optimistic sends against userMessage items', async () => {
    vi.useFakeTimers();
    const { bus, adapter, session, getState } = setup();

    const send = adapter.sendUserMessage('do the thing');
    await vi.advanceTimersByTimeAsync(100);
    await send;
    expect(session.inputs.length).toBeGreaterThan(0);
    expect(getState().messages).toHaveLength(1);
    expect(getState().messages[0].pending).toBe(true);

    bus.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 't',
        turnId: 'turn-1',
        item: {
          type: 'userMessage',
          id: 'item-1',
          content: [{ type: 'text', text: 'do the thing' }],
        },
      },
    });
    expect(getState().messages).toHaveLength(1);
    expect(getState().messages[0].pending).toBeUndefined();
    vi.useRealTimers();
    adapter.dispose();
  });
});
