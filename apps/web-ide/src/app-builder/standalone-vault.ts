import {
  base64URLStringToBuffer,
  decryptData,
  detectWebAuthnPrfSupport,
  KEYCHAIN_STORAGE_KEY,
  parseStoredKeychain,
  unlockVaultKey,
  type StoredKeychain,
} from '../features/keychain';

export interface DecryptedFileMap {
  [path: string]: string;
}

export interface UnlockResult {
  files: DecryptedFileMap;
  slots: { name: string; paths: string[] }[];
}

export function readStoredVault(): StoredKeychain | null {
  try {
    return parseStoredKeychain(localStorage.getItem(KEYCHAIN_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function isVaultSupported(): Promise<boolean> {
  return detectWebAuthnPrfSupport();
}

/**
 * Runs a WebAuthn PRF passkey ceremony against the stored vault, decrypts the ciphertext,
 * and returns the decrypted credential files. Does not read or write any VFS and does not
 * require a WebIDEHost.
 */
export async function unlockVault(vault: StoredKeychain): Promise<UnlockResult> {
  const key = await unlockVaultKey(vault.credentialId, base64URLStringToBuffer(vault.prfSalt));
  const plaintext = await decryptData(key, vault.ciphertext, vault.iv);
  const parsed = JSON.parse(plaintext) as {
    files?: Array<{ path?: unknown; rawText?: unknown }>;
    claudeAiOauth?: unknown;
  };

  const files: DecryptedFileMap = {};
  if (parsed && Array.isArray(parsed.files)) {
    for (const entry of parsed.files) {
      if (!entry) continue;
      const path = typeof entry.path === 'string' ? entry.path : null;
      const rawText = typeof entry.rawText === 'string' ? entry.rawText : null;
      if (!path || rawText === null) continue;
      files[path] = rawText;
    }
  } else if (parsed && typeof parsed === 'object' && parsed.claudeAiOauth) {
    // Legacy v1 vault shape — a single credentials.json blob.
    files['/home/user/.claude/.credentials.json'] = plaintext;
  }

  return {
    files,
    slots: vault.slots,
  };
}

export function forgetStoredVault(): void {
  localStorage.removeItem(KEYCHAIN_STORAGE_KEY);
}
