// @agent-wasm/chat-core — dependency-free chat domain types and tool-call
// helpers shared by @agent-wasm/react (chat UI) and the agent packages
// (@agent-wasm/code, …). No React, no runtime deps — just types + pure
// encoders so agent packages stay framework-free and the dependency graph
// stays acyclic.
export * from './conversation-types';
export * from './tool-calls';
export * from './agent-session-registry';
export * from './chat-preferences';
