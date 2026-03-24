export type {
  AgentAdapter,
  AgentBrowserEnv,
  AgentMountContext,
  AgentSession,
  OpenCodeAgentAdapterOptions,
  SnapshotStore,
  TerminalSessionHandle,
  WorkspaceController,
  WorkspaceCreateOptions,
  WorkspaceSnapshot,
  WorkspaceTemplate,
} from "./workspace";
export {
  DEFAULT_WORKSPACE_TEMPLATE,
  createIndexedDbSnapshotStore,
  createOpenCodeAgentAdapter,
  createWorkspace,
} from "./workspace";
