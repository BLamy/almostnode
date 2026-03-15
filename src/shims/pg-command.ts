import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { formatTable } from './pglite-command';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string): JustBashExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

export interface PgArgs {
  sql: string;
  json: boolean;
  db: string | undefined;
}

export function parsePgArgs(args: string[]): PgArgs {
  let json = false;
  let db: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--db' && i + 1 < args.length) {
      db = args[++i];
    } else if (arg.startsWith('--db=')) {
      db = arg.slice(5);
    } else {
      rest.push(arg);
    }
  }

  return { sql: rest.join(' '), json, db };
}

const QUERY_KEYWORDS = /^\s*(SELECT|WITH|EXPLAIN|SHOW|VALUES|TABLE)\b/i;
const RETURNING_CLAUSE = /\bRETURNING\b/i;

export function classifySQL(sql: string): 'query' | 'exec' {
  if (QUERY_KEYWORDS.test(sql)) return 'query';
  if (RETURNING_CLAUSE.test(sql)) return 'query';
  return 'exec';
}

export async function runPgCommand(
  args: string[],
  _ctx: CommandContext,
  _vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parsePgArgs(args);

  if (!parsed.sql) {
    return err('Usage: pg "SQL statement"\n\nExamples:\n  pg "SELECT * FROM todos"\n  pg "INSERT INTO todos (title) VALUES (\'Buy milk\')"\n  pg --json "SELECT * FROM todos"\n  pg --db myapp "SELECT count(*) FROM users"\n  pg "\\dt"   (list tables)\n  pg "\\d todos"  (describe table)');
  }

  const { sql, json: jsonOutput, db } = parsed;

  try {
    // psql shortcuts
    if (sql === '\\dt') {
      const { handleDatabaseRequest } = await import('../pglite/pglite-database');
      const result = await handleDatabaseRequest('tables', {}, db);
      if (result.statusCode !== 200) return err(result.body);
      const data = JSON.parse(result.body);
      if (!data.tables || data.tables.length === 0) return ok('(no tables)');
      if (jsonOutput) return ok(JSON.stringify(data.tables));
      return ok(data.tables.join('\n'));
    }

    if (sql.startsWith('\\d ')) {
      const table = sql.slice(3).trim();
      if (!table) return err('Usage: pg "\\d <table>"');
      const { handleDatabaseRequest } = await import('../pglite/pglite-database');
      const result = await handleDatabaseRequest(`schema/${table}`, {}, db);
      if (result.statusCode !== 200) return err(result.body);
      const data = JSON.parse(result.body);
      if (!data.columns || data.columns.length === 0) return ok(`Table "${table}" not found or has no columns`);
      if (jsonOutput) return ok(JSON.stringify(data.columns));
      return ok(formatTable(data.columns));
    }

    if (sql === '\\l') {
      const { listDatabases, getActiveDatabase } = await import('../pglite/db-manager');
      const dbs = listDatabases();
      const active = getActiveDatabase();
      if (dbs.length === 0) return ok('(no databases)');
      if (jsonOutput) return ok(JSON.stringify(dbs));
      return ok(dbs.map((d) => `${d.name === active ? '* ' : '  '}${d.name} (created ${d.createdAt})`).join('\n'));
    }

    // Auto-detect query vs exec
    const operation = classifySQL(sql);
    const { handleDatabaseRequest } = await import('../pglite/pglite-database');
    const result = await handleDatabaseRequest(operation, { sql }, db);

    if (result.statusCode !== 200) return err(result.body);

    if (operation === 'query') {
      const data = JSON.parse(result.body);
      if (jsonOutput) return ok(JSON.stringify(data.rows));
      if (!data.rows || data.rows.length === 0) return ok('(no rows)');
      return ok(formatTable(data.rows));
    }

    return ok('OK');
  } catch (error: any) {
    return err(error.message || String(error));
  }
}
