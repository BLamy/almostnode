/**
 * Backward-compatibility re-exports from the generic Keychain.
 * Existing imports throughout the codebase continue to work unchanged.
 */

export {
  Keychain as ClaudeAuthVault,
  type KeychainState as ClaudeAuthVaultState,
  type KeychainOptions as ClaudeAuthVaultOptions,
  type StoredKeychain,
  KEYCHAIN_STORAGE_KEY as CLAUDE_AUTH_STORAGE_KEY,
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
  WebAuthnError,
  bufferToBase64URLString,
  base64URLStringToBuffer,
  encryptData,
  decryptData,
  deriveVaultKeyFromPrf,
  detectWebAuthnPrfSupport,
  parseStoredKeychain,
  serializeStoredKeychain,
} from './keychain';

import type { StoredKeychain } from './keychain';
import { parseStoredKeychain, serializeStoredKeychain } from './keychain';

// v1-shaped compat types used by existing tests
export interface StoredClaudeAuthVault {
  version: number;
  path: string;
  files?: string[];
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

export function parseStoredClaudeAuthVault(raw: string | null): StoredClaudeAuthVault | null {
  // Try v2 format first
  const v2 = parseStoredKeychain(raw);
  if (v2) {
    // Convert v2 back to v1-shaped object for backward compat
    const allPaths: string[] = [];
    for (const slot of v2.slots) {
      for (const p of slot.paths) {
        if (!allPaths.includes(p)) allPaths.push(p);
      }
    }
    return {
      version: v2.version,
      path: allPaths[0] || '/home/user/.claude/.credentials.json',
      files: allPaths,
      credentialId: v2.credentialId,
      prfSalt: v2.prfSalt,
      iv: v2.iv,
      ciphertext: v2.ciphertext,
      updatedAt: v2.updatedAt,
    };
  }

  // Try v1 format
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredClaudeAuthVault;
    if (
      parsed
      && typeof parsed === 'object'
      && parsed.version === 1
      && parsed.path === '/home/user/.claude/.credentials.json'
      && typeof parsed.credentialId === 'string'
      && typeof parsed.prfSalt === 'string'
      && typeof parsed.iv === 'string'
      && typeof parsed.ciphertext === 'string'
      && typeof parsed.updatedAt === 'string'
    ) {
      return parsed;
    }
  } catch {
    // Fall through.
  }
  return null;
}

export function serializeStoredClaudeAuthVault(vault: StoredClaudeAuthVault): string {
  return JSON.stringify(vault);
}
