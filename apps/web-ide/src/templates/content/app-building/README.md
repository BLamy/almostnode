# App Building Control Plane

This template is a control plane for remote `app-building` workers on Fly.io.

Use it to:

- point workers at one shared target GitHub repo
- launch one remote Fly worker per app
- steer workers from the main Claude chat with follow-up prompts
- inspect status and logs without losing the job ledger across reloads

## First-time setup

1. Open the Keychain sidebar.
2. Sign in to Fly.io in the existing Fly slot.
3. Use the App Building slot to save:
   - `FLY_APP_NAME`
   - `INFISICAL_CLIENT_ID`
   - `INFISICAL_CLIENT_SECRET`
   - `INFISICAL_PROJECT_ID`
   - `INFISICAL_ENVIRONMENT`
   - optional image ref override
4. Ensure `GITHUB_TOKEN` already exists in Infisical global secrets for that project/environment. Workers use that token to clone, push, and open PRs against [replayio/app-building](https://github.com/replayio/app-building/).

## Main commands

```bash
app-building create --remote --name weather-radar --prompt "Build a polished weather dashboard and deploy it on Fly."
app-building list
app-building status <job-id>
app-building logs <job-id>
app-building message <job-id> --prompt "Refine the mobile nav and improve empty states."
app-building stop <job-id>
```

## Operating model

- This project is the orchestrator, not the target app repo.
- The main Claude chat should use `app-building` commands instead of editing the target repo here.
- Each worker clones `https://github.com/replayio/app-building/` into `/app` and pushes its own job branch there.
- The preview reads the same IndexedDB job store that the command surface writes.
