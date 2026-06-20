/**
 * Regression tests for shell quoting through the `/bin/sh -lc <script>` path
 * agents use. Quoted arguments must survive intact into just-bash — a `|`
 * inside quotes is a literal character, not a pipe operator.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { initChildProcess, spawn } from '../src/shims/child_process';

describe('shell quoting via /bin/sh -lc', () => {
  let vfs: VirtualFS;

  beforeEach(() => {
    vfs = new VirtualFS();
    vfs.mkdirSync('/src', { recursive: true });
    vfs.writeFileSync(
      '/src/a.tsx',
      'import { Routes } from "react-router";\nconst db = useDB();\nline3\nline4\n',
    );
    vfs.writeFileSync('/package.json', '{"name":"x"}');
    initChildProcess(vfs);
  });

  const runSh = (script: string) =>
    new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn('/bin/sh', ['-lc', script], { cwd: '/' });
      let out = '';
      let err = '';
      child.stdout?.on('data', (d: unknown) => (out += String(d)));
      child.stderr?.on('data', (d: unknown) => (err += String(d)));
      child.on('close', (code: number | null) => resolve({ code, out, err }));
      child.on('error', () => resolve({ code: -1, out, err }));
    });

  it('keeps | inside double quotes literal for rg', async () => {
    const r = await runSh('rg "Routes|useDB|db" /src /package.json -n');
    expect(r.err).not.toMatch(/command not found/);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Routes');
    expect(r.out).toContain('useDB');
  });

  it('keeps | inside double quotes literal for grep -E', async () => {
    const r = await runSh('grep -E "Routes|useDB" /src/a.tsx');
    expect(r.err).not.toMatch(/command not found/);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Routes');
  });

  it('handles single-quoted sed ranges', async () => {
    const r = await runSh("sed -n '1,2p' /src/a.tsx");
    expect(r.code).toBe(0);
    expect(r.out).toContain('Routes');
    expect(r.out).toContain('useDB');
  });

  it('still supports real pipes outside quotes', async () => {
    const r = await runSh('grep -E "Routes|useDB" /src/a.tsx | head -1');
    expect(r.code).toBe(0);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    expect(r.out).toContain('Routes');
  });

  it('preserves quoted parens and dollar signs', async () => {
    const r = await runSh("echo 'VALUES (1, $x)'");
    expect(r.code).toBe(0);
    expect(r.out).toBe('VALUES (1, $x)\n');
  });

  it('preserves quoted strings with spaces', async () => {
    const r = await runSh('echo "hello world" | wc -w');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('2');
  });
});
