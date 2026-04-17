---
name: app-building-orchestration
description: Coordinate several remote Fly.io app-building workers from the control-plane project without directly editing the generated app repositories.
---

Use this skill when the task is about launching, steering, inspecting, or stopping remote app-building workers.

Core rules:

- Treat this workspace as the control plane, not the target application.
- Do not edit generated app repositories from this project unless the user explicitly asks for direct repo work.
- Prefer the `app-building` shell surface:
  - `app-building create --remote --name <app-name> --prompt "<prompt>"`
  - `app-building list`
  - `app-building status <job-id>`
  - `app-building logs <job-id>`
  - `app-building message <job-id> --prompt "<follow-up>"`
  - `app-building stop <job-id>`
- One remote worker owns one generated repo and one push branch. Keep prompts scoped accordingly.
- Before creating workers, confirm Fly.io auth is present and the App Building keychain slot is configured.
- When coordinating multiple workers, keep a short job ledger in the conversation: goal, repo, branch, current status, next prompt.
