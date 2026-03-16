# Project: React + Vite + PGlite App

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

You have three subagents available in `.claude/agents/`:

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
