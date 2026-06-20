import { useState, type ReactNode } from 'react';
import type { SandboxRecord } from '../features/project-db';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface SandboxItemProps {
  sandbox: SandboxRecord;
  isActive: boolean;
  isExpanded: boolean;
  /** An agent session is running in this sandbox. */
  isRunning: boolean;
  /** The owning repo has a GitHub remote (selects Create PR vs Merge). */
  hasGitRemote: boolean;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onNewChat: (sandboxId: string) => void;
  /** GitHub-backed repos: push the branch + open a PR. */
  onCreatePr: (sandboxId: string) => void;
  /** Local-only repos: merge the branch into the default branch. */
  onMergeToMain: (sandboxId: string) => void;
  onDelete: (sandboxId: string) => void;
  children?: ReactNode;
}

/** Badge text: PR number + state once a PR exists, branch name until then. */
export function formatSandboxBadge(
  sandbox: Pick<SandboxRecord, 'branch' | 'pr'>,
): string {
  if (sandbox.pr) {
    return `PR #${sandbox.pr.number} (${sandbox.pr.state})`;
  }
  return sandbox.branch;
}

export function SandboxItem({
  sandbox,
  isActive,
  isExpanded,
  isRunning,
  hasGitRemote,
  onSelect,
  onToggleExpanded,
  onNewChat,
  onCreatePr,
  onMergeToMain,
  onDelete,
  children,
}: SandboxItemProps) {
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  return (
    <div className="almostnode-sandbox-group">
      <div
        className={`almostnode-sandbox-item ${isActive ? 'is-active' : ''}`}
        onClick={() => onSelect(sandbox.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenuPosition({ x: event.clientX, y: event.clientY });
        }}
      >
        <button
          className="almostnode-project-item__chevron"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(sandbox.id);
          }}
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={isExpanded ? 'is-expanded' : ''}
          >
            <path
              d="m6 3 5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <BranchIcon />

        <span className="almostnode-sandbox-item__name">{sandbox.name}</span>
        <span
          className={`almostnode-sandbox-item__badge ${sandbox.pr ? 'is-pr' : ''}`}
          title={sandbox.pr ? sandbox.pr.url : sandbox.branch}
        >
          {formatSandboxBadge(sandbox)}
        </span>

        {isRunning && (
          <span
            className="almostnode-sidebar__row-spinner"
            role="status"
            aria-label={`Agent running in ${sandbox.name}`}
          />
        )}

        <button
          className="almostnode-project-item__menu-trigger"
          onClick={(event) => {
            event.stopPropagation();
            onNewChat(sandbox.id);
          }}
          type="button"
          aria-label={`New chat in ${sandbox.name}`}
          title="New chat"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3.5v9M3.5 8h9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {contextMenuPosition && (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setContextMenuPosition(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            {/* Invisible anchor at the cursor so the menu opens in place. */}
            <span
              aria-hidden="true"
              style={{
                position: 'fixed',
                left: contextMenuPosition.x,
                top: contextMenuPosition.y,
                width: 0,
                height: 0,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={0}>
            <DropdownMenuItem onSelect={() => onNewChat(sandbox.id)}>
              New chat
            </DropdownMenuItem>
            {hasGitRemote ? (
              <DropdownMenuItem onSelect={() => onCreatePr(sandbox.id)}>
                {sandbox.pr ? 'Update PR' : 'Create PR'}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onMergeToMain(sandbox.id)}>
                Merge to main
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onDelete(sandbox.id)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isExpanded ? children : null}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flex: 'none', opacity: 0.6 }}>
      <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4.5 5.1v5.8M11.5 6.6c0 2.4-2.4 3.2-4.6 3.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
