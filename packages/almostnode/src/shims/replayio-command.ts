import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { readReplayAuth, writeReplayAuth, deleteReplayAuth, type ReplayAuthConfig } from './replay-auth';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string): JustBashExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

// ── Module-level state ──────────────────────────────────────────────────────

interface CachedRecording {
  id: number;
  timestamp: string;
  url: string;
  eventCount: number;
  sizeBytes: number;
  data: ArrayBuffer;
  /** Set after successful upload to Replay */
  visitDataId?: string;
  /** Set if ensure-visit-recording returns one (requires auth) */
  recordingId?: string;
  replayUrl?: string;
}

const MAX_CACHE = 25;
const recordingCache: CachedRecording[] = [];
let nextRecordingId = 1;

// ── CORS proxy & API ────────────────────────────────────────────────────────

const CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const REPLAY_BASE = 'https://dispatch.replay.io/nut';

// ── Auth constants ──────────────────────────────────────────────────────────

const AUTH0_CLIENT_ID = '4FvFnJJW4XlnUyrXQF8zOLw6vNAH1MAo';
const AUTH0_TOKEN_URL = 'https://webreplay.us.auth0.com/oauth/token';
const REPLAY_API = 'https://api.replay.io';
const REPLAY_APP = 'https://app.replay.io';

// Stable appId for this session (matching how the appTemplate generates one)
const APP_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Client identification headers matching the recording extension's format
const CLIENT_SESSION_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function clientHeaders(): Record<string, string> {
  return {
    'X-Client-Info': 'almostnode-webide/1.0.0',
    'X-Client-Session-Id': CLIENT_SESSION_ID,
  };
}

async function replayFetch(
  path: string,
  options: RequestInit = {},
  authenticated = false,
  vfs?: VirtualFS,
): Promise<Response> {
  // Merge client headers into every request
  const headers: Record<string, string> = {
    ...clientHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };

  // Inject auth token when requested
  if (authenticated && vfs) {
    const token = await getValidAccessToken(vfs);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const opts = { ...options, headers };

  const url = `${REPLAY_BASE}${path}`;
  try {
    const res = await fetch(url, opts);
    if (res.ok || res.status < 500) return res;
    throw new Error(`status ${res.status}`);
  } catch {
    // Retry via CORS proxy
    const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
    return fetch(proxiedUrl, opts);
  }
}

// ── Proxy fetch (for non-REPLAY_BASE URLs) ──────────────────────────────────

async function fetchViaProxy(url: string, opts: RequestInit = {}): Promise<Response> {
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
  return fetch(proxiedUrl, opts);
}

// ── Auth flow helpers ───────────────────────────────────────────────────────

async function generateAuthKey(): Promise<string> {
  // Match replay-cli: hashValue(String(performance.now())) → SHA-256 hex
  const value = String(globalThis.performance.now());
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function parseJwtExpiry(jwt: string): number {
  const payload = parseJwtPayload(jwt);
  if (payload && typeof payload.exp === 'number') {
    return payload.exp * 1000; // convert seconds to ms
  }
  // Default: 1 hour from now
  return Date.now() + 3600_000;
}

function parseJwtEmail(jwt: string): string | null {
  const payload = parseJwtPayload(jwt);
  if (!payload) return null;
  if (typeof payload.email === 'string') return payload.email;
  if (typeof payload.sub === 'string') return payload.sub;
  return null;
}

async function pollForReplayToken(key: string): Promise<string> {
  // Match replay-cli: mutation shape with success + token fields
  const mutation = `
    mutation CloseAuthRequest($key: String!) {
      closeAuthRequest(input: { key: $key }) {
        success
        token
      }
    }
  `;

  // Match replay-cli: first attempt is immediate, then 2.5s delay on retry
  const maxAttempts = 120; // ~5 minutes
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchViaProxy(`${REPLAY_API}/v1/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: mutation,
          name: 'CloseAuthRequest',
          variables: { key },
        }),
      });

      if (!res.ok) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        continue;
      }

      const json = await res.json() as {
        data?: { closeAuthRequest?: { success?: boolean; token?: string } };
        errors?: Array<{ message: string }>;
      };

      // Match replay-cli: check top-level GraphQL errors
      if (json.errors) {
        const isMissing = json.errors.length === 1 &&
          json.errors[0].message === 'Authentication request does not exist';
        if (isMissing) {
          // Auth request not created yet — retry
          await new Promise(resolve => setTimeout(resolve, 2500));
          continue;
        }
        // Any other GraphQL error is fatal
        throw new Error(json.errors.map(e => e.message).filter(Boolean).join(', '));
      }

      const token = json.data?.closeAuthRequest?.token;
      if (token) return token;

      // Request exists but no token yet — shouldn't normally happen
      // but treat it as retryable
      await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (e) {
      // Network errors — rethrow
      if (e instanceof Error) throw e;
      throw new Error(String(e));
    }
  }

  throw new Error('Login timed out after 5 minutes. Please try again.');
}

async function exchangeRefreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  // Match replay-cli: include audience and scope for proper token exchange
  const res = await fetchViaProxy(AUTH0_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience: 'https://api.replay.io',
      scope: 'openid profile',
      grant_type: 'refresh_token',
      client_id: AUTH0_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Auth0 token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { access_token?: string; refresh_token?: string; error?: string };
  if (data.error) throw new Error(`Auth0 error: ${data.error}`);
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Auth0 returned no access or refresh token');
  }

  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function getValidAccessToken(vfs: VirtualFS): Promise<string | null> {
  const auth = readReplayAuth(vfs);
  if (!auth) return null;

  // Check if token is still valid (with 60s buffer)
  if (auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken;
  }

  // Token expired — try to refresh (Auth0 token rotation returns new refresh token too)
  try {
    const { accessToken, refreshToken } = await exchangeRefreshToken(auth.refreshToken);
    const updated: ReplayAuthConfig = {
      ...auth,
      accessToken,
      refreshToken,
      expiresAt: parseJwtExpiry(accessToken),
      userInfo: parseJwtEmail(accessToken) || auth.userInfo,
    };
    writeReplayAuth(vfs, updated);
    return accessToken;
  } catch {
    // Refresh failed — token is stale
    return null;
  }
}

// ── Preview iframe access ───────────────────────────────────────────────────

function getPreviewIframe(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('webidePreview') as HTMLIFrameElement | null;
}

// ── Recording extraction via @@replay-nut protocol ──────────────────────────

async function extractRecording(): Promise<{ data: ArrayBuffer; url: string }> {
  const iframe = getPreviewIframe();
  if (!iframe) throw new Error('No preview iframe found. Run your dev server first.');

  const win = iframe.contentWindow;
  if (!win) throw new Error('Preview iframe has no window. Wait for the page to load.');

  const messageId = `replay-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const iframeSrc = iframe.src || '(unknown)';

  return new Promise<{ data: ArrayBuffer; url: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(
        new Error(
          'Timed out waiting for recording data (10s). Make sure the preview has loaded.',
        ),
      );
    }, 10_000);

    function handler(event: MessageEvent) {
      if (!event.data || event.data.source !== '@@replay-nut' || event.data.id !== messageId) return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      const response = event.data.response;
      if (response instanceof ArrayBuffer) {
        resolve({ data: response, url: iframeSrc });
      } else if (response && typeof response === 'object' && response.buffer instanceof ArrayBuffer) {
        resolve({ data: response.buffer, url: iframeSrc });
      } else if (typeof response === 'string') {
        const encoded = new TextEncoder().encode(response);
        resolve({ data: encoded.buffer, url: iframeSrc });
      } else {
        reject(new Error('Unexpected recording data format'));
      }
    }

    window.addEventListener('message', handler);

    win.postMessage(
      {
        id: messageId,
        request: { request: 'recording-data' },
        source: '@@replay-nut',
      },
      '*',
    );
  });
}

function estimateEventCount(data: ArrayBuffer): number {
  try {
    const text = new TextDecoder().decode(data.slice(0, Math.min(data.byteLength, 1024 * 1024)));
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && Array.isArray(parsed.events)) return parsed.events.length;
    if (parsed && Array.isArray(parsed.simulationData)) return parsed.simulationData.length;
  } catch {
    // Binary data — estimate from size
  }
  return Math.max(1, Math.floor(data.byteLength / 200));
}

// ── Subcommands ─────────────────────────────────────────────────────────────

async function cmdCapture(): Promise<JustBashExecResult> {
  try {
    const { data, url } = await extractRecording();
    const id = nextRecordingId++;
    const eventCount = estimateEventCount(data);
    const recording: CachedRecording = {
      id,
      timestamp: new Date().toISOString(),
      url,
      eventCount,
      sizeBytes: data.byteLength,
      data,
    };

    recordingCache.push(recording);
    if (recordingCache.length > MAX_CACHE) {
      recordingCache.shift();
    }

    const sizeKB = (data.byteLength / 1024).toFixed(1);
    return ok(
      `Captured recording #${id} (${eventCount} events, ${sizeKB} KB)\n` +
        `Use 'replayio upload ${id}' to upload to Replay for analysis.\n`,
    );
  } catch (e) {
    return err(`capture failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function cmdLs(): Promise<JustBashExecResult> {
  // Auto-capture if cache is empty and iframe is live
  if (recordingCache.length === 0) {
    const iframe = getPreviewIframe();
    if (iframe && iframe.contentWindow) {
      const captureResult = await cmdCapture();
      if (captureResult.exitCode !== 0) {
        return ok('(no recordings cached)\n');
      }
    } else {
      return ok('(no recordings cached)\n');
    }
  }

  const lines = ['ID  Timestamp                  Events  Size      Uploaded'];
  lines.push('──  ─────────────────────────  ──────  ────────  ────────');
  for (const rec of recordingCache) {
    const ts = rec.timestamp.replace('T', ' ').slice(0, 19);
    const sizeKB = (rec.sizeBytes / 1024).toFixed(1) + ' KB';
    const uploaded = rec.visitDataId ? 'yes' : 'no';
    lines.push(
      `${String(rec.id).padEnd(4)}${ts.padEnd(27)}${String(rec.eventCount).padEnd(8)}${sizeKB.padEnd(10)}${uploaded}`,
    );
  }
  return ok(lines.join('\n') + '\n');
}

async function cmdUpload(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  const idStr = args[0];
  if (!idStr) return err('Usage: replayio upload <id>\n');

  const id = parseInt(idStr, 10);
  const recording = recordingCache.find((r) => r.id === id);
  if (!recording) return err(`Recording #${id} not found. Run 'replayio ls' to see available recordings.\n`);

  // If already uploaded, return the existing visitDataId
  if (recording.visitDataId) {
    return ok(
      `Recording #${id} already uploaded.\n` +
        `  Visit Data ID: ${recording.visitDataId}\n` +
        (recording.recordingId ? `  Recording ID: ${recording.recordingId}\n` : '') +
        `\nUse 'replayio chat ${recording.visitDataId} "your question"' to ask about this recording.\n`,
    );
  }

  try {
    // Step 1: Decode ArrayBuffer → simulationData array, wrap in envelope
    const jsonText = new TextDecoder().decode(recording.data);
    let simulationDataArray: unknown[];
    try {
      const parsed = JSON.parse(jsonText);
      simulationDataArray = Array.isArray(parsed) ? parsed : parsed.simulationData ?? [parsed];
    } catch {
      return err('Recording data is not valid JSON. Try capturing again.\n');
    }

    // Step 2: Wrap in { simulationData: [...] } envelope (matching uploadStreaming.ts:uploadVisitData)
    const visitData = { simulationData: simulationDataArray };

    // Step 3: Gzip using CompressionStream (matching compressJSON in reference)
    let compressed: ArrayBuffer;
    if (typeof CompressionStream !== 'undefined') {
      const jsonString = JSON.stringify(visitData);
      const blob = new Blob([jsonString]);
      const compressedStream = (blob.stream() as ReturnType<Blob['stream']>).pipeThrough(
        new CompressionStream('gzip'),
      );
      compressed = await new Response(compressedStream).blob().then((b) => b.arrayBuffer());
    } else {
      // Fallback to pako if CompressionStream not available
      const pako = await import('pako');
      compressed = pako.gzip(new TextEncoder().encode(JSON.stringify(visitData))).buffer;
    }

    // Check auth once, used for both upload and ensure-visit-recording
    const isLoggedIn = readReplayAuth(vfs) !== null;

    // Step 4: Upload to create-visit-data
    const uploadRes = await replayFetch('/create-visit-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(compressed.byteLength),
      },
      body: compressed,
    }, isLoggedIn, vfs);

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      return err(`Upload failed (${uploadRes.status}): ${body}\n`);
    }

    const uploadJson = (await uploadRes.json()) as { visitDataId?: string; error?: string };

    // Check for server-side error in response body
    if (typeof uploadJson.error === 'string' && uploadJson.error.trim()) {
      return err(`Upload backend error: ${uploadJson.error.trim()}\n`);
    }

    const visitDataId = uploadJson.visitDataId;
    if (!visitDataId) return err('Upload succeeded but no visitDataId returned.\n');

    // Store visitDataId on the cached recording
    recording.visitDataId = visitDataId;

    // Step 5: Try ensure-visit-recording ONCE (requires auth, may return empty)
    // The recording extension only calls this once with a Bearer token.
    // Without auth the server returns {} — that's expected.
    let recordingId: string | undefined;
    let replayUrl: string | undefined;

    try {
      const ensureRes = await replayFetch('/ensure-visit-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitDataId }),
      }, isLoggedIn, vfs);

      if (ensureRes.ok) {
        const ensureData = (await ensureRes.json()) as {
          recordingId?: string;
          id?: string;
          url?: string;
          recording?: { id?: string; url?: string };
        };
        const rid = ensureData.recordingId ?? ensureData.id ?? ensureData.recording?.id;
        if (rid) {
          recordingId = rid;
          replayUrl =
            ensureData.url ?? ensureData.recording?.url ?? `https://app.replay.io/recording/${rid}`;
          recording.recordingId = recordingId;
          recording.replayUrl = replayUrl;
        }
      }
    } catch {
      // ensure-visit-recording failed — that's fine, we have visitDataId
    }

    if (recordingId) {
      return ok(
        `Recording uploaded successfully!\n` +
          `  Recording ID: ${recordingId}\n` +
          `  URL: ${replayUrl}\n\n` +
          `Use 'replayio chat ${recordingId} "your question"' to ask about this recording.\n`,
      );
    }

    // No recordingId (auth required) — use visitDataId for chat via /nut/chat
    const loginHint = !isLoggedIn
      ? `\nTip: Run 'replayio login' to get a full recording URL on upload.\n`
      : '';
    return ok(
      `Recording uploaded successfully!\n` +
        `  Visit Data ID: ${visitDataId}\n\n` +
        `Use 'replayio chat ${visitDataId} "your question"' to ask about this recording.\n` +
        loginHint,
    );
  } catch (e) {
    return err(`upload failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function resolveRecordingId(id: string, vfs: VirtualFS): Promise<string | null> {
  // Check if it's already a recordingId on a cached recording
  const cachedByRecId = recordingCache.find((r) => r.recordingId === id);
  if (cachedByRecId) return id;

  // Check if it's a visitDataId — look up the cached recordingId
  const cachedByVisit = recordingCache.find((r) => r.visitDataId === id);
  if (cachedByVisit?.recordingId) return cachedByVisit.recordingId;

  // If it's a visitDataId without a recordingId, poll ensure-visit-recording
  // The server may still be processing — retry up to 6 times (~15s)
  const visitDataId = cachedByVisit ? id : null;
  if (visitDataId) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      try {
        const ensureRes = await replayFetch('/ensure-visit-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitDataId }),
        }, true, vfs);

        if (ensureRes.ok) {
          const data = (await ensureRes.json()) as {
            recordingId?: string; id?: string; recording?: { id?: string };
          };
          const rid = data.recordingId ?? data.id ?? data.recording?.id;
          if (rid) {
            if (cachedByVisit) {
              cachedByVisit.recordingId = rid;
              cachedByVisit.replayUrl = `https://app.replay.io/recording/${rid}`;
            }
            return rid;
          }
        }
      } catch {
        // retry
      }
    }
    return null;
  }

  // Assume it's a recordingId directly (e.g. pasted from Replay URL)
  return id;
}

async function cmdChat(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  const id = args[0];
  const message = args.slice(1).join(' ');

  if (!id || !message) {
    return err('Usage: replayio chat <recordingId|visitDataId> "message"\n');
  }

  try {
    const recordingId = await resolveRecordingId(id, vfs);
    if (!recordingId) {
      return err(
        `Could not resolve a recording ID from "${id}".\n` +
        `The recording may still be processing. Wait a moment and try again.\n`,
      );
    }

    // POST /nut/recording/{recordingId}/chat — NO auth headers
    // (the extension explicitly comments out auth: "/chat will 403 if you pass it auth headers")
    const res = await replayFetch(`/recording/${recordingId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: JSON.stringify({ role: 'user', content: message }),
    });

    if (!res.ok) {
      const body = await res.text();
      return err(`Chat failed (${res.status}): ${body}\n`);
    }

    // Response is NDJSON — collect all lines
    const text = await res.text();
    const lines = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed.text || parsed.content || parsed.message || JSON.stringify(parsed);
        } catch {
          return line;
        }
      });

    return ok(lines.join('') + '\n');
  } catch (e) {
    return err(`chat failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function cmdAnalyze(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  const id = args[0];
  const goal = args.slice(1).join(' ') || 'Analyze this recording for issues and provide a summary.';

  if (!id) {
    return err('Usage: replayio analyze <recordingId|visitDataId> [goal]\n');
  }

  try {
    const recordingId = await resolveRecordingId(id, vfs);
    if (!recordingId) {
      return err(
        `Could not resolve a recording ID from "${id}".\n` +
        `The recording may still be processing. Wait a moment and try again.\n`,
      );
    }

    // POST /nut/recording/{recordingId}/analyze — WITH auth (matching extension)
    const res = await replayFetch(`/recording/${recordingId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    }, true, vfs);

    if (!res.ok) {
      const body = await res.text();
      return err(`Analysis failed (${res.status}): ${body}\n`);
    }

    const data = (await res.json()) as { explanation?: string; error?: string };
    if (typeof data.error === 'string' && data.error.trim()) {
      return err(`Analysis error: ${data.error.trim()}\n`);
    }

    const explanation = data.explanation || 'No explanation returned.';
    return ok(explanation + '\n');
  } catch (e) {
    return err(`analyze failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

// ── Auth subcommands ────────────────────────────────────────────────────────

async function cmdLogin(
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  // Check if already logged in
  const existing = readReplayAuth(vfs);
  if (existing) {
    const info = existing.userInfo || '(unknown user)';
    return ok(`Already logged in as ${info}. Run 'replayio logout' first to switch accounts.\n`);
  }

  if (typeof window === 'undefined') {
    return err('Login requires a browser environment.\n');
  }

  try {
    const key = await generateAuthKey();
    const authUrl = `${REPLAY_APP}/api/browser/auth?key=${key}&source=cli`;

    // Open auth page in new tab
    const authWindow = window.open(authUrl, '_blank');
    if (!authWindow) {
      return err(
        `Could not open auth page. Please visit this URL manually:\n  ${authUrl}\n`,
      );
    }

    // Poll for token
    const refreshToken = await pollForReplayToken(key);

    // Exchange refresh token for access token via Auth0
    // Auth0 token rotation: returns both a new access token and a new refresh token
    const exchanged = await exchangeRefreshToken(refreshToken);

    // Parse JWT for expiry and user info
    const expiresAt = parseJwtExpiry(exchanged.accessToken);
    const userInfo = parseJwtEmail(exchanged.accessToken);

    // Write to VFS — store the rotated refresh token from Auth0
    const config: ReplayAuthConfig = {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt,
      userInfo: userInfo || null,
    };
    writeReplayAuth(vfs, config);

    // Persist to keychain
    if (keychain) {
      await keychain.persistCurrentState();
    }

    const displayUser = userInfo || '(authenticated)';
    return ok(`Logged in as ${displayUser}\n`);
  } catch (e) {
    return err(`login failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function cmdLogout(
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const deleted = deleteReplayAuth(vfs);
  if (!deleted) {
    return ok('Not logged in.\n');
  }

  // Persist removal to keychain
  if (keychain) {
    await keychain.persistCurrentState();
  }

  return ok('Logged out of Replay.\n');
}

function cmdWhoami(vfs: VirtualFS): JustBashExecResult {
  const auth = readReplayAuth(vfs);
  if (!auth) {
    return ok('Not logged in. Run \'replayio login\' to authenticate.\n');
  }

  const user = auth.userInfo || '(unknown user)';
  const expired = auth.expiresAt < Date.now();
  const expiryStr = new Date(auth.expiresAt).toISOString().replace('T', ' ').slice(0, 19);

  if (expired) {
    return ok(`Logged in as ${user} (token expired at ${expiryStr}, will auto-refresh on next use)\n`);
  }

  return ok(`Logged in as ${user} (token expires ${expiryStr})\n`);
}

function cmdHelp(): JustBashExecResult {
  return ok(
    `replayio — capture and analyze app recordings with Replay

Commands:
  login                        Authenticate with Replay via browser OAuth
  logout                       Clear saved Replay credentials
  whoami                       Show current auth status
  capture                      Extract recording from preview iframe
  ls                           List cached recordings (auto-captures if empty)
  upload <id>                  Upload recording to Replay for analysis
  chat <visitDataId> "msg"     Chat with Replay AI about a recording
  analyze <visitDataId> [goal] Full analysis of a recording
  help                         Show this help message

Workflow:
  1. replayio login                — authenticate with Replay
  2. replayio capture              — grab recording from live preview
  3. replayio upload 1             — upload to Replay platform
  4. replayio chat <id> "why?"     — ask questions about the recording
  5. replayio analyze <id>         — get full root-cause analysis

The recording captures rrweb DOM snapshots, user interactions, network
activity, and errors — giving Replay AI full context for debugging.
`,
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runReplayioCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return cmdHelp();
  }

  switch (subcommand) {
    case 'login':
      return cmdLogin(vfs, keychain);
    case 'logout':
      return cmdLogout(vfs, keychain);
    case 'whoami':
      return cmdWhoami(vfs);
    case 'capture':
      return cmdCapture();
    case 'ls':
    case 'list':
      return cmdLs();
    case 'upload':
      return cmdUpload(args.slice(1), vfs);
    case 'chat':
      return cmdChat(args.slice(1), vfs);
    case 'analyze':
    case 'analysis':
      return cmdAnalyze(args.slice(1), vfs);
    default:
      return err(`unknown command: ${subcommand}. Run 'replayio help' for usage.\n`);
  }
}
