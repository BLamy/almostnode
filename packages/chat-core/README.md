# @agent-wasm/chat-core

The dependency-free chat domain shared by [`@agent-wasm/react`](https://www.npmjs.com/package/@agent-wasm/react)
(the chat UI) and the agent packages ([`@agent-wasm/code`](https://www.npmjs.com/package/@agent-wasm/code), …).
No React, no runtime — just types, pure tool-call encoders, and a session
registry, so agent packages stay framework-free and the dependency graph stays
acyclic.

```bash
npm install @agent-wasm/chat-core
```

## API

- **Conversation types** — `AgentHarness`, `ChatMessage`, `ChatToolCall`,
  `ChatElicitation`, `ConversationState`, and the `ConversationAdapter` interface
  that the chat UI renders and each agent implements.
- **Tool-call encoders** — `claudeToolUseToToolCall`, `buildUnifiedPatch`,
  `ensurePatchHeaders`, `truncateToolOutput`.
- **`agentSessionRegistry`** — a pub/sub registry of live CLI agent sessions
  (`ActiveAgentSession`, `AgentSessionRegistry`).
- **Chat preferences** — `CHAT_MODEL_OPTIONS`, `readChatModel`/`writeChatModel`,
  `readChatEffort`/`writeChatEffort`, and friends.

## License

MIT
