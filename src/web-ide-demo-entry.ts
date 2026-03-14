import { WebIDEHost } from './webide/workbench-host';
import type { TemplateId } from './webide/workspace-seed';

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

function bootIDE(template: TemplateId): void {
  // Set template in URL so reloads preserve the choice
  const url = new URL(window.location.href);
  url.searchParams.set('template', template);
  window.history.replaceState(null, '', url.toString());

  const shell = document.querySelector('.webide-shell') as HTMLElement | null;
  if (shell) {
    shell.style.display = '';
  }

  void WebIDEHost.bootstrap({
    elements: {
      workbench,
    },
    debugSections,
    marketplaceMode,
    template,
  });
}

const VALID_TEMPLATES: TemplateId[] = ['vite', 'nextjs', 'tanstack'];
const templateParam = params.get('template');

if (templateParam && VALID_TEMPLATES.includes(templateParam as TemplateId)) {
  // URL param specified — skip picker, boot directly
  const picker = document.getElementById('templatePicker');
  if (picker) {
    picker.style.display = 'none';
  }
  bootIDE(templateParam as TemplateId);
} else {
  // Show picker, hide shell
  const shell = document.querySelector('.webide-shell') as HTMLElement | null;
  if (shell) {
    shell.style.display = 'none';
  }

  const picker = document.getElementById('templatePicker');
  if (picker) {
    picker.addEventListener('click', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-template]');
      if (!card) return;

      const templateId = card.dataset.template as TemplateId;
      if (!VALID_TEMPLATES.includes(templateId)) return;

      picker.style.display = 'none';
      bootIDE(templateId);
    });
  }
}
