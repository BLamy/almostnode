import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

export const PREVIEW_EDITOR_TYPE_ID = "almostnode.editor.preview";
export const PREVIEW_EDITOR_RESOURCE = URI.from({
  scheme: "almostnode-preview",
  path: "/workspace",
});

export const DATABASE_EDITOR_TYPE_ID = "almostnode.editor.database";
export const DATABASE_EDITOR_RESOURCE = URI.from({
  scheme: "almostnode-database",
  path: "/browser",
});

export const FILES_VIEW_ID = "almostnode.sidebar.files";
export const OPEN_CODE_VIEW_ID = "almostnode.sidebar.opencode";
export const TERMINAL_VIEW_ID = "almostnode.panel.terminal";
export const DATABASE_VIEW_ID = "almostnode.sidebar.database";
export const KEYCHAIN_VIEW_ID = "almostnode.sidebar.keychain";
export const TESTS_VIEW_ID = "almostnode.sidebar.tests";

function svgIcon(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

export const WORKBENCH_SURFACE_ICONS = {
  files: svgIcon(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/></svg>',
  ),
  opencode: svgIcon(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>',
  ),
  database: svgIcon(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
  ),
  keychain: svgIcon(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  ),
  tests: svgIcon(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  ),
} as const;
