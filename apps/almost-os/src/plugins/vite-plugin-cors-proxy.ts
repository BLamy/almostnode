import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

export const CORS_PROXY_PATH = "/__api/cors-proxy";

const HOP_BY_HOP = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Stripped from the response so the proxied page can be embedded in an <iframe>
// and read cross-origin from the AlmostOS Chrome app.
const FRAME_BLOCKERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

function copyRequestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP.has(lower) ||
      lower === "origin" ||
      lower === "referer" ||
      lower.startsWith("sec-fetch-") ||
      lower.startsWith("sec-ch-ua")
    ) {
      continue;
    }
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === "string") headers.set(key, value);
  }
  headers.set("User-Agent", "Mozilla/5.0 (AlmostOS)");
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = new URL(req.url || "/", "http://127.0.0.1");
  const rawTarget = parsed.searchParams.get("url");
  if (!rawTarget) {
    res.statusCode = 400;
    res.end("Missing ?url= query parameter");
    return;
  }
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    res.statusCode = 400;
    res.end("Invalid target URL");
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    res.statusCode = 400;
    res.end("Unsupported target protocol");
    return;
  }

  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  const upstream = await fetch(target, {
    method,
    headers: copyRequestHeaders(req),
    body: body as BodyInit | undefined,
    redirect: "follow",
  });
  const responseBody = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await upstream.arrayBuffer());

  res.statusCode = upstream.status;
  res.statusMessage = upstream.statusText;
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || FRAME_BLOCKERS.has(lower)) continue;
    res.setHeader(key, value);
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(responseBody);
}

function attach(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (req, res, next) => {
    const pathname = req.url ? new URL(req.url, "http://127.0.0.1").pathname : "";
    if (pathname !== CORS_PROXY_PATH) {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        (req.headers["access-control-request-headers"] as string) || "*",
      );
      res.end();
      return;
    }
    try {
      await handle(req, res);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Proxy error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/** Dev/preview CORS + framing proxy at `/__api/cors-proxy?url=…`. */
export function corsProxyPlugin(): Plugin {
  return {
    name: "almostos-cors-proxy",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
