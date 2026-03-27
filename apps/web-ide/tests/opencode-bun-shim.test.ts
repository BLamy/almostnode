// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

async function loadBunShim() {
  vi.resetModules();

  const globals = globalThis as typeof globalThis & { Bun?: unknown };
  const previousBun = globals.Bun;
  delete globals.Bun;

  const mod = await import("../../../vendor/opencode/packages/browser/src/shims/bun.browser");

  return {
    mod,
    restore() {
      if (previousBun === undefined) {
        delete globals.Bun;
        return;
      }

      globals.Bun = previousBun;
    },
  };
}

describe("OpenCode browser Bun shim", () => {
  it("returns mapped browser commands from Bun.which", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      expect(mod.which("bash")).toBe("/bin/sh");
      expect(mod.default.which("node")).toBe("/usr/bin/node");
      expect((globalThis as typeof globalThis & { Bun?: { which?: (cmd: string) => string | null } }).Bun?.which?.("rg")).toBe("/opencode/cache/bin/rg");
    } finally {
      restore();
    }
  });

  it("returns null for unsupported commands from Bun.which", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      expect(mod.which("osascript")).toBeNull();
      expect(mod.default.which("sandbox-exec")).toBeNull();
    } finally {
      restore();
    }
  });
});
