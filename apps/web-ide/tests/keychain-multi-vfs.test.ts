// @vitest-environment jsdom
/**
 * Multi-sandbox keychain semantics: every live sandbox VFS participates in
 * credential management, not just the foreground one.
 * - A credential file that only exists in a background (auxiliary) VFS still
 *   counts as live state and is what the vault snapshot saves.
 * - When the same managed path exists in several sandboxes, the newest copy
 *   wins (a login performed in a background sandbox must not be overwritten
 *   by the foreground sandbox's stale file).
 * - Switching the primary VFS keeps the outgoing one covered; detaching a
 *   disposed session's VFS removes it from the merge.
 */

import { describe, expect, it } from 'vitest';
import { VirtualFS } from 'almostnode';
import { Keychain } from '../src/features/keychain';

const CODEX_AUTH_PATH = '/home/user/.codex/auth.json';

function makeKeychain(vfs: VirtualFS): Keychain {
  const keychain = new Keychain({ vfs });
  keychain.registerSlot('codex', [CODEX_AUTH_PATH]);
  return keychain;
}

function writeCodexAuth(vfs: VirtualFS, token: string): void {
  vfs.mkdirSync('/home/user/.codex', { recursive: true });
  vfs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify({ token }));
}

async function tick(ms = 5): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Keychain multi-VFS credential coverage', () => {
  it('sees credentials that only exist in an auxiliary VFS', () => {
    const primary = new VirtualFS();
    const background = new VirtualFS();
    const keychain = makeKeychain(primary);

    keychain.attachAuxiliaryVfs(background);
    expect(keychain.getState().hasLiveCredentials).toBe(false);

    writeCodexAuth(background, 'from-background');
    expect(keychain.getState().hasLiveCredentials).toBe(true);
    expect(keychain.hasSlotData('codex')).toBe(true);
  });

  it('prefers the newest copy of a managed path across sandboxes', async () => {
    const primary = new VirtualFS();
    const background = new VirtualFS();
    const keychain = makeKeychain(primary);
    keychain.attachAuxiliaryVfs(background);

    writeCodexAuth(primary, 'stale-foreground');
    await tick();
    writeCodexAuth(background, 'fresh-background-login');

    const snapshot = (
      keychain as unknown as {
        readManagedSnapshot(): Array<{ path: string; rawText: string }>;
      }
    ).readManagedSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].rawText).toContain('fresh-background-login');
  });

  it('keeps the outgoing primary covered after setVfs and drops detached VFSes', async () => {
    const first = new VirtualFS();
    const second = new VirtualFS();
    const keychain = makeKeychain(first);

    await keychain.setVfs(second);
    // A login landing in the now-background first VFS still counts.
    writeCodexAuth(first, 'background-login');
    expect(keychain.getState().hasLiveCredentials).toBe(true);

    keychain.detachAuxiliaryVfs(first);
    expect(keychain.getState().hasLiveCredentials).toBe(false);
  });
});
