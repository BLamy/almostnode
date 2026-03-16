/**
 * Typed database helpers over the PGlite HTTP bridge (/__db__/).
 *
 * PGlite runs in the host frame; app code talks to it via HTTP.
 * These helpers give you type safety from the Drizzle schema without
 * needing a direct PGlite connection.
 */

export type { Todo, NewTodo } from './types';

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch('/__db__/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.rows;
}

export async function dbExec(sql: string): Promise<void> {
  const res = await fetch('/__db__/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
}
