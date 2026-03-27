import { afterEach, describe, expect, it, vi } from "vitest";

const networkMocks = vi.hoisted(() => {
  const controller = {
    getConfig: vi.fn(() => ({
      provider: "tailscale" as const,
      authMode: "interactive" as const,
      useExitNode: true,
      exitNodeId: null,
      corsProxy: null,
    })),
  };

  return {
    controller,
    getDefaultNetworkController: vi.fn(() => controller),
    networkFetch: vi.fn(),
    selectNetworkRouteForUrl: vi.fn(() => "browser" as const),
  };
});

vi.mock("almostnode", () => ({
  network: {
    getDefaultNetworkController: networkMocks.getDefaultNetworkController,
    networkFetch: networkMocks.networkFetch,
    selectNetworkRouteForUrl: networkMocks.selectNetworkRouteForUrl,
  },
}));

import {
  createProxiedFetch,
  buildOpencodeProxyUrl,
  DEFAULT_OPENCODE_CORS_PROXY_URL,
  resolveOpencodeCorsProxyUrl,
} from "../src/shims/opencode-cors-proxy";

const originalFetch = globalThis.fetch;

afterEach(() => {
  networkMocks.controller.getConfig.mockClear();
  networkMocks.getDefaultNetworkController.mockClear();
  networkMocks.networkFetch.mockReset();
  networkMocks.selectNetworkRouteForUrl.mockReset();
  networkMocks.selectNetworkRouteForUrl.mockReturnValue("browser");
  globalThis.fetch = originalFetch;
});

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

  it("routes Anthropic requests through the shared network controller when tailscale is selected", async () => {
    networkMocks.selectNetworkRouteForUrl.mockReturnValue("tailscale");
    networkMocks.networkFetch.mockResolvedValue(
      new Response("tailnet-response", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const browserFetch = vi.fn<typeof fetch>();
    globalThis.fetch = browserFetch;

    const fetchFn = createProxiedFetch("test-key");
    const response = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514" }),
    });

    expect(networkMocks.getDefaultNetworkController).toHaveBeenCalledTimes(1);
    expect(networkMocks.selectNetworkRouteForUrl).toHaveBeenCalledTimes(1);
    expect(networkMocks.networkFetch).toHaveBeenCalledTimes(1);
    expect(browserFetch).not.toHaveBeenCalled();

    const [request, init, controller] = networkMocks.networkFetch.mock.calls[0]!;
    expect(init).toBeUndefined();
    expect(controller).toBe(networkMocks.controller);
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).headers.get("x-api-key")).toBe("test-key");
    expect((request as Request).headers.get("anthropic-version")).toBe("2023-06-01");
    expect((request as Request).headers.has("anthropic-dangerous-direct-browser-access")).toBe(false);
    expect(await (request as Request).text()).toContain("claude-sonnet-4-20250514");
    expect(await response.text()).toBe("tailnet-response");
  });
});
