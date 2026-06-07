import { compress, init } from "@bokuweb/zstd-wasm";

type CodexZstdGlobal = typeof globalThis & {
  __almostnodeCodexZstdCompress?: (
    input: Uint8Array,
    level?: number,
  ) => Uint8Array;
};

let installPromise: Promise<void> | null = null;

export function installCodexZstdCompression(): Promise<void> {
  const globals = globalThis as CodexZstdGlobal;
  if (globals.__almostnodeCodexZstdCompress) {
    return Promise.resolve();
  }

  installPromise ??= (async () => {
    await init();
    globals.__almostnodeCodexZstdCompress = (
      input: Uint8Array,
      level = 3,
    ): Uint8Array => {
      const normalizedLevel =
        Number.isFinite(level) && level > 0 ? Math.trunc(level) : 3;
      return compress(input, normalizedLevel);
    };
  })();

  return installPromise;
}
