import { WebIDEHost } from './webide/workbench-host';
import { fetchReferenceApp } from './webide/reference-app-loader';
import type { ReferenceAppEntry } from './webide/vite-plugin-reference-apps';
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

function showShell(): void {
  const shell = document.querySelector('.webide-shell') as HTMLElement | null;
  if (shell) {
    shell.style.display = '';
  }
  document.body.classList.add('ide-active');
}

function hidePicker(): void {
  const picker = document.getElementById('templatePicker');
  if (picker) {
    picker.style.display = 'none';
  }
}

function bootIDE(template: TemplateId): void {
  // Set template in URL so reloads preserve the choice
  const url = new URL(window.location.href);
  url.searchParams.set('template', template);
  window.history.replaceState(null, '', url.toString());

  showShell();

  void WebIDEHost.bootstrap({
    elements: {
      workbench,
    },
    debugSections,
    marketplaceMode,
    template,
  });
}

async function bootReferenceApp(refPath: string): Promise<void> {
  // Set ref in URL so reloads preserve the choice
  const url = new URL(window.location.href);
  url.searchParams.set('ref', refPath);
  window.history.replaceState(null, '', url.toString());

  showShell();

  const referenceApp = await fetchReferenceApp(refPath);

  void WebIDEHost.bootstrap({
    elements: {
      workbench,
    },
    debugSections,
    marketplaceMode,
    template: 'vite', // Reference apps use vite-based runtime
    referenceApp,
  });
}

// ── Reference apps list in the picker ──

function populateReferenceApps(apps: ReferenceAppEntry[]): void {
  const section = document.getElementById('referenceAppsSection');
  const container = document.getElementById('referenceAppsCategories');
  if (!section || !container) return;
  if (apps.length === 0) return;

  // Group by category
  const categories = new Map<string, ReferenceAppEntry[]>();
  for (const app of apps) {
    const list = categories.get(app.category) || [];
    list.push(app);
    categories.set(app.category, list);
  }

  for (const [category, categoryApps] of categories) {
    const catDiv = document.createElement('div');

    const catTitle = document.createElement('p');
    catTitle.className = 'template-picker__ref-category-name';
    catTitle.textContent = category;
    catDiv.appendChild(catTitle);

    const list = document.createElement('div');
    list.className = 'template-picker__ref-list';

    for (const app of categoryApps) {
      const card = document.createElement('div');
      card.className = 'template-picker__ref-card';
      card.dataset.ref = app.path;

      const icon = document.createElement('div');
      icon.className = 'template-picker__ref-icon';
      // Use the first letter of the app name
      const displayName = app.name.includes('/') ? app.name.split('/').pop()! : app.name;
      icon.textContent = displayName.charAt(0);

      const name = document.createElement('span');
      name.className = 'template-picker__ref-name';
      name.textContent = displayName;

      card.appendChild(icon);
      card.appendChild(name);
      list.appendChild(card);
    }

    catDiv.appendChild(list);
    container.appendChild(catDiv);
  }

  // Click handler for reference app cards
  container.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-ref]');
    if (!card) return;
    const refPath = card.dataset.ref!;
    hidePicker();
    void bootReferenceApp(refPath);
  });

  section.classList.add('is-loaded');
}

async function loadReferenceAppsManifest(): Promise<void> {
  try {
    const manifest = await import('virtual:reference-apps-manifest');
    populateReferenceApps(manifest.default);
  } catch {
    // Manifest unavailable (e.g. builder-assets not present) — just skip
  }
}

// ── Main boot logic ──

const VALID_TEMPLATES: TemplateId[] = ['vite', 'nextjs', 'tanstack'];
const templateParam = params.get('template');
const refParam = params.get('ref');

if (refParam) {
  // Reference app — skip picker, fetch and boot
  hidePicker();
  void bootReferenceApp(refParam);
} else if (templateParam && VALID_TEMPLATES.includes(templateParam as TemplateId)) {
  // URL param specified — skip picker, boot directly
  hidePicker();
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

  // Load reference apps list in the background
  void loadReferenceAppsManifest();
}
