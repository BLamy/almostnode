import type { Plugin } from "vite";

/**
 * Serves the OAuth **Client ID Metadata Document** (CIMD) used by
 * executor.sh's `oauth-cimd` connections: the document's own URL is the
 * `client_id`, so authorization servers fetch it to learn our redirect URIs.
 *
 * In dev the origin comes from the request `Host` header. For builds the
 * document is emitted only when `ALMOSTOS_ORIGIN` is set (e.g.
 * `https://blamy.github.io`) — a metadata doc with a wrong origin is worse
 * than none. Note the AS must be able to reach this URL, so CIMD against
 * real external services requires a publicly reachable deployment.
 */
export function clientMetadataPlugin(options: { base: string }): Plugin {
  const path = `${options.base}oauth/client-metadata.json`;

  const buildDocument = (origin: string) => ({
    client_id: `${origin}${path}`,
    client_name: "AlmostOS executor.sh",
    client_uri: origin,
    redirect_uris: [`${origin}${options.base}oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  return {
    name: "almostos-oauth-client-metadata",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
        if (pathname !== path) {
          next();
          return;
        }
        const host = req.headers.host ?? "localhost";
        const proto = req.headers["x-forwarded-proto"] === "https" || !host.startsWith("localhost")
          ? "https"
          : "http";
        const origin = `${proto}://${host}`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify(buildDocument(origin), null, 2));
      });
    },
    generateBundle() {
      const origin = process.env.ALMOSTOS_ORIGIN;
      if (!origin) return;
      this.emitFile({
        type: "asset",
        fileName: "oauth/client-metadata.json",
        source: JSON.stringify(buildDocument(origin.replace(/\/$/, "")), null, 2),
      });
    },
  };
}
