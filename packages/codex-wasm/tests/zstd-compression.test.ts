import { decompress } from "@bokuweb/zstd-wasm";
import { describe, expect, it } from "vitest";
import { installCodexZstdCompression } from "../src/zstd-compression";

type CodexZstdGlobal = typeof globalThis & {
  __almostnodeCodexZstdCompress?: (
    input: Uint8Array,
    level?: number,
  ) => Uint8Array;
};

describe("installCodexZstdCompression", () => {
  it("installs a synchronous browser zstd compressor for the wasm request path", async () => {
    const globals = globalThis as CodexZstdGlobal;
    delete globals.__almostnodeCodexZstdCompress;

    await installCodexZstdCompression();

    const input = new TextEncoder().encode(
      JSON.stringify({ model: "gpt-5.5", stream: true, store: false }),
    );
    const installed = (globalThis as CodexZstdGlobal)
      .__almostnodeCodexZstdCompress;
    if (!installed) {
      throw new Error("zstd compressor was not installed");
    }
    const compressed = installed(input, 3);

    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(decompress(compressed))).toBe(
      new TextDecoder().decode(input),
    );
  });
});
