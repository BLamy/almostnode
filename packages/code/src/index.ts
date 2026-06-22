// @agent-wasm/code — Claude Code agent integration: incremental JSONL
// transcript parsing and a synced conversation adapter over @agent-wasm/chat-core.
// (The Monaco-coupled IDE bridge stays demo-resident for now — see refactor notes.)
export * from './claude-threads';
export * from './claude-transcript-tail';
export * from './claude-conversation-adapter';
export * from './claude-ide-server';
