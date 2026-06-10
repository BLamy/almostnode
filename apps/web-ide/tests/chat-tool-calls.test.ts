import { describe, expect, it } from 'vitest';
import {
  buildUnifiedPatch,
  claudeToolUseToToolCall,
  ensurePatchHeaders,
} from '../src/chat/tool-calls';
import { ClaudeTranscriptTail } from '../src/chat/claude-transcript-tail';

const line = (entry: Record<string, unknown>) => `${JSON.stringify(entry)}\n`;

describe('buildUnifiedPatch', () => {
  it('trims common prefix/suffix lines into context', () => {
    const oldText = 'a\nb\nc\nd\ne';
    const newText = 'a\nb\nC!\nd\ne';
    const patch = buildUnifiedPatch('src/x.ts', oldText, newText);
    expect(patch).toContain('--- a/src/x.ts');
    expect(patch).toContain('+++ b/src/x.ts');
    expect(patch).toContain('-c');
    expect(patch).toContain('+C!');
    // Unchanged context lines around the change.
    expect(patch).toContain(' b');
    expect(patch).toContain(' d');
    // Lines outside context window aren't in the hunk.
    expect(patch).not.toContain('-a');
  });

  it('renders new files as pure additions', () => {
    const patch = buildUnifiedPatch('new.ts', '', 'line1\nline2');
    expect(patch).toContain('--- /dev/null');
    expect(patch).toContain('+line1');
    expect(patch).toContain('+line2');
    expect(patch).not.toContain('-line');
  });
});

describe('ensurePatchHeaders', () => {
  it('keeps existing headers', () => {
    const diff = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
    expect(ensurePatchHeaders('x', diff)).toBe(diff);
  });

  it('prepends headers for bare hunks', () => {
    const diff = '@@ -1 +1 @@\n-a\n+b';
    const result = ensurePatchHeaders('src/y.ts', diff);
    expect(result.startsWith('--- a/src/y.ts\n+++ b/src/y.ts\n@@')).toBe(true);
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('claudeToolUseToToolCall', () => {
  it('maps Bash to a command call', () => {
    const tool = claudeToolUseToToolCall('Bash', {
      command: 'pnpm test',
      description: 'Run tests',
    });
    expect(tool).toMatchObject({
      name: 'Bash',
      title: 'Run tests',
      command: 'pnpm test',
      status: 'running',
    });
  });

  it('maps Edit to a diff and strips the workspace prefix', () => {
    const tool = claudeToolUseToToolCall('Edit', {
      file_path: '/project/src/app.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    expect(tool.title).toBe('src/app.ts');
    expect(tool.diffs).toHaveLength(1);
    expect(tool.diffs![0].patch).toContain('-const a = 1;');
    expect(tool.diffs![0].patch).toContain('+const a = 2;');
  });

  it('maps Write to an all-additions diff', () => {
    const tool = claudeToolUseToToolCall('Write', {
      file_path: '/project/readme.md',
      content: '# Hi',
    });
    expect(tool.diffs![0].patch).toContain('+# Hi');
    expect(tool.diffs![0].patch).toContain('--- /dev/null');
  });

  it('summarizes other tools by their primary input', () => {
    expect(claudeToolUseToToolCall('Read', { file_path: '/project/a.ts' }).title).toBe(
      'a.ts',
    );
    expect(claudeToolUseToToolCall('Grep', { pattern: 'foo.*bar' }).title).toBe(
      'foo.*bar',
    );
  });
});

describe('claude transcript tail tool parsing', () => {
  it('emits tool messages for tool_use blocks and attaches results', () => {
    const tail = new ClaudeTranscriptTail();
    let content =
      line({
        type: 'user',
        uuid: 'u1',
        sessionId: 's1',
        message: { role: 'user', content: 'run the tests' },
      }) +
      line({
        type: 'assistant',
        uuid: 'a1',
        sessionId: 's1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Running them now.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'pnpm test', description: 'Run tests' },
            },
          ],
        },
      });

    let update = tail.ingest(content)!;
    expect(update.messages).toHaveLength(3);
    const toolMessage = update.messages[2];
    expect(toolMessage.kind).toBe('tool');
    expect(toolMessage.tool).toMatchObject({
      name: 'Bash',
      command: 'pnpm test',
      status: 'running',
    });

    content += line({
      type: 'user',
      uuid: 'u2',
      sessionId: 's1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [{ type: 'text', text: '12 tests passed' }],
          },
        ],
      },
    });
    update = tail.ingest(content)!;
    expect(update.messages).toHaveLength(3);
    expect(update.messages[2].tool).toMatchObject({
      status: 'success',
      output: '12 tests passed',
    });
  });

  it('marks failed tool results as errors', () => {
    const tail = new ClaudeTranscriptTail();
    const content =
      line({
        type: 'assistant',
        uuid: 'a1',
        sessionId: 's1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_err',
              name: 'Bash',
              input: { command: 'exit 1' },
            },
          ],
        },
      }) +
      line({
        type: 'user',
        uuid: 'u2',
        sessionId: 's1',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_err',
              is_error: true,
              content: 'command failed',
            },
          ],
        },
      });
    const update = tail.ingest(content)!;
    expect(update.messages).toHaveLength(1);
    expect(update.messages[0].tool).toMatchObject({
      status: 'error',
      output: 'command failed',
    });
  });

  it('still renders assistant text alongside tool messages', () => {
    const tail = new ClaudeTranscriptTail();
    const update = tail.ingest(
      line({
        type: 'assistant',
        uuid: 'a1',
        sessionId: 's1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Editing the file.' },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'Edit',
              input: {
                file_path: '/project/src/a.ts',
                old_string: 'x',
                new_string: 'y',
              },
            },
          ],
        },
      }),
    )!;
    expect(update.messages.map((m) => m.kind ?? 'text')).toEqual(['text', 'tool']);
    expect(update.messages[1].tool?.diffs?.[0].patch).toContain('-x');
  });
});
