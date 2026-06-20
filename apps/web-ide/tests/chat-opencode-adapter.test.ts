import { describe, expect, it, vi } from 'vitest';
import {
  OpenCodeConversationAdapter,
  type OpenCodeChatConnection,
} from '../src/chat/adapters/opencode-conversation-adapter';
import type { ActiveAgentSession } from '../src/chat/agent-session-registry';
import type { ConversationState } from '../src/chat/conversation-types';

function makeSession(overrides: Partial<ActiveAgentSession> = {}): ActiveAgentSession {
  return {
    harness: 'opencode',
    tabId: 'tab-oc',
    startedAt: Date.now(),
    resumeToken: null,
    sendInput: () => {},
    isRunning: () => true,
    ...overrides,
  };
}

interface Fake {
  connection: OpenCodeChatConnection;
  emit: (event: Record<string, unknown>) => void;
  appended: string[];
  submitted: { count: number };
  close: () => void;
}

function makeFakeConnection(options?: {
  sessions?: unknown;
  messages?: unknown;
}): Fake {
  const appended: string[] = [];
  const submitted = { count: 0 };
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const connection: OpenCodeChatConnection = {
    client: {
      session: {
        list: async () => options?.sessions ?? [],
        messages: async () => options?.messages ?? [],
      },
      tui: {
        appendPrompt: async ({ body }) => {
          appended.push(body.text);
          return {};
        },
        submitPrompt: async () => {
          submitted.count += 1;
          return {};
        },
      },
    },
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/event')) {
        return new Response(stream);
      }
      // Pending question/permission hydration and reply posts.
      return new Response('[]', {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
    dispose: vi.fn(),
  };
  return {
    connection,
    emit: (event) => {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    appended,
    submitted,
    close: () => controller?.close(),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('opencode conversation adapter', () => {
  it('hydrates history from the bound session', async () => {
    const fake = makeFakeConnection({
      sessions: [
        { id: 'sess-old', time: { updated: 10 } },
        { id: 'sess-new', time: { updated: 99 } },
      ],
      messages: [
        {
          info: { id: 'm1', sessionID: 'sess-new', role: 'user', time: { created: 1 } },
          parts: [{ id: 'p1', messageID: 'm1', type: 'text', text: 'earlier question' }],
        },
        {
          info: {
            id: 'm2',
            sessionID: 'sess-new',
            role: 'assistant',
            time: { created: 2, completed: 3 },
          },
          parts: [{ id: 'p2', messageID: 'm2', type: 'text', text: 'earlier answer' }],
        },
      ],
    });
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession(),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();
    expect(state!.sessionId).toBe('sess-new');
    expect(state!.messages.map((m) => m.text)).toEqual([
      'earlier question',
      'earlier answer',
    ]);
    adapter.dispose();
    expect(fake.connection.dispose).toHaveBeenCalled();
  });

  it('hydrates reloaded tool parts in message order', async () => {
    const fake = makeFakeConnection({
      sessions: [{ id: 'sess-new', time: { updated: 99 } }],
      messages: [
        {
          info: {
            id: 'm1',
            sessionID: 'sess-new',
            role: 'assistant',
            time: { created: 1, completed: 4 },
          },
          parts: [
            {
              id: 'p1',
              type: 'text',
              text: 'Before the command.',
            },
            {
              id: 'pt',
              type: 'tool',
              tool: 'bash',
              callID: 'c1',
              state: {
                status: 'completed',
                input: { command: 'pnpm test' },
                output: 'passed',
                title: 'Run tests',
              },
            },
            {
              id: 'p2',
              type: 'text',
              text: 'After the command.',
            },
          ],
        },
      ],
    });
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession(),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    expect(state!.messages).toHaveLength(3);
    expect(state!.messages[0].kind).toBeUndefined();
    expect(state!.messages[0]).toMatchObject({
      role: 'assistant',
      text: 'Before the command.',
    });
    expect(state!.messages[1]).toMatchObject({
      kind: 'tool',
      role: 'assistant',
      tool: {
        name: 'Bash',
        command: 'pnpm test',
        output: 'passed',
        status: 'success',
      },
    });
    expect(state!.messages[2].kind).toBeUndefined();
    expect(state!.messages[2]).toMatchObject({
      role: 'assistant',
      text: 'After the command.',
    });
    adapter.dispose();
  });

  it('streams live message and part events', async () => {
    const fake = makeFakeConnection();
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    fake.emit({
      type: 'message.updated',
      properties: {
        info: { id: 'm1', sessionID: 'sess-1', role: 'user', time: { created: 1 } },
      },
    });
    fake.emit({
      type: 'message.part.updated',
      properties: {
        part: { id: 'p1', messageID: 'm1', sessionID: 'sess-1', type: 'text', text: 'hi opencode' },
      },
    });
    await flush();
    expect(state!.messages).toHaveLength(1);
    expect(state!.messages[0]).toMatchObject({ role: 'user', text: 'hi opencode' });
    expect(state!.busy).toBe(true);

    fake.emit({
      type: 'message.updated',
      properties: {
        info: {
          id: 'm2',
          sessionID: 'sess-1',
          role: 'assistant',
          time: { created: 2, completed: 3 },
        },
      },
    });
    fake.emit({
      type: 'message.part.updated',
      properties: {
        part: { id: 'p2', messageID: 'm2', sessionID: 'sess-1', type: 'text', text: 'hello!' },
      },
    });
    await flush();
    expect(state!.messages).toHaveLength(2);
    expect(state!.busy).toBe(false);

    // Events for other sessions are ignored.
    fake.emit({
      type: 'message.part.updated',
      properties: {
        part: { id: 'px', messageID: 'mx', sessionID: 'other', type: 'text', text: 'noise' },
      },
    });
    await flush();
    expect(state!.messages).toHaveLength(2);
    adapter.dispose();
  });

  it('renders tool parts as tool cards', async () => {
    const fake = makeFakeConnection();
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    fake.emit({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'pt',
          messageID: 'm1',
          sessionID: 'sess-1',
          type: 'tool',
          tool: 'edit',
          callID: 'c1',
          state: {
            status: 'completed',
            input: { filePath: '/project/src/x.ts', oldString: 'a', newString: 'b' },
            output: 'done',
            title: 'src/x.ts',
          },
        },
      },
    });
    await flush();
    const tool = state!.messages.find((m) => m.kind === 'tool');
    expect(tool).toBeTruthy();
    expect(tool!.tool).toMatchObject({ name: 'Edit', title: 'src/x.ts', status: 'success' });
    expect(tool!.tool!.diffs![0].patch).toContain('-a');
    expect(tool!.tool!.diffs![0].patch).toContain('+b');
    adapter.dispose();
  });

  it('sends through the TUI prompt routes and reconciles the echo', async () => {
    const fake = makeFakeConnection();
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    await adapter.sendUserMessage('do the thing');
    expect(fake.appended).toEqual(['do the thing']);
    expect(fake.submitted.count).toBe(1);
    expect(state!.messages).toHaveLength(1);
    expect(state!.messages[0].pending).toBe(true);

    fake.emit({
      type: 'message.updated',
      properties: {
        info: { id: 'm1', sessionID: 'sess-1', role: 'user', time: { created: 1 } },
      },
    });
    fake.emit({
      type: 'message.part.updated',
      properties: {
        part: { id: 'p1', messageID: 'm1', sessionID: 'sess-1', type: 'text', text: 'do the thing' },
      },
    });
    await flush();
    expect(state!.messages).toHaveLength(1);
    expect(state!.messages[0].pending).toBeUndefined();
    adapter.dispose();
  });

  it('surfaces question elicitations and replies through the question route', async () => {
    const fake = makeFakeConnection();
    const posts: Array<{ url: string; body: unknown }> = [];
    const baseFetch = fake.connection.fetch;
    fake.connection.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return new Response('true', {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    fake.emit({
      type: 'question.asked',
      properties: {
        id: 'q-1',
        sessionID: 'sess-1',
        questions: [
          {
            question: 'Which approach?',
            header: 'Approach',
            options: [
              { label: 'Option A', description: 'first' },
              { label: 'Option B', description: 'second' },
            ],
          },
        ],
      },
    });
    await flush();

    const ask = state!.messages.find((m) => m.kind === 'elicitation');
    expect(ask).toBeTruthy();
    expect(ask!.elicitation).toMatchObject({
      requestId: 'q-1',
      kind: 'question',
      status: 'pending',
    });
    expect(ask!.elicitation!.questions[0].options.map((o) => o.label)).toEqual([
      'Option A',
      'Option B',
    ]);
    // The agent is waiting on the user — the chat must not look busy.
    expect(state!.busy).toBe(false);

    await adapter.respondToElicitation('q-1', [['Option A']]);
    expect(posts).toEqual([
      {
        url: 'http://opencode.internal/question/q-1/reply',
        body: { answers: [['Option A']] },
      },
    ]);
    const answered = state!.messages.find((m) => m.kind === 'elicitation');
    expect(answered!.elicitation).toMatchObject({
      status: 'answered',
      answers: [['Option A']],
    });
    adapter.dispose();
  });

  it('surfaces permission asks and maps replies to the permission route', async () => {
    const fake = makeFakeConnection();
    const posts: Array<{ url: string; body: unknown }> = [];
    const baseFetch = fake.connection.fetch;
    fake.connection.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return new Response('true', {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    fake.emit({
      type: 'permission.asked',
      properties: {
        id: 'perm-1',
        sessionID: 'sess-1',
        permission: 'external_directory',
        patterns: ['/project'],
      },
    });
    await flush();

    const ask = state!.messages.find((m) => m.kind === 'elicitation');
    expect(ask!.elicitation).toMatchObject({
      requestId: 'perm-1',
      kind: 'permission',
      status: 'pending',
    });
    expect(ask!.elicitation!.questions[0].question).toContain('external_directory');

    await adapter.respondToElicitation('perm-1', [['Allow always']]);
    expect(posts).toEqual([
      {
        url: 'http://opencode.internal/permission/perm-1/reply',
        body: { reply: 'always' },
      },
    ]);
    expect(
      state!.messages.find((m) => m.kind === 'elicitation')!.elicitation!.status,
    ).toBe('answered');
    adapter.dispose();
  });

  it('marks elicitations resolved when answered from the TUI', async () => {
    const fake = makeFakeConnection();
    const adapter = new OpenCodeConversationAdapter({
      session: makeSession({ resumeToken: 'sess-1' }),
      connect: async () => fake.connection,
    });
    let state: ConversationState | null = null;
    adapter.subscribe((next) => {
      state = next;
    });
    await flush();

    fake.emit({
      type: 'question.asked',
      properties: {
        id: 'q-2',
        sessionID: 'sess-1',
        questions: [
          { question: 'Proceed?', header: 'Plan', options: [{ label: 'Yes', description: '' }] },
        ],
      },
    });
    fake.emit({
      type: 'question.replied',
      properties: { sessionID: 'sess-1', requestID: 'q-2', answers: [['Yes']] },
    });
    await flush();

    expect(
      state!.messages.find((m) => m.kind === 'elicitation')!.elicitation,
    ).toMatchObject({ status: 'answered', answers: [['Yes']] });
    adapter.dispose();
  });
});
