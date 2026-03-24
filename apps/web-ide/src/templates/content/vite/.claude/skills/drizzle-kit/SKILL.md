---
name: "drizzle-kit"
description: "Use when you need to manage database schema migrations — generating migrations from Drizzle schema changes, applying migrations, pushing schema directly, or checking migration status."
---

# drizzle-kit — Schema Migration Tool

Manage PGlite database schema using Drizzle ORM migrations. Works with the schema defined in `src/db/schema.ts`.

## Workflow

### Standard migration workflow

1. Edit `src/db/schema.ts` to add/modify tables
2. Generate a migration: `drizzle-kit generate --name <description>`
3. Review the generated SQL in `drizzle/<number>_<name>.sql`
4. Apply the migration: `drizzle-kit migrate`

### Quick prototyping (no migration file)

```bash
drizzle-kit push
```

Applies schema changes directly to the database without creating a migration file. Good for rapid iteration, but changes aren't tracked.

## Commands

### Generate a migration

```bash
drizzle-kit generate --name add_users
drizzle-kit generate --name add_priority_column
drizzle-kit generate --name remove_old_table --force
```

Reads `src/db/schema.ts`, diffs against the current database, and writes a SQL migration file to `drizzle/`.

- `--name <name>` (required): Name for the migration file
- `--force`: Include DROP TABLE statements (without this flag, table drops are blocked)

### Apply pending migrations

```bash
drizzle-kit migrate
```

Reads all `.sql` files from `drizzle/`, applies any that haven't been run yet. Migrations are tracked in the `_drizzle_migrations` table.

### Push schema directly

```bash
drizzle-kit push
drizzle-kit push --force
```

Applies schema diff directly without creating a migration file. Use `--force` to allow DROP TABLE.

### Check migration status

```bash
drizzle-kit status
```

Lists all migration files with `[applied]` or `[pending]` status.

## Schema file format

The schema file at `src/db/schema.ts` uses Drizzle ORM's `pgTable` syntax:

```typescript
import { pgTable, serial, text, boolean, timestamp, integer, varchar, jsonb, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### Supported column types

| Drizzle function | SQL type |
|-----------------|----------|
| `serial` | SERIAL |
| `bigserial` | BIGSERIAL |
| `integer` | INTEGER |
| `bigint` | BIGINT |
| `smallint` | SMALLINT |
| `text` | TEXT |
| `varchar` (with `{ length: N }`) | VARCHAR(N) |
| `boolean` | BOOLEAN |
| `timestamp` | TIMESTAMP |
| `timestamp` (with `{ withTimezone: true }`) | TIMESTAMPTZ |
| `date` | DATE |
| `json` / `jsonb` | JSON / JSONB |
| `uuid` | UUID |
| `real` | REAL |
| `doublePrecision` | DOUBLE PRECISION |
| `numeric` (with `{ precision, scale }`) | NUMERIC(p,s) |

### Supported modifiers

| Modifier | SQL |
|----------|-----|
| `.primaryKey()` | PRIMARY KEY |
| `.notNull()` | NOT NULL |
| `.default(value)` | DEFAULT value |
| `.defaultNow()` | DEFAULT now() |

## Guardrails

- **Always review generated SQL** before running `drizzle-kit migrate`. The generated file is in `drizzle/`.
- **DROP TABLE requires `--force`** — without it, generate and push will refuse to drop tables.
- **Column type changes** (e.g., `text` → `integer`) are not auto-detected. Write a manual ALTER in a migration file for these.
- **`push` skips migration tracking** — use it for prototyping, not production workflows.
- **Migrations run in filename order** — the numeric prefix ensures correct ordering.

## Example: Adding a new table

```bash
# 1. Edit src/db/schema.ts to add:
#    export const users = pgTable('users', {
#      id: serial('id').primaryKey(),
#      name: text('name').notNull(),
#      email: text('email').notNull(),
#    });

# 2. Generate migration
drizzle-kit generate --name add_users

# 3. Review the generated file
# cat drizzle/0001_add_users.sql

# 4. Apply it
drizzle-kit migrate

# 5. Verify
pg "\dt"
pg "SELECT * FROM users"
```
