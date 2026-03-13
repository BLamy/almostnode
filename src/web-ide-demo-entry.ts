import { WebIDEHost } from './webide/workbench-host';

const workbench = document.getElementById('webideWorkbench');

if (!(workbench instanceof HTMLElement)) {
  throw new Error('Missing #webideWorkbench');
}

const params = new URLSearchParams(window.location.search);
const marketplaceMode = params.get('marketplace') === 'mock' ? 'fixtures' : 'open-vsx';
const DEBUG_STORAGE_KEY = '__almostnodeDebug';

function normalizeDebugSections(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  return Array.from(new Set(
    raw
      .split(/[,\s]+/)
      .map((section) => section.trim().toLowerCase())
      .filter(Boolean),
  ));
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
    // Ignore storage failures and fall back to the in-memory flag.
  }

  if (serialized) {
    (window as any).__almostnodeDebug = serialized;
  } else {
    delete (window as any).__almostnodeDebug;
  }

  return debugSections;
}

const debugSections = syncDebugState(params.get('debug'));

void WebIDEHost.bootstrap({
  elements: {
    workbench,
  },
  debugSections,
  marketplaceMode,
});
