import { describe, expect, it } from 'vitest';
import { ClaudeTranscriptTail } from '../src/chat/claude-transcript-tail';

function line(entry: Record<string, unknown>): string {
  return `${JSON.stringify(entry)}\n`;
}

const userLine = (uuid: string, text: string, extra: Record<string, unknown> = {}) =>
  line({
    parentUuid: null,
    isSidechain: false,
    sessionId: 'session-1',
    type: 'user',
    uuid,
    timestamp: '2026-03-29T18:31:32.024Z',
    message: { role: 'user', content: text },
    ...extra,
  });

const assistantLine = (uuid: string, text: string, extra: Record<string, unknown> = {}) =>
  line({
    parentUuid: 'm1',
    isSidechain: false,
    sessionId: 'session-1',
    type: 'assistant',
    uuid,
    timestamp: '2026-03-29T18:31:37.292Z',
    message: {
      model: 'claude-opus-4-6',
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
    ...extra,
  });

describe('claude transcript tail', () => {
  it('parses user and assistant messages from a transcript', () => {
    const tail = new ClaudeTranscriptTail();
    const update = tail.ingest(
      line({ type: 'file-history-snapshot', messageId: 'm1', snapshot: {} }) +
        userLine('m1', 'hey') +
        assistantLine('m2', 'Hey! How can I help you today?'),
    );

    expect(update).not.toBeNull();
    expect(update!.sessionId).toBe('session-1');
    expect(update!.messages).toHaveLength(2);
    expect(update!.messages[0]).toMatchObject({ role: 'user', text: 'hey', id: 'm1' });
    expect(update!.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Hey! How can I help you today?',
    });
  });

  it('parses incrementally, only consuming complete appended lines', () => {
    const tail = new ClaudeTranscriptTail();
    let content = userLine('m1', 'first');
    expect(tail.ingest(content)!.messages).toHaveLength(1);

    // Partial trailing line is ignored until completed.
    const partial = assistantLine('m2', 'answer').slice(0, 25);
    content += partial;
    expect(tail.ingest(content)).toBeNull();

    content = content.slice(0, content.length - partial.length) + assistantLine('m2', 'answer');
    const update = tail.ingest(content);
    expect(update!.messages).toHaveLength(2);
    expect(update!.messages[1].text).toBe('answer');
  });

  it('skips sidechain, meta, snapshot, tool-result and command entries', () => {
    const tail = new ClaudeTranscriptTail();
    const update = tail.ingest(
      userLine('m1', 'real question') +
        userLine('side-1', 'sidechain prompt', { isSidechain: true }) +
        userLine('meta-1', 'meta entry', { isMeta: true }) +
        line({
          type: 'user',
          uuid: 'tool-1',
          sessionId: 'session-1',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
          },
        }) +
        userLine('cmd-1', '<command-name>/clear</command-name>') +
        line({ type: 'file-history-snapshot', messageId: 'm9', snapshot: {} }) +
        assistantLine('m2', 'real answer'),
    );

    expect(update!.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('dedupes entries by uuid', () => {
    const tail = new ClaudeTranscriptTail();
    const content = userLine('m1', 'hello');
    tail.ingest(content);
    // Re-ingesting the same full content (e.g. duplicated change events) adds nothing.
    const update = tail.ingest(content + userLine('m1', 'hello'));
    expect(update).toBeNull();
    expect(tail.getMessages()).toHaveLength(1);
  });

  it('resets when the file is replaced with shorter content', () => {
    const tail = new ClaudeTranscriptTail();
    tail.ingest(userLine('m1', 'old session message') + assistantLine('m2', 'old reply'));
    expect(tail.getMessages()).toHaveLength(2);

    const update = tail.ingest(
      userLine('n1', 'new session', { sessionId: 'session-2' }),
    );
    expect(update!.messages).toHaveLength(1);
    expect(update!.messages[0].text).toBe('new session');
    expect(update!.sessionId).toBe('session-2');
  });

  it('renders tool-only assistant turns as tool messages, not text', () => {
    const tail = new ClaudeTranscriptTail();
    const update = tail.ingest(
      userLine('m1', 'do something') +
        line({
          type: 'assistant',
          uuid: 'm2',
          sessionId: 'session-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        }),
    );
    expect(update!.messages).toHaveLength(2);
    expect(update!.messages[1].kind).toBe('tool');
    expect(update!.messages[1].text).toBe('');
  });

  it('tracks context occupancy from the latest assistant usage', () => {
    const tail = new ClaudeTranscriptTail();
    expect(tail.getContextTokens()).toBeNull();

    tail.ingest(
      userLine('m1', 'hey') +
        assistantLine('m2', 'first reply', {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'first reply' }],
            usage: {
              input_tokens: 4,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 9_000,
              output_tokens: 50,
            },
          },
        }),
    );
    expect(tail.getContextTokens()).toBe(9_154);

    tail.ingest(
      userLine('m1', 'hey') +
        assistantLine('m2', 'first reply', {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'first reply' }],
            usage: {
              input_tokens: 4,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 9_000,
              output_tokens: 50,
            },
          },
        }) +
        assistantLine('m3', 'second reply', {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'second reply' }],
            usage: {
              input_tokens: 10,
              cache_read_input_tokens: 20_000,
              output_tokens: 90,
            },
          },
        }),
    );
    expect(tail.getContextTokens()).toBe(20_100);
  });
});
