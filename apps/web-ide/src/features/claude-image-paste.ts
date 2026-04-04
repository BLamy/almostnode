export const CLAUDE_IMAGE_PASTE_BLOCKER_REASON =
  "Browser Claude sessions currently run inside xterm, and xterm only forwards text/plain clipboard data. Claude's inline image attachments need Claude's remote UI channel.";

export function collectClipboardImageMimeTypes(
  clipboardData: Pick<DataTransfer, "items"> | null | undefined,
): string[] {
  const mimeTypes = Array.from(clipboardData?.items ?? [])
    .map((item) => {
      if (item.kind !== "file" || !item.type.startsWith("image/")) {
        return null;
      }

      return item.type;
    })
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(mimeTypes));
}

export function describeClaudeImagePasteBlocker(
  mimeTypes: readonly string[],
): string {
  const prefix =
    mimeTypes.length > 0
      ? `Pasted ${mimeTypes.join(", ")} clipboard data can't be attached in this browser Claude session yet.`
      : "Pasted image clipboard data can't be attached in this browser Claude session yet.";

  return `${prefix} ${CLAUDE_IMAGE_PASTE_BLOCKER_REASON}`;
}
