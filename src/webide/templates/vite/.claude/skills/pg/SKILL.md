---
name: "pg"
description: "Use when you need to run SQL queries against the PGlite database — inserting, selecting, updating, deleting data, or inspecting tables/schema. Provides the `pg` terminal command."
---

# pg — Quick SQL Command

Run SQL queries against PGlite databases directly from the terminal. Auto-detects whether to query or exec — no subcommands needed.

## Quick start

```bash
pg "SELECT * FROM todos"
pg "INSERT INTO todos (title) VALUES ('Buy milk')"
pg "UPDATE todos SET completed = true WHERE id = 1"
pg "DELETE FROM todos WHERE id = 1"
```

## Auto-detection

The command automatically classifies SQL:

- **Query** (returns rows): `SELECT`, `WITH`, `EXPLAIN`, `SHOW`, `VALUES`, `TABLE`, or anything with `RETURNING`
- **Exec** (returns OK): `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, etc.

```bash
pg "INSERT INTO todos (title) VALUES ('Test') RETURNING *"   # → returns the inserted row
pg "CREATE TABLE users (id serial PRIMARY KEY, name text)"    # → OK
```

## Flags

- `--json` — Output raw JSON instead of a formatted table
- `--db <name>` — Target a specific database (defaults to active)

```bash
pg --json "SELECT * FROM todos"
pg --db myapp "SELECT count(*) FROM users"
```

## psql shortcuts

```bash
pg "\dt"          # List all tables
pg "\d todos"     # Describe a table (columns, types, nullability)
pg "\l"           # List all databases
```

## Recommended patterns

### Seed data then verify

```bash
pg "INSERT INTO todos (title) VALUES ('Buy milk')"
pg "INSERT INTO todos (title) VALUES ('Walk dog')"
pg "SELECT * FROM todos"
```

### Schema changes

```bash
pg "ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 0"
pg "\d todos"
```

### Check row counts

```bash
pg "SELECT count(*) as total FROM todos"
```

### JSON output for programmatic use

```bash
pg --json "SELECT * FROM todos WHERE completed = false"
```

## Guardrails

- Always quote your SQL string: `pg "SELECT ..."` — unquoted SQL will be mangled by the shell.
- For complex queries with single quotes, use double quotes around the whole statement: `pg "INSERT INTO todos (title) VALUES ('Buy milk')"`.
- The `pg` command bypasses the shell lexer, so SQL with semicolons, backslashes, and quotes works correctly.
