// @vitest-environment jsdom
/**
 * Regression tests: a stored vault must never be destroyed.
 * - Snapshot entries with paths that aren't currently managed (slot
 *   registration races, path renames between builds) are kept, not dropped —
 *   dropping them used to mark the whole payload invalid, which deleted the
 *   vault from localStorage.
 * - Unparseable vaults are quarantined, and a parseable quarantined vault is
 *   recovered on the next read.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { VirtualFS } from 'almostnode';
import {
  Keychain,
  KEYCHAIN_QUARANTINE_KEY,
  KEYCHAIN_STORAGE_KEY,
  parseSnapshotPayload,
} from '../src/features/keychain';

describe('parseSnapshotPayload', () => {
  it('keeps entries whose paths are not currently managed', () => {
    const payload = JSON.stringify({
      files: [
        { path: '/home/user/.codex/auth.json', rawText: '{"token":"x"}' },
        { path: '/home/user/.claude/.credentials.json', rawText: '{"y":1}' },
      ],
    });
    // No managed paths registered at all (slot registration race).
    const entries = parseSnapshotPayload(payload, () => null);
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      '/home/user/.claude/.credentials.json',
      '/home/user/.codex/auth.json',
    ]);
  });

  it('prefers the normalized path when one is available', () => {
    const payload = JSON.stringify({
      files: [{ path: '/workspace/.codex/auth.json', rawText: '{}' }],
    });
    const entries = parseSnapshotPayload(
      payload,
      (path) => (path.includes('.codex') ? '/home/user/.codex/auth.json' : null),
    );
    expect(entries).toEqual([
      { path: '/home/user/.codex/auth.json', rawText: '{}' },
    ]);
  });
});

describe('vault quarantine and recovery', () => {
  const validVault = {
    version: 2,
    slots: [],
    credentialId: 'cred',
    prfSalt: 'salt',
    iv: 'iv',
    ciphertext: 'cipher',
    updatedAt: new Date(0).toISOString(),
  };

  const makeKeychain = () =>
    new Keychain({ vfs: new VirtualFS(), overlayRoot: null }) as unknown as {
      getStoredVault(): unknown;
    };

  beforeEach(() => {
    localStorage.clear();
  });

  it('quarantines an unparseable vault instead of deleting it', () => {
    localStorage.setItem(KEYCHAIN_STORAGE_KEY, '{"version":99,"bogus":true}');
    expect(makeKeychain().getStoredVault()).toBeNull();
    expect(localStorage.getItem(KEYCHAIN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(KEYCHAIN_QUARANTINE_KEY)).toContain('bogus');
  });

  it('recovers a parseable vault from quarantine', () => {
    localStorage.setItem(KEYCHAIN_QUARANTINE_KEY, JSON.stringify(validVault));
    const vault = makeKeychain().getStoredVault();
    expect(vault).toMatchObject({ credentialId: 'cred' });
    expect(localStorage.getItem(KEYCHAIN_STORAGE_KEY)).toContain('cred');
    expect(localStorage.getItem(KEYCHAIN_QUARANTINE_KEY)).toBeNull();
  });
});
