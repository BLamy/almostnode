import type { MobileSecretFiles } from "../types";

const STORAGE_KEY = "mobile-ide.settings-store.v1";

let memorySecrets: MobileSecretFiles | null = null;

const EMPTY_SECRETS: MobileSecretFiles = {
  authJson: null,
  mcpAuthJson: null,
  configJson: null,
  configJsonc: null,
  legacyConfigJson: null,
};

function normalizeSecret(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return value.trim() ? value : null;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readSecrets(): MobileSecretFiles {
  if (!canUseLocalStorage()) {
    memorySecrets ??= EMPTY_SECRETS;
    return memorySecrets;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memorySecrets = EMPTY_SECRETS;
      return EMPTY_SECRETS;
    }

    const parsed = JSON.parse(raw) as Partial<MobileSecretFiles>;
    const normalized: MobileSecretFiles = {
      authJson: normalizeSecret(parsed.authJson),
      mcpAuthJson: normalizeSecret(parsed.mcpAuthJson),
      configJson: normalizeSecret(parsed.configJson),
      configJsonc: normalizeSecret(parsed.configJsonc),
      legacyConfigJson: normalizeSecret(parsed.legacyConfigJson),
    };
    memorySecrets = normalized;
    return normalized;
  } catch {
    memorySecrets = EMPTY_SECRETS;
    return EMPTY_SECRETS;
  }
}

function writeSecrets(secrets: MobileSecretFiles): void {
  const normalized: MobileSecretFiles = {
    authJson: normalizeSecret(secrets.authJson),
    mcpAuthJson: normalizeSecret(secrets.mcpAuthJson),
    configJson: normalizeSecret(secrets.configJson),
    configJsonc: normalizeSecret(secrets.configJsonc),
    legacyConfigJson: normalizeSecret(secrets.legacyConfigJson),
  };

  memorySecrets = normalized;

  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export async function loadStoredSecrets(): Promise<MobileSecretFiles> {
  return readSecrets();
}

export async function saveStoredSecrets(next: MobileSecretFiles): Promise<MobileSecretFiles> {
  writeSecrets(next);
  return readSecrets();
}

export async function clearStoredSecrets(): Promise<void> {
  memorySecrets = EMPTY_SECRETS;
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
