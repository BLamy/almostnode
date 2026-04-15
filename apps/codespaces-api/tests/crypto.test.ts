import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptString, encryptString } from "../src/crypto";

describe("codespaces api crypto", () => {
  it("round-trips encrypted GitHub tokens", () => {
    const key = createHash("sha256").update("test-key").digest();
    const encrypted = encryptString(key, "gho_example_token");

    expect(decryptString(key, encrypted)).toBe("gho_example_token");
  });
});
