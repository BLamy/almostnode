/**
 * App Store catalog. Each entry's `load()` dynamically imports the app's source
 * (code-split), so an app's files are only fetched when the user installs it.
 */
export interface AppStoreEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Real GitHub project this minimal app is based on. */
  repoUrl: string;
  emoji: string;
  accent: string;
  /** Lazily import the app's seed files (path -> content, relative to app dir). */
  load: () => Promise<{ files: Record<string, string> }>;
}

export const CATALOG: AppStoreEntry[] = [
  {
    id: 'pomodoro',
    name: 'Pomodoro',
    tagline: 'Focus timer',
    description:
      'A 25/5 focus timer. The main process runs the countdown and streams ticks to the window over IPC.',
    repoUrl: 'https://github.com/duggiemitchell/electron-app-pomodoro-timer',
    emoji: '🍅',
    accent: '#ef4444',
    load: () => import('./apps/pomodoro'),
  },
  {
    id: 'markdownify',
    name: 'Markdownify',
    tagline: 'Markdown editor',
    description:
      'A minimal live Markdown editor. Notes are saved to the virtual filesystem through ipcMain + fs.',
    repoUrl: 'https://github.com/amitmerchant1990/electron-markdownify',
    emoji: '📝',
    accent: '#0ea5e9',
    load: () => import('./apps/markdownify'),
  },
  {
    id: 'sysinfo',
    name: 'System Info',
    tagline: 'About / diagnostics',
    description:
      'Shows app + process info via IPC, does a ping round-trip, and opens links with shell.openExternal.',
    repoUrl: 'https://github.com/electron/electron',
    emoji: 'ℹ️',
    accent: '#8b5cf6',
    load: () => import('./apps/sysinfo'),
  },
];
