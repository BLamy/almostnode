/**
 * Converts database.xml (builder-assets format) into Drizzle ORM schema + migration SQL.
 *
 * Pure function — uses browser DOMParser, zero external dependencies.
 */

export interface DatabaseXmlConversionResult {
  schemaTs: string;
  migrationSql: string;
}

interface ParsedColumn {
  name: string;
  type: string;
  indexed: boolean;
  nullable: boolean;
  foreignTable: string | null;
}

interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
}

// XML type → { drizzleFn, sqlType }
const TYPE_MAP: Record<string, { drizzleFn: string; sqlType: string }> = {
  uuid: { drizzleFn: 'uuid', sqlType: 'UUID' },
  text: { drizzleFn: 'text', sqlType: 'TEXT' },
  varchar: { drizzleFn: 'varchar', sqlType: 'VARCHAR' },
  boolean: { drizzleFn: 'boolean', sqlType: 'BOOLEAN' },
  timestamp: { drizzleFn: 'timestamp', sqlType: 'TIMESTAMP' },
  timestamptz: { drizzleFn: 'timestamp', sqlType: 'TIMESTAMPTZ' },
  date: { drizzleFn: 'date', sqlType: 'DATE' },
  bigint: { drizzleFn: 'bigint', sqlType: 'BIGINT' },
  decimal: { drizzleFn: 'numeric', sqlType: 'NUMERIC' },
  numeric: { drizzleFn: 'numeric', sqlType: 'NUMERIC' },
  integer: { drizzleFn: 'integer', sqlType: 'INTEGER' },
  jsonb: { drizzleFn: 'jsonb', sqlType: 'JSONB' },
};

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function parseXml(xmlContent: string): ParsedTable[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'text/xml');

  const errorNode = doc.querySelector('parsererror');
  if (errorNode) {
    throw new Error(`Invalid database.xml: ${errorNode.textContent}`);
  }

  const tables: ParsedTable[] = [];
  for (const tableEl of Array.from(doc.querySelectorAll('table'))) {
    const tableName = tableEl.getAttribute('name');
    if (!tableName) continue;

    const columns: ParsedColumn[] = [];
    for (const colEl of Array.from(tableEl.querySelectorAll('column'))) {
      const name = colEl.getAttribute('name');
      const type = colEl.getAttribute('type');
      if (!name || !type) continue;

      columns.push({
        name,
        type: type.toLowerCase(),
        indexed: colEl.getAttribute('indexed') === 'true',
        nullable: colEl.getAttribute('nullable') === 'true',
        foreignTable: colEl.getAttribute('foreign_table_id') || null,
      });
    }

    tables.push({ name: tableName, columns });
  }

  return tables;
}

function sortTablesByDependencies(tables: ParsedTable[]): ParsedTable[] {
  const tableNames = new Set(tables.map((t) => t.name));
  const deps = new Map<string, Set<string>>();

  for (const table of tables) {
    const tableDeps = new Set<string>();
    for (const col of table.columns) {
      if (col.foreignTable && tableNames.has(col.foreignTable) && col.foreignTable !== table.name) {
        tableDeps.add(col.foreignTable);
      }
    }
    deps.set(table.name, tableDeps);
  }

  const sorted: ParsedTable[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle — skip
    visiting.add(name);
    const tableDeps = deps.get(name);
    if (tableDeps) {
      tableDeps.forEach((dep) => visit(dep));
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

// ── Schema TS generation ──

function generateSchemaTs(tables: ParsedTable[]): string {
  const sorted = sortTablesByDependencies(tables);

  // Collect all drizzle functions actually used
  const usedFns = new Set<string>();
  usedFns.add('pgTable');
  for (const table of sorted) {
    for (const col of table.columns) {
      const mapping = TYPE_MAP[col.type];
      if (mapping) usedFns.add(mapping.drizzleFn);
    }
  }

  const importFns = ['pgTable', ...Array.from(usedFns).filter((f) => f !== 'pgTable').sort()];
  const lines: string[] = [];
  lines.push(`import { ${importFns.join(', ')} } from 'drizzle-orm/pg-core';`);
  lines.push('');

  for (const table of sorted) {
    const varName = snakeToCamel(table.name);
    lines.push(`export const ${varName} = pgTable('${table.name}', {`);

    for (const col of table.columns) {
      const propName = snakeToCamel(col.name);
      const mapping = TYPE_MAP[col.type] || TYPE_MAP.text;
      let chain = `${mapping.drizzleFn}('${col.name}')`;

      // UUID id column with indexed → primary key
      if (col.name === 'id' && col.type === 'uuid' && col.indexed) {
        chain += '.defaultRandom().primaryKey()';
      } else {
        // Not-null (default) vs nullable
        if (!col.nullable) {
          chain += '.notNull()';
        }

        // Default timestamps
        if ((col.type === 'timestamp' || col.type === 'timestamptz') &&
            (col.name === 'created_at' || col.name === 'updated_at')) {
          chain += '.defaultNow()';
        }

        // Foreign key reference
        if (col.foreignTable) {
          const refVar = snakeToCamel(col.foreignTable);
          chain += `.references(() => ${refVar}.id)`;
        }
      }

      lines.push(`  ${propName}: ${chain},`);
    }

    lines.push('});');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Migration SQL generation ──

function columnToSql(col: ParsedColumn): string {
  const mapping = TYPE_MAP[col.type] || { sqlType: 'TEXT' };
  let def = `${col.name} ${mapping.sqlType}`;

  if (col.name === 'id' && col.type === 'uuid' && col.indexed) {
    def += ' DEFAULT gen_random_uuid() PRIMARY KEY';
  } else {
    if (!col.nullable) {
      def += ' NOT NULL';
    }
    if ((col.type === 'timestamp' || col.type === 'timestamptz') &&
        (col.name === 'created_at' || col.name === 'updated_at')) {
      def += ' DEFAULT now()';
    }
    if (col.foreignTable) {
      def += ` REFERENCES ${col.foreignTable}(id)`;
    }
  }

  return def;
}

function generateMigrationSql(tables: ParsedTable[]): string {
  const sorted = sortTablesByDependencies(tables);
  const statements: string[] = [];

  for (const table of sorted) {
    const colDefs = table.columns.map(columnToSql);
    statements.push(`CREATE TABLE IF NOT EXISTS ${table.name} (\n  ${colDefs.join(',\n  ')}\n);`);
  }

  return statements.join('\n\n');
}

// ── Public API ──

export function convertDatabaseXmlToDrizzle(xmlContent: string): DatabaseXmlConversionResult {
  const tables = parseXml(xmlContent);
  return {
    schemaTs: generateSchemaTs(tables),
    migrationSql: generateMigrationSql(tables),
  };
}
