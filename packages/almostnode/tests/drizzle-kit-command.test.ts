import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDrizzleSchema,
  generateCreateTableSQL,
  generateMigrationSQL,
  diffSchemas,
  isDiffEmpty,
  buildIntrospectedSchema,
  runDrizzleKitCommand,
} from '../src/shims/drizzle-kit-command';
import type { ParsedTable, IntrospectedTable, SchemaDiff } from '../src/shims/drizzle-kit-command';
import type { CommandContext } from 'just-bash';
import { VirtualFS } from '../src/virtual-fs';

// ── Schema Parser ──

describe('parseDrizzleSchema', () => {
  it('parses a single table with basic columns', () => {
    const source = `
      import { pgTable, serial, text, boolean } from 'drizzle-orm/pg-core';
      export const todos = pgTable('todos', {
        id: serial('id').primaryKey(),
        title: text('title').notNull(),
        completed: boolean('completed').notNull().default(false),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('todos');
    expect(tables[0].columns).toHaveLength(3);

    expect(tables[0].columns[0]).toMatchObject({
      propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL',
    });
    expect(tables[0].columns[0].modifiers).toContain('primaryKey');

    expect(tables[0].columns[1]).toMatchObject({
      propName: 'title', sqlName: 'title', type: 'text', sqlType: 'TEXT',
    });
    expect(tables[0].columns[1].modifiers).toContain('notNull');

    expect(tables[0].columns[2]).toMatchObject({
      propName: 'completed', sqlName: 'completed', type: 'boolean', sqlType: 'BOOLEAN',
    });
    expect(tables[0].columns[2].modifiers).toContain('notNull');
    expect(tables[0].columns[2].modifiers).toContain('default(false)');
  });

  it('parses multiple tables', () => {
    const source = `
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
        name: text('name').notNull(),
      });
      export const posts = pgTable('posts', {
        id: serial('id').primaryKey(),
        title: text('title'),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(2);
    expect(tables[0].name).toBe('users');
    expect(tables[1].name).toBe('posts');
  });

  it('parses timestamp with withTimezone option', () => {
    const source = `
      export const t = pgTable('t', {
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables[0].columns[0].sqlType).toBe('TIMESTAMPTZ');
    expect(tables[0].columns[0].modifiers).toContain('notNull');
    expect(tables[0].columns[0].modifiers).toContain('defaultNow');
  });

  it('parses timestamp without withTimezone', () => {
    const source = `
      export const t = pgTable('t', {
        updatedAt: timestamp('updated_at').notNull(),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables[0].columns[0].sqlType).toBe('TIMESTAMP');
  });

  it('parses varchar with length option', () => {
    const source = `
      export const t = pgTable('t', {
        email: varchar('email', { length: 255 }).notNull(),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables[0].columns[0].sqlType).toBe('VARCHAR(255)');
  });

  it('parses numeric with precision and scale', () => {
    const source = `
      export const t = pgTable('t', {
        price: numeric('price', { precision: 10, scale: 2 }),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables[0].columns[0].sqlType).toBe('NUMERIC(10,2)');
  });

  it('parses all supported column types', () => {
    const source = `
      export const t = pgTable('all_types', {
        a: serial('a'),
        b: bigserial('b'),
        c: integer('c'),
        d: bigint('d'),
        e: smallint('e'),
        f: text('f'),
        g: boolean('g'),
        h: date('h'),
        i: json('i'),
        j: jsonb('j'),
        k: uuid('k'),
        l: real('l'),
        m: doublePrecision('m'),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const cols = tables[0].columns;
    expect(cols[0].sqlType).toBe('SERIAL');
    expect(cols[1].sqlType).toBe('BIGSERIAL');
    expect(cols[2].sqlType).toBe('INTEGER');
    expect(cols[3].sqlType).toBe('BIGINT');
    expect(cols[4].sqlType).toBe('SMALLINT');
    expect(cols[5].sqlType).toBe('TEXT');
    expect(cols[6].sqlType).toBe('BOOLEAN');
    expect(cols[7].sqlType).toBe('DATE');
    expect(cols[8].sqlType).toBe('JSON');
    expect(cols[9].sqlType).toBe('JSONB');
    expect(cols[10].sqlType).toBe('UUID');
    expect(cols[11].sqlType).toBe('REAL');
    expect(cols[12].sqlType).toBe('DOUBLE PRECISION');
  });

  it('handles chained modifiers', () => {
    const source = `
      export const t = pgTable('t', {
        name: text('name').notNull().default('unnamed'),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const col = tables[0].columns[0];
    expect(col.modifiers).toContain('notNull');
    expect(col.modifiers).toContain("default('unnamed')");
  });

  it('returns empty array when no pgTable calls', () => {
    const source = `
      import { pgTable } from 'drizzle-orm/pg-core';
      // no tables defined
      const x = 42;
    `;
    expect(parseDrizzleSchema(source)).toEqual([]);
  });

  it('handles comments and imports gracefully', () => {
    const source = `
      // This is a schema file
      import { pgTable, serial, text } from 'drizzle-orm/pg-core';
      import { relations } from 'drizzle-orm';

      /* Multi-line
         comment */
      export const items = pgTable('items', {
        id: serial('id').primaryKey(),
        // name column
        name: text('name'),
      });

      // Relations (should be ignored)
      export const itemsRelations = relations(items, ({ many }) => ({
        children: many(items),
      }));
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('items');
    expect(tables[0].columns).toHaveLength(2);
  });

  it('parses the real vite template schema', () => {
    const source = `
      import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';

      export const todos = pgTable('todos', {
        id: serial('id').primaryKey(),
        title: text('title').notNull(),
        completed: boolean('completed').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('todos');
    expect(tables[0].columns).toHaveLength(4);
    expect(tables[0].columns[3].sqlType).toBe('TIMESTAMPTZ');
    expect(tables[0].columns[3].modifiers).toContain('defaultNow');
  });

  it('handles multiline column definitions', () => {
    const source = `
      export const t = pgTable('t', {
        id: serial(
          'id'
        ).primaryKey(),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(1);
    expect(tables[0].columns[0].sqlName).toBe('id');
  });

  it('parses .references() with arrow function', () => {
    const source = `
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
      });
      export const posts = pgTable('posts', {
        id: serial('id').primaryKey(),
        userId: integer('user_id').references(() => users.id),
      });
    `;
    const tables = parseDrizzleSchema(source);
    expect(tables).toHaveLength(2);
    const posts = tables.find((t) => t.name === 'posts')!;
    const userIdCol = posts.columns.find((c) => c.propName === 'userId')!;
    expect(userIdCol.references).toEqual({ table: 'users', column: 'id' });
  });

  it('parses .references() with onDelete and onUpdate', () => {
    const source = `
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
      });
      export const posts = pgTable('posts', {
        id: serial('id').primaryKey(),
        userId: integer('user_id').references(() => users.id, { onDelete: 'cascade', onUpdate: 'no action' }),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const posts = tables.find((t) => t.name === 'posts')!;
    const userIdCol = posts.columns.find((c) => c.propName === 'userId')!;
    expect(userIdCol.references).toEqual({
      table: 'users',
      column: 'id',
      onDelete: 'cascade',
      onUpdate: 'no action',
    });
  });

  it('resolves variable names to SQL names in references', () => {
    const source = `
      export const userAccounts = pgTable('user_accounts', {
        id: serial('id').primaryKey(),
        displayName: text('display_name'),
      });
      export const blogPosts = pgTable('blog_posts', {
        id: serial('id').primaryKey(),
        authorId: integer('author_id').references(() => userAccounts.id),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const posts = tables.find((t) => t.name === 'blog_posts')!;
    const authorCol = posts.columns.find((c) => c.propName === 'authorId')!;
    // Variable 'userAccounts' should resolve to SQL table 'user_accounts'
    expect(authorCol.references).toEqual({ table: 'user_accounts', column: 'id' });
  });

  it('resolves column prop names to SQL names in references', () => {
    const source = `
      export const categories = pgTable('categories', {
        categoryId: serial('category_id').primaryKey(),
      });
      export const items = pgTable('items', {
        id: serial('id').primaryKey(),
        catId: integer('cat_id').references(() => categories.categoryId),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const items = tables.find((t) => t.name === 'items')!;
    const catCol = items.columns.find((c) => c.propName === 'catId')!;
    // Property 'categoryId' should resolve to SQL column 'category_id'
    expect(catCol.references).toEqual({ table: 'categories', column: 'category_id' });
  });

  it('parses .references() chained with other modifiers', () => {
    const source = `
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
      });
      export const posts = pgTable('posts', {
        id: serial('id').primaryKey(),
        userId: integer('user_id').notNull().references(() => users.id),
      });
    `;
    const tables = parseDrizzleSchema(source);
    const posts = tables.find((t) => t.name === 'posts')!;
    const userIdCol = posts.columns.find((c) => c.propName === 'userId')!;
    expect(userIdCol.modifiers).toContain('notNull');
    expect(userIdCol.references).toEqual({ table: 'users', column: 'id' });
  });
});

// ── SQL Generation ──

describe('generateCreateTableSQL', () => {
  it('generates CREATE TABLE with all column attributes', () => {
    const table: ParsedTable = {
      name: 'todos',
      columns: [
        { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
        { propName: 'title', sqlName: 'title', type: 'text', sqlType: 'TEXT', modifiers: ['notNull'] },
        { propName: 'completed', sqlName: 'completed', type: 'boolean', sqlType: 'BOOLEAN', modifiers: ['notNull', 'default(false)'] },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
    expect(sql).toContain('id SERIAL PRIMARY KEY');
    expect(sql).toContain('title TEXT NOT NULL');
    expect(sql).toContain('completed BOOLEAN NOT NULL DEFAULT false');
  });

  it('generates TIMESTAMPTZ with DEFAULT now()', () => {
    const table: ParsedTable = {
      name: 'events',
      columns: [
        { propName: 'createdAt', sqlName: 'created_at', type: 'timestamp', sqlType: 'TIMESTAMPTZ', modifiers: ['notNull', 'defaultNow'] },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('generates VARCHAR(N)', () => {
    const table: ParsedTable = {
      name: 'users',
      columns: [
        { propName: 'email', sqlName: 'email', type: 'varchar', sqlType: 'VARCHAR(255)', modifiers: ['notNull'] },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('email VARCHAR(255) NOT NULL');
  });

  it('generates column with no modifiers', () => {
    const table: ParsedTable = {
      name: 'logs',
      columns: [
        { propName: 'data', sqlName: 'data', type: 'jsonb', sqlType: 'JSONB', modifiers: [] },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('data JSONB');
    expect(sql).not.toContain('NOT NULL');
    expect(sql).not.toContain('PRIMARY KEY');
  });

  it('generates multiple columns separated by commas', () => {
    const table: ParsedTable = {
      name: 't',
      columns: [
        { propName: 'a', sqlName: 'a', type: 'integer', sqlType: 'INTEGER', modifiers: [] },
        { propName: 'b', sqlName: 'b', type: 'text', sqlType: 'TEXT', modifiers: [] },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('a INTEGER,');
    expect(sql).toContain('b TEXT');
  });

  it('generates inline REFERENCES for foreign keys', () => {
    const table: ParsedTable = {
      name: 'posts',
      columns: [
        { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
        { propName: 'userId', sqlName: 'user_id', type: 'integer', sqlType: 'INTEGER', modifiers: ['notNull'], references: { table: 'users', column: 'id' } },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('user_id INTEGER NOT NULL REFERENCES users(id)');
  });

  it('generates REFERENCES with ON DELETE CASCADE', () => {
    const table: ParsedTable = {
      name: 'posts',
      columns: [
        { propName: 'userId', sqlName: 'user_id', type: 'integer', sqlType: 'INTEGER', modifiers: [], references: { table: 'users', column: 'id', onDelete: 'cascade' } },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  });

  it('generates REFERENCES with ON DELETE SET NULL and ON UPDATE NO ACTION', () => {
    const table: ParsedTable = {
      name: 'posts',
      columns: [
        { propName: 'userId', sqlName: 'user_id', type: 'integer', sqlType: 'INTEGER', modifiers: [], references: { table: 'users', column: 'id', onDelete: 'set null', onUpdate: 'no action' } },
      ],
    };
    const sql = generateCreateTableSQL(table);
    expect(sql).toContain('REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION');
  });
});

// ── Schema Diffing ──

describe('diffSchemas', () => {
  it('detects new tables', () => {
    const desired: ParsedTable[] = [
      { name: 'users', columns: [{ propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] }] },
    ];
    const current: IntrospectedTable[] = [];
    const diff = diffSchemas(desired, current);
    expect(diff.createTables).toHaveLength(1);
    expect(diff.createTables[0].name).toBe('users');
    expect(diff.dropTables).toHaveLength(0);
  });

  it('detects dropped tables', () => {
    const desired: ParsedTable[] = [];
    const current: IntrospectedTable[] = [
      { name: 'old_table', columns: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null }] },
    ];
    const diff = diffSchemas(desired, current);
    expect(diff.dropTables).toEqual(['old_table']);
    expect(diff.createTables).toHaveLength(0);
  });

  it('skips _drizzle_migrations from drop detection', () => {
    const desired: ParsedTable[] = [];
    const current: IntrospectedTable[] = [
      { name: '_drizzle_migrations', columns: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null }] },
    ];
    const diff = diffSchemas(desired, current);
    expect(diff.dropTables).toHaveLength(0);
  });

  it('detects new columns', () => {
    const desired: ParsedTable[] = [
      {
        name: 'users', columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
          { propName: 'name', sqlName: 'name', type: 'text', sqlType: 'TEXT', modifiers: ['notNull'] },
        ],
      },
    ];
    const current: IntrospectedTable[] = [
      { name: 'users', columns: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" }] },
    ];
    const diff = diffSchemas(desired, current);
    expect(diff.addColumns).toHaveLength(1);
    expect(diff.addColumns[0].table).toBe('users');
    expect(diff.addColumns[0].columns[0].sqlName).toBe('name');
  });

  it('detects dropped columns', () => {
    const desired: ParsedTable[] = [
      {
        name: 'users', columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
        ],
      },
    ];
    const current: IntrospectedTable[] = [
      {
        name: 'users', columns: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
          { column_name: 'old_col', data_type: 'text', is_nullable: 'YES', column_default: null },
        ],
      },
    ];
    const diff = diffSchemas(desired, current);
    expect(diff.dropColumns).toHaveLength(1);
    expect(diff.dropColumns[0].columns).toEqual(['old_col']);
  });

  it('returns empty diff when schemas match', () => {
    const desired: ParsedTable[] = [
      {
        name: 'users', columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
        ],
      },
    ];
    const current: IntrospectedTable[] = [
      { name: 'users', columns: [{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" }] },
    ];
    const diff = diffSchemas(desired, current);
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it('handles multiple changes at once', () => {
    const desired: ParsedTable[] = [
      {
        name: 'users', columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
          { propName: 'email', sqlName: 'email', type: 'text', sqlType: 'TEXT', modifiers: ['notNull'] },
        ],
      },
      {
        name: 'posts', columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
        ],
      },
    ];
    const current: IntrospectedTable[] = [
      {
        name: 'users', columns: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
          { column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null },
        ],
      },
    ];
    const diff = diffSchemas(desired, current);
    expect(diff.createTables).toHaveLength(1); // posts is new
    expect(diff.addColumns).toHaveLength(1); // email added to users
    expect(diff.dropColumns).toHaveLength(1); // name removed from users
  });
});

describe('isDiffEmpty', () => {
  it('returns true for empty diff', () => {
    expect(isDiffEmpty({ createTables: [], dropTables: [], addColumns: [], dropColumns: [] })).toBe(true);
  });

  it('returns false when createTables is non-empty', () => {
    expect(isDiffEmpty({ createTables: [{ name: 't', columns: [] }], dropTables: [], addColumns: [], dropColumns: [] })).toBe(false);
  });
});

// ── buildIntrospectedSchema ──

describe('buildIntrospectedSchema', () => {
  it('groups rows by table name', () => {
    const rows = [
      { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null },
      { table_name: 'posts', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    ];
    const tables = buildIntrospectedSchema(rows);
    expect(tables).toHaveLength(2);
    const users = tables.find((t) => t.name === 'users')!;
    expect(users.columns).toHaveLength(2);
    const posts = tables.find((t) => t.name === 'posts')!;
    expect(posts.columns).toHaveLength(1);
  });

  it('returns empty array for no rows', () => {
    expect(buildIntrospectedSchema([])).toEqual([]);
  });

  it('maps data_type and is_nullable correctly', () => {
    const rows = [
      { table_name: 't', column_name: 'email', data_type: 'character varying', is_nullable: 'NO', column_default: null },
    ];
    const tables = buildIntrospectedSchema(rows);
    expect(tables[0].columns[0].data_type).toBe('character varying');
    expect(tables[0].columns[0].is_nullable).toBe('NO');
  });
});

// ── generateMigrationSQL ──

describe('generateMigrationSQL', () => {
  it('generates CREATE TABLE for new tables', () => {
    const diff: SchemaDiff = {
      createTables: [{
        name: 'users',
        columns: [
          { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
          { propName: 'name', sqlName: 'name', type: 'text', sqlType: 'TEXT', modifiers: ['notNull'] },
        ],
      }],
      dropTables: [],
      addColumns: [],
      dropColumns: [],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('id SERIAL PRIMARY KEY');
    expect(sql).toContain('name TEXT NOT NULL');
  });

  it('generates ALTER TABLE ADD COLUMN', () => {
    const diff: SchemaDiff = {
      createTables: [],
      dropTables: [],
      addColumns: [{
        table: 'users',
        columns: [{ propName: 'email', sqlName: 'email', type: 'text', sqlType: 'TEXT', modifiers: ['notNull'] }],
      }],
      dropColumns: [],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('ALTER TABLE users ADD COLUMN email TEXT NOT NULL');
  });

  it('generates ALTER TABLE DROP COLUMN', () => {
    const diff: SchemaDiff = {
      createTables: [],
      dropTables: [],
      addColumns: [],
      dropColumns: [{ table: 'users', columns: ['old_col'] }],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('ALTER TABLE users DROP COLUMN old_col');
  });

  it('generates DROP TABLE', () => {
    const diff: SchemaDiff = {
      createTables: [],
      dropTables: ['old_table'],
      addColumns: [],
      dropColumns: [],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('DROP TABLE old_table');
  });

  it('generates combined SQL for multiple changes', () => {
    const diff: SchemaDiff = {
      createTables: [{ name: 'posts', columns: [{ propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] }] }],
      dropTables: ['old'],
      addColumns: [{ table: 'users', columns: [{ propName: 'email', sqlName: 'email', type: 'text', sqlType: 'TEXT', modifiers: [] }] }],
      dropColumns: [{ table: 'users', columns: ['name'] }],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS posts');
    expect(sql).toContain('ALTER TABLE users ADD COLUMN email TEXT');
    expect(sql).toContain('ALTER TABLE users DROP COLUMN name');
    expect(sql).toContain('DROP TABLE old');
  });

  it('orders CREATE TABLE by FK dependencies (referenced tables first)', () => {
    const diff: SchemaDiff = {
      createTables: [
        // posts references users, but posts is listed first
        {
          name: 'posts', columns: [
            { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
            { propName: 'userId', sqlName: 'user_id', type: 'integer', sqlType: 'INTEGER', modifiers: [], references: { table: 'users', column: 'id' } },
          ],
        },
        {
          name: 'users', columns: [
            { propName: 'id', sqlName: 'id', type: 'serial', sqlType: 'SERIAL', modifiers: ['primaryKey'] },
          ],
        },
      ],
      dropTables: [],
      addColumns: [],
      dropColumns: [],
    };
    const sql = generateMigrationSQL(diff);
    const usersIdx = sql.indexOf('CREATE TABLE IF NOT EXISTS users');
    const postsIdx = sql.indexOf('CREATE TABLE IF NOT EXISTS posts');
    expect(usersIdx).toBeLessThan(postsIdx);
  });

  it('generates ALTER TABLE ADD COLUMN with REFERENCES', () => {
    const diff: SchemaDiff = {
      createTables: [],
      dropTables: [],
      addColumns: [{
        table: 'posts',
        columns: [{ propName: 'userId', sqlName: 'user_id', type: 'integer', sqlType: 'INTEGER', modifiers: ['notNull'], references: { table: 'users', column: 'id', onDelete: 'cascade' } }],
      }],
      dropColumns: [],
    };
    const sql = generateMigrationSQL(diff);
    expect(sql).toContain('ALTER TABLE posts ADD COLUMN user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE');
  });
});

// ── Integration tests with mocked handleDatabaseRequest ──

vi.mock('../src/pglite/pglite-database', () => ({
  handleDatabaseRequest: vi.fn(),
  initPGliteInstance: vi.fn(),
  initAndMigrate: vi.fn(),
}));

describe('runDrizzleKitCommand', () => {
  const ctx = {} as CommandContext;
  let vfs: VirtualFS;

  beforeEach(() => {
    vi.clearAllMocks();
    vfs = new VirtualFS();
  });

  it('shows help with no args', async () => {
    const result = await runDrizzleKitCommand([], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('drizzle-kit');
    expect(result.stdout).toContain('generate');
    expect(result.stdout).toContain('migrate');
  });

  it('shows help with --help', async () => {
    const result = await runDrizzleKitCommand(['--help'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('drizzle-kit');
  });

  it('returns error for unknown subcommand', async () => {
    const result = await runDrizzleKitCommand(['foobar'], ctx, vfs);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown subcommand');
  });

  // ── generate ──

  describe('generate', () => {
    it('requires --name flag', async () => {
      const result = await runDrizzleKitCommand(['generate'], ctx, vfs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--name');
    });

    it('returns error when schema file not found', async () => {
      const result = await runDrizzleKitCommand(['generate', '--name', 'init'], ctx, vfs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Schema file not found');
    });

    it('reports no changes when schema matches DB', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        import { pgTable, serial, text } from 'drizzle-orm/pg-core';
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name'),
        });
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          rows: [
            { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" },
            { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES', column_default: null },
          ],
        }),
      });

      const result = await runDrizzleKitCommand(['generate', '--name', 'test'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No schema changes');
    });

    it('generates migration for new table', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        import { pgTable, serial, text } from 'drizzle-orm/pg-core';
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
        });
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ rows: [] }),
      });

      const result = await runDrizzleKitCommand(['generate', '--name', 'add_users'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Migration generated');
      expect(result.stdout).toContain('0000_add_users.sql');

      // Verify file was written
      const migrationContent = vfs.readFileSync('/project/drizzle/0000_add_users.sql', 'utf-8');
      expect(migrationContent).toContain('CREATE TABLE IF NOT EXISTS users');
      expect(migrationContent).toContain('id SERIAL PRIMARY KEY');
    });

    it('blocks DROP TABLE without --force', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        import { pgTable, serial } from 'drizzle-orm/pg-core';
        // empty schema - no tables
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          rows: [
            { table_name: 'old_table', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
          ],
        }),
      });

      const result = await runDrizzleKitCommand(['generate', '--name', 'cleanup'], ctx, vfs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('drop table');
      expect(result.stderr).toContain('--force');
    });

    it('generates migration with foreign keys', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core';
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
        });
        export const posts = pgTable('posts', {
          id: serial('id').primaryKey(),
          title: text('title').notNull(),
          userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
        });
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ rows: [] }),
      });

      const result = await runDrizzleKitCommand(['generate', '--name', 'add_users_posts'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Migration generated');

      const migrationContent = vfs.readFileSync('/project/drizzle/0000_add_users_posts.sql', 'utf-8');
      expect(migrationContent).toContain('REFERENCES users(id) ON DELETE CASCADE');
      // users table should come before posts table (FK dependency ordering)
      const usersIdx = migrationContent.indexOf('CREATE TABLE IF NOT EXISTS users');
      const postsIdx = migrationContent.indexOf('CREATE TABLE IF NOT EXISTS posts');
      expect(usersIdx).toBeLessThan(postsIdx);
    });

    it('includes DROP TABLE with --force', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        import { pgTable, serial } from 'drizzle-orm/pg-core';
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          rows: [
            { table_name: 'old_table', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
          ],
        }),
      });

      const result = await runDrizzleKitCommand(['generate', '--name', 'cleanup', '--force'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Migration generated');

      const migrationContent = vfs.readFileSync('/project/drizzle/0000_cleanup.sql', 'utf-8');
      expect(migrationContent).toContain('DROP TABLE old_table');
    });
  });

  // ── migrate ──

  describe('migrate', () => {
    it('reports no migration files', async () => {
      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      });

      const result = await runDrizzleKitCommand(['migrate'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No migration files');
    });

    it('applies pending migrations', async () => {
      vfs.mkdirSync('/project/drizzle', { recursive: true });
      vfs.writeFileSync('/project/drizzle/0000_init.sql', 'CREATE TABLE IF NOT EXISTS todos (id SERIAL PRIMARY KEY);');

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      let callCount = 0;
      (handleDatabaseRequest as any).mockImplementation(async (op: string, body: any) => {
        callCount++;
        if (op === 'query') {
          // First query: get applied migrations (none yet)
          return { statusCode: 200, body: JSON.stringify({ rows: [] }) };
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      });

      const result = await runDrizzleKitCommand(['migrate'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Applied 1 migration');
      expect(result.stdout).toContain('0000_init.sql');
    });

    it('reports all migrations already applied', async () => {
      vfs.mkdirSync('/project/drizzle', { recursive: true });
      vfs.writeFileSync('/project/drizzle/0000_init.sql', 'CREATE TABLE todos (id SERIAL);');

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockImplementation(async (op: string, body: any) => {
        if (op === 'query') {
          return { statusCode: 200, body: JSON.stringify({ rows: [{ name: '0000_init.sql' }] }) };
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      });

      const result = await runDrizzleKitCommand(['migrate'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('All migrations already applied');
    });

    it('stops on first error', async () => {
      vfs.mkdirSync('/project/drizzle', { recursive: true });
      vfs.writeFileSync('/project/drizzle/0000_init.sql', 'CREATE TABLE todos (id SERIAL);');
      vfs.writeFileSync('/project/drizzle/0001_bad.sql', 'INVALID SQL;');

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      let execCallIndex = 0;
      (handleDatabaseRequest as any).mockImplementation(async (op: string, body: any) => {
        if (op === 'query') {
          return { statusCode: 200, body: JSON.stringify({ rows: [] }) };
        }
        // exec calls
        execCallIndex++;
        if (execCallIndex === 1) {
          // CREATE TABLE _drizzle_migrations (ensureMigrationsTable)
          return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }
        if (execCallIndex === 2) {
          // First migration succeeds
          return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }
        if (execCallIndex === 3) {
          // Record first migration
          return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }
        if (execCallIndex === 4) {
          // Second migration fails
          return { statusCode: 500, body: JSON.stringify({ error: 'syntax error' }) };
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      });

      const result = await runDrizzleKitCommand(['migrate'], ctx, vfs);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Applied 1 migration');
      expect(result.stdout).toContain('0001_bad.sql');
    });
  });

  // ── push ──

  describe('push', () => {
    it('reports schema up to date when no changes', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
        });
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          rows: [
            { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')" },
          ],
        }),
      });

      const result = await runDrizzleKitCommand(['push'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('up to date');
    });

    it('applies diff directly', async () => {
      vfs.mkdirSync('/project', { recursive: true });
      vfs.mkdirSync('/project/src/db', { recursive: true });
      vfs.writeFileSync('/project/src/db/schema.ts', `
        export const users = pgTable('users', {
          id: serial('id').primaryKey(),
          name: text('name').notNull(),
        });
      `);

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      let calls = 0;
      (handleDatabaseRequest as any).mockImplementation(async (op: string) => {
        calls++;
        if (op === 'query') {
          return { statusCode: 200, body: JSON.stringify({ rows: [] }) };
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      });

      const result = await runDrizzleKitCommand(['push'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Push complete');
      expect(result.stdout).toContain('Created table(s): users');
    });

    it('returns error when schema file not found', async () => {
      const result = await runDrizzleKitCommand(['push'], ctx, vfs);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Schema file not found');
    });
  });

  // ── status ──

  describe('status', () => {
    it('reports no migration files', async () => {
      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      });

      const result = await runDrizzleKitCommand(['status'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No migration files');
    });

    it('shows applied and pending migrations', async () => {
      vfs.mkdirSync('/project/drizzle', { recursive: true });
      vfs.writeFileSync('/project/drizzle/0000_init.sql', 'CREATE TABLE todos (id SERIAL);');
      vfs.writeFileSync('/project/drizzle/0001_add_users.sql', 'CREATE TABLE users (id SERIAL);');

      const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
      (handleDatabaseRequest as any).mockImplementation(async (op: string) => {
        if (op === 'query') {
          return { statusCode: 200, body: JSON.stringify({ rows: [{ name: '0000_init.sql' }] }) };
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      });

      const result = await runDrizzleKitCommand(['status'], ctx, vfs);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[applied] 0000_init.sql');
      expect(result.stdout).toContain('[pending] 0001_add_users.sql');
    });
  });
});
