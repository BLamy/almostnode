# Planning Workflows

Structured approaches for different task types. Pick the workflow that matches your task, then follow the steps in order.

## New Feature Workflow

**Use when:** Adding new functionality (new page, new component, new data model).

1. **Spec** — Clarify what the feature does. What data does it need? What does the UI look like? What user actions does it support?
2. **Schema** — If it needs new data, design the Drizzle schema first. Define tables, columns, relationships.
3. **Migration** — Generate and apply the migration before writing any frontend code.
4. **Components** — Build the React components. Start with the data display, then add interactivity.
5. **Pages** — Wire components into pages and routes.
6. **QA** — Verify the full flow: page loads, data displays, interactions work, data persists.

### Parallelization
- Steps 2-3 (schema + migration) must complete before step 4 (components)
- Steps 4-5 (components + pages) can be done together
- Step 6 (QA) runs last

## Bug Fix Workflow

**Use when:** Something is broken and needs fixing.

1. **Triage** — Read the error. Classify it using the [debugging skill](../debugging/SKILL.md). Is it a rendering issue? Data issue? Timing issue?
2. **Diagnose** — Use the right diagnostic tool for the failure type. Check console, snapshot, database state.
3. **Fix** — Make the minimal change that fixes the root cause. Don't refactor unrelated code.
4. **Verify** — Confirm the fix works AND nothing else broke. Check console errors, run the user flow, verify database state.

### Anti-Patterns
- Don't guess at fixes — diagnose first
- Don't fix symptoms — find the root cause
- Don't refactor while fixing — one change at a time

## Schema Change Workflow

**Use when:** Modifying the database schema (adding columns, changing types, adding tables).

1. **Design** — Write the new schema in `src/db/schema.ts`. Consider: nullability, defaults, indexes, foreign keys.
2. **Generate Migration** — `drizzle-kit generate --name <description> --force`
3. **Review SQL** — Read the generated migration file. Make sure it does what you expect.
4. **Apply** — `drizzle-kit migrate --force`
5. **Update Queries** — Find all queries that reference changed tables. Update them for the new schema.
6. **Update Types** — If you export types from `src/db/types.ts`, make sure they reflect the new schema.
7. **Verify** — `pg "\d tablename"` to confirm the actual DB matches expectations.

### Parallelization
- Steps 1-4 are sequential
- Steps 5-6 can be done in parallel
- Step 7 runs last

## UI-Only Change Workflow

**Use when:** Styling changes, layout adjustments, component modifications that don't touch data.

1. **Design** — What should change visually? Reference existing design patterns in the app.
2. **Implement** — Make the changes. Use Tailwind classes, shadcn/ui components.
3. **Verify** — `playwright-cli screenshot` + `playwright-cli snapshot` to confirm it looks right and is accessible.

## Task Scoping Rules

These rules apply to ALL workflows:

- **Stay in your lane** — Each subagent works only on its assigned task. Backend doesn't touch UI. Frontend doesn't run migrations.
- **Adding tasks != doing tasks** — If you discover additional work needed, report it back. Don't do it yourself unless it's part of your assignment.
- **Escalate, don't guess** — If something is unclear or outside your expertise, escalate. Don't make assumptions about the right approach.
- **Atomic tasks** — Each task should be completable independently. If it depends on another task, make that dependency explicit.
- **Verify your own work** — Every subagent should do a basic smoke test before reporting completion. Frontend checks console errors. Backend checks with `pg`. QA does the full flow.

## Choosing the Right Workflow

| Situation | Workflow |
|-----------|----------|
| "Add a users page" | New Feature |
| "Users page is blank" | Bug Fix |
| "Add email column to users" | Schema Change |
| "Make the header sticky" | UI-Only Change |
| "Add a users page" but users table doesn't exist | New Feature (starts at Schema step) |
| "Redesign the dashboard" | UI-Only if data layer is unchanged; New Feature if adding new data views |
