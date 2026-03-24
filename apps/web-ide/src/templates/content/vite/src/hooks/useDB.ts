import { useState, useEffect, useCallback } from 'react';
import { dbQuery, dbExec } from '@/db';

export { dbQuery, dbExec };

interface QueryResult<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDBQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): QueryResult<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dbQuery<T>(sql, params)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
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
