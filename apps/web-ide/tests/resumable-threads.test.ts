import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  discoverClaudeThreads,
  mergeDiscoveredThreads,
  toOpenCodeThreads,
} from '../src/features/resumable-threads';
import type { SerializedFile } from '../src/desktop/project-snapshot';
import type { ResumableThreadRecord } from '../src/features/project-db';

describe('resumable thread discovery', () => {
  it('extracts Claude sessions from JSONL transcripts and ignores invalid noise', () => {
    const transcript = [
      '{"type":"file-history-snapshot","timestamp":"2026-03-29T18:31:32.024Z"}',
      '{"sessionId":"session-a","type":"user","timestamp":"2026-03-29T18:31:33.000Z","message":{"role":"user","content":"Plan the migration"}}',
      '{"sessionId":"session-a","type":"assistant","timestamp":"2026-03-29T18:35:33.000Z","message":{"role":"assistant","content":"Working on it"}}',
      '{"sessionId":"session-b","type":"user","timestamp":"2026-03-29T18:36:33.000Z","message":{"role":"user","content":[{"type":"text","text":"Fix the resume flow"}]}}',
      '{"sessionId":"session-b","type":"assistant","timestamp":"2026-03-29T18:37:33.000Z","message":{"role":"assistant","content":"Done"}}',
      'not-json',
      '{"sessionId":"session-c","isSidechain":true,"type":"user","timestamp":"2026-03-29T18:38:33.000Z","message":{"role":"user","content":"Ignore me"}}',
    ].join('\n');
    const files: SerializedFile[] = [
      {
        path: '/home/user/.claude/projects/demo/transcript.jsonl',
        contentBase64: Buffer.from(transcript, 'utf8').toString('base64'),
      },
    ];

    expect(discoverClaudeThreads('project-1', files)).toEqual([
      expect.objectContaining({
        id: 'claude:project-1:session-b',
        projectId: 'project-1',
        harness: 'claude',
        title: 'Fix the resume flow',
        resumeToken: 'session-b',
        updatedAt: Date.parse('2026-03-29T18:37:33.000Z'),
      }),
      expect.objectContaining({
        id: 'claude:project-1:session-a',
        projectId: 'project-1',
        harness: 'claude',
        title: 'Plan the migration',
        resumeToken: 'session-a',
        updatedAt: Date.parse('2026-03-29T18:35:33.000Z'),
      }),
    ]);
  });

  it('keeps only root OpenCode sessions and clears stale persisted OpenCode rows on an empty rescan', () => {
    const existing: ResumableThreadRecord[] = [
      {
        id: 'opencode:project-1:session-old',
        projectId: 'project-1',
        harness: 'opencode',
        title: 'Persisted OpenCode session',
        resumeToken: 'session-old',
        createdAt: 1,
        updatedAt: 10,
      },
    ];
    const discovered = toOpenCodeThreads('project-1', [
      {
        id: 'session-root',
        title: 'Root session',
        time: { created: 20, updated: 30 },
      },
      {
        id: 'session-child',
        title: 'Child session',
        parentID: 'session-root',
        time: { created: 21, updated: 31 },
      },
    ]);

    expect(discovered).toEqual([
      {
        id: 'opencode:project-1:session-root',
        projectId: 'project-1',
        harness: 'opencode',
        title: 'Root session',
        resumeToken: 'session-root',
        createdAt: 20,
        updatedAt: 30,
      },
    ]);

    expect(mergeDiscoveredThreads(existing, { claude: [], opencode: [] })).toEqual([]);
  });
});
