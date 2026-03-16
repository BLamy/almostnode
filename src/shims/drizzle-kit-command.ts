import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string): JustBashExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

// ── Types ──

export interface ParsedColumn {
  propName: string;
  sqlName: string;
  type: string;
  sqlType: string;
  modifiers: string[];
  references?: { table: string; column: string; onDelete?: string; onUpdate?: string };
}

export interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
}

export interface IntrospectedColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface IntrospectedTable {
  name: string;
  columns: IntrospectedColumn[];
}

export interface SchemaDiff {
  createTables: ParsedTable[];
  dropTables: string[];
  addColumns: { table: string; columns: ParsedColumn[] }[];
  dropColumns: { table: string; columns: string[] }[];
}

// ── Type Mapping ──

const TYPE_MAP: Record<string, string> = {
  serial: 'SERIAL',
  bigserial: 'BIGSERIAL',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  text: 'TEXT',
  varchar: 'VARCHAR',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
  date: 'DATE',
  json: 'JSON',
  jsonb: 'JSONB',
  uuid: 'UUID',
  real: 'REAL',
  doublePrecision: 'DOUBLE PRECISION',
  numeric: 'NUMERIC',
};

// information_schema data_type values that map back to our types
const NORMALIZED_TYPES: Record<string, string> = {
  'integer': 'integer',
  'bigint': 'bigint',
  'smallint': 'smallint',
  'text': 'text',
  'character varying': 'varchar',
  'boolean': 'boolean',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamp',
  'date': 'date',
  'json': 'json',
  'jsonb': 'jsonb',
  'uuid': 'uuid',
  'real': 'real',
  'double precision': 'doublePrecision',
  'numeric': 'numeric',
};

// ── Schema Parser ──

/**
 * Find the matching closing brace for an opening brace at `start`.
 */
function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse a single column definition like:
 *   id: serial('id').primaryKey()
 *   title: text('title').notNull()
 *   completed: boolean('completed').notNull().default(false)
 *   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
 *   name: varchar('name', { length: 255 }).notNull()
 */
function parseColumnDef(propName: string, definition: string): ParsedColumn | null {
  // Match: typeFunc('sqlName', opts?).modifier1().modifier2()
  const typeMatch = definition.match(/^(\w+)\(\s*['"]([^'"]+)['"]/);
  if (!typeMatch) return null;

  const type = typeMatch[1];
  const sqlName = typeMatch[2];

  // Determine SQL type
  let sqlType = TYPE_MAP[type] || type.toUpperCase();

  // Check for options like { withTimezone: true } or { length: N }
  const optsMatch = definition.match(/\(\s*['"][^'"]+['"]\s*,\s*\{([^}]*)\}/);
  if (optsMatch) {
    const optsStr = optsMatch[1];
    if (type === 'timestamp' && /withTimezone\s*:\s*true/.test(optsStr)) {
      sqlType = 'TIMESTAMPTZ';
    }
    if (type === 'varchar') {
      const lenMatch = optsStr.match(/length\s*:\s*(\d+)/);
      if (lenMatch) sqlType = `VARCHAR(${lenMatch[1]})`;
    }
    if (type === 'numeric') {
      const precMatch = optsStr.match(/precision\s*:\s*(\d+)/);
      const scaleMatch = optsStr.match(/scale\s*:\s*(\d+)/);
      if (precMatch) {
        sqlType = scaleMatch
          ? `NUMERIC(${precMatch[1]},${scaleMatch[1]})`
          : `NUMERIC(${precMatch[1]})`;
      }
    }
  }

  // Extract modifiers: .primaryKey(), .notNull(), .default(...), .defaultNow()
  const modifiers: string[] = [];
  const modifierRegex = /\.(\w+)\(([^)]*)\)/g;
  let m;
  while ((m = modifierRegex.exec(definition)) !== null) {
    const name = m[1];
    const arg = m[2].trim();
    if (name === 'references') continue; // handled separately below
    if (name === 'primaryKey') modifiers.push('primaryKey');
    else if (name === 'notNull') modifiers.push('notNull');
    else if (name === 'defaultNow') modifiers.push('defaultNow');
    else if (name === 'default') modifiers.push(`default(${arg})`);
  }

  // Parse .references() with balanced paren matching (arrow functions have nested parens)
  let references: ParsedColumn['references'];
  const refIdx = definition.indexOf('.references(');
  if (refIdx !== -1) {
    const parenStart = refIdx + '.references'.length;
    let depth = 0;
    let endParen = -1;
    for (let i = parenStart; i < definition.length; i++) {
      if (definition[i] === '(') depth++;
      else if (definition[i] === ')') {
        depth--;
        if (depth === 0) { endParen = i; break; }
      }
    }
    if (endParen !== -1) {
      const refContent = definition.slice(parenStart + 1, endParen);
      const arrowMatch = refContent.match(/\(\)\s*=>\s*(\w+)\.(\w+)/);
      if (arrowMatch) {
        references = { table: arrowMatch[1], column: arrowMatch[2] };
        const onDeleteMatch = refContent.match(/onDelete\s*:\s*['"]([^'"]+)['"]/);
        if (onDeleteMatch) references.onDelete = onDeleteMatch[1];
        const onUpdateMatch = refContent.match(/onUpdate\s*:\s*['"]([^'"]+)['"]/);
        if (onUpdateMatch) references.onUpdate = onUpdateMatch[1];
      }
    }
  }

  return { propName, sqlName, type, sqlType, modifiers, references };
}

/**
 * Parse all pgTable() definitions from a Drizzle schema source file.
 */
export function parseDrizzleSchema(source: string): ParsedTable[] {
  const tables: ParsedTable[] = [];

  // First pass: collect variable name → SQL table name mappings
  const varToTable = new Map<string, string>();
  const varRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*pgTable\s*\(\s*['"]([^'"]+)['"]/g;
  let varMatch;
  while ((varMatch = varRegex.exec(source)) !== null) {
    varToTable.set(varMatch[1], varMatch[2]);
  }

  // Find all pgTable('name', { ... }) calls
  const pgTableRegex = /pgTable\(\s*['"]([^'"]+)['"]\s*,\s*\{/g;
  let match;

  while ((match = pgTableRegex.exec(source)) !== null) {
    const tableName = match[1];
    const braceStart = match.index + match[0].length - 1; // position of opening {
    const braceEnd = findMatchingBrace(source, braceStart);
    if (braceEnd === -1) continue;

    const columnsBlock = source.slice(braceStart + 1, braceEnd);
    const columns: ParsedColumn[] = [];

    // Split columns by top-level commas (respecting nested parens/braces)
    const entries = splitTopLevel(columnsBlock);

    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      // Match: propName: definition
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const propName = trimmed.slice(0, colonIdx).trim();
      const definition = trimmed.slice(colonIdx + 1).trim();

      const col = parseColumnDef(propName, definition);
      if (col) columns.push(col);
    }

    tables.push({ name: tableName, columns });
  }

  // Second pass: resolve variable references to SQL names
  const varToColumns = new Map<string, Map<string, string>>();
  for (const [varName, sqlTableName] of varToTable) {
    const table = tables.find((t) => t.name === sqlTableName);
    if (table) {
      const colMap = new Map<string, string>();
      for (const col of table.columns) {
        colMap.set(col.propName, col.sqlName);
      }
      varToColumns.set(varName, colMap);
    }
  }

  for (const table of tables) {
    for (const col of table.columns) {
      if (col.references) {
        const varName = col.references.table;
        const propName = col.references.column;
        // Resolve table variable name to SQL table name
        const sqlTableName = varToTable.get(varName);
        if (sqlTableName) col.references.table = sqlTableName;
        // Resolve column property name to SQL column name
        const colMap = varToColumns.get(varName);
        if (colMap) {
          const sqlColName = colMap.get(propName);
          if (sqlColName) col.references.column = sqlColName;
        }
      }
    }
  }

  return tables;
}

/**
 * Split a string by top-level commas (not inside parens, braces, or brackets).
 */
function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  return parts;
}

// ── SQL Generation ──

function columnToSQL(col: ParsedColumn): string {
  const parts = [col.sqlName, col.sqlType];

  if (col.modifiers.includes('primaryKey')) parts.push('PRIMARY KEY');
  if (col.modifiers.includes('notNull')) parts.push('NOT NULL');

  for (const mod of col.modifiers) {
    if (mod === 'defaultNow') {
      parts.push('DEFAULT now()');
    } else if (mod.startsWith('default(')) {
      const val = mod.slice(8, -1); // extract value from default(...)
      parts.push(`DEFAULT ${val}`);
    }
  }

  if (col.references) {
    let refStr = `REFERENCES ${col.references.table}(${col.references.column})`;
    if (col.references.onDelete) refStr += ` ON DELETE ${col.references.onDelete.toUpperCase()}`;
    if (col.references.onUpdate) refStr += ` ON UPDATE ${col.references.onUpdate.toUpperCase()}`;
    parts.push(refStr);
  }

  return parts.join(' ');
}

export function generateCreateTableSQL(table: ParsedTable): string {
  const columnDefs = table.columns.map(columnToSQL);
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n  ${columnDefs.join(',\n  ')}\n);`;
}

/**
 * Sort tables so that tables referenced by FKs are created before the tables that reference them.
 */
function sortTablesByDependencies(tables: ParsedTable[]): ParsedTable[] {
  const tableNames = new Set(tables.map((t) => t.name));
  const deps = new Map<string, Set<string>>();

  for (const table of tables) {
    const tableDeps = new Set<string>();
    for (const col of table.columns) {
      if (col.references && tableNames.has(col.references.table) && col.references.table !== table.name) {
        tableDeps.add(col.references.table);
      }
    }
    deps.set(table.name, tableDeps);
  }

  const sorted: ParsedTable[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle, skip
    visiting.add(name);
    for (const dep of deps.get(name) || []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(tables.find((t) => t.name === name)!);
  }

  for (const table of tables) {
    visit(table.name);
  }

  return sorted;
}

export function generateMigrationSQL(diff: SchemaDiff): string {
  const statements: string[] = [];

  // Sort tables by FK dependencies so referenced tables are created first
  const sortedCreateTables = sortTablesByDependencies(diff.createTables);
  for (const table of sortedCreateTables) {
    statements.push(generateCreateTableSQL(table));
  }

  for (const { table, columns } of diff.addColumns) {
    for (const col of columns) {
      statements.push(`ALTER TABLE ${table} ADD COLUMN ${columnToSQL(col)};`);
    }
  }

  for (const { table, columns } of diff.dropColumns) {
    for (const colName of columns) {
      statements.push(`ALTER TABLE ${table} DROP COLUMN ${colName};`);
    }
  }

  for (const tableName of diff.dropTables) {
    statements.push(`DROP TABLE ${tableName};`);
  }

  return statements.join('\n\n');
}

// ── Schema Diffing ──

/**
 * Build IntrospectedTable[] from information_schema.columns rows.
 */
export function buildIntrospectedSchema(rows: (IntrospectedColumn & { table_name: string })[]): IntrospectedTable[] {
  const tableMap = new Map<string, IntrospectedColumn[]>();
  for (const row of rows) {
    const tableName = row.table_name;
    if (!tableMap.has(tableName)) tableMap.set(tableName, []);
    tableMap.get(tableName)!.push({
      column_name: row.column_name,
      data_type: row.data_type,
      is_nullable: row.is_nullable,
      column_default: row.column_default,
    });
  }
  return Array.from(tableMap.entries()).map(([name, columns]) => ({ name, columns }));
}

/**
 * Normalize a desired type to match what information_schema would report.
 * SERIAL → integer (information_schema reports the underlying type).
 */
function normalizeTypeForComparison(drizzleType: string): string {
  const lower = drizzleType.toLowerCase();
  // SERIAL family maps to integer/bigint in information_schema
  if (lower === 'serial') return 'integer';
  if (lower === 'bigserial') return 'bigint';
  return lower;
}

/**
 * Normalize an information_schema data_type to our canonical form.
 */
function normalizeIntrospectedType(dataType: string): string {
  return NORMALIZED_TYPES[dataType.toLowerCase()] || dataType.toLowerCase();
}

/**
 * Diff desired schema (from Drizzle) against current schema (from DB introspection).
 */
export function diffSchemas(desired: ParsedTable[], current: IntrospectedTable[]): SchemaDiff {
  const diff: SchemaDiff = {
    createTables: [],
    dropTables: [],
    addColumns: [],
    dropColumns: [],
  };

  const currentMap = new Map(current.map((t) => [t.name, t]));
  const desiredMap = new Map(desired.map((t) => [t.name, t]));

  // Tables to create
  for (const table of desired) {
    if (!currentMap.has(table.name)) {
      diff.createTables.push(table);
    }
  }

  // Tables to drop
  for (const table of current) {
    // Skip internal migration tracking table
    if (table.name === '_drizzle_migrations') continue;
    if (!desiredMap.has(table.name)) {
      diff.dropTables.push(table.name);
    }
  }

  // Column-level diffs for tables that exist in both
  for (const desiredTable of desired) {
    const currentTable = currentMap.get(desiredTable.name);
    if (!currentTable) continue;

    const currentColNames = new Set(currentTable.columns.map((c) => c.column_name));
    const desiredColNames = new Set(desiredTable.columns.map((c) => c.sqlName));

    // New columns
    const newCols = desiredTable.columns.filter((c) => !currentColNames.has(c.sqlName));
    if (newCols.length > 0) {
      diff.addColumns.push({ table: desiredTable.name, columns: newCols });
    }

    // Dropped columns
    const droppedCols = currentTable.columns.filter((c) => !desiredColNames.has(c.column_name));
    if (droppedCols.length > 0) {
      diff.dropColumns.push({ table: desiredTable.name, columns: droppedCols.map((c) => c.column_name) });
    }
  }

  return diff;
}

export function isDiffEmpty(diff: SchemaDiff): boolean {
  return (
    diff.createTables.length === 0 &&
    diff.dropTables.length === 0 &&
    diff.addColumns.length === 0 &&
    diff.dropColumns.length === 0
  );
}

// ── Subcommands ──

const DRIZZLE_DIR = '/project/drizzle';
const SCHEMA_PATH = '/project/src/db/schema.ts';
const MIGRATIONS_TABLE = '_drizzle_migrations';

async function ensureMigrationsTable(): Promise<void> {
  const { handleDatabaseRequest } = await import('../pglite/pglite-database');
  await handleDatabaseRequest('exec', {
    sql: `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  });
}

async function getAppliedMigrations(): Promise<string[]> {
  const { handleDatabaseRequest } = await import('../pglite/pglite-database');
  const result = await handleDatabaseRequest('query', {
    sql: `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
  });
  if (result.statusCode !== 200) return [];
  const data = JSON.parse(result.body);
  return (data.rows || []).map((r: any) => r.name);
}

async function introspectCurrentSchema(): Promise<IntrospectedTable[]> {
  const { handleDatabaseRequest } = await import('../pglite/pglite-database');
  const result = await handleDatabaseRequest('query', {
    sql: `SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
          ORDER BY table_name, ordinal_position`,
  });
  if (result.statusCode !== 200) return [];
  const data = JSON.parse(result.body);
  return buildIntrospectedSchema(data.rows || []);
}

function getMigrationFiles(vfs: VirtualFS): string[] {
  try {
    const files = vfs.readdirSync(DRIZZLE_DIR);
    return files.filter((f: string) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

function getNextMigrationNumber(existingFiles: string[]): string {
  if (existingFiles.length === 0) return '0000';
  // Find the highest number prefix
  let max = -1;
  for (const f of existingFiles) {
    const match = f.match(/^(\d+)/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return String(max + 1).padStart(4, '0');
}

async function cmdGenerate(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  // Parse --name flag
  let name = '';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && i + 1 < args.length) {
      name = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    }
  }
  if (!name) return err('Usage: drizzle-kit generate --name <migration_name>');

  // Read and parse schema
  let schemaSource: string;
  try {
    const raw = vfs.readFileSync(SCHEMA_PATH);
    schemaSource = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  } catch {
    return err(`Schema file not found: ${SCHEMA_PATH}`);
  }

  const desired = parseDrizzleSchema(schemaSource);
  const current = await introspectCurrentSchema();
  const diff = diffSchemas(desired, current);

  if (isDiffEmpty(diff)) {
    return ok('No schema changes detected.');
  }

  // Check for DROP TABLE without --force
  if (diff.dropTables.length > 0 && !force) {
    return err(
      `Migration would drop table(s): ${diff.dropTables.join(', ')}\n` +
      'Use --force to include DROP TABLE statements.',
    );
  }

  // Generate SQL
  const sqlToWrite = force ? generateMigrationSQL(diff) : generateMigrationSQL({
    ...diff,
    dropTables: [],
  });

  // Write migration file
  try {
    vfs.mkdirSync(DRIZZLE_DIR, { recursive: true });
  } catch { /* already exists */ }

  const existingFiles = getMigrationFiles(vfs);
  const num = getNextMigrationNumber(existingFiles);
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${num}_${sanitizedName}.sql`;
  const filePath = `${DRIZZLE_DIR}/${filename}`;

  vfs.writeFileSync(filePath, sqlToWrite);

  return ok(`Migration generated: drizzle/${filename}`);
}

async function cmdMigrate(_args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  await ensureMigrationsTable();

  const files = getMigrationFiles(vfs);
  if (files.length === 0) return ok('No migration files found in drizzle/');

  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) return ok('All migrations already applied.');

  const { handleDatabaseRequest } = await import('../pglite/pglite-database');
  const results: string[] = [];
  const errors: string[] = [];

  for (const file of pending) {
    try {
      const raw = vfs.readFileSync(`${DRIZZLE_DIR}/${file}`);
      const sql = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

      const execResult = await handleDatabaseRequest('exec', { sql });
      if (execResult.statusCode !== 200) {
        const body = JSON.parse(execResult.body);
        errors.push(`${file}: ${body.error}`);
        break; // Stop on first error
      }

      // Record migration
      await handleDatabaseRequest('exec', {
        sql: `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ('${file}')`,
      });
      results.push(file);
    } catch (e: any) {
      errors.push(`${file}: ${e.message || String(e)}`);
      break;
    }
  }

  let output = '';
  if (results.length > 0) {
    output += `Applied ${results.length} migration(s):\n${results.map((f) => `  [applied] ${f}`).join('\n')}`;
  }
  if (errors.length > 0) {
    output += (output ? '\n' : '') + `Errors:\n${errors.map((e) => `  [error] ${e}`).join('\n')}`;
    return { stdout: output, stderr: '', exitCode: 1 };
  }

  return ok(output);
}

async function cmdPush(args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  // Read and parse schema
  let schemaSource: string;
  try {
    const raw = vfs.readFileSync(SCHEMA_PATH);
    schemaSource = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  } catch {
    return err(`Schema file not found: ${SCHEMA_PATH}`);
  }

  let force = args.includes('--force');

  const desired = parseDrizzleSchema(schemaSource);
  const current = await introspectCurrentSchema();
  const diff = diffSchemas(desired, current);

  if (isDiffEmpty(diff)) {
    return ok('Schema is up to date.');
  }

  if (diff.dropTables.length > 0 && !force) {
    return err(
      `Push would drop table(s): ${diff.dropTables.join(', ')}\n` +
      'Use --force to include DROP TABLE statements.',
    );
  }

  const sql = force ? generateMigrationSQL(diff) : generateMigrationSQL({
    ...diff,
    dropTables: [],
  });

  const { handleDatabaseRequest } = await import('../pglite/pglite-database');
  const result = await handleDatabaseRequest('exec', { sql });
  if (result.statusCode !== 200) {
    const body = JSON.parse(result.body);
    return err(`Push failed: ${body.error}`);
  }

  // Summarize what was done
  const actions: string[] = [];
  if (diff.createTables.length > 0) actions.push(`Created table(s): ${diff.createTables.map((t) => t.name).join(', ')}`);
  if (diff.addColumns.length > 0) actions.push(`Added column(s): ${diff.addColumns.map((a) => `${a.table}(${a.columns.map((c) => c.sqlName).join(', ')})`).join(', ')}`);
  if (diff.dropColumns.length > 0) actions.push(`Dropped column(s): ${diff.dropColumns.map((d) => `${d.table}(${d.columns.join(', ')})`).join(', ')}`);
  if (force && diff.dropTables.length > 0) actions.push(`Dropped table(s): ${diff.dropTables.join(', ')}`);

  return ok(`Push complete.\n${actions.join('\n')}`);
}

async function cmdStatus(_args: string[], vfs: VirtualFS): Promise<JustBashExecResult> {
  await ensureMigrationsTable();

  const files = getMigrationFiles(vfs);
  if (files.length === 0) return ok('No migration files found in drizzle/');

  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied);

  const lines = files.map((f) => {
    const status = appliedSet.has(f) ? '[applied]' : '[pending]';
    return `  ${status} ${f}`;
  });

  return ok(`Migrations:\n${lines.join('\n')}`);
}

// ── Main Entry Point ──

const HELP_TEXT = `drizzle-kit — Schema migration tool for Drizzle ORM

Commands:
  drizzle-kit generate --name <name>   Generate migration from schema changes
  drizzle-kit migrate                  Apply pending migrations
  drizzle-kit push                     Push schema changes directly (no migration file)
  drizzle-kit status                   Show migration status

Flags:
  --force    Include DROP TABLE statements (generate/push)
  --name     Migration name (generate)`;

export async function runDrizzleKitCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return ok(HELP_TEXT);
  }

  try {
    switch (subcommand) {
      case 'generate':
        return await cmdGenerate(args.slice(1), vfs);
      case 'migrate':
        return await cmdMigrate(args.slice(1), vfs);
      case 'push':
        return await cmdPush(args.slice(1), vfs);
      case 'status':
        return await cmdStatus(args.slice(1), vfs);
      default:
        return err(`Unknown subcommand: ${subcommand}\n\n${HELP_TEXT}`);
    }
  } catch (error: any) {
    return err(error.message || String(error));
  }
}
