import { useEffect, useRef, useState, useCallback } from 'react';
import type { TemplateId } from '../features/workspace-seed';
import { WebIDEHost } from '../workbench/workbench-host';
import { ProjectManager } from '../features/project-manager';
import { ProjectSidebar } from '../sidebar/project-sidebar';
import { AwsSetupDialog } from '../sidebar/aws-setup-dialog';
import type { AwsSetupDraft } from '../features/aws-setup';
import type { DesktopBridge } from './bridge';
import type { SerializedFile } from './project-snapshot';
import { Button } from '../ui/button';

const DEBUG_STORAGE_KEY = '__almostnodeDebug';
const CORS_PROXY_STORAGE_KEY = '__corsProxyUrl';
const INTERNAL_CORS_PROXY_PATH = '/__api/cors-proxy?url=';
const SIDEBAR_COLLAPSED_KEY = 'almostnode-sidebar-collapsed';
const PROJECT_QUERY_PARAM = 'project';

function normalizeDebugSections(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((section) => section.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function getStoredDebugValue(): string | null {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function syncDebugState(raw: string | null): string[] {
  const fromQuery = raw !== null;
  const debugSections = normalizeDebugSections(fromQuery ? raw : getStoredDebugValue());
  const serialized = debugSections.join(',');

  try {
    if (fromQuery) {
      if (serialized) {
        localStorage.setItem(DEBUG_STORAGE_KEY, serialized);
      } else {
        localStorage.removeItem(DEBUG_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage failures.
  }

  if (serialized) {
    (window as { __almostnodeDebug?: string }).__almostnodeDebug = serialized;
  } else {
    delete (window as { __almostnodeDebug?: string }).__almostnodeDebug;
  }

  return debugSections;
}

function syncCorsProxyState(raw: string | undefined): void {
  const defaultProxy = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    ? `${window.location.origin}${INTERNAL_CORS_PROXY_PATH}`
    : null;
  const normalized = raw === undefined ? defaultProxy : raw.trim();

  try {
    if (normalized) {
      localStorage.setItem(CORS_PROXY_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(CORS_PROXY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage failures.
  }
}

function hasProjectQueryParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).has(PROJECT_QUERY_PARAM);
  } catch {
    return false;
  }
}

function hasProjectCreationIntentQueryParam(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has('template') || params.has('name');
  } catch {
    return false;
  }
}

export interface WorkbenchScreenProps {
  template: TemplateId;
  debug?: string;
  marketplace?: string;
  corsProxy?: string;
  initialProjectFiles?: SerializedFile[];
  skipWorkspaceSeed?: boolean;
  deferPreviewStart?: boolean;
  desktopBridge?: DesktopBridge | null;
  hostProjectDirectory?: string | null;
  agentLaunchCommand?: string | null;
  onHostReady?: (host: WebIDEHost) => void;
}

export function WorkbenchScreen({
  template,
  debug,
  marketplace,
  corsProxy,
  initialProjectFiles,
  skipWorkspaceSeed,
  deferPreviewStart,
  desktopBridge,
  hostProjectDirectory,
  agentLaunchCommand,
  onHostReady,
}: WorkbenchScreenProps) {
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const bootstrappedRef = useRef(false);
  const hostRef = useRef<WebIDEHost | null>(null);
  const managerRef = useRef<ProjectManager | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [awsSetupDraft, setAwsSetupDraft] = useState<AwsSetupDraft | null>(null);
  const [projectLaunchDialogOpen, setProjectLaunchDialogOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null | undefined>(undefined);

  // Lazily create the project manager singleton
  if (!managerRef.current) {
    managerRef.current = new ProjectManager();
  }
  const manager = managerRef.current;

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      // Trigger Monaco layout reflow both immediately and after the sidebar transition completes.
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 220);
      return next;
    });
  }, []);

  // Cmd+B / Ctrl+B keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleToggleSidebar]);

  const shouldRestoreProjectFromUrl = !initialProjectFiles && hasProjectQueryParam();
  const shouldStartWithoutProjectSeed = (
    !initialProjectFiles
    && !shouldRestoreProjectFromUrl
    && !hasProjectCreationIntentQueryParam()
  );

  useEffect(() => {
    if (bootstrappedRef.current) return;
    const workbenchElement = workbenchRef.current;
    if (!workbenchElement) return;

    const debugSections = syncDebugState(debug ?? null);
    syncCorsProxyState(corsProxy);
    const marketplaceMode = marketplace === 'mock' ? 'fixtures' : 'open-vsx';

    document.body.classList.add('ide-active');
    bootstrappedRef.current = true;

    void WebIDEHost.bootstrap({
      elements: { workbench: workbenchElement },
      debugSections,
      marketplaceMode,
      template,
      initialProjectFiles,
      skipWorkspaceSeed: skipWorkspaceSeed || shouldRestoreProjectFromUrl || shouldStartWithoutProjectSeed,
      deferPreviewStart: deferPreviewStart || shouldRestoreProjectFromUrl || shouldStartWithoutProjectSeed,
      desktopBridge: desktopBridge ?? null,
      hostProjectDirectory: hostProjectDirectory ?? null,
      agentLaunchCommand: agentLaunchCommand ?? null,
      onRequestAwsSetup: (draft) => {
        setAwsSetupDraft(draft);
      },
    }).then((host) => {
      hostRef.current = host;
      // Wire project manager to host
      manager.setHost({
        getVfs: () => host.getVfs(),
        getTemplateId: () => host.getTemplateId(),
        hasGitHubCredentials: () => host.hasGitHubCredentials(),
        requestGitHubLogin: () => host.requestGitHubLogin(),
        listGitHubRepositories: () => host.listGitHubRepositories(),
        createGitHubRemote: (projectName) => host.createGitHubRemote(projectName),
        importGitHubRepository: (repository, dbPrefix, defaultDatabaseName) =>
          host.importGitHubRepository(repository, dbPrefix, defaultDatabaseName),
        syncProjectGit: (project) => host.syncProjectGit(project),
        attachProjectContext: (tid, dbPrefix, defaultDatabaseName) =>
          host.attachProjectContext(tid, dbPrefix, defaultDatabaseName),
        switchProjectWorkspace: (tid, files, dbPrefix, defaultDatabaseName) =>
          host.switchProjectWorkspace(tid, files, dbPrefix, defaultDatabaseName),
        collectAgentStateSnapshot: () => host.collectAgentStateSnapshot(),
        restoreAgentStateSnapshot: (snapshot) =>
          host.restoreAgentStateSnapshot(snapshot),
        teardownActiveProject: () => host.teardownActiveProject(),
        discoverActiveProjectThreads: (projectId) =>
          host.discoverActiveProjectThreads(projectId),
        resumeResumableThread: (thread) => host.resumeResumableThread(thread),
      });
      host.setProjectEnvironmentController(manager);
      void manager.init();
      setHostReady(true);
      onHostReady?.(host);
    });
  }, [
    agentLaunchCommand,
    corsProxy,
    debug,
    desktopBridge,
    hostProjectDirectory,
    initialProjectFiles,
    skipWorkspaceSeed,
    deferPreviewStart,
    shouldRestoreProjectFromUrl,
    shouldStartWithoutProjectSeed,
    marketplace,
    onHostReady,
    template,
    manager,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hostReady) {
      return;
    }

    if (!activeProjectId) {
      host.setActiveProject(null);
      return;
    }

    void manager.getActiveProject().then((project) => {
      host.setActiveProject(project);
    });
  }, [activeProjectId, hostReady, manager]);

  return (
    <div className="webide-shell">
      <header className="webide-header" />
      <main className="webide-body">
        {hostReady && (
          <ProjectSidebar
            manager={manager}
            isCollapsed={sidebarCollapsed}
            onToggle={handleToggleSidebar}
            projectLaunchDialogOpen={projectLaunchDialogOpen}
            onProjectLaunchDialogOpenChange={setProjectLaunchDialogOpen}
            onActiveProjectChange={setActiveProjectId}
          />
        )}
        <div className="webide-workbench-shell">
          <div
            id="webideWorkbench"
            ref={workbenchRef}
            className={hostReady && activeProjectId === null ? 'is-background-hidden' : ''}
          />
          {hostReady && activeProjectId === null ? (
            <IDEEmptyState onOpenProjectLauncher={() => setProjectLaunchDialogOpen(true)} />
          ) : null}
        </div>
      </main>
      <AwsSetupDialog
        open={awsSetupDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAwsSetupDraft(null);
          }
        }}
        initialDraft={awsSetupDraft}
        onSave={async (draft) => {
          const host = hostRef.current;
          if (!host) {
            throw new Error('AWS setup is not ready yet.');
          }
          await host.saveAwsSetup(draft);
          setAwsSetupDraft(null);
        }}
      />
    </div>
  );
}

function IDEEmptyState({
  onOpenProjectLauncher,
}: {
  onOpenProjectLauncher: () => void;
}) {
  return (
    <div className="webide-empty-state">
      <div className="webide-empty-state__card">
        <div className="webide-empty-state__icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 7.25h4.15c.34 0 .67.14.9.38l1.32 1.4c.23.24.56.37.89.37H17A2.75 2.75 0 0 1 19.75 12v5A2.75 2.75 0 0 1 17 19.75H7A2.75 2.75 0 0 1 4.25 17V10A2.75 2.75 0 0 1 7 7.25Z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinejoin="round"
            />
            <path
              d="M12 3.75v3.5M10.25 5.5h3.5"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="webide-empty-state__copy">
          <p className="webide-empty-state__eyebrow">Workspace ready</p>
          <h2 className="webide-empty-state__title">No project selected</h2>
          <p className="webide-empty-state__description">
            Choose a project from the sidebar or start a new sandbox from scratch.
          </p>
        </div>
        <Button className="webide-empty-state__primary" onClick={onOpenProjectLauncher}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          New project
        </Button>
      </div>
    </div>
  );
}
