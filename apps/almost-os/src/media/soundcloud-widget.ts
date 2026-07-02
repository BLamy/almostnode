// SoundCloud HTML5 Widget API wrapper. This is the browser-native way to play
// real SoundCloud audio with custom controls: the Widget API needs no API key
// and streams in-sandbox. It is the single audio engine behind every music
// surface in almost-os (Winamp/Webamp, the `napster` CLI, the OpenCode agent).
// Napster does NOT play audio — it only downloads virtual mp3s.

export interface SCSound {
  id?: number;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  user?: { username?: string };
}

export interface SCWidget {
  bind(event: string, listener: (e?: unknown) => void): void;
  unbind(event: string): void;
  load(url: string, options?: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(ms: number): void;
  setVolume(volume: number): void;
  next(): void;
  prev(): void;
  getCurrentSound(cb: (sound: SCSound) => void): void;
  getDuration(cb: (ms: number) => void): void;
  isPaused(cb: (paused: boolean) => void): void;
}

interface SCNamespace {
  Widget: {
    (el: HTMLIFrameElement | string): SCWidget;
    Events: Record<string, string>;
  };
}

const WIDGET_API_SRC = "https://w.soundcloud.com/player/api.js";
let loadPromise: Promise<SCNamespace> | null = null;

/** The iframe `src` that embeds a track in SoundCloud's player (chromeless). */
export function widgetPlayerUrl(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "false",
    show_reposts: "false",
    show_teaser: "false",
    visual: "false",
    sharing: "false",
    download: "false",
    buying: "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

export function loadSoundCloudWidgetApi(): Promise<SCNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SoundCloud widget is browser-only"));
  }
  const existing = (window as unknown as { SC?: SCNamespace }).SC;
  if (existing) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_API_SRC;
    script.async = true;
    script.onload = () => {
      const sc = (window as unknown as { SC?: SCNamespace }).SC;
      if (sc) resolve(sc);
      else reject(new Error("SoundCloud Widget API loaded without SC global"));
    };
    script.onerror = () => reject(new Error("Failed to load SoundCloud Widget API"));
    document.head.appendChild(script);
  });
  return loadPromise;
}
