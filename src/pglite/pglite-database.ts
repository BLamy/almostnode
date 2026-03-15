/**
 * PGlite Database
 * Instance pool and SQL request handlers for in-browser Postgres
 */

// PGlite is only dynamically imported to avoid Vite dep optimization interference
type PGlite = import('@electric-sql/pglite').PGlite;

let cachedAssets: { wasmModule: WebAssembly.Module; fsBundle: Blob } | null = null;

export async function loadPGliteAssets(): Promise<{ wasmModule: WebAssembly.Module; fsBundle: Blob }> {
  if (cachedAssets) return cachedAssets;
  const [wasmResp, dataResp] = await Promise.all([
    fetch('/pglite.wasm'),
    fetch('/pglite.data'),
  ]);
  const [wasmModule, fsBundle] = await Promise.all([
    WebAssembly.compileStreaming(wasmResp),
    dataResp.blob(),
  ]);
  cachedAssets = { wasmModule, fsBundle };
  return cachedAssets;
}

// ── PGlite instances ──

const instances = new Map<string, PGlite>();

export async function initPGliteInstance(
  name: string,
  schemaSQL: string | null,
  idbPath?: string,
): Promise<void> {
  // Close existing instance with this name
  if (instances.has(name)) {
    await closePGliteInstance(name);
  }

  const { PGlite: PGliteClass } = await import('@electric-sql/pglite');
  const { wasmModule, fsBundle } = await loadPGliteAssets();
  const db = idbPath
    ? new PGliteClass(idbPath, { wasmModule, fsBundle })
    : new PGliteClass({ wasmModule, fsBundle });

  instances.set(name, db);

  // Run schema SQL if provided
  if (schemaSQL) {
    await db.exec(schemaSQL);
    console.log(`[pglite] Schema applied for "${name}"`);
  }
}

export async function closePGliteInstance(name: string): Promise<void> {
  const db = instances.get(name);
  if (db) {
    await db.close();
    instances.delete(name);
  }
}

export async function closeAllPGlite(): Promise<void> {
  const names = [...instances.keys()];
  await Promise.all(names.map((n) => closePGliteInstance(n)));
}

export function getInstanceNames(): string[] {
  return [...instances.keys()];
}

export function getInstance(name: string): PGlite | undefined {
  return instances.get(name);
}

// ── Request handler ──

export interface DatabaseRequestResult {
  statusCode: number;
  body: string;
}

export async function handleDatabaseRequest(
  operation: string,
  body: any,
  dbName?: string,
): Promise<DatabaseRequestResult> {
  // Resolve which instance to use
  const name = dbName || instances.keys().next().value;
  const db = name ? instances.get(name) : undefined;

  if (!db) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: `PGlite not initialized${dbName ? ` for "${dbName}"` : ''}` }),
    };
  }

  try {
    switch (operation) {
      case 'query': {
        const { sql, params } = body;
        if (!sql) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Missing sql parameter' }) };
        }
        const result = await db.query(sql, params || []);
        return {
          statusCode: 200,
          body: JSON.stringify({ rows: result.rows, fields: result.fields }),
        };
      }

      case 'exec': {
        const { sql } = body;
        if (!sql) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Missing sql parameter' }) };
        }
        await db.exec(sql);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true }),
        };
      }

      case 'tables': {
        const result = await db.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);
        return {
          statusCode: 200,
          body: JSON.stringify({ tables: result.rows.map((r: any) => r.table_name) }),
        };
      }

      default: {
        // schema/{table} — column info for a specific table
        if (operation.startsWith('schema/')) {
          const table = operation.slice(7);
          if (!table) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing table name' }) };
          }
          const result = await db.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `, [table]);
          return {
            statusCode: 200,
            body: JSON.stringify({ table, columns: result.rows }),
          };
        }

        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Unknown operation: ${operation}` }),
        };
      }
    }
  } catch (err: any) {
    console.error(`[pglite] ${operation} error:`, err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
}
