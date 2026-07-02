// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  capturedHosts,
  clearCaptures,
  recordCapture,
  specForHost,
} from "./net-capture";

beforeEach(() => {
  clearCaptures();
});

describe("net-capture buffer", () => {
  it("records external http(s) API calls grouped by host", () => {
    recordCapture({ method: "GET", url: "https://api.example.com/users" });
    recordCapture({ method: "POST", url: "https://api.example.com/users" });
    recordCapture({ method: "GET", url: "https://other.dev/things" });
    const hosts = capturedHosts();
    expect(hosts).toContainEqual({ host: "api.example.com", samples: 2 });
    expect(hosts).toContainEqual({ host: "other.dev", samples: 1 });
  });

  it("ignores non-http and virtual (own-server) URLs", () => {
    recordCapture({ method: "GET", url: "blob:https://x/uuid" });
    recordCapture({ method: "GET", url: "data:text/plain,hi" });
    recordCapture({ method: "GET", url: "https://host/__virtual__/3000/api" });
    expect(capturedHosts()).toEqual([]);
  });

  it("caps the per-host buffer (ring buffer keeps the most recent)", () => {
    for (let i = 0; i < 250; i++) {
      recordCapture({ method: "GET", url: `https://api.example.com/item/${i}` });
    }
    const host = capturedHosts().find((h) => h.host === "api.example.com");
    expect(host?.samples).toBe(200);
  });

  it("clears one host or all", () => {
    recordCapture({ method: "GET", url: "https://a.com/x" });
    recordCapture({ method: "GET", url: "https://b.com/y" });
    clearCaptures("a.com");
    expect(capturedHosts().map((h) => h.host)).toEqual(["b.com"]);
    clearCaptures();
    expect(capturedHosts()).toEqual([]);
  });
});

describe("net-capture → OpenAPI", () => {
  it("generates a spec for a host from its samples", () => {
    recordCapture({
      method: "GET",
      url: "https://api.example.com/users/42",
      status: 200,
      responseBody: { id: 42, name: "Ada" },
    });
    recordCapture({
      method: "POST",
      url: "https://api.example.com/users",
      status: 201,
      requestBody: { name: "Grace" },
      responseBody: { id: 7 },
    });
    const spec = specForHost("api.example.com");
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(spec.paths["/users/{id}"]?.get).toBeDefined();
    expect(spec.paths["/users"]?.post?.requestBody).toBeDefined();
  });

  it("returns an empty-path spec for an unknown host", () => {
    const spec = specForHost("nope.com");
    expect(spec.paths).toEqual({});
    expect(spec.servers).toEqual([]);
  });
});
