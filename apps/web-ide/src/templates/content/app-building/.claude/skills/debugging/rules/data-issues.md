# Data Issues (PGlite + Drizzle)

## PGlite Initialization Timing

PGlite must fully initialize before any queries run. This is the #1 cause of "empty data" bugs.

**Symptom:** Page loads with empty lists. Data appears after manual refresh.

**Diagnosis:**
```bash
pg "\dt"                          # Can we even connect? Are tables there?
playwright-cli console error      # Look for "database not initialized" or similar
```

**Fix:** Always gate on the DB ready state. See [timeouts.md](timeouts.md) for the pattern.

## Migration State Mismatches

The schema in `src/db/schema.ts` is the source of truth, but it only takes effect after migrations run. If schema.ts and the actual database diverge, queries silently return wrong results.

### Symptoms

- Queries return empty results for tables that "should" have data
- INSERT fails with "column does not exist"
- SELECT returns columns that don't match your TypeScript types

### Diagnosis

```bash
# What does the DB actually have?
pg "\dt"                          # List tables
pg "\d todos"                     # Show actual columns

# What does the schema say?
cat src/db/schema.ts              # Compare with pg output

# What migrations have run?
drizzle-kit status                # Shows applied vs pending
ls drizzle/                       # List migration files
```

### Fix

```bash
# If migrations are pending:
drizzle-kit migrate --force

# If schema.ts changed but no migration was generated:
drizzle-kit generate --name fix-schema --force
drizzle-kit migrate --force

# Nuclear option (drops and recreates — loses data):
drizzle-kit push --force
```

## Data Contamination Between Sessions

PGlite uses IndexedDB for persistence. Old data from previous sessions can interfere with new schemas or seed data.

**Symptom:** App shows data you didn't create. Tests pass with stale data from a previous run.

**Diagnosis:**
```bash
pg "SELECT * FROM todos"          # Is there unexpected data?
pg "SELECT count(*) FROM todos"   # More rows than expected?
```

**Fix options:**
1. Clear the specific table: `pg "DELETE FROM todos"`
2. Clear IndexedDB (browser devtools → Application → IndexedDB → delete database)
3. Use `drizzle-kit push --force` to drop and recreate tables

## Schema Mismatch: TypeScript vs Database

Drizzle infers TypeScript types from `schema.ts`, but the runtime database might have a different structure if migrations haven't run.

**Symptom:** TypeScript compiles fine, but queries throw at runtime. `.where()` conditions don't match. INSERT inserts into wrong columns.

**Diagnosis:**
```bash
# Compare schema.ts columns with actual DB columns
pg "\d todos"
# Then read src/db/schema.ts and compare field names and types
```

**Fix:** Always run `drizzle-kit migrate --force` after changing `schema.ts`.

## Common Query Mistakes

### Forgetting `.execute()` or `.then()`
```tsx
// BAD — this is a query builder, not a result
const todos = db.select().from(todosTable);

// GOOD — actually execute the query
const todos = await db.select().from(todosTable);
```

### Wrong table reference
```tsx
// BAD — importing the type instead of the table
import { Todo } from '../db/types';
db.select().from(Todo); // Error: Todo is a type, not a table

// GOOD — import the table definition
import { todos } from '../db/schema';
db.select().from(todos);
```

## Diagnosis Checklist

1. **Is PGlite ready?** Check `isReady` flag and console errors.
2. **Do tables exist?** Run `pg "\dt"` — if tables are missing, migrations haven't run.
3. **Does the schema match?** Compare `pg "\d tablename"` with `schema.ts`.
4. **Is there stale data?** Check for unexpected rows from previous sessions.
5. **Is the query correct?** Check table references, column names, and that you're awaiting results.
