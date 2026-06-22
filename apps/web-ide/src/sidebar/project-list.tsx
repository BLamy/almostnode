import { useMemo } from 'react';
import { ScrollArea } from '@agent-wasm/react/ui';
import { useSidebar } from './sidebar-context';
import { ProjectItem } from './project-item';
import { SandboxItem } from './sandbox-item';
import { ResumableThreadItem } from './resumable-thread-item';
import { isThreadRunning } from './running-agents';
import { groupSidebarProjects } from './github-projects';
import type { ProjectRecord, ResumableThreadRecord } from '../features/project-db';

interface ProjectListProps {
  onSelectRepo: (id: string) => void;
  onToggleRepo: (id: string) => void;
  onRenameRepo: (id: string, name: string) => void;
  onDeleteRepo: (id: string) => void;
  onCreateSandbox: (repoId: string) => void;
  onSelectSandbox: (id: string) => void;
  onToggleSandbox: (id: string) => void;
  onNewChat: (sandboxId: string) => void;
  onSelectThread: (id: string) => void;
  onCreatePr: (sandboxId: string) => void;
  onMergeToMain: (sandboxId: string) => void;
  onDeleteSandbox: (sandboxId: string) => void;
}

export function ProjectList({
  onSelectRepo,
  onToggleRepo,
  onRenameRepo,
  onDeleteRepo,
  onCreateSandbox,
  onSelectSandbox,
  onToggleSandbox,
  onNewChat,
  onSelectThread,
  onCreatePr,
  onMergeToMain,
  onDeleteSandbox,
}: ProjectListProps) {
  const { state } = useSidebar();
  // Only imported repos are listed — un-imported GitHub repositories are
  // added through the New Project dialog, never shown here.
  const groups = useMemo(
    () => groupSidebarProjects(state.repos, null),
    [state.repos],
  );

  const renderThread = (thread: ResumableThreadRecord) => (
    <ResumableThreadItem
      key={thread.id}
      thread={thread}
      isActive={thread.id === state.activeChatId}
      isRunning={isThreadRunning(thread, state.runningThreadKeys)}
      onSelect={onSelectThread}
    />
  );

  const renderRepo = (repo: ProjectRecord) => {
    const sandboxes = state.sandboxesByRepo[repo.id] ?? [];
    const legacyThreads = state.legacyRepoThreads[repo.id] ?? [];
    const isExpanded = state.expandedRepoIds.includes(repo.id);
    const isRepoRunning = sandboxes.some((sandbox) =>
      state.runningSandboxIds.includes(sandbox.id),
    );
    return (
      <ProjectItem
        key={repo.id}
        project={repo}
        isActive={repo.id === state.activeRepoId && !state.activeSandboxId}
        isExpanded={isExpanded}
        isRunning={isRepoRunning}
        onSelect={onSelectRepo}
        onToggleExpanded={onToggleRepo}
        onRename={onRenameRepo}
        onDelete={onDeleteRepo}
        onNewSandbox={onCreateSandbox}
      >
        <div className="almostnode-project-group__threads">
          {sandboxes.length === 0 && legacyThreads.length === 0 && (
            <div className="almostnode-project-group__empty">No sandboxes</div>
          )}
          {sandboxes.map((sandbox) => {
            const chats = state.chatsBySandbox[sandbox.id] ?? [];
            return (
              <SandboxItem
                key={sandbox.id}
                sandbox={sandbox}
                isActive={sandbox.id === state.activeSandboxId}
                isExpanded={state.expandedSandboxIds.includes(sandbox.id)}
                isRunning={state.runningSandboxIds.includes(sandbox.id)}
                hasGitRemote={Boolean(repo.gitRemote)}
                onSelect={onSelectSandbox}
                onToggleExpanded={onToggleSandbox}
                onNewChat={onNewChat}
                onCreatePr={onCreatePr}
                onMergeToMain={onMergeToMain}
                onDelete={onDeleteSandbox}
              >
                <div className="almostnode-sandbox-group__chats">
                  {chats.length === 0 ? (
                    <div className="almostnode-project-group__empty is-nested">
                      No chats
                    </div>
                  ) : (
                    chats.map(renderThread)
                  )}
                </div>
              </SandboxItem>
            );
          })}
          {legacyThreads.map(renderThread)}
        </div>
      </ProjectItem>
    );
  };

  return (
    <ScrollArea style={{ flex: '1 1 0', minHeight: 0 }}>
      <div className="almostnode-project-list">
        <div className="almostnode-sidebar-section" data-testid="github-section">
          <div className="almostnode-sidebar-section__header">
            <span className="almostnode-sidebar-section__title">GitHub</span>
          </div>
          {groups.unlistedGitHubProjects.length === 0 ? (
            <div className="almostnode-project-group__empty">
              Import repositories from the New project dialog.
            </div>
          ) : (
            groups.unlistedGitHubProjects.map(renderRepo)
          )}
        </div>

        <div className="almostnode-sidebar-section" data-testid="no-source-control-section">
          <div className="almostnode-sidebar-section__header">
            <span className="almostnode-sidebar-section__title">No source control</span>
          </div>
          {groups.noSourceControl.length === 0 ? (
            <div className="almostnode-project-group__empty">
              Local-only projects appear here.
            </div>
          ) : (
            groups.noSourceControl.map(renderRepo)
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
