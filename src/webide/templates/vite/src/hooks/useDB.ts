import { useState, useEffect, useCallback } from 'react';

interface QueryResult<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDBQuery<T = any>(sql: string, params: any[] = []): QueryResult<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/__db__/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sql, JSON.stringify(params), tick]);

  return { rows, loading, error, refetch };
}

export async function dbExec(sql: string): Promise<void> {
  const res = await fetch('/__db__/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
}

export async function dbQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await fetch('/__db__/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.rows;
}
