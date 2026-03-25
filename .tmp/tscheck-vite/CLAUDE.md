# Project: React + Vite + PGlite App

This template ships with shared AI project metadata for both Claude Code and OpenCode.
- Claude Code uses `CLAUDE.md` and `.claude/`
- OpenCode uses `AGENTS.md` and `.opencode/agent/`
- Shared project skills live in `.claude/skills/`

## Architecture Overview

This is a React + TypeScript app running on Vite with an in-browser PostgreSQL database (PGlite) and Drizzle ORM. UI components come from shadcn/ui with Tailwind CSS styling.

### Key Paths
- `src/pages/` — Route pages
- `src/components/ui/` — shadcn/ui components
- `src/db/schema.ts` — Database schema (Drizzle ORM)
- `src/db/index.ts` — Database client and query helpers
- `src/hooks/` — React hooks (including `useDB` for database access)
- `drizzle/` — Migration files

## Runtime Environment

You are running inside **almostnode** — a browser-based Node.js runtime with a virtual filesystem, npm package manager, and service worker-backed dev servers. This is NOT a real OS. There are no background daemons, no systemd, no real processes. Everything runs in-browser.

- **Filesystem**: In-memory virtual FS (supports read/write/mkdir/etc.)
- **Package manager**: Real npm packages installed and bundled via esbuild-wasm
- **Shell**: `just-bash` — a bash emulator with built-in commands (see below)
- **Dev server**: Vite, served via service worker at `/__virtual__/{port}/`

## Available Commands

### Dev & Build
```bash
npm run dev                          # Start Vite dev server (port 3000)
npm run typecheck                    # TypeScript type check
npm install <pkg>                    # Install npm packages
npx <command>                        # Run npm binaries
npx opencode-ai                      # Launch OpenCode in the Web IDE terminal
opencode                             # Launch OpenCode if available in this workspace
node <script.js>                     # Run a JS/TS file
tsc                                  # TypeScript compiler
```

### Database (PGlite + Drizzle)
```bash
pg "SELECT * FROM users"                    # Run SQL queries against PGlite
drizzle-kit generate --name <desc> --force  # Generate migration from schema changes
drizzle-kit migrate --force                 # Apply pending migrations
drizzle-kit push --force                    # Quick schema push (no migration file)
```

### UI Testing & Debugging
```bash
playwright-cli snapshot              # Get accessibility tree of preview
playwright-cli screenshot            # Take visual screenshot of preview
playwright-cli click <ref>           # Click an element
playwright-cli fill <ref> "text"     # Fill a form field
playwright-cli open <url>            # Navigate the preview
playwright-cli console [level]       # Show console messages (error, warning, info, debug)
playwright-cli network               # Show captured network requests
playwright-cli cookie-list           # List cookies
playwright-cli cookie-get <name>     # Get a cookie value
playwright-cli cookie-set <n> <v>    # Set a cookie
playwright-cli cookie-delete <name>  # Delete a cookie
playwright-cli cookie-clear          # Clear all cookies
playwright-cli localstorage-list     # List localStorage entries
playwright-cli localstorage-get <k>  # Get localStorage value
playwright-cli localstorage-set <k> <v> # Set localStorage value
playwright-cli localstorage-delete <k>  # Delete localStorage entry
playwright-cli localstorage-clear    # Clear all localStorage
playwright-cli sessionstorage-list   # List sessionStorage entries
playwright-cli sessionstorage-get <k>   # Get sessionStorage value
playwright-cli sessionstorage-set <k> <v> # Set sessionStorage value
playwright-cli sessionstorage-delete <k>  # Delete sessionStorage entry
playwright-cli sessionstorage-clear  # Clear all sessionStorage
replayio capture                     # Capture recording from preview
replayio upload <id>                 # Upload recording to Replay
replayio chat <recordingId> "msg"    # Chat with Replay AI about recording
replayio analyze <recordingId>       # Full AI-powered recording analysis
```

### File & Text Search
```bash
grep <pattern> <file>                # Search file contents (regex)
egrep <pattern> <file>               # Extended regex search
fgrep <pattern> <file>               # Fixed-string search
rg <pattern>                         # Ripgrep (recursive search)
```

### Networking
```bash
curl <url>                           # HTTP requests (GET, POST, etc.)
curl -X POST -d '{"key":"val"}' <url>
jina <url>                           # Fetch URL as markdown via r.jina.ai
jina -o output.md <url>              # Save markdown to file
```

### Process & System
```bash
ps                                   # List running processes (shell, dev servers)
git <command>                        # Git operations
gh <command>                         # GitHub CLI
tar -xzf <file>                      # Extract archives
```

### Shell Built-ins (provided by just-bash)
`echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tr`, `cut`, `tee`, `xargs`, `env`, `export`, `which`, `true`, `false`, `test`, `[`, `read`, `printf`, `seq`, `awk`, `sed`, pipes (`|`), redirects (`>`, `>>`), command chaining (`&&`, `||`, `;`)

### NOT Available
There is no `wget`, `apt`, `brew`, `docker`, `python`, `make`, `gcc`, or any system-level tooling. This is a browser sandbox, not a real Linux environment.

## Work Strategy: Delegate to Subagents

**For any task involving 2+ steps, create a todo list first, then delegate work to specialized subagents.**

You have four Claude subagents available in `.claude/agents/`.
OpenCode gets matching subagents in `.opencode/agent/`:

### Frontend Engineer (`frontend-engineer.md`)
Delegate UI work to this agent:
- Building/modifying React components and pages
- Styling with Tailwind and shadcn/ui
- Client-side routing changes
- React hooks and state management

### Backend Engineer (`backend-engineer.md`)
Delegate data layer work to this agent:
- Schema changes in `src/db/schema.ts`
- Generating and applying migrations with `drizzle-kit`
- Writing database queries and data access hooks
- Seeding data with `pg`

### QA Tester (`qa-tester.md`)
Delegate verification to this agent after frontend or backend changes:
- UI verification with `playwright-cli snapshot` and `screenshot`
- Database state checks with `pg`
- Testing user flows end-to-end
- Console error checks

### Debugging Engineer (`debugging.md`)
Delegate troubleshooting to this agent when tests fail or behavior is unexpected:
- Root-cause analysis using `playwright-cli`, `pg`, and `replayio`
- Capturing recordings and uploading to Replay for AI-powered debugging
- Correlating UI state, database state, and recorded behavior
- Providing specific fix recommendations with file paths

## Workflow

1. **Break down the task** — Create a todo list with clear, atomic items
2. **Assign and delegate** — Use the Task tool to spin up the right subagent for each item. Include the agent's prompt file content and the specific task.
3. **Parallelize when possible** — Always do backend work first and make sure the database is migrated before doing frontend work, QA runs after both are done.
4. **Always QA** — After any code changes, delegate a verification task to the QA tester agent

### Example delegation pattern

For a task like "Add a users page with a form":

1. **Backend**: Add `users` table to schema, generate migration, apply it
2. **Frontend**: Create `src/pages/Users.tsx` with form, add route to `App.tsx`
3. **QA**: Verify page renders, form submits, data persists in DB

Steps 1 and 2 can run in parallel. Step 3 runs after both complete.

## Task Scoping Rules

- **Stay in your lane** — Each subagent only works on its assigned task. Backend doesn't touch UI. Frontend doesn't run migrations. QA doesn't fix bugs.
- **Adding tasks != doing tasks** — If you discover additional work needed during your task, report it back to the orchestrator. Don't do unassigned work.
- **Escalate, don't guess** — If something is unclear, outside your expertise, or you've already tried one fix that didn't work, escalate. Don't spend time guessing.
- **Verify your own work** — Every subagent does a basic smoke test before reporting completion:
  - Frontend → `playwright-cli console error` + `playwright-cli snapshot`
  - Backend → `pg "\dt"` + `pg "SELECT * FROM <table>"`
  - QA → Full structured checklist (console → network → database → UI → visual)

## Planning Workflows

For structured approaches to different task types, see `.claude/skills/planning/SKILL.md`:
- **New Feature**: spec → schema → components → pages → QA
- **Bug Fix**: triage → diagnose → fix → verify
- **Schema Change**: design → migrate → update queries → verify
- **UI-Only Change**: design → implement → verify

## Design System

### Animation Tokens

**Easing curves** — available as Tailwind classes (`ease-out-quart`, `ease-in-out-cubic`, etc.):

| Family | When to use | Examples |
|--------|-------------|----------|
| `ease-out-*` | Entrances, things appearing | Modals, dropdowns, toasts |
| `ease-in-out-*` | On-screen movement, repositioning | Sidebar collapse, accordion |
| `ease` (CSS default) | Hover/focus micro-interactions | Button hover, link underline |

**Recommended default**: `ease-out-quart` — sharp deceleration, feels responsive.

**Duration tokens** — semantic names for consistent timing:

| Token | Value | Use for |
|-------|-------|---------|
| `duration-micro` | 100ms | Hover states, color changes |
| `duration-fast` | 150ms | Small UI feedback, exits |
| `duration-standard` | 200ms | Most entrances, scale/fade |
| `duration-modal` | 250ms | Modals, drawers, large overlays |
| `duration-slow` | 300ms | Page transitions, complex sequences |
| `duration-exit` | 150ms | All exit animations (20% faster than entrance) |

**Rule**: If something happens 100+ times/day (button clicks, toggles), keep it under `duration-fast` or skip animation entirely.

**Animation shorthand classes**: `animate-fade-in`, `animate-fade-out`, `animate-scale-in`, `animate-scale-out`, `animate-slide-in-up`, `animate-slide-in-down`, `animate-slide-in-left`, `animate-slide-in-right`, `animate-slide-out-down`, `animate-slide-out-up`

### Typography Scale

| Class | Size | Use for |
|-------|------|---------|
| `text-display` | 3.5rem | Hero headlines |
| `text-title-1` | 2.25rem | Page titles |
| `text-title-2` | 1.5rem | Section headings |
| `text-title-3` | 1.25rem | Card headings, subtitles |
| `text-body-lg` | 1.125rem | Lead paragraphs |
| `text-body` | 1rem | Default body text |
| `text-body-sm` | 0.875rem | Secondary text, captions |
| `text-caption` | 0.75rem | Timestamps, labels |
| `text-overline` | 0.6875rem | Category labels, badges (uppercased) |

### Color Tokens

Beyond the base shadcn set (`primary`, `secondary`, `destructive`, `muted`, `accent`):

- `success` / `success-foreground` — Green, confirmations and positive states
- `warning` / `warning-foreground` — Amber, caution states
- `surface` / `surface-foreground` — Subtle background for cards/sections
- `chart-1` through `chart-5` — Data visualization palette

### Spacing Tokens

- `p-card` (2rem) / `p-card-sm` (1.25rem) — Card padding
- `py-section` (5rem) — Section vertical spacing
- `gap-gutter` (1.5rem) — Grid/flex gap

### Common Animation Patterns

```
Dropdown:     animate-scale-in origin-top
Toast:        animate-slide-in-right
Modal:        animate-scale-in
Tooltip:      animate-fade-in duration-fast
Page enter:   animate-fade-in animate-slide-in-up
Exit any:     animate-fade-out (or slide-out-* variant)
```

## Common Pitfalls

### React
- **Stale closures** — Use functional updaters (`setX(prev => ...)`) in async callbacks and effects, not direct state references
- **useEffect loops** — If an effect updates its own dependencies, it loops forever. Use `useMemo` for computed values instead of useEffect + useState
- **Key props** — Always use stable IDs (e.g., `item.id`) as keys in lists, never array indices
- **useEffect cleanup** — Always return a cleanup function from effects that do async work (fetch, timers)

### PGlite
- **Migration state** — TypeScript types come from `schema.ts`, but the actual DB only changes after `drizzle-kit migrate`. These can silently diverge.
- **IndexedDB persistence** — Old data from previous sessions can contaminate new runs. Clear tables or push schema to reset.
- **Init timing** — PGlite takes 1-3s to initialize. Gate all queries on `isReady`. Never use setTimeout as a workaround.

### Vite
- **Case-sensitive imports** — `./pages/users` vs `./pages/Users` — works on macOS, breaks on Linux/CI
- **Circular imports** — Can cause undefined exports at runtime. If a component renders as `undefined`, check for import cycles.
