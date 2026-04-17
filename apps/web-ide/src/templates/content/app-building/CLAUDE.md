# Project: App Building Control Plane

This workspace exists to orchestrate remote `app-building` workers running on Fly.io.

## Prime directive

Do not work inside the shared target repository from this control-plane project unless the user explicitly asks for direct repo changes.

The preferred workflow is:

```bash
app-building create --remote --name <app-name> --prompt "<prompt>"
app-building status <job-id>
app-building logs <job-id>
app-building message <job-id> --prompt "<follow-up>"
app-building stop <job-id>
```

## What the control plane owns

- remote worker provisioning
- job tracking and resume data
- orchestration prompts
- the control dashboard in `src/App.tsx`

## What the remote workers own

- one push branch each
- one checkout of the shared target GitHub repo at `/app`
- implementation work inside that target repo

## Runtime notes

This still runs inside almostnode:

- browser-based filesystem
- browser-safe shell commands
- Vite preview in the IDE
- no Docker, no host scripts, no background daemons

Use the shell surfaces that already exist. Do not invent manual side channels when the `app-building` command can do the work.

## Keychain prerequisites

- Fly.io auth belongs in the Fly keychain slot.
- Shared builder config belongs in the App Building keychain slot. Workers default to `replayio/app-building`.
- Secrets should stay in keychain-managed files, not prompt history.

## Suggested orchestration pattern

1. Create a concise ledger of active jobs.
2. Launch one worker per app.
3. Inspect `status` and `logs` before corrective follow-ups.
4. Send another `message` when you want the worker to continue.
5. Stop idle or superseded workers.
