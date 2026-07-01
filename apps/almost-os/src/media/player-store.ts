// The single source of truth for playback in almost-os. Exactly one hidden
// SoundCloud Widget iframe (mounted once by <PlayerHost/>) is the audio engine;
// Winamp/Webamp renders + drives it, the `sc` CLI drives it over a VFS bridge,
// and the OpenCode agent drives it through `sc`. Napster does NOT use this — it
// only downloads. All surfaces read the same queue via `useMediaPlayer()`.

import { useSyncExternalStore } from "react";
import { getWorkspace } from "../runtime/runtime";
import {
  loadSoundCloudWidgetApi,
  widgetPlayerUrl,
  type SCSound,
  type SCWidget,
} from "./soundcloud-widget";
import type { VirtualMp3 } from "./virtual-mp3";

export interface PlayerTrack {
  url: string;
  title: string;
  artist?: string;
  artwork?: string | null;
}

export interface PlayerState {
  queue: PlayerTrack[];
  index: number;
  playing: boolean;
  ready: boolean;
  posMs: number;
  durMs: number;
  volume: number;
  /** Live metadata from the widget for the current track. */
  now: { title: string; artist: string } | null;
}

// Winamp comes preloaded with the classic demo track (queued, not auto-played).
const SEED_TRACK: PlayerTrack = {
  url: "https://soundcloud.com/avishay-bassa/winamp-it-really-whips-the",
  title: "It Really Whips the Llama's Ass",
  artist: "Winamp",
};

const BRIDGE_DIR = "/home/user/.winamp";
const COMMAND_PATH = `${BRIDGE_DIR}/command.json`;
const STATE_PATH = `${BRIDGE_DIR}/state.json`;

let state: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  ready: false,
  posMs: 0,
  durMs: 0,
  volume: 80,
  now: null,
};

const listeners = new Set<() => void>();
let widget: SCWidget | null = null;
/** Bumped only on structural changes (queue/index/playing/now) → gate VFS writes. */
let structuralVersion = 0;
let lastWrittenVersion = -1;
let lastCommandId = "";
let bridgeInstalled = false;

function commit(next: Partial<PlayerState>, structural = false): void {
  state = { ...state, ...next };
  if (structural) {
    structuralVersion += 1;
    writeStateFile();
  }
  for (const listener of listeners) listener();
}

// --- widget wiring ---------------------------------------------------------

function refreshNow(): void {
  widget?.getCurrentSound((sound: SCSound) => {
    commit(
      {
        now: { title: sound?.title ?? "—", artist: sound?.user?.username ?? "" },
        durMs: sound?.duration ?? state.durMs,
      },
      true,
    );
  });
}

/** Called by <PlayerHost/> once the hidden iframe is in the DOM. Idempotent. */
export function attachIframe(iframe: HTMLIFrameElement): void {
  if (widget) return;
  void loadSoundCloudWidgetApi()
    .then((SC) => {
      const w = SC.Widget(iframe);
      widget = w;
      const E = SC.Widget.Events;
      w.bind(E.READY, () => {
        w.setVolume(state.volume);
        commit({ ready: true });
        seedQueue();
        installBridge();
      });
      w.bind(E.PLAY, () => commit({ playing: true }, true));
      w.bind(E.PAUSE, () => commit({ playing: false }, true));
      w.bind(E.FINISH, () => next());
      w.bind(E.PLAY_PROGRESS, (e) =>
        commit({ posMs: (e as { currentPosition?: number })?.currentPosition ?? 0 }),
      );
    })
    .catch((error) => console.error("[player] SoundCloud widget failed", error));
}

function loadCurrent(autoPlay: boolean): void {
  const track = state.queue[state.index];
  if (!widget || !track) return;
  commit({ posMs: 0, now: { title: track.title, artist: track.artist ?? "" } }, true);
  widget.load(track.url, { auto_play: autoPlay, callback: refreshNow });
}

// --- public transport ------------------------------------------------------

/** Preload the classic demo track once, without auto-playing. */
export function seedQueue(): void {
  if (state.queue.length > 0) return;
  enqueue(SEED_TRACK);
  playIndex(0, false);
}

export function playIndex(i: number, autoPlay = true): void {
  if (i < 0 || i >= state.queue.length) return;
  commit({ index: i }, true);
  loadCurrent(autoPlay);
}

/** Append tracks; returns the index of the first added track. */
export function enqueue(tracks: PlayerTrack | PlayerTrack[]): number {
  const add = Array.isArray(tracks) ? tracks : [tracks];
  if (add.length === 0) return state.index;
  const firstNew = state.queue.length;
  commit({ queue: [...state.queue, ...add] }, true);
  return firstNew;
}

/** Add a track and start playing it immediately. */
export function playTrack(track: PlayerTrack): void {
  const at = enqueue(track);
  playIndex(at);
}

export function playUrl(url: string, meta?: Partial<PlayerTrack>): void {
  playTrack({ url, title: meta?.title ?? url, artist: meta?.artist, artwork: meta?.artwork });
}

export function playVirtualMp3(payload: VirtualMp3): void {
  playTrack({
    url: payload.url,
    title: payload.title,
    artist: payload.artist,
    artwork: payload.artwork ?? null,
  });
}

export function toggle(): void {
  if (!widget) return;
  if (state.playing) widget.pause();
  else widget.play();
}

export function play(): void {
  widget?.play();
}
export function pause(): void {
  widget?.pause();
}

export function stop(): void {
  widget?.pause();
  widget?.seekTo(0);
  commit({ posMs: 0 });
}

export function next(): void {
  if (state.index + 1 < state.queue.length) playIndex(state.index + 1);
}

export function prev(): void {
  if (state.index > 0) playIndex(state.index - 1);
}

export function seek(ms: number): void {
  widget?.seekTo(ms);
  commit({ posMs: ms });
}

export function setVolume(v: number): void {
  const volume = Math.max(0, Math.min(100, v));
  widget?.setVolume(volume);
  commit({ volume });
}

export function clearQueue(): void {
  widget?.pause();
  commit({ queue: [], index: -1, playing: false, posMs: 0, durMs: 0, now: null }, true);
}

// --- VFS command/state bridge (lets the `sc` CLI + agent drive playback) ----

interface BridgeCommand {
  id: string;
  action: "play" | "queue" | "next" | "prev" | "toggle" | "stop";
  url?: string;
  title?: string;
  artist?: string;
}

function writeStateFile(): void {
  if (structuralVersion === lastWrittenVersion) return;
  lastWrittenVersion = structuralVersion;
  try {
    const vfs = getWorkspace().vfs;
    if (!vfs.existsSync(BRIDGE_DIR)) vfs.mkdirSync(BRIDGE_DIR, { recursive: true });
    const track = state.queue[state.index];
    vfs.writeFileSync(
      STATE_PATH,
      JSON.stringify(
        {
          playing: state.playing,
          index: state.index,
          count: state.queue.length,
          now: state.now,
          url: track?.url ?? null,
        },
        null,
        2,
      ),
    );
  } catch {
    /* bridge is best-effort */
  }
}

function handleCommand(): void {
  let cmd: BridgeCommand | null = null;
  try {
    const vfs = getWorkspace().vfs;
    if (!vfs.existsSync(COMMAND_PATH)) return;
    cmd = JSON.parse(String(vfs.readFileSync(COMMAND_PATH, "utf8"))) as BridgeCommand;
  } catch {
    return;
  }
  if (!cmd || !cmd.id || cmd.id === lastCommandId) return;
  lastCommandId = cmd.id;
  switch (cmd.action) {
    case "play":
      if (cmd.url) playUrl(cmd.url, { title: cmd.title, artist: cmd.artist });
      break;
    case "queue":
      if (cmd.url) enqueue({ url: cmd.url, title: cmd.title ?? cmd.url, artist: cmd.artist });
      break;
    case "next":
      next();
      break;
    case "prev":
      prev();
      break;
    case "toggle":
      toggle();
      break;
    case "stop":
      stop();
      break;
    default:
      break;
  }
}

/** Watch the VFS command file. Safe to call repeatedly; installs once. */
export function installBridge(): void {
  if (bridgeInstalled) return;
  let vfs;
  try {
    vfs = getWorkspace().vfs;
  } catch {
    return;
  }
  bridgeInstalled = true;
  // Seed lastCommandId so a stale command from a previous session doesn't fire.
  try {
    if (vfs.existsSync(COMMAND_PATH)) {
      const existing = JSON.parse(String(vfs.readFileSync(COMMAND_PATH, "utf8"))) as BridgeCommand;
      lastCommandId = existing?.id ?? "";
    }
  } catch {
    /* ignore */
  }
  vfs.on("change", handleCommand);
  installWindowBridge();
}

function installWindowBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    player: {
      playUrl,
      enqueue: (t: PlayerTrack) => enqueue(t),
      play,
      pause,
      toggle,
      next,
      prev,
      stop,
      getState: () => state,
    },
  };
}

// --- React binding ---------------------------------------------------------

export function playerSubscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlayerSnapshot(): PlayerState {
  return state;
}

export function useMediaPlayer(): PlayerState {
  return useSyncExternalStore(playerSubscribe, getPlayerSnapshot, getPlayerSnapshot);
}
