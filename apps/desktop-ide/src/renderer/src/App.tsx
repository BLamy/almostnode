import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopBridge } from '@webide/desktop/bridge';
import { getDesktopBridge } from '@webide/desktop/bridge';
import { ProjectMirrorService, type HostProjectFileChangedPayload } from '@webide/desktop/project-mirror';
import type { SerializedFile } from '@webide/desktop/project-snapshot';
import { WorkbenchScreen } from '@webide/desktop/workbench-screen';
import type { TemplateId } from '@webide/features/workspace-seed';
import type { WebIDEHost } from '@webide/workbench/workbench-host';

type WindowRole = 'splash' | 'project';

type BootstrapIntent =
  | { kind: 'workspace'; projectId: string }
  | { kind: 'template'; templateId: TemplateId }
  | null;

interface RecentProjectItem {
  id: string;
  title: string;
  templateId: TemplateId;
  lastOpenedAt: string;
  projectId: string;
  projectDirectory: string;
}

interface LoadedProjectPayload {
  projectId: string;
  projectDirectory: string;
  templateId: TemplateId;
  title: string;
}

interface ProjectBootstrapState {
  projectId: string;
  projectDirectory: string;
  templateId: TemplateId;
  initialFiles: SerializedFile[];
  hydrateFromDisk: boolean;
}

function updateBootstrapPhase(setPhase: (value: string) => void, value: string): void {
  console.log(`[desktop-bootstrap] ${value}`);
  setPhase(value);
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function normalizeBootstrapIntent(value: unknown): BootstrapIntent {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'workspace' && typeof record.projectId === 'string') {
    return { kind: 'workspace', projectId: record.projectId };
  }
  if (
    record.kind === 'template'
    && (record.templateId === 'vite' || record.templateId === 'nextjs' || record.templateId === 'tanstack')
  ) {
    return { kind: 'template', templateId: record.templateId };
  }
  return null;
}

function SplashScreen({
  projectRoot,
  recents,
  onChooseProjectRoot,
  onOpenRecent,
  onCreateProject,
}: {
  projectRoot: string | null;
  recents: RecentProjectItem[];
  onChooseProjectRoot: () => void;
  onOpenRecent: (projectId: string) => void;
  onCreateProject: (templateId: TemplateId) => void;
}) {
  return (
    <div className="desktop-splash">
      <section className="desktop-panel">
        <div className="desktop-eyebrow">almostnode desktop</div>
        <h1 className="desktop-title">Persisted projects with host-side agents.</h1>
        <p className="desktop-subtitle">
          Projects live on your filesystem, reopen from recents, and load into the in-memory VFS when a project window boots.
        </p>

        <div className="desktop-actions">
          <button type="button" className="desktop-button desktop-button--primary" onClick={onChooseProjectRoot}>
            {projectRoot ? 'Change Project Root' : 'Choose Project Root'}
          </button>
          <div className="desktop-inline-meta">
            <span>Project root:</span>
            <span>{projectRoot ?? 'Not configured yet'}</span>
          </div>
        </div>

        <div>
          <div className="desktop-eyebrow">New project</div>
          <div className="desktop-template-grid">
            <button type="button" className="desktop-button" onClick={() => onCreateProject('vite')}>
              Vite
            </button>
            <button type="button" className="desktop-button" onClick={() => onCreateProject('nextjs')}>
              Next.js
            </button>
            <button type="button" className="desktop-button" onClick={() => onCreateProject('tanstack')}>
              TanStack
            </button>
          </div>
        </div>
      </section>

      <section className="desktop-panel desktop-recents">
        <div className="desktop-eyebrow">Recent projects</div>
        {recents.length === 0 ? (
          <div className="desktop-empty">
            Create a project to start building a local recent-project library.
          </div>
        ) : (
          <div className="desktop-recents-list">
            {recents.map((item) => (
              <button
                key={item.id}
                type="button"
                className="desktop-recent-card"
                onClick={() => onOpenRecent(item.projectId)}
              >
                <span className="desktop-recent-title">{item.title}</span>
                <span className="desktop-recent-meta">
                  {item.templateId} · {formatTimestamp(item.lastOpenedAt)}
                </span>
                <span className="desktop-recent-meta">{item.projectDirectory}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function App(): ReactElement {
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [windowRole, setWindowRole] = useState<WindowRole | null>(null);
  const [bootstrapIntent, setBootstrapIntent] = useState<BootstrapIntent>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentProjectItem[]>([]);
  const [projectState, setProjectState] = useState<ProjectBootstrapState | null>(null);
  const [host, setHost] = useState<WebIDEHost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapPhase, setBootstrapPhase] = useState('Starting desktop bootstrap…');
  const hostRef = useRef<WebIDEHost | null>(null);
  const mirrorRef = useRef<ProjectMirrorService | null>(null);
  const almostnodeBridgeBoundRef = useRef(false);
  const splashRecentsLoadedRef = useRef(false);
  const projectBootstrapKeyRef = useRef<string | null>(null);

  const refreshRecents = useCallback(async () => {
    if (!bridge) return;
    const nextRecents = await bridge.invoke<RecentProjectItem[]>('project-library:list');
    setRecents(Array.isArray(nextRecents) ? nextRecents : []);
  }, [bridge]);

  useEffect(() => {
    if (almostnodeBridgeBoundRef.current) return;
    if (typeof window === 'undefined' || !window.almostnodeBridge) return;

    almostnodeBridgeBoundRef.current = true;
    window.almostnodeBridge.onRequest((requestId, operation, params) => {
      void (async () => {
        try {
          const host = hostRef.current;
          if (!host) {
            throw new Error('almostnode workbench host is not ready yet.');
          }

          switch (operation) {
            case 'run-command': {
              const result = await host.executeBridgedCommand(params);
              window.almostnodeBridge?.sendResponse(requestId, null, result);
              return;
            }
            default:
              throw new Error(`Unsupported almostnode bridge operation: ${operation}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          window.almostnodeBridge?.sendResponse(requestId, message, null);
        }
      })();
    });
  }, []);

  useEffect(() => {
    if (!bridge) {
      updateBootstrapPhase(setBootstrapPhase, 'Desktop bridge is unavailable.');
      setError('Desktop bridge is unavailable.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const unsubscribeProjectRoot = bridge.on<string>('project-root:updated', (value: string) => {
      setProjectRoot(typeof value === 'string' ? value : null);
      void refreshRecents();
    });

    void (async () => {
      try {
        updateBootstrapPhase(setBootstrapPhase, 'Loading desktop window role and bootstrap state…');
        const [rolePayload, bootstrapPayload, rootDirectory] = await Promise.all([
          withTimeout(bridge.invoke<{ role?: WindowRole }>('project-window:get-role'), 'project-window:get-role'),
          withTimeout(bridge.invoke('project-window:get-bootstrap'), 'project-window:get-bootstrap'),
          withTimeout(bridge.invoke<string | null>('project-root:get'), 'project-root:get'),
        ]);

        if (cancelled) return;

        setWindowRole(rolePayload?.role === 'project' ? 'project' : 'splash');
        setBootstrapIntent(normalizeBootstrapIntent(bootstrapPayload));
        setProjectRoot(typeof rootDirectory === 'string' ? rootDirectory : null);
        updateBootstrapPhase(
          setBootstrapPhase,
          rolePayload?.role === 'project'
            ? 'Desktop project window identified.'
            : 'Desktop splash window identified.',
        );
      } catch (err) {
        if (cancelled) return;
        updateBootstrapPhase(setBootstrapPhase, 'Desktop bootstrap failed.');
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeProjectRoot();
    };
  }, [bridge, refreshRecents]);

  useEffect(() => {
    if (!bridge || !windowRole) return;

    if (windowRole === 'splash') {
      if (splashRecentsLoadedRef.current) {
        return;
      }
      splashRecentsLoadedRef.current = true;
      updateBootstrapPhase(setBootstrapPhase, 'Loading recent projects…');
      void refreshRecents();
      return;
    }

    if (!bootstrapIntent) {
      updateBootstrapPhase(setBootstrapPhase, 'Project bootstrap data is unavailable.');
      setError('Project bootstrap data is unavailable.');
      return;
    }

    const bootstrapKey = bootstrapIntent.kind === 'workspace'
      ? `workspace:${bootstrapIntent.projectId}`
      : `template:${bootstrapIntent.templateId}`;
    if (projectBootstrapKeyRef.current === bootstrapKey) {
      return;
    }
    projectBootstrapKeyRef.current = bootstrapKey;

    let cancelled = false;
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        if (bootstrapIntent.kind === 'workspace') {
          updateBootstrapPhase(setBootstrapPhase, `Loading workspace ${bootstrapIntent.projectId} from disk…`);
          const payload = await withTimeout(bridge.invoke<LoadedProjectPayload>('project-files:load', {
            projectId: bootstrapIntent.projectId,
          }), 'project-files:load');
          if (cancelled) return;
          setProjectState({
            projectId: payload.projectId,
            projectDirectory: payload.projectDirectory,
            templateId: payload.templateId,
            initialFiles: [],
            hydrateFromDisk: true,
          });
          updateBootstrapPhase(setBootstrapPhase, `Workspace ${payload.projectId} loaded into the desktop renderer.`);
          return;
        }

        updateBootstrapPhase(setBootstrapPhase, `Creating ${bootstrapIntent.templateId} workspace…`);
        const created = await withTimeout(bridge.invoke<{ projectId: string; projectDirectory: string }>('project-session:start', {
          templateId: bootstrapIntent.templateId,
        }), 'project-session:start', 60_000);
        if (cancelled) return;
        setProjectState({
          projectId: created.projectId,
          projectDirectory: created.projectDirectory,
          templateId: bootstrapIntent.templateId,
          initialFiles: [],
          hydrateFromDisk: false,
        });
        updateBootstrapPhase(setBootstrapPhase, `Workspace ${created.projectId} created.`);
      } catch (err) {
        if (!cancelled) {
          updateBootstrapPhase(setBootstrapPhase, 'Project bootstrap failed.');
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapIntent, bridge, refreshRecents, windowRole]);

  useEffect(() => {
    if (!bridge || !projectState || !host) return;

    const mirror = new ProjectMirrorService(host.container.vfs, bridge, projectState.initialFiles);
    mirror.start();
    void mirror.flushNow();
    mirrorRef.current = mirror;

    const unsubscribeFileChanged = bridge.on<HostProjectFileChangedPayload>('project-directory:file-changed', (payload: HostProjectFileChangedPayload) => {
      mirror.applyHostChange(payload);
    });
    const unsubscribeWatchError = bridge.on<{ message?: string }>('project-directory:watch-error', (payload: { message?: string }) => {
      const message = typeof payload?.message === 'string' ? payload.message : 'Unknown project watch error';
      console.error(`[Project Watcher] ${message}`);
    });

    void (async () => {
      if (projectState.hydrateFromDisk) {
        updateBootstrapPhase(setBootstrapPhase, `Hydrating ${projectState.projectId} into the VFS…`);
        await bridge.invoke('project-files:hydrate-active');
        updateBootstrapPhase(setBootstrapPhase, `Hydration finished for ${projectState.projectId}.`);
        host.ensurePreviewReady();
      }

      await bridge.invoke('project-directory:watch-active');
    })();

    return () => {
      void mirror.flushNow();
      mirror.dispose();
      mirrorRef.current = null;
      unsubscribeFileChanged();
      unsubscribeWatchError();
      void bridge.invoke('project-directory:unwatch');
    };
  }, [bridge, host, projectState]);

  useEffect(() => {
    if (!bridge || !projectState || bootstrapIntent?.kind !== 'template') {
      return;
    }

    void bridge.invoke('project-directory:seed-active-if-empty', {
      templateId: projectState.templateId,
    });
  }, [bootstrapIntent, bridge, projectState]);

  const handleChooseProjectRoot = useCallback(() => {
    if (!bridge) return;
    void bridge.invoke('project-root:choose');
  }, [bridge]);

  const handleOpenRecent = useCallback((projectId: string) => {
    if (!bridge) return;
    void bridge.invoke('project-window:open-workspace', { projectId });
  }, [bridge]);

  const handleCreateProject = useCallback((templateId: TemplateId) => {
    if (!bridge) return;
    if (!projectRoot) {
      void bridge.invoke('project-root:choose');
      return;
    }
    void bridge.invoke('project-window:create-from-template', { templateId });
  }, [bridge, projectRoot]);

  if (!bridge) {
    return <div className="desktop-error">Desktop bridge is unavailable.</div>;
  }

  if (error) {
    return <div className="desktop-error">{error}</div>;
  }

  if (loading && !projectState) {
    return <div className="desktop-loading">{bootstrapPhase}</div>;
  }

  if (windowRole === 'splash') {
    return (
      <div className="desktop-shell">
        <SplashScreen
          projectRoot={projectRoot}
          recents={recents}
          onChooseProjectRoot={handleChooseProjectRoot}
          onOpenRecent={handleOpenRecent}
          onCreateProject={handleCreateProject}
        />
      </div>
    );
  }

  if (!projectState) {
    return <div className="desktop-loading">Preparing project workspace…</div>;
  }

  return (
    <div className="desktop-shell desktop-workbench">
      <WorkbenchScreen
        template={projectState.templateId}
        initialProjectFiles={projectState.initialFiles}
        skipWorkspaceSeed={projectState.hydrateFromDisk}
        deferPreviewStart={projectState.hydrateFromDisk}
        desktopBridge={bridge}
        hostProjectDirectory={projectState.projectDirectory}
        onHostReady={(host: WebIDEHost) => {
          hostRef.current = host;
          setHost(host);
        }}
      />
    </div>
  );
}
