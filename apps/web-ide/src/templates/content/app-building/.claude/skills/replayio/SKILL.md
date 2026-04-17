---
name: "replayio"
description: "Use when you need to capture recordings from the preview, upload them to Replay, and use AI-powered analysis for debugging. Provides the `replayio` terminal command."
---

# replayio — Record and Debug with Replay

Capture DOM recordings from the preview iframe and upload them to Replay for AI-powered debugging analysis. This is a built-in command — no installation needed.

## Quick start

```bash
replayio capture
replayio upload 1
replayio chat <recordingId> "What does this app do?"
replayio analyze <recordingId> "Why is the form not submitting?"
```

## Core workflow

1. `replayio capture` — extract a recording from the live preview iframe.
2. `replayio upload <id>` — upload to Replay platform, get a recordingId.
3. `replayio chat <recordingId> "question"` — ask Replay AI about the recording.
4. `replayio analyze <recordingId> [goal]` — get a full root-cause analysis.

## Command reference

### capture
Extract simulation data (rrweb DOM snapshots, interactions, network, errors) from the preview iframe.

```bash
replayio capture
# → Captured recording #1 (142 events, 28.3 KB)
```

### ls
List all cached recordings. Auto-captures if cache is empty and preview is live.

```bash
replayio ls
# → ID  Timestamp    Events  Size     URL
# → 1   2024-01-15   142     28.3 KB  /__virtual__/3000/
```

### upload
Upload a cached recording to the Replay platform. Returns a recordingId for use with chat/analyze.

```bash
replayio upload 1
# → Recording ID: abc123
# → URL: https://app.replay.io/recording/abc123
```

### chat
Stream a conversation with Replay AI about a specific recording.

```bash
replayio chat abc123 "Why is the todo list empty after submitting the form?"
replayio chat abc123 "What network requests were made?"
replayio chat abc123 "Were there any errors?"
```

### analyze
Request a full analysis of a recording. Optionally provide a goal to focus the analysis.

```bash
replayio analyze abc123
replayio analyze abc123 "Find why the delete button doesn't work"
replayio analyze abc123 "Check for race conditions in data fetching"
```

## Recommended patterns

### Quick debug after a failing test
```bash
replayio capture
replayio upload 1
replayio analyze <recordingId> "This test is failing — find the root cause"
```

### Investigate a specific interaction
```bash
replayio capture
replayio upload 1
replayio chat <recordingId> "What happens when the user clicks the submit button?"
```

### Compare before/after
```bash
replayio capture                     # Before the change
# ... make code changes ...
replayio capture                     # After the change
replayio ls                          # See both recordings
```

## Guardrails

- Always `capture` before `upload` — you need a cached recording first.
- Recording IDs from `upload` are different from cache IDs used by `ls`/`upload`.
- The `chat` and `analyze` commands require a Replay recordingId (from `upload`), not a cache ID.
- Recordings capture rrweb DOM snapshots, user interactions, network activity, and errors — matching Replay's simulationData format.
- If capture times out, make sure the preview has loaded (the capture script is auto-injected by the Vite dev server).
