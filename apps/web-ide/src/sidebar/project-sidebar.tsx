import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { ProjectList } from './project-list';
import { agentSessionRegistry, type ActiveAgentSession } from '@agent-wasm/chat-core';
import { computeRunningAgentState } from './running-agents';
import { FORK_REQUESTED_EVENT, forkRepoIntoSandbox, type ForkRequestDetail } from './fork-on-edit';
import { NewProjectDialog } from './new-project-dialog';
import { Button } from '@agent-wasm/react/ui';
import { TooltipProvider } from '@agent-wasm/react/ui';
import { ProjectManager } from '../features/project-manager';
import type { GitHubRepositorySummary } from '../features/github-repositories';
import type { TemplateId } from '../features/workspace-seed';
import './sidebar.css';

const EXPANDED_REPOS_KEY = 'almostnode-expanded-project-ids';
const EXPANDED_SANDBOXES_KEY = 'almostnode-expanded-sandbox-ids';
/** Safety-net poll: isRunning() flips via abort controller without notify. */
const RUNNING_AGENTS_POLL_MS = 2000;

function readExpandedIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeExpandedIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Ignore storage failures.
  }
}

interface SidebarInnerProps {
  manager: ProjectManager;
  projectLaunchDialogOpen: boolean;
  onProjectLaunchDialogOpenChange: (open: boolean) => void;
  onActiveProjectChange?: (projectId: string | null) => void;
  /** Reports the active thread's title (null when no thread is selected). */
  onActiveThreadChange?: (title: string | null) => void;
}

function SidebarInner({
  manager,
  projectLaunchDialogOpen,
  onProjectLaunchDialogOpenChange,
  onActiveProjectChange,
  onActiveThreadChange,
}: SidebarInnerProps) {
  const { state, dispatch } = useSidebar();
  const [hasGitHubCredentials, setHasGitHubCredentials] = useState(() => manager.hasGitHubCredentials());
  // Fork-on-edit fires on every refused write; only one fork at a time.
  const forkInFlightRef = useRef(false);
  // Create PR / Merge to main run git sequences — one per sandbox at a time.
  const sandboxActionInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    manager.setCallbacks({
      onProjectsChanged: (projects) => dispatch({ type: 'SET_REPOS', repos: projects }),
      onActiveProjectChanged: (projectId) => {
        dispatch({ type: 'SET_ACTIVE_REPO', repoId: projectId });
        onActiveProjectChange?.(projectId);
      },
      onResumableThreadsChanged: (threads) => dispatch({ type: 'SET_RESUMABLE_THREADS', threads }),
      onSwitchingStateChanged: (isSwitching) => dispatch({ type: 'SET_SWITCHING', isSwitching }),
      onSandboxesChanged: (sandboxesByRepo) => dispatch({ type: 'SET_SANDBOXES', sandboxesByRepo }),
      // Covers switches the sidebar didn't initiate (legacy-thread resume
      // forks, sandbox deletion) so the selection highlight tracks the
      // workbench.
      onActiveSandboxChanged: (sandboxId) =>
        dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId }),
    });
  }, [manager, dispatch, onActiveProjectChange]);

  useEffect(() => {
    dispatch({ type: 'SET_EXPANDED_REPOS', repoIds: readExpandedIds(EXPANDED_REPOS_KEY) });
    dispatch({ type: 'SET_EXPANDED_SANDBOXES', sandboxIds: readExpandedIds(EXPANDED_SANDBOXES_KEY) });
  }, [dispatch]);

  // Initial load: callbacks only fire on changes, so pull the current
  // sandbox listing (and the sandbox the workbench already shows) once.
  useEffect(() => {
    void manager
      .getSandboxesGroupedByRepo()
      .then((sandboxesByRepo) => dispatch({ type: 'SET_SANDBOXES', sandboxesByRepo }))
      .catch(() => {});
    const activeSandboxId = manager.getActiveSandboxId();
    if (activeSandboxId) {
      dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId: activeSandboxId });
    }
  }, [manager, dispatch]);

  // Discover chats for every known sandbox (live sessions read their VFS,
  // dormant ones their snapshot). Keyed by the id set so lastActive bumps
  // don't re-trigger discovery.
  const sandboxIdsKey = useMemo(
    () =>
      Object.values(state.sandboxesByRepo)
        .flat()
        .map((sandbox) => sandbox.id)
        .sort()
        .join('\n'),
    [state.sandboxesByRepo],
  );

  useEffect(() => {
    if (!sandboxIdsKey) return;
    let cancelled = false;
    void (async () => {
      for (const sandboxId of sandboxIdsKey.split('\n')) {
        if (cancelled) return;
        try {
          await manager.discoverSandboxThreads(sandboxId);
        } catch {
          // A sandbox without a snapshot yet has no chats to discover.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sandboxIdsKey, manager]);

  // Running-agent spinners: registry notifications plus a poll, since a
  // session's isRunning() can flip without a registry notify.
  useEffect(() => {
    let latestSessions: ActiveAgentSession[] = [];
    const update = () => {
      const { runningSandboxIds, runningThreadKeys } = computeRunningAgentState(latestSessions);
      dispatch({ type: 'SET_RUNNING_AGENTS', runningSandboxIds, runningThreadKeys });
    };
    const unsubscribe = agentSessionRegistry.subscribeAll((sessions) => {
      latestSessions = sessions;
      update();
    });
    const interval = setInterval(update, RUNNING_AGENTS_POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [dispatch]);

  // Fork-on-edit: the host refused a write/launch on a read-only repo base.
  useEffect(() => {
    const handleForkRequested = (event: Event) => {
      const repoId = (event as CustomEvent<ForkRequestDetail>).detail?.repoId;
      if (!repoId || forkInFlightRef.current) {
        return;
      }
      forkInFlightRef.current = true;
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      onActiveThreadChange?.(null);
      void forkRepoIntoSandbox(manager, repoId)
        .then((sandbox) => {
          dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId: sandbox.id });
        })
        .catch((error) => {
          console.error('[sidebar] fork-on-edit failed', error);
        })
        .finally(() => {
          forkInFlightRef.current = false;
        });
    };
    window.addEventListener(FORK_REQUESTED_EVENT, handleForkRequested);
    return () => window.removeEventListener(FORK_REQUESTED_EVENT, handleForkRequested);
  }, [manager, dispatch, onActiveThreadChange]);

  // Keep the active repo and sandbox visible.
  useEffect(() => {
    if (!state.activeRepoId || state.expandedRepoIds.includes(state.activeRepoId)) {
      return;
    }
    dispatch({
      type: 'SET_EXPANDED_REPOS',
      repoIds: [...state.expandedRepoIds, state.activeRepoId],
    });
  }, [state.activeRepoId, state.expandedRepoIds, dispatch]);

  useEffect(() => {
    if (!state.activeSandboxId || state.expandedSandboxIds.includes(state.activeSandboxId)) {
      return;
    }
    dispatch({
      type: 'SET_EXPANDED_SANDBOXES',
      sandboxIds: [...state.expandedSandboxIds, state.activeSandboxId],
    });
  }, [state.activeSandboxId, state.expandedSandboxIds, dispatch]);

  useEffect(() => {
    writeExpandedIds(EXPANDED_REPOS_KEY, state.expandedRepoIds);
  }, [state.expandedRepoIds]);

  useEffect(() => {
    writeExpandedIds(EXPANDED_SANDBOXES_KEY, state.expandedSandboxIds);
  }, [state.expandedSandboxIds]);

  useEffect(() => {
    if (!projectLaunchDialogOpen) {
      return;
    }
    setHasGitHubCredentials(manager.hasGitHubCredentials());
  }, [manager, projectLaunchDialogOpen]);

  // Clicking a repo row opens it for work: its most recent sandbox, with
  // the first one auto-created. Main itself never opens writable.
  const handleSelectRepo = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      onActiveThreadChange?.(null);
      void manager
        .openRepo(id)
        .then(() => {
          const sandboxId = manager.getActiveSandboxId?.() ?? null;
          dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId });
        })
        .catch((error) => console.error('[sidebar] failed to open repo', error));
    },
    [dispatch, manager, onActiveThreadChange],
  );

  const handleToggleRepo = useCallback(
    (id: string) => {
      dispatch({ type: 'TOGGLE_REPO_EXPANDED', repoId: id });
    },
    [dispatch],
  );

  const handleRenameRepo = useCallback(
    (id: string, name: string) => {
      void manager.renameProject(id, name);
    },
    [manager],
  );

  const handleDeleteRepo = useCallback(
    (id: string) => {
      void manager.deleteProject(id);
    },
    [manager],
  );

  // "+" on a repo row: fork a sandbox from main and open it.
  const handleCreateSandbox = useCallback(
    (repoId: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      onActiveThreadChange?.(null);
      agentSessionRegistry.deactivate();
      void forkRepoIntoSandbox(manager, repoId)
        .then((sandbox) => {
          dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId: sandbox.id });
        })
        .catch((error) => console.error('[sidebar] failed to create sandbox', error));
    },
    [dispatch, manager, onActiveThreadChange],
  );

  const handleSelectSandbox = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      onActiveThreadChange?.(null);
      if (id === state.activeSandboxId) {
        return;
      }
      void manager
        .switchToSandbox(id)
        .then(() => dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId: id }))
        .catch(async (error) => {
          // A silently failed switch leaves the previous sandbox's code on
          // screen — indistinguishable from "switching is broken" unless
          // the failure is surfaced.
          console.error('[sidebar] failed to open sandbox', error);
          const toast = await import('../features/toast');
          toast.showSandboxActionErrorToast(
            'Failed to open sandbox',
            error instanceof Error ? error.message : String(error),
          );
        });
    },
    [dispatch, manager, onActiveThreadChange, state.activeSandboxId],
  );

  const handleToggleSandbox = useCallback(
    (id: string) => {
      const expanding = !state.expandedSandboxIds.includes(id);
      dispatch({ type: 'TOGGLE_SANDBOX_EXPANDED', sandboxId: id });
      if (expanding) {
        // Lazy PR-state refresh: a no-op unless the sandbox has a PR and a
        // live session can run `gh pr view`.
        void manager.refreshSandboxPrState(id).catch(() => {});
      }
    },
    [dispatch, manager, state.expandedSandboxIds],
  );

  const runSandboxAction = useCallback(
    (sandboxId: string, action: () => Promise<void>) => {
      if (sandboxActionInFlightRef.current.has(sandboxId)) {
        return;
      }
      sandboxActionInFlightRef.current.add(sandboxId);
      void action().finally(() => {
        sandboxActionInFlightRef.current.delete(sandboxId);
      });
    },
    [],
  );

  // "Create PR" on a sandbox of a GitHub-backed repo: commit-if-dirty,
  // push the branch, open the PR; the badge updates via onSandboxesChanged.
  const handleCreatePr = useCallback(
    (sandboxId: string) => {
      runSandboxAction(sandboxId, async () => {
        const toast = await import('../features/toast');
        try {
          const pr = await manager.createPrForSandbox(sandboxId);
          toast.showSandboxActionSuccessToast(`PR #${pr.number} ready`, pr.url);
        } catch (error) {
          console.error('[sidebar] failed to create PR', error);
          toast.showSandboxActionErrorToast(
            'Failed to create PR',
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    },
    [manager, runSandboxAction],
  );

  // "Merge to main" on a sandbox of a local-only repo.
  const handleMergeToMain = useCallback(
    (sandboxId: string) => {
      runSandboxAction(sandboxId, async () => {
        const toast = await import('../features/toast');
        try {
          await manager.mergeSandboxToMain(sandboxId);
          toast.showSandboxActionSuccessToast('Merged to main');
        } catch (error) {
          console.error('[sidebar] merge to main failed', error);
          toast.showSandboxActionErrorToast(
            'Merge failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    },
    [manager, runSandboxAction],
  );

  const handleDeleteSandbox = useCallback(
    (sandboxId: string) => {
      runSandboxAction(sandboxId, async () => {
        try {
          await manager.deleteSandbox(sandboxId);
        } catch (error) {
          console.error('[sidebar] failed to delete sandbox', error);
          const toast = await import('../features/toast');
          toast.showSandboxActionErrorToast(
            'Failed to delete sandbox',
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    },
    [manager, runSandboxAction],
  );

  const handleCreateProject = useCallback(
    async (
      name: string,
      templateId: TemplateId,
      options: { createGitHubRepo: boolean },
    ) => {
      const project = await manager.createProject(name, templateId, options);
      dispatch({
        type: 'SET_EXPANDED_REPOS',
        repoIds: Array.from(new Set([...state.expandedRepoIds, project.id])),
      });
      // Lands in the repo's first auto-created sandbox; openRepo also
      // promotes the template-seeded workspace to the repo base snapshot.
      await manager.openRepo(project.id);
    },
    [dispatch, manager, state.expandedRepoIds],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: id });
      const sandboxChats = Object.entries(state.chatsBySandbox);
      let owningSandboxId: string | null = null;
      let thread = Object.values(state.legacyRepoThreads)
        .flat()
        .find((candidate) => candidate.id === id);
      if (!thread) {
        for (const [sandboxId, chats] of sandboxChats) {
          const match = chats.find((candidate) => candidate.id === id);
          if (match) {
            thread = match;
            owningSandboxId = sandboxId;
            break;
          }
        }
      }
      onActiveThreadChange?.(thread?.title?.trim() || null);
      void (async () => {
        // Sandbox chats resume inside their sandbox's session — switch (or
        // re-attach) it first; resumeThread only knows repo-level
        // switching. Compare against the MANAGER's active sandbox, not the
        // sidebar's render-captured copy: a stale guard here resumes the
        // chat into whatever sandbox is foreground, which then shows the
        // wrong sandbox's code.
        const activeSandboxId =
          manager.getActiveSandboxId?.() ?? state.activeSandboxId;
        if (owningSandboxId && owningSandboxId !== activeSandboxId) {
          await manager.switchToSandbox(owningSandboxId);
          dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId: owningSandboxId });
        }
        await manager.resumeThread(id);
      })().catch(async (error) => {
        console.error('[sidebar] failed to resume thread', error);
        const toast = await import('../features/toast');
        toast.showSandboxActionErrorToast(
          'Failed to resume chat',
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [
      dispatch,
      manager,
      onActiveThreadChange,
      state.chatsBySandbox,
      state.legacyRepoThreads,
      state.activeSandboxId,
    ],
  );

  // "+" on a sandbox row: start a fresh chat there — detach the chat from
  // the running session so the next message launches a new one.
  const handleNewChat = useCallback(
    (sandboxId: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      onActiveThreadChange?.(null);
      agentSessionRegistry.startNewChat(sandboxId);
      // Manager truth, not the render-captured sidebar copy: a stale guard
      // would start the chat in whatever sandbox is actually foreground.
      const activeSandboxId =
        manager.getActiveSandboxId?.() ?? state.activeSandboxId;
      if (sandboxId !== activeSandboxId) {
        void manager
          .switchToSandbox(sandboxId)
          .then(() => dispatch({ type: 'SET_ACTIVE_SANDBOX', sandboxId }))
          .catch(async (error) => {
            console.error('[sidebar] failed to open sandbox', error);
            const toast = await import('../features/toast');
            toast.showSandboxActionErrorToast(
              'Failed to open sandbox',
              error instanceof Error ? error.message : String(error),
            );
          });
      }
    },
    [dispatch, manager, onActiveThreadChange, state.activeSandboxId],
  );

  const handleGitHubLogin = useCallback(async () => {
    await manager.requestGitHubLogin();
    const nextHasGitHubCredentials = manager.hasGitHubCredentials();
    setHasGitHubCredentials(nextHasGitHubCredentials);
    if (!nextHasGitHubCredentials) {
      throw new Error('GitHub login did not complete. Finish `gh auth login` in the terminal and try again.');
    }
  }, [manager]);

  const handleLoadGitHubRepositories = useCallback(
    () => manager.listGitHubRepositories(),
    [manager],
  );

  const handleImportGitHubRepository = useCallback(
    async (repository: GitHubRepositorySummary) => {
      dispatch({ type: 'SET_ACTIVE_CHAT', chatId: null });
      const project = await manager.importGitHubRepository(repository);
      dispatch({
        type: 'SET_EXPANDED_REPOS',
        repoIds: Array.from(new Set([...state.expandedRepoIds, project.id])),
      });
    },
    [dispatch, manager, state.expandedRepoIds],
  );

  return (
    <div className={`almostnode-project-sidebar ${state.isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="almostnode-sidebar__header">
        <span className="almostnode-sidebar__title">Projects</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <Button
            variant="ghost"
            size="icon"
            style={{ width: '1.6rem', height: '1.6rem' }}
            aria-label="Create or import project"
            onClick={() => onProjectLaunchDialogOpenChange(true)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>

      <ProjectList
        onSelectRepo={handleSelectRepo}
        onToggleRepo={handleToggleRepo}
        onRenameRepo={handleRenameRepo}
        onDeleteRepo={handleDeleteRepo}
        onCreateSandbox={handleCreateSandbox}
        onSelectSandbox={handleSelectSandbox}
        onToggleSandbox={handleToggleSandbox}
        onNewChat={handleNewChat}
        onSelectThread={handleSelectThread}
        onCreatePr={handleCreatePr}
        onMergeToMain={handleMergeToMain}
        onDeleteSandbox={handleDeleteSandbox}
      />

      {state.isSwitching && (
        <div className="almostnode-sidebar__switching-overlay">
          <div className="almostnode-sidebar__switching-spinner" />
        </div>
      )}

      <NewProjectDialog
        open={projectLaunchDialogOpen}
        onOpenChange={onProjectLaunchDialogOpenChange}
        hasGitHubCredentials={hasGitHubCredentials}
        onCreate={handleCreateProject}
        onLogin={handleGitHubLogin}
        onLoadRepositories={handleLoadGitHubRepositories}
        onImport={handleImportGitHubRepository}
      />
    </div>
  );
}

export interface ProjectSidebarProps {
  manager: ProjectManager;
  isCollapsed: boolean;
  projectLaunchDialogOpen: boolean;
  onProjectLaunchDialogOpenChange: (open: boolean) => void;
  onActiveProjectChange?: (projectId: string | null) => void;
  onActiveThreadChange?: (title: string | null) => void;
}

export function ProjectSidebar({
  manager,
  isCollapsed,
  projectLaunchDialogOpen,
  onProjectLaunchDialogOpenChange,
  onActiveProjectChange,
  onActiveThreadChange,
}: ProjectSidebarProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SidebarSyncCollapsed isCollapsed={isCollapsed} />
        <SidebarInner
          manager={manager}
          projectLaunchDialogOpen={projectLaunchDialogOpen}
          onProjectLaunchDialogOpenChange={onProjectLaunchDialogOpenChange}
          onActiveProjectChange={onActiveProjectChange}
          onActiveThreadChange={onActiveThreadChange}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function SidebarSyncCollapsed({ isCollapsed }: { isCollapsed: boolean }) {
  const { dispatch } = useSidebar();
  useEffect(() => {
    dispatch({ type: 'SET_COLLAPSED', collapsed: isCollapsed });
  }, [isCollapsed, dispatch]);
  return null;
}
