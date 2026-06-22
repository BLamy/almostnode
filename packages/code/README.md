# @agent-wasm/code

Claude Code agent integration for agent-wasm: an incremental JSONL transcript
parser and a synced conversation adapter over
[`@agent-wasm/chat-core`](https://www.npmjs.com/package/@agent-wasm/chat-core).

```bash
npm install @agent-wasm/code @agent-wasm/chat-core
```

## API

- **`ClaudeTranscriptTail`** — tail a Claude Code project transcript (`.jsonl`),
  emitting `ChatMessage`s as the agent writes its own record.
- **`ClaudeConversationAdapter`** — a `ConversationAdapter` that surfaces a live,
  bidirectional view of a running Claude Code session in the chat UI.
- **`claudeToolUseToToolCall`** (re-exported from chat-core) — map Claude
  `tool_use` blocks to renderable tool-call cards with diffs.
- **`CLAUDE_PROJECTS_ROOT` / `extractClaudeMessageText`** — transcript path + content
  helpers.

## Scope

This package ships the browser-runnable, encoding-only Claude pieces. The
MCP-over-SSE IDE bridge that streams Monaco editor selection/diagnostics back to
the CLI lives behind an injected `EditorStateProvider` — its reusable server half
ships here as `ClaudeIdeVirtualServer` + `buildClaudeIdeMcpConfig`, while the
editor-state reads stay in the host (the web IDE).

## License

MIT
