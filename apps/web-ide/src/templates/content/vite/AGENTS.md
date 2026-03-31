# Project: React + Vite + PGlite App

This template includes shared AI project metadata for both Claude Code and OpenCode.

- Claude Code uses `CLAUDE.md` and `.claude/`
- OpenCode uses `AGENTS.md` and `.opencode/agent/`
- Shared project skills live in `.claude/skills/`, and OpenCode can load them too

## Architecture Overview

This is a React + TypeScript app running on Vite with an in-browser PostgreSQL database (PGlite) and Drizzle ORM. UI components come from shadcn/ui with Tailwind CSS styling.

### Key Paths
- `src/pages/` - Route pages
- `src/components/ui/` - shadcn/ui components
- `src/db/schema.ts` - Database schema (Drizzle ORM)
- `src/db/index.ts` - Database client and query helpers
- `src/hooks/` - React hooks (including `useDB` for database access)
- `drizzle/` - Migration files

## Runtime Environment

You are running inside **almostnode** - a browser-based Node.js runtime with a virtual filesystem, npm package manager, and service worker-backed dev servers. This is not a real OS.

- Filesystem: in-memory virtual FS
- Package manager: real npm packages installed and bundled in-browser
- Shell: `just-bash`
- Dev server: Vite, served via service worker

There are no background daemons, no systemd, no Docker, and no system package manager. Use the browser-safe tools that already exist in the workspace.

## Available Commands

### Dev and Build
```bash
npm run dev
npm run typecheck
npm install <pkg>
npx <command>
npx opencode-ai
opencode
node <script.js>
tsc
```

### Database
```bash
pg "SELECT * FROM users"
drizzle-kit generate --name <desc> --force
drizzle-kit migrate --force
drizzle-kit push --force
```

### UI Testing and Debugging
```bash
playwright-cli snapshot
playwright-cli screenshot
playwright-cli click <ref>
playwright-cli fill <ref> "text"
playwright-cli open <url>
playwright-cli console [level]
playwright-cli network
replayio capture
replayio upload <id>
replayio chat <recordingId> "msg"
replayio analyze <recordingId>
```

### Search and Shell
```bash
grep <pattern> <file>
rg <pattern>
curl <url>
jina <url>
ps
git <command>
gh <command>
```

Shell built-ins include `echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tr`, `cut`, `tee`, `xargs`, `env`, `export`, `which`, `true`, `false`, `test`, `read`, `printf`, `seq`, `awk`, `sed`, pipes, redirects, and command chaining.

## OpenCode Workflow

For any task involving multiple steps:

1. Create a todo list first.
2. Use the right subagent from `.opencode/agent/` when the work splits cleanly.
3. Load a project skill from `.claude/skills/` when a task matches an existing workflow.
4. Verify changes before reporting back.
5. A scaffolded git hook commits file changes when a todo item moves to `completed`.
6. When `origin` exists, that same hook pushes the new commit before the todo stays completed.

## Available Subagents

OpenCode subagents are defined in `.opencode/agent/`:

- `frontend-engineer`
- `backend-engineer`
- `qa-tester`
- `debugging-engineer`

Claude keeps equivalent prompts in `.claude/agents/`.

## Conventions

- `src/db/schema.ts` is the schema source of truth.
- Run `drizzle-kit generate` plus `drizzle-kit migrate` for tracked schema changes.
- Gate database access on the PGlite ready state.
- Prefer shadcn/ui components over custom primitives.
- Use Tailwind utility classes instead of inline styles.
- Fix console errors before focusing on visual polish.
- When frontend and backend both change, finish the schema and migration path before final QA.
- Treat git as part of the workflow: do not disable the scaffolded task-completion git hook unless the user explicitly asks.

## Common Pitfalls

### React
- Use functional state updates inside async callbacks to avoid stale closures.
- Avoid `useEffect` feedback loops.
- Use stable keys, not array indices.
- Clean up async effects and timers.

### PGlite
- TypeScript types can drift from the actual database unless migrations run.
- IndexedDB persistence can leave stale data behind between sessions.
- Initialization takes time; do not query before readiness.

### Vite
- Case-sensitive imports matter.
- Circular imports can surface as undefined exports at runtime.

If you need the longer project brief, `CLAUDE.md` contains the same template context in Claude-oriented form.
