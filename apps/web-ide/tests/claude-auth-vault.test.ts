/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualFS } from 'almostnode';
import {
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
  CLAUDE_AUTH_STORAGE_KEY,
  ClaudeAuthVault,
  WebAuthnError,
  base64URLStringToBuffer,
  bufferToBase64URLString,
  decryptData,
  detectWebAuthnPrfSupport,
  encryptData,
  parseStoredClaudeAuthVault,
  serializeStoredClaudeAuthVault,
} from '../src/features/claude-auth-vault';
import {
  Keychain,
  KEYCHAIN_STORAGE_KEY,
  OPENCODE_AUTH_PATH,
  OPENCODE_CONFIG_JSONC_PATH,
  OPENCODE_CONFIG_PATH,
  OPENCODE_LEGACY_CONFIG_PATH,
  OPENCODE_MCP_AUTH_PATH,
  deriveVaultKeyFromPrf,
  parseStoredKeychain,
} from '../src/features/keychain';

const CLAUDE_SLOT_PATHS = [
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
];
const OPENCODE_SLOT_PATHS = [
  OPENCODE_AUTH_PATH,
  OPENCODE_MCP_AUTH_PATH,
  OPENCODE_CONFIG_JSONC_PATH,
  OPENCODE_CONFIG_PATH,
  OPENCODE_LEGACY_CONFIG_PATH,
];

const GH_HOSTS_PATH = '/home/user/.config/gh/hosts.yml';

interface WebAuthnMockOptions {
  prfCapability?: boolean;
  includePrfOnCreate?: boolean;
  includePrfOnGet?: boolean;
}

function toBytes(value: BufferSource): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Unsupported BufferSource');
}

function cloneBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function deriveMockPrf(secret: Uint8Array, input: BufferSource): Promise<ArrayBuffer> {
  const inputBytes = toBytes(input);
  const combined = new Uint8Array(secret.length + inputBytes.length);
  combined.set(secret);
  combined.set(inputBytes, secret.length);
  return crypto.subtle.digest('SHA-256', combined);
}

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  });
}

function installWebAuthnMock(options: WebAuthnMockOptions = {}) {
  let stored: { credentialId: string; rawId: Uint8Array; secret: Uint8Array } | null = null;

  class MockPublicKeyCredential {}

  const capabilities = vi.fn().mockResolvedValue({ prf: options.prfCapability ?? true });
  Object.assign(MockPublicKeyCredential, {
    getClientCapabilities: capabilities,
  });

  const create = vi.fn(async ({ publicKey }: { publicKey: any }) => {
    const rawId = crypto.getRandomValues(new Uint8Array(16));
    const credentialId = bufferToBase64URLString(rawId.buffer);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    stored = { credentialId, rawId, secret };

    const prfResult = options.includePrfOnCreate === false
      ? undefined
      : await deriveMockPrf(secret, publicKey.extensions.prf.eval.first);

    return {
      id: credentialId,
      rawId: cloneBuffer(rawId),
      type: 'public-key',
      response: {},
      getClientExtensionResults: () => prfResult
        ? { prf: { results: { first: prfResult } } }
        : {},
    } as PublicKeyCredential;
  });

  const get = vi.fn(async ({ publicKey }: { publicKey: any }) => {
    if (!stored) {
      throw new WebAuthnError('No mock passkey was registered.');
    }

    const prfRequest = publicKey.extensions.prf.evalByCredential[stored.credentialId];
    const prfResult = options.includePrfOnGet === false
      ? undefined
      : await deriveMockPrf(stored.secret, prfRequest.first);

    return {
      id: stored.credentialId,
      rawId: cloneBuffer(stored.rawId),
      type: 'public-key',
      response: {},
      getClientExtensionResults: () => prfResult
        ? { prf: { results: { first: prfResult } } }
        : {},
    } as PublicKeyCredential;
  });

  setSecureContext(true);
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: MockPublicKeyCredential,
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create, get },
  });

  return { capabilities, create, get };
}

async function flushWatcher(): Promise<void> {
  await vi.advanceTimersByTimeAsync(250);
  await Promise.resolve();
}

function createVault(vfs = new VirtualFS()): ClaudeAuthVault {
  const vault = new ClaudeAuthVault({
    vfs,
    overlayRoot: document.getElementById('overlay'),
  });
  vault.registerSlot('claude', CLAUDE_SLOT_PATHS);
  return vault;
}

function createKeychain(vfs = new VirtualFS()): Keychain {
  const kc = new Keychain({
    vfs,
    overlayRoot: document.getElementById('overlay'),
  });
  kc.registerSlot('claude', CLAUDE_SLOT_PATHS);
  kc.registerSlot('github', [GH_HOSTS_PATH]);
  kc.registerSlot('opencode', OPENCODE_SLOT_PATHS);
  return kc;
}

function writeClaudeAuth(vfs: VirtualFS, accessToken: string): string {
  const raw = JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: `refresh-${accessToken}`,
    },
  });
  vfs.writeFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, raw);
  return raw;
}

function writeClaudeConfig(vfs: VirtualFS, theme: string) {
  const nestedConfig = JSON.stringify({
    theme,
    hasCompletedOnboarding: true,
  });
  const legacyConfig = JSON.stringify({
    oauthAccount: {
      emailAddress: 'demo@example.com',
    },
    theme,
    hasCompletedOnboarding: true,
  });

  vfs.writeFileSync(CLAUDE_AUTH_CONFIG_PATH, nestedConfig);
  vfs.writeFileSync(CLAUDE_LEGACY_CONFIG_PATH, legacyConfig);

  return { nestedConfig, legacyConfig };
}

function writeGhHosts(vfs: VirtualFS, token: string): string {
  const raw = `github.com:\n  oauth_token: ${token}\n  user: testuser\n  git_protocol: https\n`;
  vfs.mkdirSync('/home/user/.config/gh', { recursive: true });
  vfs.writeFileSync(GH_HOSTS_PATH, raw);
  return raw;
}

function writeOpenCodeAuth(vfs: VirtualFS, apiKey: string): string {
  const raw = JSON.stringify({
    openai: {
      type: 'api',
      key: apiKey,
    },
  });
  vfs.mkdirSync(OPENCODE_AUTH_PATH.slice(0, OPENCODE_AUTH_PATH.lastIndexOf('/')), { recursive: true });
  vfs.writeFileSync(OPENCODE_AUTH_PATH, raw);
  return raw;
}

function writeOpenCodeConfig(vfs: VirtualFS): { json: string; jsonc: string } {
  const json = JSON.stringify({
    provider: {
      openai: {
        disabled: false,
      },
    },
  });
  const jsonc = '{\n  "provider": {\n    "openai": {\n      "disabled": false\n    }\n  }\n}\n';

  vfs.mkdirSync(OPENCODE_CONFIG_PATH.slice(0, OPENCODE_CONFIG_PATH.lastIndexOf('/')), { recursive: true });
  vfs.writeFileSync(OPENCODE_CONFIG_PATH, json);
  vfs.writeFileSync(OPENCODE_CONFIG_JSONC_PATH, jsonc);

  return { json, jsonc };
}

async function unlockStoredKeychainKey(stored: { credentialId: string; prfSalt: string }): Promise<CryptoKey> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      timeout: 60_000,
      userVerification: 'required',
      rpId: window.location.hostname,
      allowCredentials: [
        {
          id: base64URLStringToBuffer(stored.credentialId),
          type: 'public-key',
        },
      ],
      extensions: {
        prf: {
          evalByCredential: {
            [stored.credentialId]: {
              first: base64URLStringToBuffer(stored.prfSalt),
            },
          },
        },
      },
    },
  }) as PublicKeyCredential & {
    getClientExtensionResults: () => {
      prf?: {
        results?: {
          first?: ArrayBuffer;
        };
      };
    };
  };

  const prfOutput = assertion.getClientExtensionResults().prf?.results?.first;
  if (!prfOutput) {
    throw new Error('Mock authenticator did not return a PRF result.');
  }

  return deriveVaultKeyFromPrf(prfOutput, base64URLStringToBuffer(stored.prfSalt));
}

describe('ClaudeAuthVault', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="overlay"></div>';
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: globalThis.crypto,
    });
    setSecureContext(true);
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('round-trips base64url, AES-GCM, and vault payload serialization', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const encoded = bufferToBase64URLString(bytes.buffer);

    expect(Array.from(new Uint8Array(base64URLStringToBuffer(encoded)))).toEqual(Array.from(bytes));

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const encrypted = await encryptData(key, '{"claudeAiOauth":{"accessToken":"abc"}}');

    expect(await decryptData(key, encrypted.ciphertext, encrypted.iv)).toBe('{"claudeAiOauth":{"accessToken":"abc"}}');

    // v1-style compat round-trip still works
    const payload = {
      version: 1,
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
      files: [CLAUDE_AUTH_CREDENTIALS_PATH, CLAUDE_AUTH_CONFIG_PATH, CLAUDE_LEGACY_CONFIG_PATH],
      credentialId: 'credential-id',
      prfSalt: 'salt',
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      updatedAt: '2026-03-09T00:00:00.000Z',
    };

    expect(parseStoredClaudeAuthVault(serializeStoredClaudeAuthVault(payload))).toEqual(payload);
  });

  it('detects secure-context and PRF capability support', async () => {
    setSecureContext(false);
    expect(await detectWebAuthnPrfSupport()).toBe(false);

    installWebAuthnMock({ prfCapability: true });
    expect(await detectWebAuthnPrfSupport()).toBe(true);

    installWebAuthnMock({ prfCapability: false });
    expect(await detectWebAuthnPrfSupport()).toBe(false);
  });

  it('prompts to save when Claude auth appears and stores an encrypted vault payload', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const vault = createVault(vfs);

    await vault.init();
    const raw = writeClaudeAuth(vfs, 'alpha');
    writeClaudeConfig(vfs, 'dark');
    await flushWatcher();

    expect(vault.getState().bannerMode).toBe('save');
    expect(document.getElementById('almostnodeKeychainSaveButton')).toBeTruthy();

    await vault.handlePrimaryAction();

    const stored = parseStoredClaudeAuthVault(localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY));
    expect(stored?.path).toBe(CLAUDE_AUTH_CREDENTIALS_PATH);
    expect(stored?.files).toEqual([
      CLAUDE_AUTH_CREDENTIALS_PATH,
      CLAUDE_AUTH_CONFIG_PATH,
      CLAUDE_LEGACY_CONFIG_PATH,
    ]);
    expect(stored?.ciphertext).toBeTruthy();
    expect(stored?.ciphertext).not.toContain(raw);
    expect(vault.getState().hasStoredVault).toBe(true);
    expect(vault.getState().bannerMode).toBe(null);
  });

  it('suppresses repeated save prompts for dismissed unchanged credentials and re-prompts on change', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const vault = createVault(vfs);

    await vault.init();
    writeClaudeAuth(vfs, 'alpha');
    writeClaudeConfig(vfs, 'dark');
    await flushWatcher();

    expect(vault.getState().bannerMode).toBe('save');
    (document.getElementById('almostnodeKeychainDismissButton') as HTMLButtonElement | null)?.click();
    expect(vault.getState().bannerMode).toBe(null);

    writeClaudeAuth(vfs, 'alpha');
    await flushWatcher();
    expect(vault.getState().bannerMode).toBe(null);

    writeClaudeConfig(vfs, 'light');
    await flushWatcher();
    expect(vault.getState().bannerMode).toBe('save');
  });

  it('restores Claude credentials and config files together after refresh', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const initialVfs = new VirtualFS();
    const initialVault = createVault(initialVfs);

    await initialVault.init();
    const credentials = writeClaudeAuth(initialVfs, 'alpha');
    const configs = writeClaudeConfig(initialVfs, 'dark');
    await flushWatcher();
    await initialVault.handlePrimaryAction();

    const refreshedVfs = new VirtualFS();
    const refreshedVault = createVault(refreshedVfs);

    await refreshedVault.init();
    expect(refreshedVault.getState().bannerMode).toBe('unlock');

    await refreshedVault.handlePrimaryAction();

    expect(refreshedVfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, 'utf8')).toBe(credentials);
    expect(refreshedVfs.readFileSync(CLAUDE_AUTH_CONFIG_PATH, 'utf8')).toBe(configs.nestedConfig);
    expect(refreshedVfs.readFileSync(CLAUDE_LEGACY_CONFIG_PATH, 'utf8')).toBe(configs.legacyConfig);
  });

  it('silently updates the saved vault when Claude config changes while unlocked', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const liveVfs = new VirtualFS();
    const liveVault = createVault(liveVfs);

    await liveVault.init();
    writeClaudeAuth(liveVfs, 'alpha');
    writeClaudeConfig(liveVfs, 'dark');
    await flushWatcher();
    await liveVault.handlePrimaryAction();

    const updatedConfigs = writeClaudeConfig(liveVfs, 'light');
    await flushWatcher();

    const refreshedVfs = new VirtualFS();
    const refreshedVault = createVault(refreshedVfs);
    await refreshedVault.init();
    await refreshedVault.handlePrimaryAction();

    expect(refreshedVfs.readFileSync(CLAUDE_AUTH_CONFIG_PATH, 'utf8')).toBe(updatedConfigs.nestedConfig);
    expect(refreshedVfs.readFileSync(CLAUDE_LEGACY_CONFIG_PATH, 'utf8')).toBe(updatedConfigs.legacyConfig);
  });

  it('clears the saved vault on file deletion and ignores invalid JSON writes', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const vault = createVault(vfs);

    await vault.init();
    writeClaudeAuth(vfs, 'alpha');
    await flushWatcher();
    await vault.handlePrimaryAction();

    expect(localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY)).toBeTruthy();

    vfs.writeFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, '{not-json');
    await flushWatcher();
    expect(vault.getState().bannerMode).toBe(null);

    vfs.unlinkSync(CLAUDE_AUTH_CREDENTIALS_PATH);
    await flushWatcher();
    expect(localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY)).toBeNull();
    expect(vault.getState().hasStoredVault).toBe(false);
  });

  it('fails closed when PRF support is unavailable and leaves login manual', async () => {
    vi.useFakeTimers();
    installWebAuthnMock({ prfCapability: false });

    const vfs = new VirtualFS();
    const vault = createVault(vfs);

    await vault.init();
    writeClaudeAuth(vfs, 'alpha');
    await flushWatcher();

    expect(vault.getState().supported).toBe(false);
    expect(vault.getState().bannerMode).toBe(null);
    expect(localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY)).toBeNull();
  });

  it('fails closed when the authenticator does not return a PRF result', async () => {
    vi.useFakeTimers();
    installWebAuthnMock({
      prfCapability: true,
      includePrfOnCreate: false,
      includePrfOnGet: false,
    });

    const vfs = new VirtualFS();
    const vault = createVault(vfs);

    await vault.init();
    writeClaudeAuth(vfs, 'alpha');
    await flushWatcher();
    await vault.handlePrimaryAction();

    expect(localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY)).toBeNull();
    expect(vault.getState().bannerMode).toBe('save');
    expect(vault.getState().bannerMessage).toContain('PRF result');
  });
});

describe('Keychain', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="overlay"></div>';
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: globalThis.crypto,
    });
    setSecureContext(true);
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('stores v2 format with slot manifest', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);

    await kc.init();
    writeClaudeAuth(vfs, 'alpha');
    writeClaudeConfig(vfs, 'dark');
    await flushWatcher();
    await kc.handlePrimaryAction();

    const raw = localStorage.getItem(KEYCHAIN_STORAGE_KEY);
    const stored = parseStoredKeychain(raw);
    expect(stored).toBeTruthy();
    expect(stored!.version).toBe(2);
    expect(stored!.slots).toEqual([
      {
        name: 'claude',
        paths: [
          CLAUDE_AUTH_CREDENTIALS_PATH,
          CLAUDE_AUTH_CONFIG_PATH,
          CLAUDE_LEGACY_CONFIG_PATH,
        ],
      },
    ]);
  });

  it('persists GitHub token alongside Claude auth via persistCurrentState', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);

    await kc.init();
    writeClaudeAuth(vfs, 'alpha');
    writeClaudeConfig(vfs, 'dark');
    await flushWatcher();
    await kc.handlePrimaryAction();

    // Write GH hosts after keychain is unlocked
    const ghContent = writeGhHosts(vfs, 'ghp_test123');
    await kc.persistCurrentState();

    const stored = parseStoredKeychain(localStorage.getItem(KEYCHAIN_STORAGE_KEY));
    expect(stored!.slots).toEqual([
      {
        name: 'claude',
        paths: [
          CLAUDE_AUTH_CREDENTIALS_PATH,
          CLAUDE_AUTH_CONFIG_PATH,
          CLAUDE_LEGACY_CONFIG_PATH,
        ],
      },
      {
        name: 'github',
        paths: [GH_HOSTS_PATH],
      },
    ]);

    // Verify restore includes GH hosts
    const refreshedVfs = new VirtualFS();
    const refreshedKc = createKeychain(refreshedVfs);
    await refreshedKc.init();
    await refreshedKc.handlePrimaryAction();

    expect(refreshedVfs.readFileSync(GH_HOSTS_PATH, 'utf8')).toBe(ghContent);
    expect(refreshedVfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, 'utf8')).toBeTruthy();
  });

  it('persistCurrentState is a no-op when locked', async () => {
    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);
    // Don't init or unlock — just call persistCurrentState
    await kc.persistCurrentState(); // should not throw
  });

  it('hasSlotData returns true when slot files exist', async () => {
    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);

    expect(kc.hasSlotData('claude')).toBe(false);
    expect(kc.hasSlotData('github')).toBe(false);

    writeClaudeAuth(vfs, 'test');
    expect(kc.hasSlotData('claude')).toBe(true);
    expect(kc.hasSlotData('github')).toBe(false);

    writeGhHosts(vfs, 'ghp_test');
    expect(kc.hasSlotData('github')).toBe(true);
  });

  it('migrates v1 vault to v2 on first access', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    // Create a v1 vault the old way: save some data as v1 format
    const setupVfs = new VirtualFS();
    const setupVault = createVault(setupVfs);
    await setupVault.init();
    writeClaudeAuth(setupVfs, 'migrated-token');
    writeClaudeConfig(setupVfs, 'dark');
    await flushWatcher();
    await setupVault.handlePrimaryAction();

    // The vault saved in KEYCHAIN_STORAGE_KEY (v2 format via re-export shim)
    // Move it to V1_STORAGE_KEY to simulate legacy
    const v2Raw = localStorage.getItem(KEYCHAIN_STORAGE_KEY);
    expect(v2Raw).toBeTruthy();

    // Construct a proper v1 blob from the v2 data
    const v2Data = JSON.parse(v2Raw!);
    const allPaths: string[] = [];
    for (const slot of v2Data.slots) {
      for (const p of slot.paths) {
        if (!allPaths.includes(p)) allPaths.push(p);
      }
    }
    const v1Blob = JSON.stringify({
      version: 1,
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
      files: allPaths,
      credentialId: v2Data.credentialId,
      prfSalt: v2Data.prfSalt,
      iv: v2Data.iv,
      ciphertext: v2Data.ciphertext,
      updatedAt: v2Data.updatedAt,
    });

    localStorage.removeItem(KEYCHAIN_STORAGE_KEY);
    localStorage.setItem('almostnode.webide.claudeAuth.v1', v1Blob);

    // Now create a fresh keychain — it should find the v1 data and migrate
    const freshVfs = new VirtualFS();
    const freshKc = createKeychain(freshVfs);
    await freshKc.init();

    // v1 key should be gone, v2 key should exist
    expect(localStorage.getItem('almostnode.webide.claudeAuth.v1')).toBeNull();
    expect(localStorage.getItem(KEYCHAIN_STORAGE_KEY)).toBeTruthy();

    const migrated = parseStoredKeychain(localStorage.getItem(KEYCHAIN_STORAGE_KEY));
    expect(migrated!.version).toBe(2);
    expect(migrated!.slots.length).toBeGreaterThan(0);

    // Unlock should restore the files
    expect(freshKc.getState().bannerMode).toBe('unlock');
    await freshKc.handlePrimaryAction();
    expect(freshVfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, 'utf8')).toContain('migrated-token');
  });

  it('multi-slot unlock restores both Claude and GitHub data', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);
    await kc.init();

    writeClaudeAuth(vfs, 'multi-alpha');
    writeClaudeConfig(vfs, 'dark');
    const ghContent = writeGhHosts(vfs, 'ghp_multi');
    await flushWatcher();
    await kc.handlePrimaryAction();

    // Now include the GH hosts in the persisted state
    await kc.persistCurrentState();

    // Simulate page refresh
    const freshVfs = new VirtualFS();
    const freshKc = createKeychain(freshVfs);
    await freshKc.init();
    await freshKc.handlePrimaryAction();

    expect(freshVfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, 'utf8')).toContain('multi-alpha');
    expect(freshVfs.readFileSync(GH_HOSTS_PATH, 'utf8')).toBe(ghContent);
  });

  it('stores and restores OpenCode auth/config without requiring Claude files', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const vfs = new VirtualFS();
    const kc = createKeychain(vfs);
    await kc.init();

    const auth = writeOpenCodeAuth(vfs, 'sk-openai-test');
    const config = writeOpenCodeConfig(vfs);
    await flushWatcher();

    expect(kc.getState().hasLiveCredentials).toBe(true);

    await kc.handlePrimaryAction();

    const stored = parseStoredKeychain(localStorage.getItem(KEYCHAIN_STORAGE_KEY));
    expect(stored?.slots).toEqual([
      {
        name: 'opencode',
        paths: [
          OPENCODE_AUTH_PATH,
          OPENCODE_CONFIG_JSONC_PATH,
          OPENCODE_CONFIG_PATH,
        ],
      },
    ]);

    const freshVfs = new VirtualFS();
    const freshKc = createKeychain(freshVfs);
    await freshKc.init();
    expect(freshKc.getState().bannerMode).toBe('unlock');

    await freshKc.handlePrimaryAction();

    expect(freshVfs.readFileSync(OPENCODE_AUTH_PATH, 'utf8')).toBe(auth);
    expect(freshVfs.readFileSync(OPENCODE_CONFIG_PATH, 'utf8')).toBe(config.json);
    expect(freshVfs.readFileSync(OPENCODE_CONFIG_JSONC_PATH, 'utf8')).toBe(config.jsonc);
  });

  it('auto-restores saved OpenCode auth before opencode commands run', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const setupVfs = new VirtualFS();
    const setupKc = createKeychain(setupVfs);
    await setupKc.init();

    const auth = writeOpenCodeAuth(setupVfs, 'sk-openai-prepare');
    await flushWatcher();
    await setupKc.handlePrimaryAction();

    const freshVfs = new VirtualFS();
    const freshKc = createKeychain(freshVfs);
    await freshKc.init();

    expect(freshKc.getState().hasLiveCredentials).toBe(false);

    await expect(freshKc.prepareForCommand('opencode')).resolves.toBe(true);

    expect(freshVfs.readFileSync(OPENCODE_AUTH_PATH, 'utf8')).toBe(auth);
    expect(freshKc.getState().hasLiveCredentials).toBe(true);
  });

  it('drops an invalid saved payload instead of blocking opencode startup', async () => {
    vi.useFakeTimers();
    installWebAuthnMock();

    const setupVfs = new VirtualFS();
    const setupKc = createKeychain(setupVfs);
    await setupKc.init();

    writeOpenCodeAuth(setupVfs, 'sk-openai-invalid-payload');
    await flushWatcher();
    await setupKc.handlePrimaryAction();

    const stored = parseStoredKeychain(localStorage.getItem(KEYCHAIN_STORAGE_KEY));
    expect(stored).toBeTruthy();

    const key = await unlockStoredKeychainKey(stored!);
    const encrypted = await encryptData(key, JSON.stringify({ files: [] }));
    localStorage.setItem(KEYCHAIN_STORAGE_KEY, JSON.stringify({
      ...stored,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    }));

    const freshVfs = new VirtualFS();
    const freshKc = createKeychain(freshVfs);
    await freshKc.init();

    await expect(freshKc.prepareForCommand('opencode')).resolves.toBe(true);

    expect(localStorage.getItem(KEYCHAIN_STORAGE_KEY)).toBeNull();
    expect(freshKc.getState().hasStoredVault).toBe(false);
    expect(freshKc.getState().hasLiveCredentials).toBe(false);
  });
});
