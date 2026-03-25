// @vitest-environment node
import { describe, expect, it } from "vitest";
import which from "../../../vendor/opencode/packages/browser/src/shims/which.browser";

describe("OpenCode browser which shim", () => {
  it("returns null for unsupported commands when nothrow is enabled", async () => {
    expect(which.sync("osascript", { nothrow: true })).toBeNull();
    await expect(which("osascript", { nothrow: true })).resolves.toBeNull();
  });

  it("still throws when nothrow is not enabled", async () => {
    expect(() => which.sync("osascript")).toThrow("which: osascript not available in browser");
    await expect(which("osascript")).rejects.toThrow("which: osascript not available in browser");
  });

  it("returns mapped browser commands", async () => {
    expect(which.sync("bash")).toBe("/bin/sh");
    await expect(which("rg")).resolves.toBe("/opencode/cache/bin/rg");
  });
});
