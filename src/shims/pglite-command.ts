import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string): JustBashExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

export async function runPGliteCommand(
  args: string[],
  _ctx: CommandContext,
  _vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help') {
    return ok(HELP_TEXT);
  }

  try {
    switch (subcommand) {
      case 'query': {
        const sql = args.slice(1).join(' ');
        if (!sql) return err('Usage: pglite query "SELECT ..."');
        const { handleDatabaseRequest } = await import('../pglite/pglite-database');
        const result = await handleDatabaseRequest('query', { sql });
        if (result.statusCode !== 200) return err(result.body);
        const data = JSON.parse(result.body);
        if (!data.rows || data.rows.length === 0) return ok('(no rows)');
        return ok(formatTable(data.rows));
      }

      case 'exec': {
        const sql = args.slice(1).join(' ');
        if (!sql) return err('Usage: pglite exec "CREATE TABLE ..."');
        const { handleDatabaseRequest } = await import('../pglite/pglite-database');
        const result = await handleDatabaseRequest('exec', { sql });
        if (result.statusCode !== 200) return err(result.body);
        return ok('OK');
      }

      case 'tables': {
        const { handleDatabaseRequest } = await import('../pglite/pglite-database');
        const result = await handleDatabaseRequest('tables', {});
        if (result.statusCode !== 200) return err(result.body);
        const data = JSON.parse(result.body);
        if (!data.tables || data.tables.length === 0) return ok('(no tables)');
        return ok(data.tables.join('\n'));
      }

      case 'schema': {
        const table = args[1];
        if (!table) return err('Usage: pglite schema <table>');
        const { handleDatabaseRequest } = await import('../pglite/pglite-database');
        const result = await handleDatabaseRequest(`schema/${table}`, {});
        if (result.statusCode !== 200) return err(result.body);
        const data = JSON.parse(result.body);
        if (!data.columns || data.columns.length === 0) return ok(`Table "${table}" not found or has no columns`);
        return ok(formatTable(data.columns));
      }

      case 'list': {
        const { listDatabases } = await import('../pglite/db-manager');
        const { getActiveDatabase } = await import('../pglite/db-manager');
        const dbs = listDatabases();
        const active = getActiveDatabase();
        if (dbs.length === 0) return ok('(no databases)');
        return ok(dbs.map((d) => `${d.name === active ? '* ' : '  '}${d.name} (created ${d.createdAt})`).join('\n'));
      }

      case 'switch': {
        const name = args[1];
        if (!name) return err('Usage: pglite switch <name>');
        const { listDatabases, setActiveDatabase, getIdbPath } = await import('../pglite/db-manager');
        const dbs = listDatabases();
        if (!dbs.some((d) => d.name === name)) return err(`Database "${name}" not found`);
        const { closePGliteInstance, initPGliteInstance } = await import('../pglite/pglite-database');
        const { getActiveDatabase } = await import('../pglite/db-manager');
        const oldActive = getActiveDatabase();
        if (oldActive) await closePGliteInstance(oldActive);
        setActiveDatabase(name);
        // Try to read schema.sql if it exists
        let schemaSQL: string | null = null;
        try { const raw = _vfs.readFileSync('/project/schema.sql'); schemaSQL = typeof raw === 'string' ? raw : new TextDecoder().decode(raw); } catch { /* no schema */ }
        await initPGliteInstance(name, schemaSQL, getIdbPath(name));
        return ok(`Switched to database "${name}"`);
      }

      case 'create': {
        const name = args[1];
        if (!name) return err('Usage: pglite create <name>');
        const { createDatabase, getIdbPath } = await import('../pglite/db-manager');
        createDatabase(name);
        const { initPGliteInstance } = await import('../pglite/pglite-database');
        let schemaSQL: string | null = null;
        try { const raw = _vfs.readFileSync('/project/schema.sql'); schemaSQL = typeof raw === 'string' ? raw : new TextDecoder().decode(raw); } catch { /* no schema */ }
        await initPGliteInstance(name, schemaSQL, getIdbPath(name));
        return ok(`Created database "${name}"`);
      }

      case 'delete': {
        const name = args[1];
        if (!name) return err('Usage: pglite delete <name>');
        const { deleteDatabase, listDatabases } = await import('../pglite/db-manager');
        if (listDatabases().length <= 1) return err('Cannot delete the last database');
        const { closePGliteInstance } = await import('../pglite/pglite-database');
        await closePGliteInstance(name);
        deleteDatabase(name);
        return ok(`Deleted database "${name}"`);
      }

      default:
        return err(`Unknown subcommand: ${subcommand}\n\n${HELP_TEXT}`);
    }
  } catch (error: any) {
    return err(error.message || String(error));
  }
}

export function formatTable(rows: any[]): string {
  if (rows.length === 0) return '(empty)';
  const keys = Object.keys(rows[0]);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
  );
  const header = keys.map((k, i) => k.padEnd(widths[i])).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const body = rows
    .map((r) => keys.map((k, i) => String(r[k] ?? '').padEnd(widths[i])).join(' | '))
    .join('\n');
  return `${header}\n${sep}\n${body}`;
}

const HELP_TEXT = `pglite — In-browser Postgres (PGlite)

SQL:
  pglite query "SELECT * FROM todos"
  pglite exec  "INSERT INTO todos (title) VALUES ('Buy milk')"
  pglite tables
  pglite schema <table>

Database management:
  pglite list
  pglite switch <name>
  pglite create <name>
  pglite delete <name>`;
