import { randomUUID } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OAuthLoopbackSession {
  sessionId: string;
  redirectUri: string;
}

export interface OAuthLoopbackCallbackResult {
  callbackUrl: string;
  requestBody?: string | null;
  requestHeaders?: Record<string, string> | null;
  requestMethod?: string | null;
}

export interface OAuthLoopbackService {
  createSession(payload?: {
    allowedOrigins?: unknown;
    callbackPath?: unknown;
    captureBody?: unknown;
    matchAnyPath?: unknown;
    preferredPort?: unknown;
  }): Promise<OAuthLoopbackSession>;
  openExternal(payload?: { sessionId?: unknown; url?: unknown }): Promise<{ opened: true }>;
  waitForCallback(payload?: {
    sessionId?: unknown;
    timeoutMs?: unknown;
    successHtml?: unknown;
  }): Promise<OAuthLoopbackCallbackResult>;
  dispose(): void;
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: unknown,
      payload?: unknown,
    ) => unknown,
  ): void;
}

interface PendingLoopbackSession {
  allowedOrigins: string[] | null;
  sessionId: string;
  callbackPath: string;
  captureBody: boolean;
  redirectUri: string;
  server: HttpServer;
  callbackUrl: string | null;
  matchAnyPath: boolean;
  requestBody: string | null;
  requestHeaders: Record<string, string> | null;
  requestMethod: string | null;
  successHtml: string;
  waiter:
    | {
        resolve: (value: OAuthLoopbackCallbackResult) => void;
        reject: (reason: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | null;
}

const DEFAULT_CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Authentication complete</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Authentication complete</h1>
      <p>You can close this window and return to almostnode.</p>
    </main>
  </body>
</html>`;

function normalizeCallbackPath(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CALLBACK_PATH;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_CALLBACK_PATH;
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('OAuth callback paths must start with "/".');
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('OAuth callback paths cannot include a query string or fragment.');
  }
  return trimmed;
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('OAuth loopback payload is missing a sessionId.');
  }
  return value.trim();
}

function normalizePreferredPort(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error('OAuth loopback preferredPort must be an integer between 1 and 65535.');
  }
  return value;
}

function normalizeExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('OAuth loopback payload is missing a URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('OAuth loopback payload provided an invalid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OAuth loopback only supports http:// and https:// URLs.');
  }
  return parsed.toString();
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return fallback;
}

function normalizeAllowedOrigins(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const origins = value
    .map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        return null;
      }
      try {
        return new URL(entry.trim()).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];

  return origins.length > 0 ? Array.from(new Set(origins)) : null;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(600_000, Math.max(1_000, Math.floor(value)));
}

function normalizeSuccessHtml(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_SUCCESS_HTML;
  }
  return value;
}

function writeHtmlResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(body);
}

function writeTextResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(body);
}

function applyCorsHeaders(
  response: ServerResponse,
  session: PendingLoopbackSession,
  originHeader: string | undefined,
): boolean {
  if (!session.allowedOrigins || session.allowedOrigins.length === 0) {
    return true;
  }

  const origin = typeof originHeader === 'string' ? originHeader.trim() : '';
  if (!origin || !session.allowedOrigins.includes(origin)) {
    return false;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Vary', 'Origin');
  return true;
}

async function readRequestBody(
  request: IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeHeaders(
  headers: IncomingMessage['headers'],
): Record<string, string> | null {
  const entries = Object.entries(headers)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value] as const;
      }
      if (Array.isArray(value) && value.length > 0) {
        return [key, value.join(', ')] as const;
      }
      return null;
    })
    .filter(Boolean) as Array<readonly [string, string]>;

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function createOAuthLoopbackService(
  options?: {
    openExternal?: (url: string) => Promise<void>;
  },
): OAuthLoopbackService {
  const sessions = new Map<string, PendingLoopbackSession>();
  const openExternal = options?.openExternal
    ?? (async () => {
      throw new Error('No host browser opener is configured for OAuth loopback.');
    });

  const cleanupSession = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    sessions.delete(sessionId);
    if (session.waiter) {
      clearTimeout(session.waiter.timer);
      session.waiter = null;
    }

    try {
      session.server.close();
    } catch {
      // Ignore shutdown errors.
    }
  };

  const getSession = (sessionId: unknown): PendingLoopbackSession => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = sessions.get(normalizedSessionId);
    if (!session) {
      throw new Error('OAuth loopback session was not found.');
    }
    return session;
  };

  return {
    async createSession(payload?: {
      allowedOrigins?: unknown;
      callbackPath?: unknown;
      captureBody?: unknown;
      matchAnyPath?: unknown;
      preferredPort?: unknown;
    }): Promise<OAuthLoopbackSession> {
      const callbackPath = normalizeCallbackPath(payload?.callbackPath);
      const allowedOrigins = normalizeAllowedOrigins(payload?.allowedOrigins);
      const captureBody = normalizeBoolean(payload?.captureBody, false);
      const matchAnyPath = normalizeBoolean(payload?.matchAnyPath, false);
      const preferredPort = normalizePreferredPort(payload?.preferredPort);
      const server = createHttpServer();
      const sessionId = randomUUID();

      const redirectUri = await new Promise<string>((resolve, reject) => {
        server.once('error', reject);
        server.listen(preferredPort ?? 0, '127.0.0.1', () => {
          const address = server.address() as AddressInfo | null;
          if (!address) {
            reject(new Error('OAuth loopback listener did not expose a listening address.'));
            return;
          }
          resolve(`http://127.0.0.1:${address.port}${callbackPath}`);
        });
      });

      const session: PendingLoopbackSession = {
        allowedOrigins,
        sessionId,
        callbackPath,
        captureBody,
        redirectUri,
        server,
        callbackUrl: null,
        matchAnyPath,
        requestBody: null,
        requestHeaders: null,
        requestMethod: null,
        successHtml: DEFAULT_SUCCESS_HTML,
        waiter: null,
      };

      server.on('request', (request: IncomingMessage, response: ServerResponse) => {
        void (async () => {
          let pathname = '';
          let callbackUrl = '';

          try {
            const parsed = new URL(request.url || callbackPath, redirectUri);
            pathname = parsed.pathname;
            callbackUrl = parsed.toString();
          } catch {
            writeTextResponse(response, 400, 'Invalid callback URL.');
            return;
          }

          if (request.method === 'OPTIONS') {
            if (!applyCorsHeaders(response, session, request.headers.origin)) {
              writeTextResponse(response, 403, 'Origin not allowed.');
              return;
            }
            response.statusCode = 204;
            response.end();
            return;
          }

          if (!session.matchAnyPath && pathname !== session.callbackPath) {
            writeTextResponse(response, 404, 'Not found.');
            return;
          }

          if (!applyCorsHeaders(response, session, request.headers.origin)) {
            writeTextResponse(response, 403, 'Origin not allowed.');
            return;
          }

          const requestBody = session.captureBody
            ? await readRequestBody(request)
            : null;

          session.callbackUrl = callbackUrl;
          session.requestBody = requestBody;
          session.requestHeaders = normalizeHeaders(request.headers);
          session.requestMethod = request.method || null;
          writeHtmlResponse(response, 200, session.successHtml);

          if (session.waiter) {
            const waiter = session.waiter;
            session.waiter = null;
            clearTimeout(waiter.timer);
            waiter.resolve({
              callbackUrl,
              requestBody,
              requestHeaders: session.requestHeaders,
              requestMethod: session.requestMethod,
            });
            cleanupSession(session.sessionId);
          }
        })().catch((error) => {
          writeTextResponse(
            response,
            500,
            error instanceof Error ? error.message : 'OAuth loopback request failed.',
          );
        });
      });

      sessions.set(sessionId, session);
      return { sessionId, redirectUri };
    },

    async openExternal(payload?: { sessionId?: unknown; url?: unknown }): Promise<{ opened: true }> {
      const session = getSession(payload?.sessionId);
      const url = normalizeExternalUrl(payload?.url);
      await openExternal(url);
      if (!sessions.has(session.sessionId)) {
        throw new Error('OAuth loopback session ended before the browser was opened.');
      }
      return { opened: true };
    },

    async waitForCallback(payload?: {
      sessionId?: unknown;
      timeoutMs?: unknown;
      successHtml?: unknown;
    }): Promise<OAuthLoopbackCallbackResult> {
      const session = getSession(payload?.sessionId);
      if (session.callbackUrl) {
        const result: OAuthLoopbackCallbackResult = {
          callbackUrl: session.callbackUrl,
          requestBody: session.requestBody,
          requestHeaders: session.requestHeaders,
          requestMethod: session.requestMethod,
        };
        cleanupSession(session.sessionId);
        return result;
      }
      if (session.waiter) {
        throw new Error('OAuth loopback session is already waiting for a callback.');
      }

      const timeoutMs = normalizeTimeoutMs(payload?.timeoutMs);
      session.successHtml = normalizeSuccessHtml(payload?.successHtml);

      return new Promise<OAuthLoopbackCallbackResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          session.waiter = null;
          cleanupSession(session.sessionId);
          reject(new Error(`Authentication timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);

        session.waiter = {
          resolve: (value) => resolve(value),
          reject,
          timer,
        };
      });
    },

    dispose(): void {
      for (const sessionId of Array.from(sessions.keys())) {
        cleanupSession(sessionId);
      }
    },
  };
}

export function setupOAuthLoopbackIpcHandlers(
  ipcMain: IpcMainLike,
  service: OAuthLoopbackService,
): void {
  ipcMain.handle('oauth-loopback:create', (_event, payload: {
    allowedOrigins?: unknown;
    callbackPath?: unknown;
    captureBody?: unknown;
    matchAnyPath?: unknown;
    preferredPort?: unknown;
  } | undefined) => {
    return service.createSession(payload);
  });

  ipcMain.handle(
    'oauth-loopback:open-external',
    (_event, payload: { sessionId?: unknown; url?: unknown } | undefined) => {
      return service.openExternal(payload);
    },
  );

  ipcMain.handle(
    'oauth-loopback:wait',
    (
      _event,
      payload: {
        sessionId?: unknown;
        timeoutMs?: unknown;
        successHtml?: unknown;
      } | undefined,
    ) => {
      return service.waitForCallback(payload);
    },
  );
}
