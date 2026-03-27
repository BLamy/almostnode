import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const PROXY_PATH = '/__api/cors-proxy';
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

function isAllowedTarget(target: URL): boolean {
  return target.protocol === 'http:' || target.protocol === 'https:';
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
    },
    configurePreviewServer(server) {
      attachProxyMiddleware(server);
    },
  };
}
