import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifySQL, parsePgArgs, runPgCommand } from '../src/shims/pg-command';
import type { CommandContext } from 'just-bash';
import type { VirtualFS } from '../src/virtual-fs';

// ── classifySQL ──

describe('classifySQL', () => {
  it('classifies SELECT as query', () => {
    expect(classifySQL('SELECT * FROM todos')).toBe('query');
  });

  it('classifies select (lowercase) as query', () => {
    expect(classifySQL('select 1')).toBe('query');
  });

  it('classifies WITH as query', () => {
    expect(classifySQL('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('query');
  });

  it('classifies EXPLAIN as query', () => {
    expect(classifySQL('EXPLAIN SELECT * FROM todos')).toBe('query');
  });

  it('classifies SHOW as query', () => {
    expect(classifySQL('SHOW server_version')).toBe('query');
  });

  it('classifies VALUES as query', () => {
    expect(classifySQL('VALUES (1, 2), (3, 4)')).toBe('query');
  });

  it('classifies TABLE as query', () => {
    expect(classifySQL('TABLE todos')).toBe('query');
  });

  it('classifies INSERT as exec', () => {
    expect(classifySQL('INSERT INTO todos (title) VALUES (\'Buy milk\')')).toBe('exec');
  });

  it('classifies UPDATE as exec', () => {
    expect(classifySQL('UPDATE todos SET done = true WHERE id = 1')).toBe('exec');
  });

  it('classifies DELETE as exec', () => {
    expect(classifySQL('DELETE FROM todos WHERE id = 1')).toBe('exec');
  });

  it('classifies CREATE TABLE as exec', () => {
    expect(classifySQL('CREATE TABLE users (id serial PRIMARY KEY)')).toBe('exec');
  });

  it('classifies INSERT ... RETURNING as query', () => {
    expect(classifySQL('INSERT INTO todos (title) VALUES (\'Buy milk\') RETURNING *')).toBe('query');
  });

  it('classifies DELETE ... RETURNING as query', () => {
    expect(classifySQL('DELETE FROM todos WHERE id = 1 RETURNING id')).toBe('query');
  });

  it('classifies UPDATE ... RETURNING as query', () => {
    expect(classifySQL('UPDATE todos SET done = true RETURNING *')).toBe('query');
  });

  it('handles leading whitespace', () => {
    expect(classifySQL('  SELECT 1')).toBe('query');
  });

  it('classifies DROP TABLE as exec', () => {
    expect(classifySQL('DROP TABLE todos')).toBe('exec');
  });

  it('classifies ALTER TABLE as exec', () => {
    expect(classifySQL('ALTER TABLE todos ADD COLUMN priority int')).toBe('exec');
  });
});

// ── parsePgArgs ──

describe('parsePgArgs', () => {
  it('parses bare SQL string', () => {
    expect(parsePgArgs(['SELECT * FROM todos'])).toEqual({
      sql: 'SELECT * FROM todos',
      json: false,
      db: undefined,
    });
  });

  it('parses --json flag', () => {
    expect(parsePgArgs(['--json', 'SELECT 1'])).toEqual({
      sql: 'SELECT 1',
      json: true,
      db: undefined,
    });
  });

  it('parses --db with space', () => {
    expect(parsePgArgs(['--db', 'myapp', 'SELECT 1'])).toEqual({
      sql: 'SELECT 1',
      json: false,
      db: 'myapp',
    });
  });

  it('parses --db=name', () => {
    expect(parsePgArgs(['--db=myapp', 'SELECT 1'])).toEqual({
      sql: 'SELECT 1',
      json: false,
      db: 'myapp',
    });
  });

  it('joins multiple positional args as SQL', () => {
    expect(parsePgArgs(['SELECT', '*', 'FROM', 'todos'])).toEqual({
      sql: 'SELECT * FROM todos',
      json: false,
      db: undefined,
    });
  });

  it('handles --json and --db together', () => {
    expect(parsePgArgs(['--json', '--db', 'test', 'SELECT 1'])).toEqual({
      sql: 'SELECT 1',
      json: true,
      db: 'test',
    });
  });

  it('returns empty sql when no positional args', () => {
    expect(parsePgArgs(['--json'])).toEqual({
      sql: '',
      json: true,
      db: undefined,
    });
  });

  it('returns empty sql for empty args', () => {
    expect(parsePgArgs([])).toEqual({
      sql: '',
      json: false,
      db: undefined,
    });
  });
});

// ── runPgCommand integration ──

vi.mock('../src/pglite/pglite-database', () => ({
  handleDatabaseRequest: vi.fn(),
}));

vi.mock('../src/pglite/db-manager', () => ({
  listDatabases: vi.fn(() => [
    { name: 'default', createdAt: '2024-01-01T00:00:00.000Z' },
  ]),
  getActiveDatabase: vi.fn(() => 'default'),
}));

describe('runPgCommand', () => {
  const ctx = {} as CommandContext;
  const vfs = {} as VirtualFS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows usage when no SQL provided', async () => {
    const result = await runPgCommand([], ctx, vfs);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });

  it('runs a SELECT query and formats as table', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ rows: [{ id: 1, title: 'Buy milk' }], fields: [] }),
    });

    const result = await runPgCommand(['SELECT * FROM todos'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('id');
    expect(result.stdout).toContain('Buy milk');
    expect(handleDatabaseRequest).toHaveBeenCalledWith('query', { sql: 'SELECT * FROM todos' }, undefined);
  });

  it('runs a SELECT with --json flag', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ rows: [{ id: 1 }], fields: [] }),
    });

    const result = await runPgCommand(['--json', 'SELECT 1 as id'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ id: 1 }]);
  });

  it('runs INSERT as exec', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    });

    const result = await runPgCommand(["INSERT INTO todos (title) VALUES ('Buy milk')"], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('OK');
    expect(handleDatabaseRequest).toHaveBeenCalledWith('exec', { sql: "INSERT INTO todos (title) VALUES ('Buy milk')" }, undefined);
  });

  it('runs INSERT RETURNING as query', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ rows: [{ id: 1, title: 'Buy milk' }], fields: [] }),
    });

    const result = await runPgCommand(["INSERT INTO todos (title) VALUES ('Buy milk') RETURNING *"], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Buy milk');
    expect(handleDatabaseRequest).toHaveBeenCalledWith('query', { sql: "INSERT INTO todos (title) VALUES ('Buy milk') RETURNING *" }, undefined);
  });

  it('passes --db to handleDatabaseRequest', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ rows: [{ count: 5 }], fields: [] }),
    });

    const result = await runPgCommand(['--db', 'myapp', 'SELECT count(*) FROM users'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(handleDatabaseRequest).toHaveBeenCalledWith('query', { sql: 'SELECT count(*) FROM users' }, 'myapp');
  });

  it('handles \\dt (list tables)', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ tables: ['todos', 'users'] }),
    });

    const result = await runPgCommand(['\\dt'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('todos\nusers');
  });

  it('handles \\d <table> (describe)', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        table: 'todos',
        columns: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('todos_id_seq')" },
          { column_name: 'title', data_type: 'text', is_nullable: 'YES', column_default: null },
        ],
      }),
    });

    const result = await runPgCommand(['\\d todos'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('column_name');
    expect(result.stdout).toContain('id');
    expect(result.stdout).toContain('title');
  });

  it('handles \\l (list databases)', async () => {
    const result = await runPgCommand(['\\l'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('default');
  });

  it('returns (no rows) for empty query result', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ rows: [], fields: [] }),
    });

    const result = await runPgCommand(['SELECT * FROM todos WHERE false'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('(no rows)');
  });

  it('returns error from handleDatabaseRequest', async () => {
    const { handleDatabaseRequest } = await import('../src/pglite/pglite-database');
    (handleDatabaseRequest as any).mockResolvedValue({
      statusCode: 500,
      body: JSON.stringify({ error: 'relation "foo" does not exist' }),
    });

    const result = await runPgCommand(['SELECT * FROM foo'], ctx, vfs);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('relation');
    expect(result.stderr).toContain('does not exist');
  });
});
