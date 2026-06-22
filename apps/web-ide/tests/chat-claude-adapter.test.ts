import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeConversationAdapter,
  type ClaudeAdapterVfs,
} from '@agent-wasm/code';
import {
  AgentSessionRegistry,
  type ActiveAgentSession,
} from '@agent-wasm/chat-core';
import type { ConversationState } from '@agent-wasm/chat-core';

const ROOT = '/home/user/.claude/projects';

class FakeVfs implements ClaudeAdapterVfs {
  private files = new Map<string, { content: string; mtime: number }>();
  private listeners = new Set<(path: string, content: string) => void>();

  on(_event: 'change', listener: (path: string, content: string) => void) {
    this.listeners.add(listener);
    return this;
  }

  off(_event: 'change', listener: (path: string, content: string) => void) {
    this.listeners.delete(listener);
    return this;
  }

  write(path: string, content: string, mtime = Date.now()): void {
    this.files.set(path, { content, mtime });
    for (const listener of this.listeners) {
      listener(path, content);
    }
  }

  seed(path: string, content: string, mtime: number): void {
    this.files.set(path, { content, mtime });
  }

  existsSync(path: string): boolean {
    if (this.files.has(path)) return true;
    const prefix = path.endsWith('/') ? path : `${path}/`;
    return Array.from(this.files.keys()).some((file) => file.startsWith(prefix));
  }

  readdirSync(path: string): string[] {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const entries = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      entries.add(file.slice(prefix.length).split('/')[0]);
    }
    return Array.from(entries);
  }

  statSync(path: string) {
    const file = this.files.get(path);
    if (file) {
      return { isDirectory: () => false, mtimeMs: file.mtime };
    }
    if (this.existsSync(path)) {
      return { isDirectory: () => true, mtimeMs: 0 };
    }
    throw new Error(`ENOENT: ${path}`);
  }

  readFileSync(path: string): string {
    const file = this.files.get(path);
    if (!file) throw new Error(`ENOENT: ${path}`);
    return file.content;
  }
}

function makeSession(
  overrides: Partial<ActiveAgentSession> = {},
): ActiveAgentSession & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    harness: 'claude',
    tabId: 'tab-1',
    startedAt: Date.now(),
    resumeToken: null,
    sendInput: (data: string) => inputs.push(data),
    isRunning: () => true,
    inputs,
    ...overrides,
  };
}

const userLine = (uuid: string, text: string) =>
  `${JSON.stringify({
    type: 'user',
    uuid,
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: text },
  })}\n`;

const assistantLine = (uuid: string, text: string) =>
  `${JSON.stringify({
    type: 'assistant',
    uuid,
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })}\n`;

describe('claude conversation adapter', () => {
  it('adopts the first transcript written after launch and streams messages', () => {
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);

    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });

    const path = `${ROOT}/-workspace/session-1.jsonl`;
    vfs.write(path, userLine('m1', 'hello agent'));
    expect(state!.messages).toHaveLength(1);
    expect(state!.busy).toBe(true);
    expect(state!.sessionId).toBe('session-1');

    vfs.write(path, userLine('m1', 'hello agent') + assistantLine('m2', 'hi!'));
    expect(state!.messages).toHaveLength(2);
    expect(state!.busy).toBe(false);

    // Writes to other transcripts are ignored once bound.
    vfs.write(`${ROOT}/-workspace/other.jsonl`, userLine('x1', 'unrelated'));
    expect(state!.messages).toHaveLength(2);

    adapter.dispose();
  });

  it('hydrates from an existing transcript when resuming', () => {
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    const path = `${ROOT}/-workspace/resume-token.jsonl`;
    vfs.seed(path, userLine('m1', 'earlier question') + assistantLine('m2', 'earlier answer'), 50);
    vfs.seed(`${ROOT}/-workspace/newer-other.jsonl`, userLine('z1', 'other session'), 99999);

    const session = makeSession({ resumeToken: 'resume-token', startedAt: 100_000 });
    registry.setActive(session);
    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });

    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });

    expect(state!.messages.map((m) => m.text)).toEqual([
      'earlier question',
      'earlier answer',
    ]);
    adapter.dispose();
  });

  it('ignores stale transcripts from before the session started', () => {
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    // Snapshot restore writes old transcripts moments before launch.
    vfs.seed(`${ROOT}/-workspace/old.jsonl`, userLine('m1', 'old stuff'), 499_900);

    const session = makeSession({ startedAt: 500_000 });
    registry.setActive(session);
    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });

    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    expect(state!.messages).toHaveLength(0);

    // The real session file appears after launch and wins.
    vfs.write(`${ROOT}/-workspace/new-session.jsonl`, userLine('n1', 'fresh message'));
    expect(state!.messages.map((m) => m.text)).toEqual(['fresh message']);
    adapter.dispose();
  });

  it('does not adopt transcript files that carry no conversation messages', () => {
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);
    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });

    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });

    // Snapshot/index writes parse but contain no messages — keep waiting.
    vfs.write(
      `${ROOT}/-workspace/index.jsonl`,
      `${JSON.stringify({ type: 'file-history-snapshot', messageId: 'x', snapshot: {} })}\n`,
    );
    expect(state!.messages).toHaveLength(0);

    vfs.write(`${ROOT}/-workspace/session-1.jsonl`, userLine('m1', 'hello'));
    expect(state!.messages.map((m) => m.text)).toEqual(['hello']);

    // The non-adopted file changing again stays ignored.
    vfs.write(
      `${ROOT}/-workspace/index.jsonl`,
      `${JSON.stringify({ type: 'file-history-snapshot', messageId: 'y', snapshot: {} })}\n` +
        userLine('zz', 'should not appear'),
    );
    expect(state!.messages.map((m) => m.text)).toEqual(['hello']);
    adapter.dispose();
  });

  it('shows an optimistic pending message and reconciles on transcript echo', async () => {
    vi.useFakeTimers();
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    const session = makeSession();
    registry.setActive(session);
    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });

    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });

    const sendPromise = adapter.sendUserMessage('fix the bug');
    expect(state!.messages).toHaveLength(1);
    expect(state!.messages[0]).toMatchObject({ pending: true, text: 'fix the bug' });

    await vi.advanceTimersByTimeAsync(100);
    await sendPromise;
    expect(session.inputs).toEqual(['[200~fix the bug[201~', '\r']);

    // Transcript echoes the message back — pending entry is replaced.
    vfs.write(`${ROOT}/-workspace/session-1.jsonl`, userLine('m1', 'fix the bug'));
    expect(state!.messages).toHaveLength(1);
    expect(state!.messages[0].pending).toBeUndefined();
    expect(state!.messages[0].id).toBe('m1');

    vi.useRealTimers();
    adapter.dispose();
  });

  it('drops the pending message when the send fails', async () => {
    const vfs = new FakeVfs();
    const registry = new AgentSessionRegistry();
    const session = makeSession({ isRunning: () => false });
    registry.setActive(session);
    const adapter = new ClaudeConversationAdapter({ vfs, session, registry });

    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });

    await expect(adapter.sendUserMessage('hello')).rejects.toThrow();
    expect(state!.messages).toHaveLength(0);
    adapter.dispose();
  });
});
