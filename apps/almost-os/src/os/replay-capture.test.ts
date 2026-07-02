import { describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import {
  gzipJson,
  readReplayToken,
  uploadSimulationData,
} from "./replay-capture";

describe("readReplayToken", () => {
  it("reads accessToken from the replay auth file", () => {
    const vfs = {
      existsSync: (p: string) => p === "/home/user/.replay/auth.json",
      readFileSync: () => JSON.stringify({ accessToken: "tok-123", refreshToken: "r" }),
    };
    expect(readReplayToken(vfs)).toBe("tok-123");
  });

  it("returns null when the file is missing or malformed", () => {
    expect(readReplayToken({ existsSync: () => false, readFileSync: () => "" })).toBeNull();
    expect(
      readReplayToken({ existsSync: () => true, readFileSync: () => "not json" }),
    ).toBeNull();
  });
});

describe("gzipJson", () => {
  it("produces a gzip stream that round-trips", async () => {
    const buf = await gzipJson({ simulationData: [{ kind: "metadata" }] });
    const text = gunzipSync(Buffer.from(buf)).toString("utf8");
    expect(JSON.parse(text)).toEqual({ simulationData: [{ kind: "metadata" }] });
  });
});

describe("uploadSimulationData", () => {
  it("posts a gzipped envelope, then ensures the recording, returning the URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/create-visit-data")) {
        return new Response(JSON.stringify({ visitDataId: "vd-1" }), { status: 200 });
      }
      if (url.includes("/ensure-visit-recording")) {
        return new Response(JSON.stringify({ recordingId: "rec-9" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const result = await uploadSimulationData([{ kind: "rrweb", event: {} }], {
      token: "tok-123",
      fetchImpl,
    });

    expect(result).toEqual({
      visitDataId: "vd-1",
      recordingId: "rec-9",
      url: "https://app.replay.io/recording/rec-9",
    });
    // create-visit-data carried the Bearer token + gzip body.
    const create = calls.find((c) => c.url.includes("/create-visit-data"))!;
    expect((create.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect(create.init.body).toBeInstanceOf(ArrayBuffer);
  });

  it("falls back to the CORS proxy when the direct call 5xxs", async () => {
    let first = true;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("https://dispatch.replay.io") && first) {
        first = false;
        return new Response("boom", { status: 502 });
      }
      if (url.includes("create-visit-data")) {
        return new Response(JSON.stringify({ visitDataId: "vd-2" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const result = await uploadSimulationData([{ kind: "metadata" }], {
      token: null,
      fetchImpl,
    });
    expect(result.visitDataId).toBe("vd-2");
    // The retried URL is the CORS proxy.
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("cors-proxy"))).toBe(true);
  });

  it("throws when create-visit-data returns no id", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(
      uploadSimulationData([], { token: "t", fetchImpl }),
    ).rejects.toThrow(/no visitDataId/);
  });
});
