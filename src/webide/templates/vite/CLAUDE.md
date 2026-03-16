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

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run typecheck    # TypeScript check
drizzle-kit generate --name <desc>   # Generate migration
drizzle-kit migrate                  # Apply migrations
drizzle-kit push                     # Quick schema push (no migration file)
pg "SQL"                             # Run SQL queries
playwright-cli snapshot              # UI accessibility tree
playwright-cli screenshot            # Visual screenshot
```
