import { useEffect, useRef } from 'react';
import type { TemplateId } from '../features/workspace-seed';
import { WebIDEHost } from '../workbench/workbench-host';
import type { DesktopBridge } from './bridge';
import type { SerializedFile } from './project-snapshot';

const DEBUG_STORAGE_KEY = '__almostnodeDebug';
const CORS_PROXY_STORAGE_KEY = '__corsProxyUrl';
const INTERNAL_CORS_PROXY_PATH = '/__api/cors-proxy?url=';

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
      skipWorkspaceSeed,
      deferPreviewStart,
      desktopBridge: desktopBridge ?? null,
      hostProjectDirectory: hostProjectDirectory ?? null,
      agentLaunchCommand: agentLaunchCommand ?? null,
    }).then((host) => {
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
    marketplace,
    onHostReady,
    template,
  ]);

  return (
    <div className="webide-shell">
      <header className="webide-header" />
      <main className="webide-body">
        <div id="webideWorkbench" ref={workbenchRef} />
      </main>
    </div>
  );
}
