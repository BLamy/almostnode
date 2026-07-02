/**
 * Phase 7 — self-debugging: record the desktop with rrweb + capture
 * network/console/interaction packets, then upload to Replay.io.
 *
 * The heavy lifting (auth, endpoints, gzip envelope) mirrors the `replayio`
 * CLI in `@agent-wasm/core` (`shims/replayio-command.ts`), but the capture
 * source is almost-os's own DOM — the CLI's capture is hardcoded to web-ide's
 * `#webidePreview` iframe, which doesn't exist here.
 *
 * The uploader needs only a valid `/home/user/.replay/auth.json` (the Replay
 * keychain slot) — as the user noted, RECORD_REPLAY_API_KEY placed there is
 * sufficient for upload. rrweb is loaded from esm.sh at runtime (no dep),
 * exactly like the core dev-server capture script.
 */

const REPLAY_BASE = "https://dispatch.replay.io/nut";
const CORS_PROXY = "https://almostnode-cors-proxy.langtail.workers.dev/?url=";
const REPLAY_AUTH_PATH = "/home/user/.replay/auth.json";
const RRWEB_URL = "https://esm.sh/rrweb@2.0.0-alpha.4";

/** One packet in Replay's "nut" simulationData bundle. */
export type SimulationPacket = Record<string, unknown>;

export interface UploadResult {
  visitDataId: string;
  recordingId?: string;
  url?: string;
}

interface MinimalVfs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
}

/** Read the Replay access token from the keychain-managed auth file. */
export function readReplayToken(vfs: MinimalVfs): string | null {
  try {
    if (!vfs.existsSync(REPLAY_AUTH_PATH)) return null;
    const parsed = JSON.parse(vfs.readFileSync(REPLAY_AUTH_PATH, "utf8")) as {
      accessToken?: string;
    };
    return typeof parsed.accessToken === "string" && parsed.accessToken
      ? parsed.accessToken
      : null;
  } catch {
    return null;
  }
}

/** gzip a string using the platform CompressionStream (pako fallback). */
export async function gzipJson(value: unknown): Promise<ArrayBuffer> {
  const json = JSON.stringify(value);
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  const pako = await import("pako");
  return pako.gzip(new TextEncoder().encode(json)).buffer as ArrayBuffer;
}

export interface UploadDeps {
  token: string | null;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Try REPLAY_BASE directly, fall back to the CORS proxy (like replayFetch). */
async function replayPost(
  path: string,
  init: RequestInit,
  token: string | null,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-Client-Info": "almostos/1.0.0",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts: RequestInit = { ...init, headers };
  const url = `${REPLAY_BASE}${path}`;
  try {
    const res = await fetchImpl(url, opts);
    if (res.ok || res.status < 500) return res;
    throw new Error(`status ${res.status}`);
  } catch {
    return fetchImpl(`${CORS_PROXY}${encodeURIComponent(url)}`, opts);
  }
}

/**
 * Upload a simulationData bundle to Replay. Returns the recording URL when a
 * token is present (else just the visitDataId, which still supports chat).
 */
export async function uploadSimulationData(
  packets: SimulationPacket[],
  deps: UploadDeps,
): Promise<UploadResult> {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const compressed = await gzipJson({ simulationData: packets });

  const uploadRes = await replayPost(
    "/create-visit-data",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(compressed.byteLength),
      },
      body: compressed,
    },
    deps.token,
    fetchImpl,
  );
  if (!uploadRes.ok) {
    throw new Error(`Replay upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }
  const uploadJson = (await uploadRes.json()) as { visitDataId?: string; error?: string };
  if (uploadJson.error) throw new Error(`Replay backend error: ${uploadJson.error}`);
  const visitDataId = uploadJson.visitDataId;
  if (!visitDataId) throw new Error("Replay upload returned no visitDataId.");

  const result: UploadResult = { visitDataId };
  try {
    const ensureRes = await replayPost(
      "/ensure-visit-recording",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitDataId }),
      },
      deps.token,
      fetchImpl,
    );
    if (ensureRes.ok) {
      const data = (await ensureRes.json()) as {
        recordingId?: string;
        id?: string;
        url?: string;
        recording?: { id?: string; url?: string };
      };
      const rid = data.recordingId ?? data.id ?? data.recording?.id;
      if (rid) {
        result.recordingId = rid;
        result.url = data.url ?? data.recording?.url ?? `https://app.replay.io/recording/${rid}`;
      }
    }
  } catch {
    // ensure-visit-recording needs auth; without it we keep just the visitDataId.
  }
  return result;
}

// ── live recorder ─────────────────────────────────────────────────────────────

interface RecorderState {
  packets: SimulationPacket[];
  stopRrweb?: () => void;
  restoreFetch?: () => void;
  detachListeners?: () => void;
}

let active: RecorderState | null = null;

/** Start recording the desktop (rrweb DOM + interactions + network + errors). */
export async function startReplayRecording(root: Element = document.body): Promise<void> {
  if (active) return;
  const packets: SimulationPacket[] = [];
  const now = () => performance.now();

  packets.push({
    kind: "metadata",
    version: 1,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    locationHref: window.location.href,
    documentURL: window.location.href,
    colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    time: now(),
  });

  const state: RecorderState = { packets };

  // rrweb DOM snapshots + mutations (CDN, no dependency).
  try {
    const rrweb = (await import(/* @vite-ignore */ RRWEB_URL)) as {
      record: (opts: { emit: (e: unknown) => void; checkoutEveryNms?: number }) => (() => void) | undefined;
    };
    state.stopRrweb = rrweb.record({
      emit: (event) => packets.push({ kind: "rrweb", event, time: now() }),
      checkoutEveryNms: 10_000,
    });
  } catch {
    // rrweb unavailable (offline) — interaction/network packets still record.
  }

  // Interaction packets.
  const onInteract = (type: string) => (event: Event) => {
    const target = event.target as HTMLElement | null;
    packets.push({
      kind: "interaction",
      type,
      time: now(),
      tag: target?.tagName?.toLowerCase(),
      appId: target?.closest?.(".os-window")?.getAttribute("data-app-id") ?? undefined,
    });
  };
  const click = onInteract("click");
  const keydown = onInteract("keydown");
  root.addEventListener("click", click, true);
  root.addEventListener("keydown", keydown, true);
  state.detachListeners = () => {
    root.removeEventListener("click", click, true);
    root.removeEventListener("keydown", keydown, true);
  };

  // Network packets (fetch monkeypatch).
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url ?? String(args[0]);
    packets.push({ kind: "networkRequest", url, time: now() });
    try {
      const res = await originalFetch(...args);
      packets.push({ kind: "networkResponse", url, status: res.status, time: now() });
      return res;
    } catch (error) {
      packets.push({ kind: "detectedError", message: String(error), url, time: now() });
      throw error;
    }
  };
  state.restoreFetch = () => {
    window.fetch = originalFetch;
  };

  active = state;
}

/** True when a recording is in progress. */
export function isReplayRecording(): boolean {
  return active !== null;
}

/** Push a synthetic error packet (e.g. from an app crash boundary). */
export function recordReplayError(message: string, detail?: unknown): void {
  active?.packets.push({
    kind: "detectedError",
    message,
    detail: detail === undefined ? undefined : String(detail),
    time: performance.now(),
  });
}

/** Stop recording and return the captured packets. */
export function stopReplayRecording(): SimulationPacket[] {
  if (!active) return [];
  active.stopRrweb?.();
  active.restoreFetch?.();
  active.detachListeners?.();
  const packets = active.packets;
  active = null;
  return packets;
}
