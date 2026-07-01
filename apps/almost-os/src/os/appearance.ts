import { useSyncExternalStore } from "react";

/** System-wide look & feel: accent color, wallpaper, light/dark, volume. */

export type AppearanceMode = "light" | "dark" | "auto";

export interface AccentDef {
  id: string;
  name: string;
  color: string;
}

export interface WallpaperDef {
  id: string;
  name: string;
  /** Base linear-gradient painted behind the desktop. */
  base: string;
  /** The three blurred radial glows, as rgba centers. */
  glows: [string, string, string];
}

export const ACCENTS: AccentDef[] = [
  { id: "blue", name: "Blue", color: "#2f7bff" },
  { id: "purple", name: "Purple", color: "#8a4fd0" },
  { id: "pink", name: "Pink", color: "#ff375f" },
  { id: "orange", name: "Orange", color: "#ff9500" },
  { id: "green", name: "Green", color: "#34c759" },
  { id: "graphite", name: "Graphite", color: "#8e8e93" },
];

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: "sonoma",
    name: "Sonoma",
    base: "linear-gradient(160deg, #3b2f74 0%, #5642a6 30%, #7d4fb0 55%, #c065a0 100%)",
    glows: ["rgba(255,158,102,0.85)", "rgba(94,169,255,0.8)", "rgba(214,95,196,0.7)"],
  },
  {
    id: "sequoia",
    name: "Sequoia",
    base: "linear-gradient(160deg, #0b2a5b 0%, #12467f 40%, #1f6fb0 70%, #37b0c9 100%)",
    glows: ["rgba(94,169,255,0.8)", "rgba(120,220,235,0.72)", "rgba(60,110,200,0.7)"],
  },
  {
    id: "sunset",
    name: "Sunset",
    base: "linear-gradient(160deg, #3a1c53 0%, #8a2b6c 40%, #d1487a 70%, #ff9d5c 100%)",
    glows: ["rgba(255,158,102,0.9)", "rgba(255,90,140,0.75)", "rgba(150,60,180,0.7)"],
  },
  {
    id: "mint",
    name: "Mint",
    base: "linear-gradient(160deg, #08322b 0%, #12594a 40%, #1f9e7a 70%, #7fe0b0 100%)",
    glows: ["rgba(120,230,180,0.8)", "rgba(80,200,190,0.7)", "rgba(40,150,120,0.7)"],
  },
  {
    id: "graphite",
    name: "Graphite",
    base: "linear-gradient(160deg, #1c1c22 0%, #2a2a33 45%, #3a3a45 75%, #54545f 100%)",
    glows: ["rgba(120,130,150,0.5)", "rgba(90,100,120,0.45)", "rgba(70,75,90,0.5)"],
  },
];

export interface Appearance {
  accent: string;
  wallpaper: string;
  mode: AppearanceMode;
  /** Output volume, 0–100. */
  volume: number;
}

const STORAGE_KEY = "almostos.appearance";
const DEFAULT: Appearance = { accent: "blue", wallpaper: "sonoma", mode: "auto", volume: 65 };

function load(): Appearance {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<Appearance>;
    return {
      accent: ACCENTS.some((a) => a.id === p.accent) ? (p.accent as string) : DEFAULT.accent,
      wallpaper: WALLPAPERS.some((w) => w.id === p.wallpaper)
        ? (p.wallpaper as string)
        : DEFAULT.wallpaper,
      mode:
        p.mode === "light" || p.mode === "dark" || p.mode === "auto" ? p.mode : DEFAULT.mode,
      volume: typeof p.volume === "number" ? Math.max(0, Math.min(100, p.volume)) : DEFAULT.volume,
    };
  } catch {
    return DEFAULT;
  }
}

let state: Appearance = load();
const listeners = new Set<() => void>();

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Push accent + resolved light/dark onto the document root. */
export function applyAppearance(s: Appearance = state): void {
  if (typeof document === "undefined") return;
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0];
  document.documentElement.style.setProperty("--accent", accent.color);
  const resolved = s.mode === "auto" ? (prefersDark() ? "dark" : "light") : s.mode;
  document.documentElement.dataset.appearance = resolved;
}

function commit(next: Appearance) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  applyAppearance(state);
  for (const listener of listeners) listener();
}

export function getAppearance(): Appearance {
  return state;
}

export function setAccent(accent: string): void {
  commit({ ...state, accent });
}

export function setWallpaper(wallpaper: string): void {
  commit({ ...state, wallpaper });
}

export function setMode(mode: AppearanceMode): void {
  commit({ ...state, mode });
}

export function setVolume(volume: number): void {
  commit({ ...state, volume: Math.max(0, Math.min(100, Math.round(volume))) });
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
