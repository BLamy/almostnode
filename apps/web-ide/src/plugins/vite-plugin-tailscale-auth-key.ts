import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

import {
  handleTailscaleAuthKeyApiRequest,
  TAILSCALE_AUTH_KEY_API_PATH,
} from "../features/tailscale-auth-key-api";

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const result = await handleTailscaleAuthKeyApiRequest({
    method: req.method || "GET",
    headers: headersFromIncomingMessage(req),
    bodyText:
      req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
        ? await readRequestBody(req)
        : undefined,
  });

  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) {
    res.setHeader(key, value);
  }
  res.end(result.body);
}

function attachTailscaleAuthKeyMiddleware(
  server: ViteDevServer | PreviewServer,
): void {
  server.middlewares.use(async (req, res, next) => {
    const pathname = req.url
      ? new URL(req.url, "http://127.0.0.1").pathname
      : "";
    if (pathname !== TAILSCALE_AUTH_KEY_API_PATH) {
      next();
      return;
    }

    try {
      await handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = 500;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({ error: "tailscale_auth_key_error", detail: message }),
      );
    }
  });
}

export function tailscaleAuthKeyPlugin(): Plugin {
  return {
    name: "tailscale-auth-key-api",
    configureServer(server) {
      attachTailscaleAuthKeyMiddleware(server);
    },
    configurePreviewServer(server) {
      attachTailscaleAuthKeyMiddleware(server);
    },
  };
}
