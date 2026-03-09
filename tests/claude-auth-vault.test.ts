/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
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
} from '../src/webide/claude-auth-vault';

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
  return new ClaudeAuthVault({
    vfs,
    overlayRoot: document.getElementById('overlay'),
  });
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
    expect(document.getElementById('almostnodeClaudeAuthSaveButton')).toBeTruthy();

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
    (document.getElementById('almostnodeClaudeAuthDismissButton') as HTMLButtonElement | null)?.click();
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
