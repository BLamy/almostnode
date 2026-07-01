import type { WorkspaceController } from "@agent-wasm/sdk";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface OpenCodeAdapter {
  authed: boolean;
  respond: (input: string) => Promise<string>;
}

/**
 * Seam for the OpenCode-powered chat. Auth comes from the keychain's `opencode`
 * slot. v1 ships a local, workspace-aware preview responder; wiring the real
 * in-browser OpenCode runtime (session/stream) happens behind this same
 * interface as a fast-follow.
 */
export function createOpenCodeChatAdapter(opts: {
  authed: boolean;
  workspace: WorkspaceController;
}): OpenCodeAdapter {
  const { authed, workspace } = opts;

  return {
    authed,
    async respond(input) {
      const q = input.trim();
      if (!authed) {
        return "I'm not signed in yet. Open **Keychain** from the dock, store your OpenCode auth, and I'll be able to act on your workspace.";
      }

      const lower = q.toLowerCase();
      if (/\b(ls|list|files|directory|what.*files)\b/.test(lower)) {
        const files = workspace
          .listFiles("/project")
          .map((f) => f.replace("/project/", ""));
        return files.length
          ? `Files in /project:\n${files.map((f) => `• ${f}`).join("\n")}`
          : "The /project folder is empty.";
      }

      const readMatch = q.match(/(?:read|open|show|cat)\s+(\S+)/i);
      if (readMatch) {
        const rel = readMatch[1].replace(/^\.?\//, "");
        const path = rel.startsWith("/") ? rel : `/project/${rel}`;
        try {
          const content = workspace.readFile(path);
          return `${path}:\n\n${content.slice(0, 1400)}`;
        } catch {
          return `I couldn't read \`${path}\`.`;
        }
      }

      return `OpenCode is connected (local preview — full agent runs land in a follow-up).\n\nYou said: "${q}"\nTry "list files" or "read package.json".`;
    },
  };
}
