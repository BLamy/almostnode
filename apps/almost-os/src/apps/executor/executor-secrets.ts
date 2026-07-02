/**
 * executor.sh secret placement.
 *
 * API keys are files in the VFS at
 * `/home/user/.config/executor/secrets/{connectionId}.json`, registered as
 * keychain slots so the passkey vault encrypts them alongside OAuth tokens.
 * This module is import-cycle-free on purpose: `keychain-store` calls
 * {@link listExecutorSecretSlots} at boot (before `keychain.init()`) so
 * persisted secrets restore into the VFS on vault unlock.
 */

export const EXECUTOR_SECRET_DIR = "/home/user/.config/executor/secrets";
export const EXECUTOR_STATE_STORAGE_KEY = "app:executor:state.v1";

export interface ExecutorApiKeySecret {
  version: 1;
  connectionId: string;
  headerName: string;
  prefix?: string;
  key: string;
}

/** Minimal VFS surface used here (matches `@agent-wasm/core`'s VirtualFS). */
export interface SecretsFs {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, content: string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

export function apiKeySecretPath(connectionId: string): string {
  return `${EXECUTOR_SECRET_DIR}/${connectionId}.json`;
}

export function apiKeySlotName(connectionId: string): string {
  return `executor-key-${connectionId}`;
}

export function writeApiKeySecret(vfs: SecretsFs, secret: ExecutorApiKeySecret): void {
  if (!vfs.existsSync(EXECUTOR_SECRET_DIR)) {
    vfs.mkdirSync(EXECUTOR_SECRET_DIR, { recursive: true });
  }
  vfs.writeFileSync(apiKeySecretPath(secret.connectionId), `${JSON.stringify(secret, null, 2)}\n`);
}

export function readApiKeySecret(
  vfs: SecretsFs,
  connectionId: string,
): ExecutorApiKeySecret | null {
  const path = apiKeySecretPath(connectionId);
  try {
    if (!vfs.existsSync(path)) return null;
    const parsed = JSON.parse(vfs.readFileSync(path, "utf8")) as ExecutorApiKeySecret;
    return typeof parsed?.key === "string" && typeof parsed?.headerName === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function deleteApiKeySecret(vfs: SecretsFs, connectionId: string): void {
  try {
    if (vfs.existsSync(apiKeySecretPath(connectionId))) {
      vfs.unlinkSync(apiKeySecretPath(connectionId));
    }
  } catch {
    // Already gone.
  }
}

/**
 * Boot-time slot enumeration for the keychain, read straight from the
 * persisted (non-secret) executor state in localStorage. Kept dependency-free
 * so `keychain-store` can call it without importing the executor app.
 */
export function listExecutorSecretSlots(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
): Array<{ name: string; paths: string[] }> {
  if (!storage) return [];
  try {
    const raw = storage.getItem(EXECUTOR_STATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      connections?: Array<{ id?: string; method?: string }>;
    };
    return (parsed.connections ?? [])
      .filter((conn) => conn?.method === "api-key" && typeof conn.id === "string")
      .map((conn) => ({
        name: apiKeySlotName(conn.id!),
        paths: [apiKeySecretPath(conn.id!)],
      }));
  } catch {
    return [];
  }
}
