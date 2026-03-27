import type { VirtualFS, FSWatcher } from 'almostnode';
import {
  parseStoredTailscaleSessionSnapshot,
  readStoredTailscaleSessionSnapshot,
  serializeTailscaleSessionSnapshot,
  writeStoredTailscaleSessionSnapshot,
} from './network-session';
export const CLAUDE_AUTH_CREDENTIALS_PATH = '/home/user/.claude/.credentials.json';
export const CLAUDE_AUTH_CONFIG_PATH = '/home/user/.claude/.config.json';
export const CLAUDE_LEGACY_CONFIG_PATH = '/home/user/.claude.json';
export const TAILSCALE_SESSION_KEYCHAIN_PATH = '/__almostnode/keychain/tailscale-session.json';
const OPENCODE_DATA_ROOT = '/opencode/data/opencode';
const OPENCODE_CONFIG_ROOT = '/opencode/config/opencode';
const LEGACY_OPENCODE_AUTH_PATH = '/opencode/data/auth.json';
const LEGACY_OPENCODE_MCP_AUTH_PATH = '/opencode/data/mcp-auth.json';
const LEGACY_OPENCODE_CONFIG_PATH = '/opencode/config/opencode.json';
const LEGACY_OPENCODE_CONFIG_JSONC_PATH = '/opencode/config/opencode.jsonc';
const LEGACY_OPENCODE_LEGACY_CONFIG_PATH = '/opencode/config/config.json';

export const OPENCODE_AUTH_PATH = `${OPENCODE_DATA_ROOT}/auth.json`;
export const OPENCODE_MCP_AUTH_PATH = `${OPENCODE_DATA_ROOT}/mcp-auth.json`;
export const OPENCODE_CONFIG_PATH = `${OPENCODE_CONFIG_ROOT}/opencode.json`;
export const OPENCODE_CONFIG_JSONC_PATH = `${OPENCODE_CONFIG_ROOT}/opencode.jsonc`;
export const OPENCODE_LEGACY_CONFIG_PATH = `${OPENCODE_CONFIG_ROOT}/config.json`;

const OPENCODE_PATH_ALIASES: Record<string, string> = {
  [LEGACY_OPENCODE_AUTH_PATH]: OPENCODE_AUTH_PATH,
  [LEGACY_OPENCODE_MCP_AUTH_PATH]: OPENCODE_MCP_AUTH_PATH,
  [LEGACY_OPENCODE_CONFIG_PATH]: OPENCODE_CONFIG_PATH,
  [LEGACY_OPENCODE_CONFIG_JSONC_PATH]: OPENCODE_CONFIG_JSONC_PATH,
  [LEGACY_OPENCODE_LEGACY_CONFIG_PATH]: OPENCODE_LEGACY_CONFIG_PATH,
};

const V1_STORAGE_KEY = 'almostnode.webide.claudeAuth.v1';
export const KEYCHAIN_STORAGE_KEY = 'almostnode.webide.keychain.v2';
const KEYCHAIN_VERSION = 2;
const V1_VERSION = 1;

const KEYCHAIN_BANNER_ID = 'almostnodeKeychainBanner';
const KEYCHAIN_STYLE_ID = 'almostnodeKeychainBannerStyles';
const KEYCHAIN_WATCH_DEBOUNCE_MS = 150;
const KEYCHAIN_PRF_INFO = 'almostnode claude auth vault';
const INVALID_STORED_PAYLOAD_MESSAGE = 'The saved credentials payload is invalid.';

type BannerMode = 'save' | 'unlock' | null;
type UnlockIntent = 'restore' | 'persist';
type SupportState = 'unknown' | 'supported' | 'unsupported';

type AuthFileInspection =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'withoutAuth' }
  | { kind: 'valid'; rawText: string };

export interface StoredKeychain {
  version: number;
  slots: { name: string; paths: string[] }[];
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

interface SnapshotEntry {
  path: string;
  rawText: string;
}

interface SnapshotPayload {
  files: SnapshotEntry[];
}

interface ManagedSnapshotState {
  files: SnapshotEntry[];
  hasInvalidClaudeCredentials: boolean;
}

interface BannerAction {
  action: 'save' | 'unlock' | 'forget' | 'dismiss';
  label: string;
  primary?: boolean;
}

type PublicKeyCredentialWithExtensions = PublicKeyCredential & {
  getClientExtensionResults: () => AuthenticationExtensionsClientOutputs & {
    prf?: {
      enabled?: boolean;
      results?: {
        first?: ArrayBuffer | ArrayBufferView;
        second?: ArrayBuffer | ArrayBufferView;
      };
    };
  };
};

interface PrfInputValue {
  first: BufferSource;
  second?: BufferSource;
}

interface PublicKeyCredentialCreationOptionsWithPrf extends PublicKeyCredentialCreationOptions {
  extensions?: AuthenticationExtensionsClientInputs & {
    prf?: {
      eval?: PrfInputValue;
    };
  };
}

interface PublicKeyCredentialRequestOptionsWithPrf extends PublicKeyCredentialRequestOptions {
  extensions?: AuthenticationExtensionsClientInputs & {
    prf?: {
      evalByCredential?: Record<string, PrfInputValue>;
    };
  };
}

declare global {
  interface PublicKeyCredentialConstructor {
    getClientCapabilities?: () => Promise<Record<string, boolean>>;
  }
}

export interface KeychainState {
  supported: boolean;
  hasStoredVault: boolean;
  hasUnlockedKey: boolean;
  hasLiveCredentials: boolean;
  bannerMode: BannerMode;
  bannerMessage: string | null;
  busy: boolean;
  path: string;
}

export interface KeychainOptions {
  vfs: VirtualFS;
  overlayRoot?: HTMLElement | null;
  onStateChange?: (state: KeychainState) => void;
}

export class WebAuthnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

export function bufferToBase64URLString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64URLStringToBuffer(base64URLString: string): ArrayBuffer {
  const base64 = base64URLString
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function encryptData(key: CryptoKey, data: string): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(data);
  const encryptedData = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encodedData,
  );

  return {
    iv: bufferToBase64URLString(iv.buffer),
    ciphertext: bufferToBase64URLString(encryptedData),
  };
}

export async function decryptData(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(base64URLStringToBuffer(iv)),
    },
    key,
    new Uint8Array(base64URLStringToBuffer(ciphertext)),
  );

  return new TextDecoder().decode(decryptedData);
}

export async function deriveVaultKeyFromPrf(prfOutput: ArrayBuffer, prfSalt: ArrayBuffer): Promise<CryptoKey> {
  const prfBytes = new Uint8Array(prfOutput);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfBytes,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(prfSalt),
      info: new TextEncoder().encode(KEYCHAIN_PRF_INFO),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function isCredentialLike(value: unknown): value is PublicKeyCredentialWithExtensions {
  const rawId = value && typeof value === 'object'
    ? (value as { rawId?: unknown }).rawId
    : null;

  return Boolean(
    value
    && typeof value === 'object'
    && 'rawId' in value
    && rawId
    && typeof rawId === 'object'
    && 'byteLength' in rawId
    && typeof (rawId as { byteLength?: unknown }).byteLength === 'number',
  );
}

function toArrayBuffer(value: ArrayBuffer | ArrayBufferView | undefined): ArrayBuffer | null {
  if (!value) {
    return null;
  }
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  if (typeof value === 'object' && 'byteLength' in value && typeof value.byteLength === 'number') {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value));
    return copy.buffer;
  }
  return null;
}

function getPrfResult(credential: PublicKeyCredentialWithExtensions): ArrayBuffer | null {
  const extensionResults = credential.getClientExtensionResults?.();
  return toArrayBuffer(extensionResults?.prf?.results?.first);
}

async function ensureWebAuthnSupport(): Promise<void> {
  if (!window.isSecureContext) {
    throw new WebAuthnError('WebAuthn PRF requires a secure context.');
  }
  if (typeof window.PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new WebAuthnError('WebAuthn is not supported in this browser.');
  }

  const capabilities = window.PublicKeyCredential.getClientCapabilities;
  if (typeof capabilities === 'function') {
    try {
      const result = await capabilities.call(window.PublicKeyCredential);
      if (result.prf === false) {
        throw new WebAuthnError('This browser does not support the WebAuthn PRF extension.');
      }
    } catch (error) {
      if (error instanceof WebAuthnError) {
        throw error;
      }
    }
  }
}

export async function detectWebAuthnPrfSupport(): Promise<boolean> {
  try {
    await ensureWebAuthnSupport();
    return true;
  } catch {
    return false;
  }
}

async function registerVaultCredential(prfSalt: ArrayBuffer): Promise<{ credentialId: string; key: CryptoKey }> {
  await ensureWebAuthnSupport();

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const createOptions: PublicKeyCredentialCreationOptionsWithPrf = {
    challenge,
    rp: {
      name: 'almostnode Keychain',
      id: window.location.hostname,
    },
    user: {
      id: userId,
      name: 'keychain@almostnode.local',
      displayName: 'almostnode Keychain',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
    },
    extensions: {
      prf: {
        eval: {
          first: prfSalt,
        },
      },
    },
  };

  const created = await navigator.credentials.create({
    publicKey: createOptions,
  });

  if (!isCredentialLike(created)) {
    throw new WebAuthnError('Passkey registration did not return a public-key credential.');
  }

  const credentialId = bufferToBase64URLString(created.rawId);
  const prfResult = getPrfResult(created);
  const key = prfResult
    ? await deriveVaultKeyFromPrf(prfResult, prfSalt)
    : await unlockVaultKey(credentialId, prfSalt);

  return { credentialId, key };
}

async function unlockVaultKey(credentialId: string, prfSalt: ArrayBuffer): Promise<CryptoKey> {
  await ensureWebAuthnSupport();

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const requestOptions: PublicKeyCredentialRequestOptionsWithPrf = {
    challenge,
    timeout: 60000,
    userVerification: 'required',
    rpId: window.location.hostname,
    allowCredentials: [
      {
        id: base64URLStringToBuffer(credentialId),
        type: 'public-key',
      },
    ],
    extensions: {
      prf: {
        evalByCredential: {
          [credentialId]: {
            first: prfSalt,
          },
        },
      },
    },
  };

  const assertion = await navigator.credentials.get({
    publicKey: requestOptions,
  });

  if (!isCredentialLike(assertion)) {
    throw new WebAuthnError('Passkey authentication did not return a public-key credential.');
  }

  const prfResult = getPrfResult(assertion);
  if (!prfResult) {
    throw new WebAuthnError('This authenticator did not return a PRF result.');
  }

  return deriveVaultKeyFromPrf(prfResult, prfSalt);
}

function inspectCredentialsFile(vfs: VirtualFS): AuthFileInspection {
  if (!vfs.existsSync(CLAUDE_AUTH_CREDENTIALS_PATH)) {
    return { kind: 'missing' };
  }

  let rawText = '';
  try {
    rawText = vfs.readFileSync(CLAUDE_AUTH_CREDENTIALS_PATH, 'utf8');
  } catch {
    return { kind: 'invalid' };
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && parsed.claudeAiOauth) {
      return { kind: 'valid', rawText };
    }
    return { kind: 'withoutAuth' };
  } catch {
    return { kind: 'invalid' };
  }
}

function readManagedSnapshotState(vfs: VirtualFS, managedPaths: string[]): ManagedSnapshotState {
  const files: SnapshotEntry[] = [];
  let hasInvalidClaudeCredentials = false;

  for (const path of managedPaths) {
    if (path === TAILSCALE_SESSION_KEYCHAIN_PATH) {
      const snapshot = readStoredTailscaleSessionSnapshot();
      if (snapshot) {
        files.push({
          path,
          rawText: serializeTailscaleSessionSnapshot(snapshot),
        });
      }
      continue;
    }

    if (!vfs.existsSync(path)) {
      continue;
    }

    if (path === CLAUDE_AUTH_CREDENTIALS_PATH) {
      const inspection = inspectCredentialsFile(vfs);
      if (inspection.kind === 'valid') {
        files.push({
          path,
          rawText: inspection.rawText,
        });
        continue;
      }

      if (inspection.kind === 'invalid') {
        hasInvalidClaudeCredentials = true;
      }
      continue;
    }

    try {
      if (!vfs.statSync(path).isFile()) {
        continue;
      }
      files.push({
        path,
        rawText: vfs.readFileSync(path, 'utf8'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WebAuthnError(`Unable to read managed file ${path}: ${message}`);
    }
  }

  return {
    files,
    hasInvalidClaudeCredentials,
  };
}

function ensureBannerStyles(): void {
  if (document.getElementById(KEYCHAIN_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = KEYCHAIN_STYLE_ID;
  style.textContent = `
    #${KEYCHAIN_BANNER_ID} {
      position: fixed;
      top: 1.1rem;
      right: 1.1rem;
      z-index: 10000;
      width: min(24rem, calc(100vw - 2rem));
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0.9rem;
      background: linear-gradient(180deg, rgba(12, 19, 29, 0.98), rgba(8, 14, 22, 0.98));
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
      color: #e6edf7;
      overflow: hidden;
      backdrop-filter: blur(18px);
    }

    #${KEYCHAIN_BANNER_ID}[hidden] {
      display: none;
    }

    #${KEYCHAIN_BANNER_ID} .almostnode-keychain-banner__body {
      display: grid;
      gap: 0.55rem;
      padding: 0.85rem 0.95rem 0.95rem;
    }

    #${KEYCHAIN_BANNER_ID} .almostnode-keychain-banner__eyebrow {
      font: 600 0.72rem/1.2 "IBM Plex Mono", monospace;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #ff7a59;
    }

    #${KEYCHAIN_BANNER_ID} .almostnode-keychain-banner__message {
      font: 500 0.84rem/1.45 "Instrument Sans", system-ui, sans-serif;
      color: rgba(230, 237, 247, 0.96);
      margin: 0;
    }

    #${KEYCHAIN_BANNER_ID} .almostnode-keychain-banner__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    #${KEYCHAIN_BANNER_ID} button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      color: inherit;
      font: 600 0.74rem/1 "Instrument Sans", system-ui, sans-serif;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }

    #${KEYCHAIN_BANNER_ID} button:hover:not(:disabled) {
      border-color: rgba(255, 122, 89, 0.45);
      background: rgba(255, 122, 89, 0.12);
    }

    #${KEYCHAIN_BANNER_ID} button[data-primary="true"] {
      border-color: rgba(255, 122, 89, 0.55);
      background: rgba(255, 122, 89, 0.18);
      color: #fff3ee;
    }

    #${KEYCHAIN_BANNER_ID} button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  `;

  document.head.appendChild(style);
}

// ── v1 compat types ─────────────────────────────────────────────────────────

interface StoredV1Vault {
  version: number;
  path: string;
  files?: string[];
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

function parseV1Vault(raw: string | null): StoredV1Vault | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredV1Vault;
    if (
      parsed
      && typeof parsed === 'object'
      && parsed.version === V1_VERSION
      && parsed.path === CLAUDE_AUTH_CREDENTIALS_PATH
      && (parsed.files === undefined || (
        Array.isArray(parsed.files)
        && parsed.files.every((entry) => typeof entry === 'string')
      ))
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

// ── Keychain ─────────────────────────────────────────────────────────────────

export class Keychain {
  private readonly vfs: VirtualFS;
  private readonly overlayRoot: HTMLElement | null;
  private readonly onStateChange?: (state: KeychainState) => void;
  private watchers: FSWatcher[] = [];
  private pendingHandle = 0;
  private unlockedKey: CryptoKey | null = null;
  private bannerMode: BannerMode = null;
  private bannerMessage: string | null = null;
  private busy = false;
  private ignoredWrite = false;
  private dismissedSaveDigest: string | null = null;
  private syncedSnapshotDigest: string | null = null;
  private unlockIntent: UnlockIntent = 'restore';
  private supportState: SupportState = 'unknown';
  private slots: Map<string, string[]> = new Map();

  constructor(options: KeychainOptions) {
    this.vfs = options.vfs;
    this.overlayRoot = options.overlayRoot ?? null;
    this.onStateChange = options.onStateChange;
  }

  registerSlot(name: string, paths: string[]): void {
    this.slots.set(name, [...paths]);
  }

  hasSlotData(name: string): boolean {
    const paths = this.slots.get(name);
    if (!paths) return false;
    return paths.some((path) => this.hasManagedPathData(path));
  }

  private get managedPaths(): string[] {
    const all: string[] = [];
    for (const paths of this.slots.values()) {
      for (const p of paths) {
        if (!all.includes(p)) all.push(p);
      }
    }
    return all;
  }

  private isManagedPath(path: string): boolean {
    return this.managedPaths.includes(path);
  }

  private isSyntheticManagedPath(path: string): boolean {
    return path === TAILSCALE_SESSION_KEYCHAIN_PATH;
  }

  private normalizeManagedPath(path: string): string | null {
    if (this.isManagedPath(path)) {
      return path;
    }

    const aliased = OPENCODE_PATH_ALIASES[path];
    if (aliased && this.isManagedPath(aliased)) {
      return aliased;
    }

    return null;
  }

  private hasManagedPathData(path: string): boolean {
    if (path === TAILSCALE_SESSION_KEYCHAIN_PATH) {
      return readStoredTailscaleSessionSnapshot() !== null;
    }

    if (path === CLAUDE_AUTH_CREDENTIALS_PATH) {
      return inspectCredentialsFile(this.vfs).kind === 'valid';
    }

    try {
      return this.vfs.existsSync(path) && this.vfs.statSync(path).isFile();
    } catch {
      return false;
    }
  }

  private getPrimaryManagedPath(): string {
    return this.managedPaths.find((path) => !this.isSyntheticManagedPath(path))
      ?? this.managedPaths[0]
      ?? CLAUDE_AUTH_CREDENTIALS_PATH;
  }

  async init(): Promise<void> {
    ensureBannerStyles();
    this.ensureBannerElement();
    await this.detectSupport();

    // Watch parent dirs for all managed paths
    const watchedDirs = new Set<string>();
    for (const p of this.managedPaths) {
      if (this.isSyntheticManagedPath(p)) {
        continue;
      }
      const parentDir = p.slice(0, p.lastIndexOf('/')) || '/';
      if (watchedDirs.has(parentDir)) continue;
      watchedDirs.add(parentDir);

      if (parentDir === '/') {
        // Watch individual files at root
        this.watchers.push(this.vfs.watch(p, () => {
          this.scheduleCredentialsInspection();
        }));
      } else {
        this.watchers.push(this.vfs.watch(parentDir, { recursive: true }, (_eventType, filename) => {
          const resolvedPath = filename?.startsWith('/')
            ? filename
            : `${parentDir}/${filename || ''}`.replace(/\/+$/g, '');
          if (!filename || this.isManagedPath(resolvedPath)) {
            this.scheduleCredentialsInspection();
          }
        }));
      }
    }

    // Also watch individual managed files that are directly in root or top-level
    for (const p of this.managedPaths) {
      if (this.isSyntheticManagedPath(p)) {
        continue;
      }
      const parentDir = p.slice(0, p.lastIndexOf('/')) || '/';
      if (!watchedDirs.has(parentDir) || parentDir === '/') continue;
      // The directory watcher above covers this
    }

    this.updateBannerForCurrentState();
  }

  async prepareForCommand(command: string): Promise<boolean> {
    const stored = this.getStoredVault();
    if (!stored || this.hasRestoredState(stored)) {
      return true;
    }

    const normalized = command.trim().toLowerCase();
    const shouldAutoRestore = /\b(opencode(?:-ai)?|gh|replayio|tailscale)\b/.test(normalized);
    if (!shouldAutoRestore) {
      return true;
    }

    if (!await this.detectSupport()) {
      this.showUnlockBanner('Unlock the saved keychain before running this command.', 'restore');
      return false;
    }

    let restored = true;
    let discardedInvalidVault = false;
    await this.runBusyAction(async () => {
      await this.restoreSavedCredentials();
      this.hideBanner();
    }, (error) => {
      if (this.isInvalidStoredPayloadError(error)) {
        discardedInvalidVault = true;
        this.discardInvalidStoredVault();
        return;
      }

      restored = false;
      this.showUnlockBanner(this.toUserFacingError(error), 'restore');
    });

    if (discardedInvalidVault) {
      return true;
    }

    const current = this.getStoredVault();
    if (!current) {
      return restored;
    }

    return restored && this.hasRestoredState(current);
  }

  private getManagedSnapshotState(): ManagedSnapshotState {
    return readManagedSnapshotState(this.vfs, this.managedPaths);
  }

  notifyExternalStateChanged(): void {
    this.scheduleCredentialsInspection();
  }

  async handleExternalCredentialActivation(): Promise<void> {
    const snapshot = this.getManagedSnapshotState().files;
    if (snapshot.length === 0) {
      return;
    }

    const stored = this.getStoredVault();
    const rawSnapshot = serializeSnapshot(snapshot);
    if (rawSnapshot === this.syncedSnapshotDigest) {
      this.hideBanner();
      return;
    }

    if (!await this.detectSupport()) {
      const message = 'This browser does not support the WebAuthn PRF extension.';
      if (stored) {
        this.showUnlockBanner(message, 'persist');
      } else {
        this.showSaveBanner(message);
      }
      return;
    }

    await this.runBusyAction(async () => {
      await this.saveCurrentCredentials();
      this.hideBanner();
    }, (error) => {
      if (this.isInvalidStoredPayloadError(error)) {
        this.discardInvalidStoredVault();
        return;
      }

      if (stored) {
        this.showUnlockBanner(this.toUserFacingError(error), 'persist');
      } else {
        this.showSaveBanner(this.toUserFacingError(error));
      }
    });
  }

  async handlePrimaryAction(): Promise<void> {
    if (!await this.detectSupport()) {
      const message = 'This browser does not support the WebAuthn PRF extension.';
      if (this.getStoredVault()) {
        this.showUnlockBanner(
          message,
          this.bannerMode === 'save' ? 'persist' : this.unlockIntent,
        );
      } else {
        this.showSaveBanner(message);
      }
      return;
    }

    if (this.getStoredVault()) {
      const intent = this.bannerMode === 'save' || this.unlockIntent === 'persist'
        ? 'persist'
        : 'restore';
      await this.runBusyAction(async () => {
        if (intent === 'persist') {
          await this.saveCurrentCredentials();
        } else {
          await this.restoreSavedCredentials();
        }
        this.hideBanner();
      }, (error) => {
        if (this.isInvalidStoredPayloadError(error)) {
          this.discardInvalidStoredVault();
          return;
        }

        this.showUnlockBanner(this.toUserFacingError(error), intent);
      });
      return;
    }

    const snapshot = this.getManagedSnapshotState().files;
    if (snapshot.length === 0) {
      this.showSaveBanner('No credentials are available to save yet.');
      return;
    }

    await this.runBusyAction(async () => {
      await this.saveCurrentCredentials();
      this.hideBanner();
    }, (error) => {
      this.showSaveBanner(this.toUserFacingError(error));
    });
  }

  forgetSavedVault(): void {
    this.clearStoredVault();
    this.hideBanner();
  }

  getState(): KeychainState {
    const snapshotState = this.getManagedSnapshotState();
    return {
      supported: this.supportState === 'supported',
      hasStoredVault: Boolean(this.getStoredVault()),
      hasUnlockedKey: this.unlockedKey !== null,
      hasLiveCredentials: snapshotState.files.length > 0,
      bannerMode: this.bannerMode,
      bannerMessage: this.bannerMessage,
      busy: this.busy,
      path: this.getPrimaryManagedPath(),
    };
  }

  async persistCurrentState(): Promise<void> {
    if (!this.unlockedKey || !this.getStoredVault()) {
      return;
    }

    const snapshot = this.getManagedSnapshotState().files;
    if (snapshot.length === 0) {
      return;
    }

    const rawSnapshot = serializeSnapshot(snapshot);
    const snapshotPaths = snapshot.map((entry) => entry.path);
    await this.persistPayload(rawSnapshot, this.unlockedKey, snapshotPaths);
  }

  private scheduleCredentialsInspection(): void {
    window.clearTimeout(this.pendingHandle);
    this.pendingHandle = window.setTimeout(() => {
      void this.handleCredentialsChange();
    }, KEYCHAIN_WATCH_DEBOUNCE_MS);
  }

  private async handleCredentialsChange(): Promise<void> {
    if (this.ignoredWrite) {
      return;
    }

    if (!await this.detectSupport()) {
      this.hideBanner();
      return;
    }

    const snapshotState = this.getManagedSnapshotState();
    if (snapshotState.files.length === 0) {
      if (snapshotState.hasInvalidClaudeCredentials) {
        this.emitState();
        return;
      }

      if (this.getStoredVault()) {
        this.clearStoredVault();
      } else {
        this.hideBanner();
      }
      return;
    }

    const rawSnapshot = serializeSnapshot(snapshotState.files);

    if (this.getStoredVault() && this.unlockedKey) {
      try {
        await this.persistPayload(rawSnapshot, this.unlockedKey);
        this.hideBanner();
      } catch (error) {
        this.showSaveBanner(this.toUserFacingError(error));
      }
      return;
    }

    if (this.getStoredVault()) {
      this.showUnlockBanner(
        'Unlock the saved keychain to update it with the latest credentials.',
        'persist',
      );
      return;
    }

    if (this.dismissedSaveDigest === rawSnapshot) {
      return;
    }

    this.showSaveBanner();
  }

  private async saveCurrentCredentials(): Promise<void> {
    const existing = this.getStoredVault();
    let key = this.unlockedKey;
    const snapshot = this.getManagedSnapshotState().files;
    const rawSnapshot = serializeSnapshot(snapshot);
    const snapshotPaths = snapshot.map((entry) => entry.path);

    if (!key) {
      if (existing) {
        key = await unlockVaultKey(existing.credentialId, base64URLStringToBuffer(existing.prfSalt));
      } else {
        const prfSalt = crypto.getRandomValues(new Uint8Array(32)).buffer;
        const registration = await registerVaultCredential(prfSalt);
        const encrypted = await encryptData(registration.key, rawSnapshot);
        this.storeVault({
          version: KEYCHAIN_VERSION,
          slots: this.buildSlotManifest(snapshotPaths),
          credentialId: registration.credentialId,
          prfSalt: bufferToBase64URLString(prfSalt),
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          updatedAt: new Date().toISOString(),
        });
        this.unlockedKey = registration.key;
        this.syncedSnapshotDigest = rawSnapshot;
        this.dismissedSaveDigest = null;
        this.emitState();
        return;
      }
    }

    if (!key) {
      throw new WebAuthnError('Unable to derive a passkey-backed vault key.');
    }

    this.unlockedKey = key;
    await this.persistPayload(rawSnapshot, key, snapshotPaths);
    this.dismissedSaveDigest = null;
  }

  private async persistPayload(rawText: string, key: CryptoKey, paths?: string[]): Promise<void> {
    const existing = this.getStoredVault();
    if (!existing) {
      throw new WebAuthnError('No saved credentials vault is available to update.');
    }

    const resolvedPaths = paths ?? this.readManagedSnapshot().map((entry) => entry.path);
    const encrypted = await encryptData(key, rawText);
    this.storeVault({
      ...existing,
      slots: this.buildSlotManifest(resolvedPaths),
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      updatedAt: new Date().toISOString(),
    });
    this.syncedSnapshotDigest = rawText;
    this.emitState();
  }

  private async restoreSavedCredentials(): Promise<void> {
    const stored = this.getStoredVault();
    if (!stored) {
      throw new WebAuthnError('No saved credentials vault was found for this browser.');
    }

    const key = this.unlockedKey ?? await unlockVaultKey(stored.credentialId, base64URLStringToBuffer(stored.prfSalt));
    const decrypted = await decryptData(key, stored.ciphertext, stored.iv);
    const snapshot = parseSnapshotPayload(decrypted, (p) => this.normalizeManagedPath(p));
    if (!snapshot.some((entry) => entry.path === CLAUDE_AUTH_CREDENTIALS_PATH)) {
      // Might be a keychain that only has non-Claude data — that's fine, just restore what's there
    }

    this.ignoredWrite = true;
    try {
      for (const entry of snapshot) {
        if (entry.path === TAILSCALE_SESSION_KEYCHAIN_PATH) {
          const tailscaleSnapshot = parseStoredTailscaleSessionSnapshot(entry.rawText);
          if (!tailscaleSnapshot) {
            throw new WebAuthnError(INVALID_STORED_PAYLOAD_MESSAGE);
          }
          writeStoredTailscaleSessionSnapshot(tailscaleSnapshot);
          continue;
        }

        const parentPath = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
        if (parentPath !== '/') {
          this.vfs.mkdirSync(parentPath, { recursive: true });
        }
        this.vfs.writeFileSync(entry.path, entry.rawText);
      }
    } finally {
      queueMicrotask(() => {
        this.ignoredWrite = false;
      });
    }

    this.unlockedKey = key;
    this.syncedSnapshotDigest = decrypted;
    this.emitState();
  }

  private readManagedSnapshot(): SnapshotEntry[] {
    return this.getManagedSnapshotState().files;
  }

  private buildSlotManifest(snapshotPaths: string[]): StoredKeychain['slots'] {
    const manifest: StoredKeychain['slots'] = [];
    for (const [name, registeredPaths] of this.slots) {
      const activePaths = registeredPaths.filter((p) => snapshotPaths.includes(p));
      if (activePaths.length > 0) {
        manifest.push({ name, paths: activePaths });
      }
    }
    return manifest;
  }

  private hasRestoredState(vault: StoredKeychain): boolean {
    const paths = this.getStoredVaultPaths(vault);
    if (paths.length === 0) {
      return false;
    }

    return paths.every((path) => {
      if (path === TAILSCALE_SESSION_KEYCHAIN_PATH) {
        return readStoredTailscaleSessionSnapshot() !== null;
      }
      if (path === CLAUDE_AUTH_CREDENTIALS_PATH) {
        return inspectCredentialsFile(this.vfs).kind === 'valid';
      }
      return this.hasManagedPathData(path);
    });
  }

  private getStoredVaultPaths(vault: StoredKeychain): string[] {
    const paths: string[] = [];
    for (const slot of vault.slots) {
      for (const p of slot.paths) {
        const normalized = this.normalizeManagedPath(p);
        if (normalized && !paths.includes(normalized)) {
          paths.push(normalized);
        }
      }
    }
    return paths;
  }

  private runBusyAction(action: () => Promise<void>, onError: (error: unknown) => void): Promise<void> {
    if (this.busy) {
      return Promise.resolve();
    }

    this.busy = true;
    this.renderBanner();
    this.emitState();

    return action()
      .catch((error) => {
        onError(error);
      })
      .finally(() => {
        this.busy = false;
        this.renderBanner();
        this.emitState();
      });
  }

  private showSaveBanner(message?: string): void {
    this.bannerMode = 'save';
    this.bannerMessage = message || (this.getStoredVault()
      ? 'Credentials changed. Update the saved passkey-protected copy?'
      : 'Credentials detected. Save this sign-in for this browser?');
    this.renderBanner();
    this.emitState();
  }

  private showUnlockBanner(message?: string, intent: UnlockIntent = 'restore'): void {
    this.bannerMode = 'unlock';
    this.unlockIntent = intent;
    this.bannerMessage = message || 'Saved credentials are available for this browser.';
    this.renderBanner();
    this.emitState();
  }

  private hideBanner(): void {
    this.bannerMode = null;
    this.unlockIntent = 'restore';
    this.bannerMessage = null;
    this.renderBanner();
    this.emitState();
  }

  private handleDismiss(): void {
    if (this.bannerMode === 'save') {
      const snapshot = this.getManagedSnapshotState().files;
      if (snapshot.length > 0) {
        this.dismissedSaveDigest = serializeSnapshot(snapshot);
      }
    }
    this.hideBanner();
  }

  private handleForget(): void {
    this.clearStoredVault();
    this.hideBanner();
  }

  private isInvalidStoredPayloadError(error: unknown): boolean {
    return error instanceof WebAuthnError && error.message === INVALID_STORED_PAYLOAD_MESSAGE;
  }

  private discardInvalidStoredVault(): void {
    this.clearStoredVault();
    const snapshot = this.getManagedSnapshotState().files;
    if (snapshot.length > 0) {
      this.showSaveBanner('Saved credentials were invalid and were cleared. Save the current credentials again?');
      return;
    }

    this.hideBanner();
  }

  private updateBannerForCurrentState(): void {
    if (this.supportState !== 'supported') {
      this.hideBanner();
      return;
    }

    const stored = this.getStoredVault();
    if (stored && !this.hasRestoredState(stored)) {
      this.showUnlockBanner(undefined, 'restore');
      return;
    }
    this.hideBanner();
  }

  private storeVault(vault: StoredKeychain): void {
    localStorage.setItem(KEYCHAIN_STORAGE_KEY, JSON.stringify(vault));
  }

  private clearStoredVault(): void {
    localStorage.removeItem(KEYCHAIN_STORAGE_KEY);
    this.unlockedKey = null;
    this.syncedSnapshotDigest = null;
    this.bannerMode = null;
    this.bannerMessage = null;
    this.unlockIntent = 'restore';
    this.renderBanner();
    this.emitState();
  }

  private getStoredVault(): StoredKeychain | null {
    // Try v2 first
    const raw = localStorage.getItem(KEYCHAIN_STORAGE_KEY);
    const parsed = parseStoredKeychain(raw);
    if (parsed) {
      return parsed;
    }
    if (raw) {
      localStorage.removeItem(KEYCHAIN_STORAGE_KEY);
    }

    // Try v1 migration
    return this.migrateV1ToV2();
  }

  private migrateV1ToV2(): StoredKeychain | null {
    const v1Raw = localStorage.getItem(V1_STORAGE_KEY);
    const v1 = parseV1Vault(v1Raw);
    if (!v1) return null;

    const v1Paths = v1.files && v1.files.length > 0
      ? v1.files.filter((p) => this.isManagedPath(p))
      : [v1.path].filter((p) => this.isManagedPath(p));

    const v2: StoredKeychain = {
      version: KEYCHAIN_VERSION,
      slots: v1Paths.length > 0
        ? [{ name: 'claude', paths: Array.from(new Set(v1Paths)) }]
        : [],
      credentialId: v1.credentialId,
      prfSalt: v1.prfSalt,
      iv: v1.iv,
      ciphertext: v1.ciphertext,
      updatedAt: v1.updatedAt,
    };

    localStorage.setItem(KEYCHAIN_STORAGE_KEY, JSON.stringify(v2));
    localStorage.removeItem(V1_STORAGE_KEY);
    return v2;
  }

  private ensureBannerElement(): HTMLElement {
    let banner = document.getElementById(KEYCHAIN_BANNER_ID) as HTMLDivElement | null;
    if (banner) {
      return banner;
    }

    banner = document.createElement('div');
    banner.id = KEYCHAIN_BANNER_ID;
    banner.hidden = true;
    (this.overlayRoot ?? document.body).appendChild(banner);
    return banner;
  }

  private renderBanner(): void {
    const banner = this.ensureBannerElement();
    if (!this.bannerMode) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }

    const actions: BannerAction[] = this.bannerMode === 'save'
      ? [
          { action: 'save', label: this.getStoredVault() ? 'Update with passkey' : 'Save with passkey', primary: true },
          { action: 'dismiss', label: 'Dismiss' },
        ]
      : [
          { action: 'unlock', label: 'Unlock', primary: true },
          { action: 'dismiss', label: 'Dismiss' },
          { action: 'forget', label: 'Forget' },
        ];

    banner.hidden = false;
    banner.dataset.mode = this.bannerMode;
    banner.innerHTML = '';

    const body = document.createElement('div');
    body.className = 'almostnode-keychain-banner__body';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'almostnode-keychain-banner__eyebrow';
    eyebrow.textContent = this.bannerMode === 'save' ? 'Credentials Detected' : 'Credentials Available';
    body.appendChild(eyebrow);

    const message = document.createElement('p');
    message.className = 'almostnode-keychain-banner__message';
    message.textContent = this.bannerMessage || '';
    body.appendChild(message);

    const actionRow = document.createElement('div');
    actionRow.className = 'almostnode-keychain-banner__actions';

    for (const action of actions) {
      actionRow.appendChild(this.createBannerButton(action));
    }

    body.appendChild(actionRow);
    banner.appendChild(body);
  }

  private createBannerButton(config: BannerAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = config.label;
    button.dataset.action = config.action;
    button.dataset.primary = config.primary ? 'true' : 'false';
    button.disabled = this.busy;

    if (config.action === 'save') {
      button.id = 'almostnodeKeychainSaveButton';
      button.addEventListener('click', () => {
        void this.handlePrimaryAction();
      });
      return button;
    }

    if (config.action === 'unlock') {
      button.id = 'almostnodeKeychainUnlockButton';
      button.addEventListener('click', () => {
        void this.handlePrimaryAction();
      });
      return button;
    }

    if (config.action === 'forget') {
      button.id = 'almostnodeKeychainForgetButton';
      button.addEventListener('click', () => {
        this.handleForget();
      });
      return button;
    }

    button.id = 'almostnodeKeychainDismissButton';
    button.addEventListener('click', () => {
      this.handleDismiss();
    });
    return button;
  }

  private toUserFacingError(error: unknown): string {
    if (error instanceof WebAuthnError) {
      return error.message;
    }
    if (error instanceof Error && error.name === 'NotAllowedError') {
      return 'Passkey prompt was cancelled.';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'An unexpected credentials error occurred.';
  }

  private async detectSupport(): Promise<boolean> {
    if (this.supportState === 'supported') {
      return true;
    }
    if (this.supportState === 'unsupported') {
      return false;
    }

    this.supportState = await detectWebAuthnPrfSupport() ? 'supported' : 'unsupported';
    this.emitState();
    return this.supportState === 'supported';
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeSnapshot(files: SnapshotEntry[]): string {
  return JSON.stringify({ files } satisfies SnapshotPayload);
}

function parseSnapshotPayload(rawText: string, normalizePath: (path: string) => string | null): SnapshotEntry[] {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;

  if (parsed && Array.isArray(parsed.files)) {
    const files = new Map<string, SnapshotEntry>();

    for (const entry of parsed.files) {
      if (
        !entry
        || typeof entry !== 'object'
        || typeof (entry as { path?: unknown }).path !== 'string'
        || typeof (entry as { rawText?: unknown }).rawText !== 'string'
      ) {
        continue;
      }

      const normalizedPath = normalizePath((entry as { path: string }).path);
      if (!normalizedPath) {
        continue;
      }

      files.set(normalizedPath, {
        path: normalizedPath,
        rawText: (entry as { rawText: string }).rawText,
      });
    }

    if (files.size > 0) {
      return Array.from(files.values());
    }
  }

  // Legacy format: raw credentials JSON
  if (parsed && typeof parsed === 'object' && parsed.claudeAiOauth) {
    return [{
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
      rawText,
    }];
  }

  throw new WebAuthnError(INVALID_STORED_PAYLOAD_MESSAGE);
}

export function parseStoredKeychain(raw: string | null): StoredKeychain | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredKeychain;
    if (
      parsed
      && typeof parsed === 'object'
      && parsed.version === KEYCHAIN_VERSION
      && Array.isArray(parsed.slots)
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

export function serializeStoredKeychain(vault: StoredKeychain): string {
  return JSON.stringify(vault);
}
