import React from "react";

// Lucide-style SVG inner markup (viewBox 0 0 24 24), ported from the web-ide
// FilesSidebarSurface icon set so the React tree matches the existing explorer.
const PATHS = {
  chevron: '<path d="m9 18 6-6-6-6"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderOpen:
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  fileCode:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  fileJson:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>',
  fileText:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8"/><path d="M16 17H8"/><path d="M16 13h-2"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
} as const;

type PathKey = keyof typeof PATHS;

const EXT: Record<string, [PathKey, string]> = {
  ts: ["fileCode", "#3178C6"],
  tsx: ["fileCode", "#3178C6"],
  js: ["fileCode", "#CBCB41"],
  jsx: ["fileCode", "#CBCB41"],
  mjs: ["fileCode", "#CBCB41"],
  cjs: ["fileCode", "#CBCB41"],
  json: ["fileJson", "#CBCB41"],
  css: ["hash", "#519ABA"],
  scss: ["hash", "#F55385"],
  less: ["hash", "#563D7C"],
  html: ["globe", "#E44D26"],
  htm: ["globe", "#E44D26"],
  svg: ["image", "#F7B93E"],
  png: ["image", "#A074C4"],
  jpg: ["image", "#A074C4"],
  jpeg: ["image", "#A074C4"],
  gif: ["image", "#A074C4"],
  ico: ["image", "#A074C4"],
  md: ["fileText", "#519ABA"],
  mdx: ["fileText", "#519ABA"],
  txt: ["fileText", "#8ca0bb"],
  yaml: ["settings", "#CB171E"],
  yml: ["settings", "#CB171E"],
  toml: ["settings", "#6D8086"],
  env: ["settings", "#ECD53F"],
  sh: ["fileCode", "#4EAA25"],
  py: ["fileCode", "#3572A5"],
};

const NAMES: Record<string, [PathKey, string]> = {
  "package.json": ["box", "#E8274B"],
  "package-lock.json": ["box", "#E8274B"],
  "tsconfig.json": ["settings", "#3178C6"],
  "tsconfig.node.json": ["settings", "#3178C6"],
  ".gitignore": ["settings", "#F05032"],
  ".eslintrc.json": ["settings", "#4B32C3"],
  ".prettierrc": ["settings", "#F7B93E"],
  "vite.config.ts": ["settings", "#646CFF"],
  "vite.config.js": ["settings", "#646CFF"],
  "next.config.js": ["settings", "#e6edf7"],
  "next.config.mjs": ["settings", "#e6edf7"],
  "tailwind.config.js": ["settings", "#38BDF8"],
  "tailwind.config.ts": ["settings", "#38BDF8"],
  "postcss.config.js": ["settings", "#DD3A0A"],
};

const FOLDER_COLOR = "#C09553";

interface GlyphProps {
  pathKey: PathKey;
  color: string;
  filled?: boolean;
  className?: string;
}

function Glyph({ pathKey, color, filled, className }: GlyphProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill={filled ? color : "none"}
      fillOpacity={filled ? 0.2 : undefined}
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      // PATHS values are static, trusted inline SVG markup.
      dangerouslySetInnerHTML={{ __html: PATHS[pathKey] }}
    />
  );
}

export function FileIcon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const match = NAMES[name] ?? EXT[name.split(".").pop()?.toLowerCase() ?? ""];
  const [pathKey, color] = match ?? (["file", "#8ca0bb"] as const);
  return <Glyph pathKey={pathKey} color={color} className={className} />;
}

export function FolderIcon({ open, className }: { open: boolean; className?: string }): React.ReactElement {
  return (
    <Glyph
      pathKey={open ? "folderOpen" : "folder"}
      color={FOLDER_COLOR}
      filled
      className={className}
    />
  );
}

export function ChevronIcon({ className }: { className?: string }): React.ReactElement {
  return <Glyph pathKey="chevron" color="currentColor" className={className} />;
}

// Monochrome action glyphs for the toolbar + context menu (inherit currentColor).
const ACTION_PATHS = {
  filePlus:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  folderPlus:
    '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  collapse:
    '<path d="m4 9 4-4 4 4"/><path d="m4 15 4 4 4-4"/><path d="M14 5h6"/><path d="M14 12h6"/><path d="M14 19h6"/>',
  rename:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
} as const;

export type ActionIconName = keyof typeof ACTION_PATHS;

export function ActionIcon({
  name,
  className,
}: {
  name: ActionIconName;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ACTION_PATHS[name] }}
    />
  );
}
