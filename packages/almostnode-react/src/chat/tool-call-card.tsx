import { useMemo, useState } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import type { FileDiffOptions, VirtualFileMetrics } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { ChatToolCall, ChatToolDiff } from '@agent-wasm/chat-core';

const DIFF_METRICS = {
  diffHeaderHeight: 32,
  fileGap: 10,
  hunkLineCount: 24,
  hunkSeparatorHeight: 28,
  lineHeight: 20,
} as unknown as VirtualFileMetrics;

function diffOptions(): FileDiffOptions<undefined> {
  const light =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.almostnodeTheme === 'light';
  return {
    diffIndicators: 'classic',
    diffStyle: 'unified',
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word',
    overflow: 'wrap',
    theme: light ? 'pierre-light' : 'pierre-dark',
    themeType: light ? 'light' : 'dark',
  };
}

function ToolDiff({ diff }: { diff: ChatToolDiff }) {
  const parsed = useMemo(() => {
    try {
      const files = parsePatchFiles(diff.patch).flatMap((patch) => patch.files);
      return { files, error: null as string | null };
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [diff.patch]);
  const options = useMemo(diffOptions, []);

  if (parsed.error || parsed.files.length === 0) {
    // Fall back to the raw patch when it isn't parseable.
    return <pre className="webide-tool-output">{diff.patch}</pre>;
  }

  return (
    <div className="webide-tool-diff">
      {parsed.files.map((fileDiff, index) => (
        <FileDiff
          key={`${fileDiff.prevName ?? ''}:${fileDiff.name}:${index}`}
          disableWorkerPool
          fileDiff={fileDiff}
          metrics={DIFF_METRICS}
          options={options}
        />
      ))}
    </div>
  );
}

const STATUS_LABELS: Record<NonNullable<ChatToolCall['status']>, string> = {
  running: 'Running',
  success: 'Done',
  error: 'Failed',
};

export function ToolCallCard({ tool }: { tool: ChatToolCall }) {
  const hasDetails = Boolean(tool.output || (tool.diffs && tool.diffs.length > 0));
  // Diffs are the point of the card — expand them by default; command output
  // stays collapsed until asked for.
  const [expanded, setExpanded] = useState(() =>
    Boolean(tool.diffs && tool.diffs.length > 0),
  );

  return (
    <div
      className={`webide-tool-card is-${tool.status ?? 'running'}`}
      data-testid="chat-tool-card"
    >
      <button
        type="button"
        className="webide-tool-card-header"
        onClick={() => hasDetails && setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="webide-tool-card-status" aria-hidden="true" />
        <span className="webide-tool-card-name">{tool.name}</span>
        <span className="webide-tool-card-title">
          {tool.command ?? tool.title}
        </span>
        <span className="webide-tool-card-state">
          {STATUS_LABELS[tool.status ?? 'running']}
        </span>
        {hasDetails ? (
          <svg
            className={`webide-tool-card-chevron${expanded ? ' is-open' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
      {expanded && tool.diffs
        ? tool.diffs.map((diff, index) => <ToolDiff key={index} diff={diff} />)
        : null}
      {expanded && tool.output ? (
        <pre className="webide-tool-output">{tool.output}</pre>
      ) : null}
    </div>
  );
}
