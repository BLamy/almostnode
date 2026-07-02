// The single source of truth for playback in almost-os. Two engines, one queue:
// SoundCloud URLs play through the hidden SoundCloud Widget iframe (mounted once
// by <PlayerHost/>); everything else (local/http media files, e.g. the seeded
// llama demo mp3) plays through a module-owned HTMLAudioElement. Winamp/Webamp
// renders + drives the store, the `napster` CLI drives it over a VFS bridge, and
// the OpenCode agent drives it through `napster`. Napster does NOT use this — it
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
  /** Track length in ms, when known up front (file tracks refine it on load). */
  durationMs?: number;
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
  url: `${import.meta.env.BASE_URL}media/llama.mp3`,
  title: "Llama Whippin' Intro",
  artist: "DJ Mike Llama",
  durationMs: 5322,
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
let audioEl: HTMLAudioElement | null = null;
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

// --- engine routing --------------------------------------------------------

/** SoundCloud URLs go through the widget; everything else through <audio>. */
export function isSoundCloudUrl(url: string): boolean {
  try {
    const host = new URL(url, "https://localhost").hostname;
    return host === "soundcloud.com" || host.endsWith(".soundcloud.com") || host === "snd.sc";
  } catch {
    return false;
  }
}

function currentEngine(): "widget" | "file" {
  const track = state.queue[state.index];
  return track && !isSoundCloudUrl(track.url) ? "file" : "widget";
}

/**
 * Lazy singleton <audio> for non-SoundCloud tracks.
 *
 * Every event handler is gated on the engine owning the current track: when a
 * track switch hands playback to the other engine, the losing engine's
 * in-flight events (a pause fired by the switch itself, a straggling
 * timeupdate) must not overwrite the new track's state.
 */
function getAudioEl(): HTMLAudioElement {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = "auto";
  el.volume = state.volume / 100;
  el.addEventListener("timeupdate", () => {
    if (currentEngine() !== "file") return;
    commit({ posMs: Math.round(el.currentTime * 1000) });
  });
  el.addEventListener("durationchange", () => {
    if (currentEngine() !== "file") return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      commit({ durMs: Math.round(el.duration * 1000) }, true);
    }
  });
  el.addEventListener("play", () => {
    if (currentEngine() === "file") commit({ playing: true }, true);
  });
  el.addEventListener("pause", () => {
    if (currentEngine() === "file") commit({ playing: false }, true);
  });
  el.addEventListener("ended", () => {
    if (currentEngine() === "file") next();
  });
  el.addEventListener("error", () => {
    console.warn("[player] file engine error", el.error?.message ?? el.error);
  });
  audioEl = el;
  return el;
}

function playAudioEl(): void {
  void getAudioEl()
    .play()
    .catch((error) => console.warn("[player] audio play blocked", error));
}

// --- widget wiring ---------------------------------------------------------

function refreshNow(): void {
  widget?.getCurrentSound((sound: SCSound) => {
    // The widget answers for whatever IT has loaded — ignore it when the
    // current track belongs to the file engine (e.g. the seeded llama mp3).
    if (currentEngine() !== "widget") return;
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
  // Seed the queue up front — independent of the SoundCloud widget handshake —
  // so the "now playing" list shows the classic demo track immediately, even if
  // the widget is slow to become ready (or never does, e.g. embeds blocked).
  seedQueue();
  void loadSoundCloudWidgetApi()
    .then((SC) => {
      const w = SC.Widget(iframe);
      widget = w;
      const E = SC.Widget.Events;

      let readied = false;
      const onReady = () => {
        if (readied) return;
        readied = true;
        w.setVolume(state.volume);
        commit({ ready: true });
        // Point the widget at the current track if it's a SoundCloud one, so the
        // very first press of play has audio loaded. A file track already has the
        // <audio> engine — reloading it here would reset its playback.
        const current = state.queue[state.index];
        if (current && isSoundCloudUrl(current.url)) loadCurrent(false);
        installBridge();
      };
      // Gated on engine ownership — see getAudioEl for why.
      w.bind(E.READY, onReady);
      w.bind(E.PLAY, () => {
        if (currentEngine() === "widget") commit({ playing: true }, true);
      });
      w.bind(E.PAUSE, () => {
        if (currentEngine() === "widget") commit({ playing: false }, true);
      });
      w.bind(E.FINISH, () => {
        if (currentEngine() === "widget") next();
      });
      w.bind(E.PLAY_PROGRESS, (e) => {
        if (currentEngine() !== "widget") return;
        commit({ posMs: (e as { currentPosition?: number })?.currentPosition ?? 0 });
      });

      // The widget's READY event fires only once. Because the iframe often loads
      // (and fires READY) before this API script finishes loading and binds the
      // handler, that one-shot event is easily missed — leaving the widget fully
      // functional but the app stuck thinking it never became ready. Guard the
      // race by polling a cheap widget request (getCurrentSound only answers once
      // the widget is live) and promoting to ready as soon as it responds.
      const poll = window.setInterval(() => {
        if (readied) {
          window.clearInterval(poll);
          return;
        }
        w.getCurrentSound((sound: SCSound) => {
          if (sound && !readied) onReady();
        });
      }, 600);
      window.setTimeout(() => window.clearInterval(poll), 30000);
    })
    .catch((error) => console.error("[player] SoundCloud widget failed", error));
  // Watchdog: surface a silent handshake failure so "why won't it play?" is
  // diagnosable instead of a mystery. The SoundCloud embed needs to reach READY
  // for any audio to play; if it doesn't, log a clear hint.
  window.setTimeout(() => {
    if (!state.ready) {
      console.warn(
        "[player] SoundCloud widget has not become ready after 8s — SoundCloud playback is unavailable " +
          "(local file tracks still play). This usually means the SoundCloud embed (w.soundcloud.com) is " +
          "blocked (e.g. third-party cookies/embeds disabled).",
      );
    }
  }, 8000);
}

function loadCurrent(autoPlay: boolean): void {
  const track = state.queue[state.index];
  if (!track) return;
  commit(
    {
      posMs: 0,
      durMs: track.durationMs ?? 0,
      now: { title: track.title, artist: track.artist ?? "" },
    },
    true,
  );
  if (isSoundCloudUrl(track.url)) {
    audioEl?.pause();
    if (!widget) return;
    widget.load(track.url, { auto_play: autoPlay, callback: refreshNow });
  } else {
    widget?.pause();
    const el = getAudioEl();
    el.src = track.url;
    if (autoPlay) playAudioEl();
  }
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
    durationMs: payload.duration,
  });
}

export function toggle(): void {
  if (state.playing) pause();
  else play();
}

export function play(): void {
  if (currentEngine() === "file") playAudioEl();
  else widget?.play();
}
export function pause(): void {
  if (currentEngine() === "file") audioEl?.pause();
  else widget?.pause();
}

export function stop(): void {
  if (currentEngine() === "file") {
    audioEl?.pause();
    if (audioEl) audioEl.currentTime = 0;
  } else {
    widget?.pause();
    widget?.seekTo(0);
  }
  commit({ posMs: 0 });
}

export function next(): void {
  if (state.index + 1 < state.queue.length) playIndex(state.index + 1);
}

export function prev(): void {
  if (state.index > 0) playIndex(state.index - 1);
}

export function seek(ms: number): void {
  if (currentEngine() === "file") {
    if (audioEl) audioEl.currentTime = ms / 1000;
  } else {
    widget?.seekTo(ms);
  }
  commit({ posMs: ms });
}

export function setVolume(v: number): void {
  const volume = Math.max(0, Math.min(100, v));
  if (volume === state.volume) return;
  widget?.setVolume(volume);
  if (audioEl) audioEl.volume = volume / 100;
  commit({ volume });
}

export function clearQueue(): void {
  widget?.pause();
  audioEl?.pause();
  commit({ queue: [], index: -1, playing: false, posMs: 0, durMs: 0, now: null }, true);
}

// --- VFS command/state bridge (lets the `napster` CLI + agent drive playback) ----

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
