# almostnode

This repository now includes root OpenCode/Codex project guidance for the monorepo.

- OpenCode uses `AGENTS.md` and `.opencode/agent/`
- Project-local skills can live in `.agents/skills/` and `.claude/skills/`
- If you need the longer architecture brief, read `CLAUDE.md`

## What This Repo Is

almostnode is an Nx monorepo for a browser-based Node.js runtime and the apps around it. This is not a normal OS-first backend repo.

Primary areas:

- `packages/almostnode/` - runtime, VFS, npm/package manager, framework servers, shell command shims
- `apps/web-ide/` - browser IDE, terminal routing, workspace templates, template seeding
- `apps/desktop-ide/` - desktop host integration and workspace/project wiring
- `apps/sdk-showcase/` - showcase app and browser integration surface
- `vendor/` - vendored dependencies; do not make speculative edits here unless the task explicitly requires it

## Core Principle

Do not paper over platform gaps with package-specific hacks.

- If a package or workflow fails because the environment is missing support, fix the platform or shim layer.
- Prefer the existing command surface and runtime behavior before inventing fallback scripts or manual workarounds.
- For shell/runtime tasks, validate against the real shim or command path when it exists.

## Runtime Model

almostnode provides a browser-safe runtime with a virtual filesystem, package installation, service worker-backed dev servers, and registered CLI shims. Treat the available commands as first-class tools, not as examples.

- Filesystem may be virtual or bridged, depending on context
- CLI behavior may be implemented by almostnode shims rather than a host OS binary
- There is no guarantee that ad-hoc host tooling is the right path, even if the shell looks familiar

## Preferred Commands

Use the built-in or already-supported CLI tools before inventing substitute workflows:

```bash
# Workspace and project commands
pnpm nx serve-examples almostnode
pnpm nx dev web-ide
pnpm nx dev sdk-showcase
pnpm nx build almostnode
pnpm nx build web-ide
pnpm nx test almostnode
pnpm nx test web-ide
pnpm nx e2e almostnode
pnpm nx type-check almostnode

# Runtime and package commands
node <script>
npm <command>
npx <command>
tsc

# Browser-safe CLI tools already supported by almostnode
drizzle-kit <subcommand>
pg "<sql>"
pglite <subcommand>
playwright-cli <subcommand>
replayio <subcommand>
curl <url>
jina <url>
rg <pattern>
git <command>
gh <command>
ps
```

## Tool Selection Rules

- For schema or migration work, prefer `drizzle-kit generate --name <desc>`, review the generated SQL, then run `drizzle-kit migrate`.
- Use `pg` to verify the actual database state after schema or data changes.
- Use `drizzle-kit push --force` only for resets, destructive changes, or short-lived prototyping.
- For browser or UI verification, use `playwright-cli` before speculative reasoning about what the app "probably" did.
- For recordings or hard-to-reproduce issues, escalate to `replayio` after basic console, network, storage, and DOM inspection.
- For repo search, use `rg` before slower or more manual approaches.
- When a built-in CLI exists for the task, do not replace it with hand-written scripts or manual reimplementation unless the command is proven insufficient.

## Monorepo Conventions

- Read the relevant example, template, or test before changing behavior.
- For template or Drizzle-backed workspace tasks, treat the schema file as the source of truth and use the real migration workflow.
- For runtime compatibility issues, prefer generic shim/runtime fixes over one-off library adapters.
- Preserve existing worktree changes that are unrelated to your task.

## File Editing

- Never create or overwrite source files with shell heredocs such as `cat > file <<'EOF'`.
- Use the available editor or patch tool for file creation and modification.
- If shell execution is required, avoid inlining source code inside quoted shell commands.

## Work Strategy

For multi-step work, delegation is a strong default, not an absolute rule.

1. Make a short task list for work with 2 or more meaningful steps.
2. Delegate when ownership splits cleanly and the tasks are non-overlapping.
3. Keep tiny or tightly coupled tasks local instead of forcing delegation.
4. After meaningful code changes, always delegate or perform an explicit QA pass before closing the task.

## Available Subagents

OpenCode subagents for this repo are defined in `.opencode/agent/`:

- `runtime-engineer` - owns `packages/almostnode/`, command shims, runtime/framework/package-manager behavior
- `ide-engineer` - owns `apps/web-ide/`, `apps/desktop-ide/`, `apps/sdk-showcase/`, template seeding, and app integration
- `qa-tester` - owns verification with `pnpm nx`, `playwright-cli`, `pg`, and related smoke checks
- `debugging-engineer` - owns reproduction and root-cause analysis across UI, runtime, storage, database, and recordings

## Delegation Rules

- Delegate runtime or shell-command work to `runtime-engineer`.
- Delegate app, IDE, template, and integration work to `ide-engineer`.
- Delegate verification after meaningful changes to `qa-tester`.
- Delegate hard-to-reproduce failures, flaky behavior, or unclear regressions to `debugging-engineer`.
- If a task spans runtime and IDE work, split it rather than asking one subagent to do both.
- If a task is too small to benefit from delegation, keep it local and finish it directly.

## Skills

Load an existing project skill when it matches the task instead of improvising a new workflow.

- Project-local skills may be available in `.agents/skills/`
- Project-local Claude-compatible skills may also be available in `.claude/skills/`
- Prefer repo-local skill instructions over generic habits when a matching skill exists

## Notes For Drizzle and Browser Work

- `drizzle-kit`, `pg`, and `playwright-cli` are part of the intended toolchain here. Use them directly when the task calls for them.
- If you are editing template or seeded-app database behavior, generate or apply migrations instead of manually faking schema state.
- If you are validating UI behavior, inspect the real rendered state with `playwright-cli` instead of reasoning from code alone.
