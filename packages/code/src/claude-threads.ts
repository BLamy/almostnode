// Claude Code transcript/thread primitives. Pure helpers shared by the
// transcript tail/adapter here and the demo's multi-agent thread discovery.

/** VFS root where Claude Code persists its per-project JSONL transcripts. */
export const CLAUDE_PROJECTS_ROOT = '/home/user/.claude/projects';

/** Flatten a Claude message `content` field (string | parts[] | object) to text. */
export function extractClaudeMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join(' ')
      .trim();
  }

  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') {
    return content.text.trim();
  }

  return '';
}
