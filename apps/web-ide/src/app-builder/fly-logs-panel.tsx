import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchFlyLogsSince,
  type FlyLogsEntry,
} from '../../../../packages/almostnode/src/shims/app-building-remote';
import { Button } from '../ui/button';

const POLL_INTERVAL_MS = 5_000;
const MAX_ENTRIES = 500;

interface FlyLogsPanelProps {
  appName: string | null;
  token: string | null;
  machineId?: string | null;
  /** Human label for context ("hackernews worker", "all workers", …). */
  label?: string;
}

function formatTimestamp(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toISOString().replace('T', ' ').replace('Z', '');
  } catch {
    return raw;
  }
}

function levelClass(level: string | undefined): string {
  if (!level) return '';
  const normalized = level.toLowerCase();
  if (normalized.includes('err') || normalized === 'fatal') return 'is-error';
  if (normalized.includes('warn')) return 'is-warn';
  if (normalized.includes('info')) return 'is-info';
  return '';
}

function mergeEntries(prev: FlyLogsEntry[], next: FlyLogsEntry[]): FlyLogsEntry[] {
  if (next.length === 0) return prev;
  const combined = [...prev, ...next];
  // de-dup by timestamp + message
  const seen = new Set<string>();
  const out: FlyLogsEntry[] = [];
  for (const entry of combined) {
    const key = `${entry.timestamp ?? ''}|${entry.instance ?? ''}|${entry.message ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  if (out.length > MAX_ENTRIES) {
    out.splice(0, out.length - MAX_ENTRIES);
  }
  return out;
}

export function FlyLogsPanel({ appName, token, machineId, label }: FlyLogsPanelProps) {
  const [entries, setEntries] = useState<FlyLogsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const startTimeRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contextKey = `${appName ?? ''}|${machineId ?? ''}|${token ? 't' : ''}`;

  const tick = useCallback(async () => {
    if (!appName || !token) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const page = await fetchFlyLogsSince(appName, token, {
        machineId: machineId ?? null,
        cursor: cursorRef.current,
        startTime: startTimeRef.current,
      });
      cursorRef.current = page.nextToken || cursorRef.current;
      if (!startTimeRef.current && page.entries.length > 0) {
        startTimeRef.current = page.entries[page.entries.length - 1].timestamp ?? null;
      }
      if (page.entries.length > 0) {
        setEntries((prev) => mergeEntries(prev, page.entries));
        setError(null);
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [appName, token, machineId]);

  useEffect(() => {
    cursorRef.current = null;
    startTimeRef.current = new Date(Date.now() - 60_000).toISOString();
    setEntries([]);
    setError(null);
  }, [contextKey]);

  useEffect(() => {
    if (!appName || !token) return;
    if (!isLive) return;
    void tick();
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [appName, token, isLive, tick]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!appName || !token) {
    return (
      <div className="app-builder-route__logs app-builder-route__logs--idle">
        Pick a Fly app and sign in before logs can stream.
      </div>
    );
  }

  return (
    <div className="app-builder-route__logs">
      <div className="app-builder-route__logs-header">
        <div>
          <p className="app-builder-route__eyebrow">
            Worker logs{label ? ` · ${label}` : ''}
          </p>
          <p className="app-builder-route__cp-muted">
            Polling <code>{appName}</code>
            {machineId ? <> · machine <code>{machineId.slice(0, 10)}</code></> : null}
            {' '}every {POLL_INTERVAL_MS / 1000}s
          </p>
        </div>
        <div className="app-builder-route__logs-actions">
          <Button
            type="button"
            variant={isLive ? 'outline' : 'default'}
            size="sm"
            onClick={() => setIsLive((v) => !v)}
          >
            {isLive ? 'Pause' : 'Resume'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              cursorRef.current = null;
              startTimeRef.current = new Date(Date.now() - 60_000).toISOString();
              setEntries([]);
              setError(null);
              void tick();
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="app-builder-route__logs-body">
        {entries.length === 0 && !error ? (
          <p className="app-builder-route__cp-muted app-builder-route__cp-empty">
            {isLive ? 'Waiting for log entries…' : 'Paused. Resume to stream.'}
          </p>
        ) : null}
        {entries.map((entry, index) => (
          <div
            key={`${entry.timestamp ?? ''}-${entry.instance ?? ''}-${index}`}
            className={`app-builder-route__logs-row ${levelClass(entry.level)}`}
          >
            <span className="app-builder-route__logs-time">
              {formatTimestamp(entry.timestamp)}
            </span>
            {entry.instance ? (
              <span className="app-builder-route__logs-instance">{entry.instance.slice(0, 10)}</span>
            ) : null}
            <span className="app-builder-route__logs-message">{entry.message}</span>
          </div>
        ))}
      </div>

      {error ? (
        <div className="app-builder-route__logs-error">{error}</div>
      ) : null}
    </div>
  );
}
