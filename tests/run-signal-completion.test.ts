// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/index';

describe('container.run signal completion', () => {
  it('completes one-shot node commands even with an abort signal', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/silent.js', 'module.exports = {};');

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Timed out waiting for node command to finish'));
      }, 4000);
    });

    const result = await Promise.race([
      container.run('node /silent.js', {
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('decodes arrow and return keypresses for interactive CLIs', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/keys.js', `
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
let seen = 0;
process.stdin.on('keypress', (_str, key) => {
  if (!key || !key.name) return;
  if (key.name === 'up' || key.name === 'return') {
    console.log('KEY:' + key.name);
    seen++;
  }
  if (seen >= 2) process.exit(0);
});
`);

    const controller = new AbortController();
    const out: string[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const runPromise = container.run('node /keys.js', {
      signal: controller.signal,
      onStdout: (chunk) => out.push(chunk),
      onStderr: (chunk) => out.push(chunk),
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Timed out waiting for interactive keypress handling'));
      }, 5000);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    container.sendInput('\u001b[A');
    container.sendInput('\r');

    const result = await Promise.race([runPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);

    const combined = out.join('');
    expect(result.exitCode).toBe(0);
    expect(combined).toContain('KEY:up');
    expect(combined).toContain('KEY:return');
  });

  it('normalizes CRLF into a single return keypress', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/return-once.js', `
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
let returns = 0;
process.stdin.on('keypress', (_str, key) => {
  if (!key || key.name !== 'return') return;
  returns++;
  console.log('RET:' + returns);
  if (returns > 1) process.exit(2);
});
setTimeout(() => process.exit(0), 150);
`);

    const controller = new AbortController();
    const out: string[] = [];
    const resultPromise = container.run('node /return-once.js', {
      signal: controller.signal,
      onStdout: (chunk) => out.push(chunk),
      onStderr: (chunk) => out.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    container.sendInput('\r\n');

    const result = await resultPromise;
    const combined = out.join('');
    expect(result.exitCode).toBe(0);
    expect(combined).toContain('RET:1');
    expect(combined).not.toContain('RET:2');
  });

  it('keeps text data events while suppressing arrow control data', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/stdin-mixed.js', `
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  console.log('DATA:' + JSON.stringify(String(chunk)));
});
process.stdin.on('keypress', (_str, key) => {
  if (!key || !key.name) return;
  console.log('KEY:' + key.name);
  if (key.name === 'return') process.exit(0);
});
`);

    const controller = new AbortController();
    const out: string[] = [];
    const resultPromise = container.run('node /stdin-mixed.js', {
      signal: controller.signal,
      onStdout: (chunk) => out.push(chunk),
      onStderr: (chunk) => out.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    container.sendInput('\u001b[A');
    container.sendInput('next-app');
    container.sendInput('\r');

    const result = await resultPromise;
    const combined = out.join('');

    expect(result.exitCode).toBe(0);
    expect(combined).toContain('KEY:up');
    expect(combined).toContain('KEY:return');
    expect(combined).toContain('DATA:"next-app"');
    expect(combined).not.toContain('DATA:"\\u001b[A"');
  });

  it('supports readable stdin flow and live TTY stream flags for interactive CLIs', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/stdin-readable.js', `
process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);
process.stdin.ref();
let seen = '';
process.stdin.on('readable', () => {
  let chunk = process.stdin.read();
  while (chunk !== null) {
    seen += String(chunk);
    chunk = process.stdin.read();
  }
  if (seen.includes('x')) {
    console.log('READABLE:' + seen);
    if (!process.stdout.writable || !process.stdin.readable) process.exit(129);
    process.exit(0);
  }
});
setTimeout(() => {
  if (!process.stdout.writable || !process.stdin.readable) process.exit(129);
}, 50);
`);

    const controller = new AbortController();
    const out: string[] = [];
    const resultPromise = container.run('node /stdin-readable.js', {
      signal: controller.signal,
      onStdout: (chunk) => out.push(chunk),
      onStderr: (chunk) => out.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    container.sendInput('x');

    const result = await resultPromise;
    const combined = out.join('');

    expect(result.exitCode).toBe(0);
    expect(combined).toContain('READABLE:x');
  });

  it('passes pasted auth-style tokens through stdin without bracketed paste markers', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/stdin-paste.js', `
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  console.log('DATA:' + JSON.stringify(String(chunk)));
  process.exit(0);
});
`);

    const out: string[] = [];
    const resultPromise = container.run('node /stdin-paste.js', {
      onStdout: (chunk) => out.push(chunk),
      onStderr: (chunk) => out.push(chunk),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    container.sendInput('\u001b[200~RNQar6ibVesWdWYkm2ZH5lkojbuYCzG2valccELWOf2ofWes#TDF-LhDbcRnyAHFzRau1Oq_fO4epJKYfuAalzRMpnIU\u001b[201~');

    const result = await resultPromise;
    const combined = out.join('');

    expect(result.exitCode).toBe(0);
    expect(combined).toContain('DATA:"RNQar6ibVesWdWYkm2ZH5lkojbuYCzG2valccELWOf2ofWes#TDF-LhDbcRnyAHFzRau1Oq_fO4epJKYfuAalzRMpnIU"');
  });

});
