import { describe, expect, it } from "vitest";
import { Buffer } from "../src/shims/node-buffer";

describe("web-ide node buffer shim", () => {
  it("supports Node-style buffer writes used by isomorphic-git", () => {
    const buffer = Buffer.alloc(12);

    expect(buffer.write("DIRC", 0)).toBe(4);
    buffer.writeUInt32BE(2, 4);

    expect(buffer.toString("utf8", 0, 4)).toBe("DIRC");
    expect(buffer.readUInt32BE(4)).toBe(2);

    const copy = Buffer.alloc(4);
    expect(buffer.copy(copy, 0, 0, 4)).toBe(4);
    expect(copy.toString("utf8")).toBe("DIRC");
  });
});
