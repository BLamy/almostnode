// @vitest-environment node
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const claudeCodeRoot = "/Users/brettlamy/Downloads/claude-code";
const hasClaudeCodeCheckout = existsSync(claudeCodeRoot);
const itIfClaudeCode = hasClaudeCodeCheckout ? it : it.skip;

function claudeCodeModuleUrl(relativePath: string): string {
  return pathToFileURL(`${claudeCodeRoot}/${relativePath}`).href;
}

async function loadBunShim() {
  vi.resetModules();

  const globals = globalThis as typeof globalThis & {
    Bun?: unknown;
    __BUN_BUNDLE_FEATURES__?: Record<string, boolean>;
  };
  const previousBun = globals.Bun;
  const previousFeatureFlags = globals.__BUN_BUNDLE_FEATURES__;
  delete globals.Bun;
  delete globals.__BUN_BUNDLE_FEATURES__;

  const mod = await import("../../../vendor/opencode/packages/browser/src/shims/bun.browser");

  return {
    mod,
    restore() {
      if (previousBun === undefined) {
        delete globals.Bun;
      } else {
        globals.Bun = previousBun;
      }

      if (previousFeatureFlags === undefined) {
        delete globals.__BUN_BUNDLE_FEATURES__;
      } else {
        globals.__BUN_BUNDLE_FEATURES__ = previousFeatureFlags;
      }
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

  it("exposes Bun as a global identifier for vendor modules that use free Bun references", async () => {
    const { restore } = await loadBunShim();

    try {
      expect(new Function("return Bun.which('bash')")()).toBe("/bin/sh");
      expect(new Function("return typeof Bun.$")()).toBe("function");
      expect(new Function("return typeof Bun.hash")()).toBe("function");
      expect(new Function("return typeof Bun.semver.order")()).toBe("function");
      expect(new Function("return typeof Bun.YAML.parse")()).toBe("function");
      expect(new Function("return typeof Bun.gc")()).toBe("function");
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

  it("provides deterministic Bun.hash compatibility helpers", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      const helloFromString = mod.hash("hello");
      const helloFromBytes = mod.hash(new Uint8Array([104, 101, 108, 108, 111]));

      expect(typeof helloFromString).toBe("bigint");
      expect(helloFromString).toBe(helloFromBytes);
      expect(mod.default.hash("hello")).toBe(helloFromString);
      expect(mod.hash("hello")).toBe(helloFromString);
      expect(mod.hash("hello", 1n)).not.toBe(helloFromString);
      expect(mod.hash("hello")).not.toBe(mod.hash("goodbye"));
      expect(mod.hash.wyhash("hello")).toBe(helloFromString);
      expect(typeof mod.hash.crc32("hello")).toBe("number");
      expect(new Function("return Bun.hash('hello')")()).toBe(helloFromString);
    } finally {
      restore();
    }
  });

  it("supports semver and YAML call patterns that only check for Bun presence", async () => {
    const { restore } = await loadBunShim();

    try {
      const fixture = await import("./fixtures/claude-code-bun-compat");

      expect(fixture.semverOrder("1.2.3", "1.2.4")).toBe(-1);
      expect(fixture.semverOrder("2.0.0", "1.9.9")).toBe(1);
      expect(fixture.semverMatches("1.2.3", "^1.0.0")).toBe(true);
      expect(fixture.parseYaml("name: almostnode\ncount: 2\n")).toEqual({
        name: "almostnode",
        count: 2,
      });
      expect(fixture.stringifyYaml({ enabled: true })).toContain("enabled: true");
    } finally {
      restore();
    }
  });

  it("resolves bun:bundle feature() imports with injected feature flags", async () => {
    const { restore } = await loadBunShim();

    try {
      const bundle = await import("../../../vendor/opencode/packages/browser/src/shims/bun-bundle.browser");
      bundle.setFeatureFlags({ CONNECTOR_TEXT: true });

      const fixture = await import("./fixtures/claude-code-bun-compat");
      expect(fixture.connectorTextFeatureEnabled).toBe(true);
      expect(bundle.feature("MISSING_FEATURE")).toBe(false);
    } finally {
      restore();
    }
  });

  it("provides JSONL.parseChunk and wrapAnsi compatibility helpers", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      const jsonl = `\ufeff{"id":1}\n{"id":2}\n`;
      expect(mod.JSONL.parseChunk(jsonl)).toEqual({
        values: [{ id: 1 }, { id: 2 }],
        error: null,
        read: jsonl.length,
        done: true,
      });

      const partial = mod.JSONL.parseChunk('{"id":1}\n{bad}\n{"id":2}\n');
      expect(partial.values).toEqual([{ id: 1 }]);
      expect(partial.error).toBeInstanceOf(Error);
      expect(partial.done).toBe(false);
      expect(mod.wrapAnsi("hello world", 5)).toBe("hello\nworld");
    } finally {
      restore();
    }
  });

  it("defaults embeddedFiles to an empty array and keeps gc harmless", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      expect(mod.embeddedFiles).toEqual([]);
      expect(() => mod.gc(true)).not.toThrow();
    } finally {
      restore();
    }
  });

  it("fails unsupported Bun native APIs with explicit errors", async () => {
    const { mod, restore } = await loadBunShim();

    try {
      expect(() => mod.listen()).toThrow("Bun.listen is unavailable in browser mode");
      expect(() => mod.spawn(["rg"])).toThrow("Bun.spawn is unavailable in browser mode");
      expect(() => mod.generateHeapSnapshot("v8", "arraybuffer")).toThrow(
        "Bun.generateHeapSnapshot is unavailable in browser mode",
      );
    } finally {
      restore();
    }
  });

  it("supports Bun.hash seed chaining used by claude-code helpers", async () => {
    const { restore } = await loadBunShim();

    try {
      const fixture = await import("./fixtures/claude-code-bun-compat");
      expect(fixture.hashPair("ts", "code")).not.toBe(fixture.hashPair("tsc", "ode"));
    } finally {
      restore();
    }
  });

  itIfClaudeCode("imports real claude-code semver, YAML, and hash helpers under Bun", async () => {
    const { restore } = await loadBunShim();

    try {
      const semverMod = await import(claudeCodeModuleUrl("utils/semver.ts"));
      const yamlMod = await import(claudeCodeModuleUrl("utils/yaml.ts"));
      const hashMod = await import(claudeCodeModuleUrl("utils/hash.ts"));

      expect(semverMod.order("1.2.3", "1.2.4")).toBe(-1);
      expect(semverMod.gt("2.0.0", "1.9.9")).toBe(true);
      expect(semverMod.gte("1.2.3", "1.2.3")).toBe(true);
      expect(semverMod.lt("1.2.3", "2.0.0")).toBe(true);
      expect(semverMod.lte("1.2.3", "1.2.3")).toBe(true);
      expect(semverMod.satisfies("1.2.3", "^1.0.0")).toBe(true);
      expect(yamlMod.parseYaml("name: almostnode\ncount: 2\n")).toEqual({
        name: "almostnode",
        count: 2,
      });
      expect(hashMod.hashContent("almostnode")).toBe(Bun.hash("almostnode").toString());
      expect(hashMod.hashPair("ts", "code")).not.toBe(hashMod.hashPair("tsc", "ode"));
    } finally {
      restore();
    }
  });

  itIfClaudeCode("can import a real claude-code leaf module that relies on bun:bundle", async () => {
    const { restore } = await loadBunShim();

    try {
      const bundle = await import("../../../vendor/opencode/packages/browser/src/shims/bun-bundle.browser");
      bundle.setFeatureFlags({ CONNECTOR_TEXT: true, TRANSCRIPT_CLASSIFIER: false });

      const mod = await import(claudeCodeModuleUrl("constants/betas.ts"));

      expect(mod.SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER).toBe("summarize-connector-text-2026-03-13");
      expect(mod.AFK_MODE_BETA_HEADER).toBe("");
    } finally {
      restore();
    }
  });
});
