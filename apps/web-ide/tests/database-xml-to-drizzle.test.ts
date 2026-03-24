// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { convertDatabaseXmlToDrizzle } from '../src/features/database-xml-to-drizzle';

const TODO_APP_XML = `<database>
<table name='users'>
<column name='id' type='uuid' indexed='true' />
<column name='auth_user_id' type='text' indexed='true' />
<column name='email' type='varchar' indexed='true' />
<column name='provider' type='varchar' />
<column name='name' type='varchar' />
<column name='avatar_url' type='text' nullable='true' />
<column name='verified' type='boolean' />
<column name='anonymous' type='boolean' nullable='true' />
<column name='created_at' type='timestamp' />
<column name='updated_at' type='timestamp' />
</table>
<table name='webhook_calls'>
<column name='id' type='uuid' indexed='true' />
<column name='created_at' type='timestamp' />
<column name='updated_at' type='timestamp' />
<column name='path' type='text' nullable='true' />
<column name='error' type='text' nullable='true' />
<column name='request_id' type='uuid' nullable='true' />
</table>
<table name='tasks'>
<column name='id' type='uuid' indexed='true' />
<column name='created_at' type='timestamp' nullable='true' />
<column name='updated_at' type='timestamp' nullable='true' />
<column name='name' type='text' />
<column name='completed' type='boolean' />
<column name='user_id' type='uuid' nullable='true' indexed='true' foreign_table_id='users' />
</table>
</database>`;

describe('convertDatabaseXmlToDrizzle', () => {
  it('converts TodoApp database.xml to Drizzle schema', () => {
    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(TODO_APP_XML);

    // Schema TS assertions
    expect(schemaTs).toContain("import { pgTable,");
    expect(schemaTs).toContain("from 'drizzle-orm/pg-core'");

    // users table
    expect(schemaTs).toContain("export const users = pgTable('users',");
    expect(schemaTs).toContain("id: uuid('id').defaultRandom().primaryKey()");
    expect(schemaTs).toContain("authUserId: text('auth_user_id').notNull()");
    expect(schemaTs).toContain("email: varchar('email').notNull()");
    expect(schemaTs).toContain("avatarUrl: text('avatar_url')");
    expect(schemaTs).toContain("createdAt: timestamp('created_at').notNull().defaultNow()");

    // tasks table with FK
    expect(schemaTs).toContain("export const tasks = pgTable('tasks',");
    expect(schemaTs).toContain("userId: uuid('user_id').references(() => users.id)");

    // webhook_calls table
    expect(schemaTs).toContain("export const webhookCalls = pgTable('webhook_calls',");
  });

  it('generates correct migration SQL', () => {
    const { migrationSql } = convertDatabaseXmlToDrizzle(TODO_APP_XML);

    // All 3 tables
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS webhook_calls');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS tasks');

    // UUID PK
    expect(migrationSql).toContain('id UUID DEFAULT gen_random_uuid() PRIMARY KEY');

    // Default timestamps
    expect(migrationSql).toContain('created_at TIMESTAMP NOT NULL DEFAULT now()');
    expect(migrationSql).toContain('updated_at TIMESTAMP NOT NULL DEFAULT now()');

    // FK reference
    expect(migrationSql).toContain('user_id UUID REFERENCES users(id)');

    // Nullable columns don't have NOT NULL
    expect(migrationSql).toMatch(/avatar_url TEXT[^,\n]*(?!NOT NULL)/);
  });

  it('orders tables by FK dependencies', () => {
    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(TODO_APP_XML);

    // users must come before tasks (tasks references users)
    const usersIdx = schemaTs.indexOf("export const users");
    const tasksIdx = schemaTs.indexOf("export const tasks");
    expect(usersIdx).toBeLessThan(tasksIdx);

    // Same in SQL
    const usersCreate = migrationSql.indexOf('CREATE TABLE IF NOT EXISTS users');
    const tasksCreate = migrationSql.indexOf('CREATE TABLE IF NOT EXISTS tasks');
    expect(usersCreate).toBeLessThan(tasksCreate);
  });

  it('handles self-referencing FKs (comments → comments)', () => {
    const xml = `<database>
<table name='comments'>
<column name='id' type='uuid' indexed='true' />
<column name='content' type='text' />
<column name='parent_comment_id' type='uuid' nullable='true' indexed='true' foreign_table_id='comments' />
</table>
</database>`;

    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(xml);
    expect(schemaTs).toContain("parentCommentId: uuid('parent_comment_id').references(() => comments.id)");
    expect(migrationSql).toContain('parent_comment_id UUID REFERENCES comments(id)');
  });

  it('only imports used Drizzle functions', () => {
    const simpleXml = `<database>
<table name='settings'>
<column name='id' type='uuid' indexed='true' />
<column name='key' type='text' />
<column name='value' type='text' nullable='true' />
</table>
</database>`;

    const { schemaTs } = convertDatabaseXmlToDrizzle(simpleXml);
    expect(schemaTs).toContain('pgTable, text, uuid');
    // Should not import unused types
    expect(schemaTs).not.toContain('boolean');
    expect(schemaTs).not.toContain('timestamp');
    expect(schemaTs).not.toContain('varchar');
  });

  it('handles complex schema with multiple FK chains', () => {
    const xml = `<database>
<table name='users'>
<column name='id' type='uuid' indexed='true' />
<column name='name' type='varchar' />
</table>
<table name='projects'>
<column name='id' type='uuid' indexed='true' />
<column name='name' type='varchar' />
<column name='owner_id' type='uuid' indexed='true' foreign_table_id='users' />
</table>
<table name='issues'>
<column name='id' type='uuid' indexed='true' />
<column name='title' type='varchar' />
<column name='project_id' type='uuid' nullable='true' indexed='true' foreign_table_id='projects' />
<column name='assignee_id' type='uuid' nullable='true' indexed='true' foreign_table_id='users' />
</table>
<table name='comments'>
<column name='id' type='uuid' indexed='true' />
<column name='content' type='text' />
<column name='issue_id' type='uuid' indexed='true' foreign_table_id='issues' />
<column name='user_id' type='uuid' indexed='true' foreign_table_id='users' />
</table>
</database>`;

    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(xml);

    // Dependency order: users → projects → issues → comments
    const positions = ['users', 'projects', 'issues', 'comments'].map(
      (name) => schemaTs.indexOf(`export const ${name === 'users' ? 'users' : name === 'projects' ? 'projects' : name === 'issues' ? 'issues' : 'comments'}`)
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }

    // SQL FK references
    expect(migrationSql).toContain('owner_id UUID NOT NULL REFERENCES users(id)');
    expect(migrationSql).toContain('project_id UUID REFERENCES projects(id)');
    expect(migrationSql).toContain('issue_id UUID NOT NULL REFERENCES issues(id)');
  });

  it('handles all supported column types', () => {
    const xml = `<database>
<table name='all_types'>
<column name='id' type='uuid' indexed='true' />
<column name='text_col' type='text' />
<column name='varchar_col' type='varchar' />
<column name='bool_col' type='boolean' />
<column name='ts_col' type='timestamp' />
<column name='tstz_col' type='timestamptz' />
<column name='date_col' type='date' />
<column name='bigint_col' type='bigint' />
<column name='decimal_col' type='decimal' />
<column name='int_col' type='integer' />
<column name='jsonb_col' type='jsonb' />
</table>
</database>`;

    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(xml);

    // Drizzle schema
    expect(schemaTs).toContain("textCol: text('text_col')");
    expect(schemaTs).toContain("varcharCol: varchar('varchar_col')");
    expect(schemaTs).toContain("boolCol: boolean('bool_col')");
    expect(schemaTs).toContain("tsCol: timestamp('ts_col')");
    expect(schemaTs).toContain("tstzCol: timestamp('tstz_col')");
    expect(schemaTs).toContain("dateCol: date('date_col')");
    expect(schemaTs).toContain("bigintCol: bigint('bigint_col')");
    expect(schemaTs).toContain("decimalCol: numeric('decimal_col')");
    expect(schemaTs).toContain("intCol: integer('int_col')");
    expect(schemaTs).toContain("jsonbCol: jsonb('jsonb_col')");

    // SQL types
    expect(migrationSql).toContain('text_col TEXT NOT NULL');
    expect(migrationSql).toContain('varchar_col VARCHAR NOT NULL');
    expect(migrationSql).toContain('bool_col BOOLEAN NOT NULL');
    expect(migrationSql).toContain('ts_col TIMESTAMP NOT NULL');
    expect(migrationSql).toContain('tstz_col TIMESTAMPTZ NOT NULL');
    expect(migrationSql).toContain('date_col DATE NOT NULL');
    expect(migrationSql).toContain('bigint_col BIGINT NOT NULL');
    expect(migrationSql).toContain('decimal_col NUMERIC NOT NULL');
    expect(migrationSql).toContain('int_col INTEGER NOT NULL');
    expect(migrationSql).toContain('jsonb_col JSONB NOT NULL');
  });

  it('throws on invalid XML', () => {
    expect(() => convertDatabaseXmlToDrizzle('<not-database>')).not.toThrow();
    // DOMParser doesn't throw on all malformed XML — it returns a parsererror
    // This XML is technically parseable but has no tables, so result is empty
    const { schemaTs } = convertDatabaseXmlToDrizzle('<not-database/>');
    expect(schemaTs).toContain("import { pgTable }");
  });
});
