# Project: App Building Control Plane

This workspace is the orchestration layer for remote Fly.io app-building workers.

- Claude Code uses `CLAUDE.md` and `.claude/`
- OpenCode uses `AGENTS.md` and `.opencode/agent/`
- Shared project skills live in `.claude/skills/`

## Core rule

Do not edit the shared target repository from this control-plane project unless the user explicitly asks for direct repo work.

Use the `app-building` shell surface instead:

```bash
app-building create --remote --name <app-name> --prompt "<prompt>"
app-building list
app-building status <job-id>
app-building logs <job-id>
app-building message <job-id> --prompt "<follow-up>"
app-building stop <job-id>
```

## Operating model

- One remote worker owns one push branch in the shared target repo.
- The main chat coordinates workers by prompting, inspecting, and stopping them.
- The preview dashboard is only a mirror of the job ledger. The terminal command surface is authoritative.
- Fly.io auth lives in the Fly keychain slot.
- Builder-specific orchestration config lives in the App Building keychain slot. Workers default to `replayio/app-building`.

## Key paths

- `src/App.tsx` — control-plane dashboard
- `src/lib/app-building-dashboard.ts` — IndexedDB reader for builder jobs/config
- `.claude/skills/app-building-orchestration/SKILL.md` — orchestration workflow

## almostnode runtime

This is still an almostnode workspace:

- browser-based filesystem and shell
- Vite preview in-browser
- no Docker or host-side daemons
- use existing shell surfaces instead of inventing side scripts

## Workflow expectations

1. Keep a concise ledger of active jobs in the conversation.
2. Create workers with explicit prompts and app names.
3. Use `status` and `logs` before sending corrective prompts.
4. Prefer `message` to continue work over manual edits inside target repos.
5. Stop workers when they are no longer needed.
