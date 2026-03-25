import { describe, expect, it } from "vitest";
import { snapshot } from "../src/shims/opencode-models-snapshot";

describe("opencode models snapshot shim", () => {
  it("falls through to the live provider catalog instead of masking it with an empty object", () => {
    expect(snapshot).toBeUndefined();
  });
});
