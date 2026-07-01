# Isomorphic Agents: Durable Stream-Native Source Control

## Summary

- Build a vertical slice inside `almostnode`: `packages/isomorphic-agents` plus Web IDE/runtime integration.
- Use `replayio/notes-demo` as the pattern for same-origin Durable Streams proxies, deterministic stream IDs, and server-held secrets.
- Treat StreamFS as an adapter target, not a hard dependency yet: `@durable-streams/stream-fs` is documented but currently not published.
- Make browser and cloud agents resume from the same durable file, database, and log streams.

## Context

`notes-demo` combines Durable Streams-backed Yjs document state with Durable Streams-backed TanStack AI chat sessions. Browser clients talk to same-origin API routes, and those routes map deterministic document/chat IDs to Electric/Durable Streams services with server-side secrets.

`almostnode` already has the right local primitives:

- `VirtualFS` for browser runtime file operations, snapshots, and file watchers.
- Repo/sandbox branch concepts in the Web IDE, where the repo base is read-only and sandboxes are writable branch forks.
- PGlite namespaces for project-scoped browser databases.
- Chat/session state split across `packages/chat-core`, `packages/almostnode-react`, and Web IDE session management.
- Git shims remain useful for interoperability, but they should not be the source of truth for this agent-native model.

## Relationship To The Visual Source Editor Plan

Keep this plan separate from `plans/almostnode-staged-visual-source-editor.md`.
The visual source editor is an internal Web IDE editing surface; this plan owns
durable branch state, file event persistence, agent logs, database lineage, and
cloud handoff.

The alignment contract is the existing file write path:

- Visual editor Apply writes source through `VfsFileSystemProvider.writeFile()`.
- `DurableVirtualFsBridge` observes or wraps the same VFS write path when a
  durable branch is attached.
- Durable streams record the resulting file operations, hashes, branch offsets,
  and optional visual-edit summaries after Apply succeeds.
- Preview-only DOM mutations and uncommitted staged visual edits remain
  ephemeral; they are not branch history until they become VFS writes.
- The visual editor must not call Durable Streams directly or own branch/merge
  semantics in v1.

This lets the editor become one producer of normal source edits while
`isomorphic-agents` remains the source of truth for durable continuity.

## Goals

- Persist all workspace files in durable append-only streams.
- Persist all agent chat/log/tool events in durable streams.
- Let branches behave like agent-native source-control branches: every committed workspace/file/log action is durable, replayable, and branch-scoped.
- Clone/branch the PGlite database whenever a filesystem branch is created.
- Allow browser agents to continue locally, hand off to cloud on demand, or resume in cloud after reconnect/credential approval.
- Signal other branches after merges so agents can rebase or reconcile themselves.

## Non-Goals

- Do not replace all existing git behavior in v1.
- Do not depend on unpublished `@durable-streams/stream-fs` as a blocking dependency.
- Do not implement a full visual conflict-resolution UI in the first vertical slice.
- Do not make provider-specific cloud infrastructure the core abstraction.

## Architecture

### Package Boundary

Add `packages/isomorphic-agents` with public types and runtime helpers:

- `AgentWorkspaceRef`
- `AgentBranchRef`
- `DurableStreamConfig`
- `BranchManifest`
- `FileEvent`
- `AgentLogEvent`
- `DbBranchManifest`
- `CloudHandoffRequest`

The package should expose protocol-level APIs and keep Web IDE UI integration outside the core where possible.

### Stream Topology

Use deterministic stream paths:

- Branch manifest: `workspaces/{workspaceId}/branches/{branchId}/manifest`
- Filesystem metadata: `workspaces/{workspaceId}/branches/{branchId}/fs/_metadata`
- File content: `workspaces/{workspaceId}/branches/{branchId}/fs/_content/{contentId}`
- Agent session events: `workspaces/{workspaceId}/branches/{branchId}/sessions/{sessionId}/events`
- Branch ledger: `workspaces/{workspaceId}/branches/{branchId}/ledger`
- Merge/rebase signals: `workspaces/{workspaceId}/branches/{branchId}/signals`
- Database branch metadata: `workspaces/{workspaceId}/branches/{branchId}/db/manifest`

Use JSON-mode Durable Streams for structured events and byte streams for raw file/database content where needed.

### Filesystem Persistence

Implement `DurableVirtualFsBridge` around existing `VirtualFS`.

Responsibilities:

- Hydrate a VFS from branch streams.
- Mirror local VFS `writeFile`, `unlink`, `mkdir`, `rmdir`, and `rename` operations into append-only durable file events.
- Replay remote file events back into the local VFS without echo loops.
- Track stream offsets per branch/session so reload and cloud handoff resume from the last materialized point.
- Keep IndexedDB snapshots as cache/fast-start materializations, not source of truth.

Initial implementation can use `@durable-streams/client` directly. Once `@durable-streams/stream-fs` is actually available, swap the bridge internals to use `StreamFilesystem` while preserving the same public interfaces.

### Agent Logs And Chats

Add a durable log adapter that writes normalized agent events:

- user messages
- assistant text deltas
- tool start/progress/end
- file diffs or file operation summaries
- elicitation/request-user-input events
- permission prompts
- errors, retries, cancellations
- handoff and resume lifecycle events

The chat UI can still render through existing `ConversationAdapter` interfaces, but durable streams become the shared persistence and sync layer.

### Branch Model

Branch creation:

- Create a new `BranchManifest` with parent branch id and parent branch offsets.
- Hydrate the new branch from the parent materialized filesystem state.
- Create branch-local file, ledger, signal, log, and db metadata streams.
- Write `branch.created` to the new branch ledger and `branch.child_created` to the parent ledger.

Merge:

- Materialize source and target branch states at known offsets.
- Apply source branch events to target branch through a deterministic merge operation.
- Write `merge.applied` to the target branch ledger.
- Write `branch.rebase_requested` to other open child branches, including target offsets and merge metadata.
- Agents subscribed to those branches decide whether to auto-rebase, ask the user, or continue with explicit divergence.

V1 conflict handling should be conservative: detect path-level conflicts and surface a structured event rather than silently choosing a side.

### PGlite Branching

Branch the PGlite database with the filesystem branch:

- Quiesce or close the source branch PGlite instance before cloning.
- Call PGlite `dumpDataDir()` on the source branch database.
- Create a new database namespace/idb path for the child branch.
- Initialize the child branch database with `loadDataDir`.
- Record source branch id, source filesystem offset, source db metadata, child namespace, and dump metadata in `DbBranchManifest`.

After cloning, source and child databases diverge independently. Merge support for DB changes should start as manifest-level lineage and explicit migration/replay policy, not automatic row-level merging.

### Cloud Handoff

Add a provider-neutral cloud runner protocol first.

Browser side:

- User clicks "Move to cloud" or reconnect policy requests a cloud resume.
- Browser writes `handoff.requested` with workspace, branch, session, stream offsets, required credential slots, and desired runner constraints.
- If credentials are required, browser/mobile notification asks the user to approve short-lived credential grants.

Cloud side:

- Runner claims the handoff event.
- Runner hydrates files from durable streams.
- Runner hydrates database from branch DB metadata.
- Runner resumes the agent session from durable log offsets.
- Runner writes `handoff.claimed`, `handoff.running`, and eventual completion/error events.

The first runner should be generic server/worker code. Cloudflare/Fly-specific deployment can follow after the protocol works.

## Implementation Plan

1. Add `packages/isomorphic-agents` with type definitions, stream path builders, and protocol helpers.
2. Add tests for stream ID builders and event schemas.
3. Implement a local Durable Streams client wrapper with create/read/append helpers and idempotent producer support.
4. Implement `DurableVirtualFsBridge` against `VirtualFS` with local hydrate and append-only write mirroring.
5. Wire Web IDE sandbox open/create paths to optionally attach a durable branch ref.
6. Add durable agent log adapter behind existing chat/session abstractions.
7. Add branch manifest and branch creation flow that forks file streams plus PGlite DB state.
8. Add merge/rebase signal events without automatic complex conflict resolution.
9. Add cloud handoff event protocol and a local fake runner for tests.
10. Add UI affordances after the data model works: durable sync status, branch lineage, and "Move to cloud".

## Test Plan

- Unit test stream ID builders, event schema validation, and branch manifest serialization.
- Unit test VFS bridge create/write/delete/rename replay against `VirtualFS`.
- Unit test offset resume and duplicate event handling with idempotent producers.
- Unit test branch creation materializes parent files at the captured offset.
- Unit test PGlite branch clone using `dumpDataDir()` and `loadDataDir`, verifying source and child diverge independently.
- Integration test with local `@durable-streams/server`: two sessions edit the same branch, reload, reconnect from saved offsets, and converge.
- Cross-plan integration test: with the staged visual source editor enabled,
  Apply a visual edit and verify it produces normal VFS writes plus durable file
  events without the editor depending on Durable Streams APIs.
- Web IDE smoke with `playwright-cli`: create sandbox branch, edit files, run agent chat, reload, switch branch, merge, and observe rebase signal.
- Run `pnpm nx test almostnode`, `pnpm nx test web-ide`, `pnpm nx type-check almostnode`, and targeted Web IDE e2e once UI surfaces are wired.

## Acceptance Criteria

- A workspace branch can be hydrated from durable streams into `VirtualFS`.
- Local file edits produce durable stream events and can be replayed after reload.
- Agent logs are durable, offset-resumable, and renderable by the existing chat surface.
- Creating a branch clones both file state and PGlite state.
- Source and child branch PGlite databases diverge independently after branch creation.
- Merging one branch emits durable merge and rebase-request signals.
- A local fake cloud runner can claim a handoff and resume from durable offsets.

## Assumptions

- V1 is a monorepo vertical slice, not a standalone app.
- `@durable-streams/stream-fs` remains unavailable until proven otherwise; use protocol-level Durable Streams APIs first.
- Existing IndexedDB project/sandbox persistence stays as a cache and migration fallback during rollout.
- Git remains available for import/export and compatibility, but durable branch streams are the source of truth for agent-native continuity.
- The first cloud runner is provider-neutral; Cloudflare/Fly-specific deployment is a follow-up.
