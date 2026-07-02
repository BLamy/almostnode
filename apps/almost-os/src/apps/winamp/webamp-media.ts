// Webamp media backend adapting the shared player store. Passed to Webamp as
// `__customMediaClass` (the shipped seam winampify uses for Spotify), so every
// Webamp affordance — transport buttons, seekbar (both directions), time
// display, volume — flows through webamp's own mediaMiddleware into the store,
// which owns the real audio (SoundCloud widget or the <audio> file engine).

import type Webamp from "webamp";
import {
  getPlayerSnapshot,
  pause,
  play,
  playerSubscribe,
  playIndex,
  playUrl,
  seek,
  setVolume,
  stop,
} from "../../media/player-store";

type IMedia = InstanceType<typeof Webamp>["media"];

// Webamp mirrors the store's queue into its own playlist; while it does, the
// PLAY_TRACK/BUFFER_TRACK actions it dispatches must not loop back into the
// store. IMediaClass takes no constructor args, so coordination is module-level
// (only one Winamp instance exists at a time — the window manager dedupes it).
let suppressed = false;

export function withSuppressedReflection(fn: () => void): void {
  suppressed = true;
  try {
    fn();
  } finally {
    suppressed = false;
  }
}

type MediaListener = (...args: unknown[]) => void;

export class PlayerStoreMedia implements IMedia {
  private listeners = new Map<string, Set<MediaListener>>();
  private unsubscribe: () => void;
  private analyser: AnalyserNode | null = null;
  private lastPosMs: number;
  private lastDurMs: number;
  private lastUrl: string | undefined;
  private lastPlaying: boolean;

  constructor() {
    const s = getPlayerSnapshot();
    this.lastPosMs = s.posMs;
    this.lastDurMs = s.durMs;
    this.lastUrl = s.queue[s.index]?.url;
    this.lastPlaying = s.playing;
    this.unsubscribe = playerSubscribe(() => this.onStoreChange());
  }

  private onStoreChange(): void {
    const s = getPlayerSnapshot();
    const url = s.queue[s.index]?.url;
    if (s.posMs !== this.lastPosMs) {
      this.lastPosMs = s.posMs;
      this.emit("timeupdate");
    }
    if (s.playing && !this.lastPlaying) this.emit("playing");
    this.lastPlaying = s.playing;
    if (url !== this.lastUrl || s.durMs !== this.lastDurMs) {
      this.lastUrl = url;
      this.lastDurMs = s.durMs;
      // Deferred so WinampApp's reflect listener can point Webamp's playlist at
      // the new current track first — SET_MEDIA attaches the duration to
      // whatever track Webamp considers current when this fires.
      queueMicrotask(() => this.emit("fileLoaded"));
    }
    // Note: never emit "ended" — the store's FINISH → next() is the sole
    // queue-advance authority; Webamp advancing its own playlist too would
    // double-skip.
  }

  private emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(...args);
  }

  on(event: string, callback: MediaListener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }

  timeElapsed(): number {
    return getPlayerSnapshot().posMs / 1000;
  }

  duration(): number {
    return getPlayerSnapshot().durMs / 1000;
  }

  async play(): Promise<void> {
    play();
  }

  pause(): void {
    pause();
  }

  stop(): void {
    stop();
  }

  seekToPercentComplete(percent: number): void {
    const { durMs } = getPlayerSnapshot();
    if (durMs > 0) seek(Math.round((durMs * percent) / 100));
  }

  async loadFromUrl(url: string, autoPlay: boolean): Promise<void> {
    if (suppressed) return;
    const s = getPlayerSnapshot();
    const current = s.queue[s.index];
    if (current?.url === url) {
      // Same track (e.g. pressing play on the loaded track) — just resume.
      if (autoPlay && !s.playing) play();
      return;
    }
    const at = s.queue.findIndex((t) => t.url === url);
    if (at >= 0) playIndex(at, autoPlay);
    else if (autoPlay) playUrl(url);
  }

  setVolume(volume: number): void {
    setVolume(volume);
  }

  // The widget/file engines have no EQ/balance path — accept and ignore.
  setBalance(_balance: number): void {}
  setPreamp(_value: number): void {}
  setEqBand(_band: unknown, _value: number): void {}
  disableEq(): void {}
  enableEq(): void {}

  getAnalyser(): AnalyserNode {
    // Cross-origin iframe audio can't be analyzed — the visualizer stays flat.
    if (!this.analyser) {
      this.analyser = new AudioContext().createAnalyser();
    }
    return this.analyser;
  }

  dispose(): void {
    // Only detach from the store — closing Winamp must not stop playback.
    this.unsubscribe();
    this.listeners.clear();
  }
}
