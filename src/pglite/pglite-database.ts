/**
 * PGlite Database
 * Instance pool and SQL request handlers for in-browser Postgres
 */

// PGlite is only dynamically imported to avoid Vite dep optimization interference
type PGlite = import('@electric-sql/pglite').PGlite;

let cachedAssets: { wasmModule: WebAssembly.Module; fsBundle: Blob } | null = null;

export async function loadPGliteAssets(): Promise<{ wasmModule: WebAssembly.Module; fsBundle: Blob }> {
  if (cachedAssets) return cachedAssets;
  const base = import.meta.env.BASE_URL || '/';
  const [wasmResp, dataResp] = await Promise.all([
    fetch(`${base}pglite.wasm`),
    fetch(`${base}pglite.data`),
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

// ── Migration support ──

export async function applyPendingMigrations(
  vfs: import('../virtual-fs').VirtualFS,
  dbName: string,
): Promise<{ applied: string[]; errors: string[] }> {
  const db = instances.get(dbName);
  if (!db) return { applied: [], errors: ['Database not initialized'] };

  // Ensure migrations table exists
  await db.exec(`CREATE TABLE IF NOT EXISTS _drizzle_migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // Get already-applied migrations
  const appliedResult = await db.query('SELECT name FROM _drizzle_migrations ORDER BY name');
  const appliedSet = new Set((appliedResult.rows as any[]).map((r) => r.name));

  // Read migration files from VFS
  let files: string[];
  try {
    files = vfs.readdirSync('/project/drizzle').filter((f: string) => f.endsWith('.sql')).sort();
  } catch {
    return { applied: [], errors: [] }; // No drizzle/ directory
  }

  const pending = files.filter((f) => !appliedSet.has(f));
  const applied: string[] = [];
  const errors: string[] = [];

  for (const file of pending) {
    try {
      const raw = vfs.readFileSync(`/project/drizzle/${file}`);
      const sql = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      await db.exec(sql);
      await db.exec(`INSERT INTO _drizzle_migrations (name) VALUES ('${file}')`);
      applied.push(file);
    } catch (e: any) {
      errors.push(`${file}: ${e.message || String(e)}`);
      break; // Stop on first error
    }
  }

  return { applied, errors };
}

export async function initAndMigrate(
  name: string,
  vfs: import('../virtual-fs').VirtualFS,
  idbPath?: string,
): Promise<void> {
  // Init with no schema SQL — migrations will handle it
  await initPGliteInstance(name, null, idbPath);

  // Check for drizzle/ migrations first
  const hasDrizzleDir = (() => {
    try {
      const stat = vfs.statSync('/project/drizzle');
      return stat.isDirectory();
    } catch {
      return false;
    }
  })();

  if (hasDrizzleDir) {
    const { applied, errors } = await applyPendingMigrations(vfs, name);
    if (applied.length > 0) {
      console.log(`[pglite] Applied ${applied.length} migration(s) for "${name}"`);
    }
    if (errors.length > 0) {
      console.error(`[pglite] Migration errors for "${name}":`, errors);
    }
    return;
  }

  // Fallback: legacy schema.sql
  try {
    const raw = vfs.readFileSync('/project/schema.sql');
    const schemaSQL = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const db = instances.get(name);
    if (db && schemaSQL) {
      await db.exec(schemaSQL);
      console.log(`[pglite] Schema applied for "${name}" (legacy schema.sql)`);
    }
  } catch {
    // No schema.sql — empty database is fine
  }
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
