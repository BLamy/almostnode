import * as SecureStore from "expo-secure-store";
import type { MobileSecretFiles } from "../types";

const SETTINGS_KEYS = {
  authJson: "mobile-ide.opencode.auth-json",
  mcpAuthJson: "mobile-ide.opencode.mcp-auth-json",
  configJson: "mobile-ide.opencode.config-json",
  configJsonc: "mobile-ide.opencode.config-jsonc",
  legacyConfigJson: "mobile-ide.opencode.legacy-config-json",
} as const;

function normalizeSecret(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return value.trim() ? value : null;
}

export async function loadStoredSecrets(): Promise<MobileSecretFiles> {
  const [
    authJson,
    mcpAuthJson,
    configJson,
    configJsonc,
    legacyConfigJson,
  ] = await Promise.all([
    SecureStore.getItemAsync(SETTINGS_KEYS.authJson),
    SecureStore.getItemAsync(SETTINGS_KEYS.mcpAuthJson),
    SecureStore.getItemAsync(SETTINGS_KEYS.configJson),
    SecureStore.getItemAsync(SETTINGS_KEYS.configJsonc),
    SecureStore.getItemAsync(SETTINGS_KEYS.legacyConfigJson),
  ]);

  return {
    authJson,
    mcpAuthJson,
    configJson,
    configJsonc,
    legacyConfigJson,
  };
}

export async function saveStoredSecrets(next: MobileSecretFiles): Promise<MobileSecretFiles> {
  const normalized: MobileSecretFiles = {
    authJson: normalizeSecret(next.authJson),
    mcpAuthJson: normalizeSecret(next.mcpAuthJson),
    configJson: normalizeSecret(next.configJson),
    configJsonc: normalizeSecret(next.configJsonc),
    legacyConfigJson: normalizeSecret(next.legacyConfigJson),
  };

  await Promise.all(
    Object.entries(SETTINGS_KEYS).map(async ([field, storageKey]) => {
      const value = normalized[field as keyof MobileSecretFiles];
      if (value == null) {
        await SecureStore.deleteItemAsync(storageKey);
        return;
      }
      await SecureStore.setItemAsync(storageKey, value);
    }),
  );

  return normalized;
}

export async function clearStoredSecrets(): Promise<void> {
  await Promise.all(
    Object.values(SETTINGS_KEYS).map((storageKey) => SecureStore.deleteItemAsync(storageKey)),
  );
}
