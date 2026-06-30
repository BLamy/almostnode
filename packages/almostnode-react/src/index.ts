// @agent-wasm/react — reusable IDE-chrome React layer over @agent-wasm/sdk:
// the workspace provider + Editor/Preview/Terminal panes, the agent chat
// surface (host injected via props), and the Radix UI primitives.
export {
  AgentPanel,
  AlmostnodeProvider,
  EditorPane,
  PreviewPane,
  TerminalPane,
  useWorkspace,
  useWorkspaceSnapshot,
} from "./provider";

export { FileTree, type FileTreeProps } from "./file-tree";
export * from "./chat";
export * from "./ui";
