import { describe, expect, it } from "vitest";
import {
  getNativeSurface,
  isNativeSurfaceUrl,
  parseNativeSurfaceName,
  registerNativeSurface,
} from "./native-surfaces";

// A trivial component stand-in (registry only stores the reference).
const Dummy = () => null;

describe("native-surfaces", () => {
  it("parses the surface name from an almost-native URL", () => {
    expect(parseNativeSurfaceName("almost-native://webamp")).toBe("webamp");
    expect(parseNativeSurfaceName("almost-native://webamp/main")).toBe("webamp");
    expect(parseNativeSurfaceName("almost-native://webamp?x=1")).toBe("webamp");
    expect(parseNativeSurfaceName("https://example.com")).toBeNull();
  });

  it("detects native-surface URLs", () => {
    expect(isNativeSurfaceUrl("almost-native://x")).toBe(true);
    expect(isNativeSurfaceUrl("http://localhost:5173")).toBe(false);
    expect(isNativeSurfaceUrl(undefined)).toBe(false);
  });

  it("registers and resolves a surface with its options", () => {
    expect(getNativeSurface("test-surface")).toBeNull();
    registerNativeSurface("test-surface", Dummy, { overlay: true });
    const entry = getNativeSurface("test-surface");
    expect(entry?.component).toBe(Dummy);
    expect(entry?.options.overlay).toBe(true);
  });
});
