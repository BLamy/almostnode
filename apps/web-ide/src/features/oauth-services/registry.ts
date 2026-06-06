/**
 * Persistent registry of user-added OAuth services.
 *
 * Stored in `localStorage` so it can be loaded synchronously at boot, BEFORE
 * the keychain is unlocked — this is required because the keychain rejects
 * writes to unknown paths in `restoreSavedCredentials` (see
 * `keychain.ts#normalizeManagedPath`). Slot registration must happen before
 * unlock, so the list of slots cannot live in the encrypted vault itself.
 *
 * Only non-secret config lives here. Tokens (and any `client_secret`) live in
 * the VFS at `/home/user/.config/oauth/{id}.json`, which is encrypted into
 * the vault by the keychain watcher.
 */

import type { OAuthServiceConfig } from "./types";

export const OAUTH_REGISTRY_STORAGE_KEY = "almostnode.webide.oauthServices.v1";
export const OAUTH_REGISTRY_VERSION = 1;

export const OAUTH_TOKEN_DIR = "/home/user/.config/oauth";

/** VFS path for the encrypted token file backing a service. */
export function tokenFilePathForService(serviceId: string): string {
  return `${OAUTH_TOKEN_DIR}/${serviceId}.json`;
}

interface StoredRegistry {
  version: number;
  services: OAuthServiceConfig[];
}

/**
 * Generate a stable-ish service id from a hostname plus 6 random chars so
 * multiple entries from the same host can coexist (e.g. two GitHub Apps).
 */
export function generateServiceId(hostname: string): string {
  const slug = hostname
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "oauth";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let suffix = "";
  for (const byte of bytes) {
    suffix += (byte % 36).toString(36);
  }
  return `${slug}-${suffix.slice(0, 6).padEnd(6, "0")}`;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isOAuthServiceConfig(value: unknown): value is OAuthServiceConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string"
    && typeof v.displayName === "string"
    && typeof v.issuer === "string"
    && typeof v.authorizationEndpoint === "string"
    && typeof v.tokenEndpoint === "string"
    && typeof v.clientId === "string"
    && typeof v.redirectUri === "string"
    && Array.isArray(v.scopesRequested)
    && v.codeChallengeMethod === "S256"
  );
}

function parseStoredRegistry(raw: string | null): OAuthServiceConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const candidate = parsed as Partial<StoredRegistry>;
  if (candidate.version !== OAUTH_REGISTRY_VERSION || !Array.isArray(candidate.services)) {
    return [];
  }
  return candidate.services.filter(isOAuthServiceConfig);
}

export interface OAuthRegistryOptions {
  storage?: StorageLike | null;
  storageKey?: string;
}

/**
 * In-memory mirror of the persisted registry. Methods are synchronous so
 * boot-time slot registration can use them without awaiting anything.
 */
export class OAuthServiceRegistry {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private services: OAuthServiceConfig[];
  private listeners: Array<(services: OAuthServiceConfig[]) => void> = [];

  constructor(options: OAuthRegistryOptions = {}) {
    this.storage = options.storage ?? getDefaultStorage();
    this.storageKey = options.storageKey ?? OAUTH_REGISTRY_STORAGE_KEY;
    this.services = parseStoredRegistry(this.storage?.getItem(this.storageKey) ?? null);
  }

  list(): OAuthServiceConfig[] {
    return this.services.map((service) => ({ ...service }));
  }

  get(id: string): OAuthServiceConfig | undefined {
    const found = this.services.find((service) => service.id === id);
    return found ? { ...found } : undefined;
  }

  has(id: string): boolean {
    return this.services.some((service) => service.id === id);
  }

  upsert(service: OAuthServiceConfig): void {
    const existingIndex = this.services.findIndex((entry) => entry.id === service.id);
    if (existingIndex >= 0) {
      this.services[existingIndex] = { ...service };
    } else {
      this.services = [...this.services, { ...service }];
    }
    this.persist();
  }

  remove(id: string): boolean {
    const before = this.services.length;
    this.services = this.services.filter((entry) => entry.id !== id);
    if (this.services.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  /** Subscribe to changes. Returns an unsubscribe fn. */
  subscribe(listener: (services: OAuthServiceConfig[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const payload: StoredRegistry = {
        version: OAUTH_REGISTRY_VERSION,
        services: this.services,
      };
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // localStorage write can throw under quota / private-mode scenarios.
      // We swallow because the registry is best-effort persistence and the
      // in-memory state remains valid for the session.
    }
    const snapshot = this.list();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("OAuth registry listener failed", error);
      }
    }
  }
}
