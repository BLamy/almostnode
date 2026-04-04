import { describe, expect, it } from "vitest";

import {
  CLAUDE_IMAGE_PASTE_BLOCKER_REASON,
  collectClipboardImageMimeTypes,
  describeClaudeImagePasteBlocker,
} from "../src/features/claude-image-paste";

describe("Claude image paste helpers", () => {
  it("collects image mime types from clipboard items", () => {
    const mimeTypes = collectClipboardImageMimeTypes({
      items: [
        { kind: "file", type: "image/png" },
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/webp" },
        { kind: "file", type: "image/png" },
      ] as unknown as DataTransferItemList,
    });

    expect(mimeTypes).toEqual(["image/png", "image/webp"]);
  });

  it("describes the browser-terminal blocker for pasted images", () => {
    expect(describeClaudeImagePasteBlocker(["image/png"])).toContain(
      CLAUDE_IMAGE_PASTE_BLOCKER_REASON,
    );
    expect(describeClaudeImagePasteBlocker(["image/png"])).toContain(
      "image/png",
    );
  });
});
