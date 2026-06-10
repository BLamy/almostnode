import type { ChatToolCall } from './conversation-types';

const HUNK_CONTEXT_LINES = 2;
const MAX_TOOL_OUTPUT_CHARS = 4000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

/**
 * Build a unified diff patch for an old→new text replacement. Common leading
 * and trailing lines are trimmed to context so small edits render as small
 * hunks. Line numbers are relative to the provided fragment (Claude's Edit
 * tool only carries the replaced snippet, not whole-file offsets) — they are
 * for display, not application.
 */
export function buildUnifiedPatch(
  path: string,
  oldText: string,
  newText: string,
): string {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - HUNK_CONTEXT_LINES);
  const contextBefore = oldLines.slice(contextStart, prefix);
  const contextAfter = oldLines.slice(
    oldLines.length - suffix,
    Math.min(oldLines.length, oldLines.length - suffix + HUNK_CONTEXT_LINES),
  );
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);

  const hunkLines = [
    ...contextBefore.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...contextAfter.map((line) => ` ${line}`),
  ];
  const oldCount = contextBefore.length + removed.length + contextAfter.length;
  const newCount = contextBefore.length + added.length + contextAfter.length;
  const isNewFile = oldLines.length === 0;
  const oldStart = isNewFile ? 0 : contextStart + 1;
  const newStart = newCount === 0 ? 0 : contextStart + 1;

  return [
    isNewFile ? '--- /dev/null' : `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...hunkLines,
    '',
  ].join('\n');
}

/** Ensure a diff body has ---/+++ file headers so parsePatchFiles accepts it. */
export function ensurePatchHeaders(path: string, diff: string): string {
  const trimmed = diff.trimStart();
  if (trimmed.startsWith('--- ') || trimmed.startsWith('diff --git')) {
    return diff;
  }
  return `--- a/${path}\n+++ b/${path}\n${diff.endsWith('\n') ? diff : `${diff}\n`}`;
}

export function truncateToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… (${output.length - MAX_TOOL_OUTPUT_CHARS} more characters)`;
}

function workspaceRelative(path: unknown): string {
  if (typeof path !== 'string' || !path) return '';
  return path.replace(/^\/project\//, '');
}

interface ClaudeEditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  edits?: Array<{ old_string?: string; new_string?: string }>;
  content?: string;
  command?: string;
  description?: string;
  pattern?: string;
  path?: string;
  query?: string;
  url?: string;
  prompt?: string;
}

/**
 * Map a Claude Code `tool_use` block to a renderable tool call: rich diffs
 * for file edits, the command line for Bash, and a compact summary for the
 * rest.
 */
export function claudeToolUseToToolCall(
  name: string,
  rawInput: unknown,
): ChatToolCall {
  const input = (rawInput ?? {}) as ClaudeEditInput;
  const filePath = workspaceRelative(input.file_path ?? input.path);

  switch (name) {
    case 'Bash': {
      const command = typeof input.command === 'string' ? input.command : '';
      return {
        name,
        title: input.description?.trim() || command || 'Run command',
        command: command || undefined,
        status: 'running',
      };
    }
    case 'Edit': {
      return {
        name,
        title: filePath || 'Edit file',
        diffs: filePath
          ? [
              {
                path: filePath,
                patch: buildUnifiedPatch(
                  filePath,
                  input.old_string ?? '',
                  input.new_string ?? '',
                ),
              },
            ]
          : undefined,
        status: 'running',
      };
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        name,
        title: filePath || 'Edit file',
        diffs: filePath
          ? edits.map((edit) => ({
              path: filePath,
              patch: buildUnifiedPatch(
                filePath,
                edit.old_string ?? '',
                edit.new_string ?? '',
              ),
            }))
          : undefined,
        status: 'running',
      };
    }
    case 'Write':
    case 'NotebookEdit': {
      return {
        name,
        title: filePath || 'Write file',
        diffs:
          filePath && typeof input.content === 'string'
            ? [
                {
                  path: filePath,
                  patch: buildUnifiedPatch(filePath, '', input.content),
                },
              ]
            : undefined,
        status: 'running',
      };
    }
    default: {
      const summary =
        filePath ||
        input.pattern ||
        input.query ||
        input.url ||
        (typeof input.prompt === 'string'
          ? input.prompt.slice(0, 80)
          : '') ||
        (typeof input.command === 'string' ? input.command : '');
      return {
        name,
        title: summary || name,
        status: 'running',
      };
    }
  }
}
