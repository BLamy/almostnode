# @agent-wasm/react

The reusable React layer over [`@agent-wasm/sdk`](https://www.npmjs.com/package/@agent-wasm/sdk):
a workspace provider, the agent **chat surface**, and the Radix UI primitives that
sit on top of the CLI agents.

```bash
npm install @agent-wasm/react @agent-wasm/sdk @agent-wasm/chat-core react react-dom
```

```tsx
import { AlmostnodeProvider, EditorPane, PreviewPane } from "@agent-wasm/react";
import { ChatScreen } from "@agent-wasm/react/chat";

<AlmostnodeProvider workspace={workspace}>
  <EditorPane />
  <PreviewPane />
  <ChatScreen
    startAgentSession={(harness) => host.startAgentSession(harness)}
    createAdapter={(session) => host.createConversationAdapter(session)}
  />
</AlmostnodeProvider>
```

## Subpaths

| Import | Contents |
| --- | --- |
| `@agent-wasm/react` | `AlmostnodeProvider`, `useWorkspace`, `useWorkspaceSnapshot`, `EditorPane`, `PreviewPane`, `TerminalPane`, plus the chat + ui re-exports |
| `@agent-wasm/react/chat` | `ChatScreen`, `TimelineFeed`, `ChatComposer`, `ToolCallCard`, `ElicitationCard` |
| `@agent-wasm/react/ui` | Radix-based primitives: `Button`, `Dialog`, `DropdownMenu`, `Input`, `ScrollArea`, `Separator`, `Tooltip`, `cn` |

## Host injection

`ChatScreen` is host-agnostic — it takes `startAgentSession(harness)` and
`createAdapter(session)` callbacks, so any host (the agent-wasm web IDE, your own
app, …) can drive it. The concrete per-agent conversation adapters live with their
agent packages or in the host, not here.

## License

MIT
