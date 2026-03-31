import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const PROXY_PATH = '/__api/cors-proxy';
const WS_RELAY_PATH = '/__api/ws-relay';
const UPSTREAM_STATUS_HEADER = 'x-almostnode-upstream-status';
const UPSTREAM_STATUS_TEXT_HEADER = 'x-almostnode-upstream-status-text';
const HOP_BY_HOP_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const WS_RESERVED_HEADERS = new Set([
  'connection',
  'upgrade',
  'host',
  'sec-websocket-accept',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
]);
const wsRelayServers = new WeakMap<object, WebSocketServer>();

function isAllowedTarget(target: URL): boolean {
  return target.protocol === 'http:' || target.protocol === 'https:';
}

function isAllowedWebSocketTarget(target: URL): boolean {
  return target.protocol === 'ws:' || target.protocol === 'wss:';
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

function copyRequestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower)
      || lower === 'origin'
      || lower === 'referer'
      || lower.startsWith('sec-fetch-')
      || lower.startsWith('sec-ch-ua')
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  // Replace browser User-Agent with a Node.js-like one
  headers.set('User-Agent', 'node');

  return headers;
}

function writeResponse(
  res: ServerResponse,
  upstream: Response,
  body: Buffer,
): void {
  const isRedirect =
    upstream.status >= 300
    && upstream.status < 400
    && upstream.headers.has('location');

  // Expose upstream redirects as metadata instead of forwarding a 3xx status.
  // Browser fetch() turns manual cross-origin redirects into opaqueredirect
  // responses with status=0, which breaks the runtime redirect loop.
  res.statusCode = isRedirect ? 200 : upstream.status;
  res.statusMessage = isRedirect ? 'OK' : upstream.statusText;

  if (isRedirect) {
    res.setHeader(UPSTREAM_STATUS_HEADER, String(upstream.status));
    res.setHeader(UPSTREAM_STATUS_TEXT_HEADER, upstream.statusText || '');
  }

  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower)
      || lower === 'content-encoding'
      || lower === 'content-length'
    ) {
      continue;
    }
    res.setHeader(key, value);
  }

  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function decodeRelayJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function parseWebSocketRelayRequest(rawUrl: string): {
  target: URL;
  headers: Record<string, string>;
  protocols: string[];
} {
  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  const rawTarget = parsed.searchParams.get('url');
  if (!rawTarget) {
    throw new Error('Missing ?url= query parameter');
  }

  const target = new URL(rawTarget);
  if (!isAllowedWebSocketTarget(target)) {
    throw new Error('Unsupported target protocol');
  }

  const headers = decodeRelayJson<Record<string, string>>(
    parsed.searchParams.get('headers'),
  ) || {};
  const protocols = decodeRelayJson<string[]>(
    parsed.searchParams.get('protocols'),
  ) || [];

  const sanitizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (WS_RESERVED_HEADERS.has(lower)) {
      continue;
    }
    if (typeof value === 'string' && value) {
      sanitizedHeaders[key] = value;
    }
  }

  return {
    target,
    headers: sanitizedHeaders,
    protocols: protocols.filter((value) => typeof value === 'string' && value.trim().length > 0),
  };
}

function relayClose(
  source: WebSocket,
  target: WebSocket,
  code: number,
  reason: Buffer | string,
): void {
  if (target.readyState === WebSocket.CLOSED || target.readyState === WebSocket.CLOSING) {
    return;
  }

  const normalizedReason = typeof reason === 'string'
    ? reason
    : reason.toString('utf8');
  target.close(code || 1000, normalizedReason.slice(0, 123));
}

function attachSocketRelay(
  client: WebSocket,
  upstream: WebSocket,
): void {
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on('close', (code, reason) => {
    relayClose(client, upstream, code, reason);
  });

  upstream.on('close', (code, reason) => {
    relayClose(upstream, client, code, reason);
  });

  client.on('error', () => {
    if (upstream.readyState !== WebSocket.CLOSED) {
      upstream.close(1011, 'relay client error');
    }
  });

  upstream.on('error', () => {
    if (client.readyState !== WebSocket.CLOSED) {
      client.close(1011, 'relay upstream error');
    }
  });
}

function attachProxyUpgrade(server: ViteDevServer | PreviewServer): void {
  const httpServer = (server as ViteDevServer & { httpServer?: object | null }).httpServer;
  if (!httpServer || wsRelayServers.has(httpServer)) {
    return;
  }

  const relayServer = new WebSocketServer({ noServer: true });
  wsRelayServers.set(httpServer, relayServer);

  (httpServer as {
    on: (
      event: 'upgrade',
      listener: (
        req: IncomingMessage,
        socket: import('net').Socket,
        head: Buffer,
      ) => void,
    ) => void,
  }).on('upgrade', (req, socket, head) => {
    const pathname = req.url
      ? new URL(req.url, 'http://127.0.0.1').pathname
      : '';
    if (pathname !== WS_RELAY_PATH) {
      return;
    }

    let relayRequest: ReturnType<typeof parseWebSocketRelayRequest>;
    try {
      relayRequest = parseWebSocketRelayRequest(req.url || '/');
    } catch (error) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy(error instanceof Error ? error : undefined);
      return;
    }

    relayServer.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(
        relayRequest.target,
        relayRequest.protocols.length > 0 ? relayRequest.protocols : undefined,
        {
          headers: relayRequest.headers,
        },
      );
      attachSocketRelay(client, upstream);
    });
  });
}

async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = new URL(req.url || '/', 'http://127.0.0.1');
  const rawTarget = parsed.searchParams.get('url');

  if (!rawTarget) {
    res.statusCode = 400;
    res.end('Missing ?url= query parameter');
    return;
  }

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    res.statusCode = 400;
    res.end('Invalid target URL');
    return;
  }

  if (!isAllowedTarget(target)) {
    res.statusCode = 400;
    res.end('Unsupported target protocol');
    return;
  }

  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readRequestBody(req);

  const upstream = await fetch(target, {
    method,
    headers: copyRequestHeaders(req),
    body,
    redirect: 'manual',
  });

  const responseBody = method === 'HEAD'
    ? Buffer.alloc(0)
    : Buffer.from(await upstream.arrayBuffer());

  writeResponse(res, upstream, responseBody);
}

function attachProxyMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (req, res, next) => {
    const pathname = req.url
      ? new URL(req.url, 'http://127.0.0.1').pathname
      : '';

    if (pathname !== PROXY_PATH) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.end();
      return;
    }

    try {
      await handleProxyRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Proxy error: ${message}`);
    }
  });
}

export function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      attachProxyMiddleware(server);
      attachProxyUpgrade(server);
    },
    configurePreviewServer(server) {
      attachProxyMiddleware(server);
      attachProxyUpgrade(server);
    },
  };
}
