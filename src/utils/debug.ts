function getProcessDebugValue(): string | null {
  try {
    const value = (globalThis as any)?.process?.env?.ALMOSTNODE_DEBUG;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function getGlobalDebugValue(): string | null {
  try {
    const value = (globalThis as any).__almostnodeDebug;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function getLocalStorageDebugValue(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem('__almostnodeDebug');
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function parseDebugSections(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAlmostnodeDebugEnabled(section?: string): boolean {
  const raw =
    getProcessDebugValue()
    ?? getGlobalDebugValue()
    ?? getLocalStorageDebugValue();

  const sections = parseDebugSections(raw);
  if (sections.size === 0) return false;
  if (sections.has('*') || sections.has('all')) return true;
  if (!section) return true;

  const normalized = section.trim().toLowerCase();
  return sections.has(normalized);
}

export function almostnodeDebugLog(section: string, ...args: unknown[]): void {
  if (!isAlmostnodeDebugEnabled(section)) return;
  console.log(...args);
}

export function almostnodeDebugError(section: string, ...args: unknown[]): void {
  if (!isAlmostnodeDebugEnabled(section)) return;
  console.error(...args);
}
