import { describe, expect, it } from "vitest";
import {
  buildOpencodeProxyUrl,
  DEFAULT_OPENCODE_CORS_PROXY_URL,
  resolveOpencodeCorsProxyUrl,
} from "../src/shims/opencode-cors-proxy";

describe("OpenCode CORS proxy shim", () => {
  it("uses a stored override before any defaults", () => {
    const proxyUrl = resolveOpencodeCorsProxyUrl(
      { hostname: "almostnode.pages.dev", origin: "https://almostnode.pages.dev" },
      { getItem: () => "https://proxy.example/?url=" },
      null,
    );

    expect(proxyUrl).toBe("https://proxy.example/?url=");
  });

  it("uses the local Vite proxy on localhost when no override is stored", () => {
    const proxyUrl = resolveOpencodeCorsProxyUrl(
      { hostname: "localhost", origin: "http://localhost:5173" },
      { getItem: () => null },
      null,
    );

    expect(proxyUrl).toBe("http://localhost:5173/__api/cors-proxy?url=");
  });

  it("falls back to the existing hosted worker for non-local builds", () => {
    const proxyUrl = resolveOpencodeCorsProxyUrl(
      { hostname: "brettlamy.github.io", origin: "https://brettlamy.github.io" },
      { getItem: () => null },
      "",
    );

    expect(proxyUrl).toBe(DEFAULT_OPENCODE_CORS_PROXY_URL);
  });

  it("encodes full target URLs for generic ?url= proxies", () => {
    const targetUrl = "https://api.anthropic.com/v1/messages?beta=true&limit=20";

    expect(buildOpencodeProxyUrl("https://proxy.example/?url=", targetUrl)).toBe(
      `https://proxy.example/?url=${encodeURIComponent(targetUrl)}`,
    );
  });

  it("preserves path-based Anthropic proxy deployments", () => {
    const targetUrl = "https://api.anthropic.com/v1/messages?beta=true";

    expect(buildOpencodeProxyUrl("https://proxy.example", targetUrl)).toBe(
      "https://proxy.example/v1/messages?beta=true",
    );
  });
});
