import { afterEach, expect, it, vi } from 'vitest';
import { createContainer } from '../src/container';

afterEach(() => vi.unstubAllGlobals());

it('disables online commands before auth or network access while retaining player controls', async () => {
  const getIdToken = vi.fn(() => 'unused-token');
  const fetch = vi.fn(() => { throw new Error('Unexpected network request'); });
  vi.stubGlobal('almostOS', { soundcloud: { onlineEnabled: false, getIdToken } });
  vi.stubGlobal('fetch', fetch);
  const container = createContainer();
  try {
    for (const alias of ['napster', 'soundcloud']) {
      for (const command of ['whoami', 'search example', 'resolve https://soundcloud.com/example/track',
        'download https://soundcloud.com/example/track', 'play https://soundcloud.com/example/track',
        'queue https://soundcloud.com/example/track']) {
        const result = await container.run(`${alias} ${command}`);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('online features are disabled');
      }
    }
    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(container.vfs.existsSync('/home/user/.winamp/command.json')).toBe(false);
    expect(container.vfs.existsSync('/home/user/Desktop/Napster Downloads')).toBe(false);
    for (const action of ['next', 'prev', 'toggle', 'stop']) {
      expect((await container.run(`napster ${action}`)).exitCode).toBe(0);
      expect(JSON.parse(container.vfs.readFileSync('/home/user/.winamp/command.json', 'utf8') as string).action)
        .toBe(action);
    }
    expect((await container.run('napster help')).stdout).toContain('online features are disabled');
  } finally {
    container.dispose();
  }
});

it('preserves online capability for hosts that do not opt out', async () => {
  const getIdToken = vi.fn(() => `header.${btoa(JSON.stringify({ email: 'listener@example.com' }))}.signature`);
  vi.stubGlobal('almostOS', { soundcloud: { getIdToken } });
  const container = createContainer();
  try {
    const result = await container.run('napster whoami');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('listener@example.com');
    expect(getIdToken).toHaveBeenCalledOnce();
  } finally {
    container.dispose();
  }
});
