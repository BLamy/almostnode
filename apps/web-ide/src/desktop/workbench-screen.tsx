import { useEffect, useRef, useState, useCallback } from 'react';
import type { TemplateId } from '../features/workspace-seed';
import { WebIDEHost } from '../workbench/workbench-host';
import { ProjectManager } from '../features/project-manager';
import { ProjectSidebar } from '../sidebar/project-sidebar';
import type { DesktopBridge } from './bridge';
import type { SerializedFile } from './project-snapshot';

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
  const managerRef = useRef<ProjectManager | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  // Lazily create the project manager singleton
  if (!managerRef.current) {
    managerRef.current = new ProjectManager();
  }
  const manager = managerRef.current;

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      // Trigger Monaco layout reflow after sidebar animation
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
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
      skipWorkspaceSeed: skipWorkspaceSeed || shouldRestoreProjectFromUrl,
      deferPreviewStart: deferPreviewStart || shouldRestoreProjectFromUrl,
      desktopBridge: desktopBridge ?? null,
      hostProjectDirectory: hostProjectDirectory ?? null,
      agentLaunchCommand: agentLaunchCommand ?? null,
    }).then((host) => {
      // Wire project manager to host
      manager.setHost({
        getVfs: () => host.getVfs(),
        getTemplateId: () => host.getTemplateId(),
        attachProjectContext: (tid, dbPrefix) =>
          host.attachProjectContext(tid, dbPrefix),
        switchProjectWorkspace: (tid, files, dbPrefix) =>
          host.switchProjectWorkspace(tid, files, dbPrefix),
        collectAgentStateSnapshot: () => host.collectAgentStateSnapshot(),
        restoreAgentStateSnapshot: (snapshot) =>
          host.restoreAgentStateSnapshot(snapshot),
        discoverActiveProjectThreads: (projectId) =>
          host.discoverActiveProjectThreads(projectId),
        resumeResumableThread: (thread) => host.resumeResumableThread(thread),
      });
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
    marketplace,
    onHostReady,
    template,
    manager,
  ]);

  return (
    <div className="webide-shell">
      <header className="webide-header" />
      <main className="webide-body">
        {hostReady && (
          <ProjectSidebar
            manager={manager}
            isCollapsed={sidebarCollapsed}
            onToggle={handleToggleSidebar}
          />
        )}
        <div id="webideWorkbench" ref={workbenchRef} />
      </main>
    </div>
  );
}
