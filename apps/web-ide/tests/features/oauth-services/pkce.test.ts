import { describe, expect, it } from "vitest";
import {
  encodeBase64Url,
  generatePkcePair,
  randomState,
  randomToken,
} from "../../../src/features/oauth-services/pkce";

describe("encodeBase64Url", () => {
  it("returns the empty string for an empty input", () => {
    expect(encodeBase64Url(new Uint8Array(0))).toBe("");
  });

  it("encodes raw bytes URL-safely with no padding", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    // Standard base64 of these bytes is "+/+/" — URL-safe alphabet uses "-" and "_".
    expect(encodeBase64Url(bytes)).toBe("-_-_");
  });

  it("accepts an ArrayBuffer in addition to Uint8Array", () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    expect(encodeBase64Url(buffer)).toBe(encodeBase64Url(new Uint8Array([1, 2, 3])));
  });

  it("strips padding", () => {
    const bytes = new Uint8Array([1]); // base64 "AQ==" — should drop the "==".
    expect(encodeBase64Url(bytes)).toBe("AQ");
  });
});

describe("randomToken", () => {
  it("returns the empty string for non-positive lengths", () => {
    expect(randomToken(0)).toBe("");
    expect(randomToken(-5)).toBe("");
  });

  it("returns the requested length", () => {
    expect(randomToken(43)).toHaveLength(43);
    expect(randomToken(96)).toHaveLength(96);
  });

  it("only emits URL-safe characters", () => {
    const token = randomToken(128);
    expect(token).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("does not collide twice in a row (overwhelmingly likely)", () => {
    expect(randomToken(64)).not.toBe(randomToken(64));
  });
});

describe("randomState", () => {
  it("emits a 48-char URL-safe token", () => {
    const state = randomState();
    expect(state).toHaveLength(48);
    expect(state).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});

describe("generatePkcePair", () => {
  it("produces a 96-char verifier and an S256 challenge", async () => {
    const pair = await generatePkcePair();
    expect(pair.codeVerifier).toHaveLength(96);
    expect(pair.codeChallengeMethod).toBe("S256");
    // base64url(SHA-256(...)) is 43 chars (256 bits / 6, rounded down, no padding).
    expect(pair.codeChallenge).toHaveLength(43);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("yields a verifier that hashes to the same challenge (RFC 7636 §4.6)", async () => {
    const pair = await generatePkcePair();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pair.codeVerifier),
    );
    expect(encodeBase64Url(digest)).toBe(pair.codeChallenge);
  });

  it("yields distinct verifiers across calls", async () => {
    const [a, b] = await Promise.all([generatePkcePair(), generatePkcePair()]);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});
