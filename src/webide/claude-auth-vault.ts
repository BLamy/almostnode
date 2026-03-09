import type { VirtualFS, FSWatcher } from '../virtual-fs';

export const CLAUDE_AUTH_STORAGE_KEY = 'almostnode.webide.claudeAuth.v1';
export const CLAUDE_AUTH_CREDENTIALS_PATH = '/home/user/.claude/.credentials.json';
export const CLAUDE_AUTH_CONFIG_PATH = '/home/user/.claude/.config.json';
export const CLAUDE_LEGACY_CONFIG_PATH = '/home/user/.claude.json';
const CLAUDE_AUTH_DIRECTORY = '/home/user/.claude';
const CLAUDE_AUTH_STATE_PATHS = [
  CLAUDE_AUTH_CREDENTIALS_PATH,
  CLAUDE_AUTH_CONFIG_PATH,
  CLAUDE_LEGACY_CONFIG_PATH,
] as const;
const CLAUDE_AUTH_BANNER_ID = 'almostnodeClaudeAuthBanner';
const CLAUDE_AUTH_STYLE_ID = 'almostnodeClaudeAuthBannerStyles';
const CLAUDE_AUTH_WATCH_DEBOUNCE_MS = 150;
const CLAUDE_AUTH_PRF_INFO = 'almostnode claude auth vault';
const CLAUDE_AUTH_VERSION = 1;

type BannerMode = 'save' | 'unlock' | null;
type SupportState = 'unknown' | 'supported' | 'unsupported';

type AuthFileInspection =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'withoutAuth' }
  | { kind: 'valid'; rawText: string };

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

interface ClaudeStateSnapshotEntry {
  path: string;
  rawText: string;
}

interface ClaudeStateSnapshotPayload {
  files: ClaudeStateSnapshotEntry[];
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

export interface ClaudeAuthVaultState {
  supported: boolean;
  hasStoredVault: boolean;
  hasUnlockedKey: boolean;
  hasLiveCredentials: boolean;
  bannerMode: BannerMode;
  bannerMessage: string | null;
  busy: boolean;
  path: string;
}

export interface ClaudeAuthVaultOptions {
  vfs: VirtualFS;
  overlayRoot?: HTMLElement | null;
  onStateChange?: (state: ClaudeAuthVaultState) => void;
}

export class WebAuthnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

export function serializeStoredClaudeAuthVault(vault: StoredClaudeAuthVault): string {
  return JSON.stringify(vault);
}

export function parseStoredClaudeAuthVault(raw: string | null): StoredClaudeAuthVault | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredClaudeAuthVault;
    if (
      parsed
      && typeof parsed === 'object'
      && parsed.version === CLAUDE_AUTH_VERSION
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
      info: new TextEncoder().encode(CLAUDE_AUTH_PRF_INFO),
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
      name: 'almostnode Claude Auth Vault',
      id: window.location.hostname,
    },
    user: {
      id: userId,
      name: 'claude-auth@almostnode.local',
      displayName: 'almostnode Claude Auth',
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

function isClaudeStatePath(path: string): boolean {
  return (CLAUDE_AUTH_STATE_PATHS as readonly string[]).includes(path);
}

function getStoredVaultPaths(vault: StoredClaudeAuthVault): string[] {
  const paths = vault.files && vault.files.length > 0
    ? vault.files
    : [vault.path];
  return Array.from(new Set(paths.filter(isClaudeStatePath)));
}

function readClaudeStateSnapshot(vfs: VirtualFS): ClaudeStateSnapshotEntry[] {
  const files: ClaudeStateSnapshotEntry[] = [];

  for (const path of CLAUDE_AUTH_STATE_PATHS) {
    if (!vfs.existsSync(path)) {
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
      throw new WebAuthnError(`Unable to read Claude state file ${path}: ${message}`);
    }
  }

  return files;
}

function serializeClaudeStateSnapshot(files: ClaudeStateSnapshotEntry[]): string {
  return JSON.stringify({ files } satisfies ClaudeStateSnapshotPayload);
}

function parseClaudeStateSnapshotPayload(rawText: string): ClaudeStateSnapshotEntry[] {
  const parsed = JSON.parse(rawText) as Record<string, unknown>;

  if (parsed && Array.isArray(parsed.files)) {
    const files = parsed.files
      .filter((entry): entry is ClaudeStateSnapshotEntry => {
        return Boolean(
          entry
          && typeof entry === 'object'
          && typeof (entry as { path?: unknown }).path === 'string'
          && typeof (entry as { rawText?: unknown }).rawText === 'string'
          && isClaudeStatePath((entry as { path: string }).path),
        );
      })
      .map((entry) => ({
        path: entry.path,
        rawText: entry.rawText,
      }));

    if (files.length > 0) {
      return files;
    }
  }

  if (parsed && typeof parsed === 'object' && parsed.claudeAiOauth) {
    return [{
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
      rawText,
    }];
  }

  throw new WebAuthnError('The saved Claude auth payload is invalid.');
}

function hasRestoredClaudeState(vfs: VirtualFS, vault: StoredClaudeAuthVault): boolean {
  const paths = getStoredVaultPaths(vault);
  if (!paths.includes(CLAUDE_AUTH_CREDENTIALS_PATH)) {
    return false;
  }

  const credentials = inspectCredentialsFile(vfs);
  if (credentials.kind !== 'valid') {
    return false;
  }

  return paths.every((path) => {
    if (path === CLAUDE_AUTH_CREDENTIALS_PATH) {
      return true;
    }
    try {
      return vfs.existsSync(path) && vfs.statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

function normalizeClaudeLaunchSegment(segment: string): string {
  let normalized = segment.trim();

  while (normalized) {
    const withoutEnvAssignments = normalized.replace(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/,
      '',
    );
    if (withoutEnvAssignments !== normalized) {
      normalized = withoutEnvAssignments.trimStart();
      continue;
    }

    const withoutPrefix = normalized.replace(/^(?:env|command|time)\s+/, '');
    if (withoutPrefix !== normalized) {
      normalized = withoutPrefix.trimStart();
      continue;
    }

    break;
  }

  return normalized;
}

function matchesClaudeLaunchSegment(segment: string): boolean {
  const trimmed = normalizeClaudeLaunchSegment(segment);
  if (!trimmed) {
    return false;
  }

  if (/^(?:\.\/)?(?:node_modules\/\.bin\/)?claude(?:\s|$)/.test(trimmed)) {
    return true;
  }
  if (/^npx(?:\s+[-\w=]+)*(?:\s+@anthropic-ai\/claude-code|\s+claude)(?:\s|$)/.test(trimmed)) {
    return true;
  }
  if (/^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+@anthropic-ai\/claude-code|\s+claude)(?:\s|$)/.test(trimmed)) {
    return true;
  }

  return false;
}

function matchesClaudeLaunchCommand(command: string): boolean {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .some((segment) => matchesClaudeLaunchSegment(segment));
}

function ensureBannerStyles(): void {
  if (document.getElementById(CLAUDE_AUTH_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = CLAUDE_AUTH_STYLE_ID;
  style.textContent = `
    #${CLAUDE_AUTH_BANNER_ID} {
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

    #${CLAUDE_AUTH_BANNER_ID}[hidden] {
      display: none;
    }

    #${CLAUDE_AUTH_BANNER_ID} .almostnode-claude-auth-banner__body {
      display: grid;
      gap: 0.55rem;
      padding: 0.85rem 0.95rem 0.95rem;
    }

    #${CLAUDE_AUTH_BANNER_ID} .almostnode-claude-auth-banner__eyebrow {
      font: 600 0.72rem/1.2 "IBM Plex Mono", monospace;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #ff7a59;
    }

    #${CLAUDE_AUTH_BANNER_ID} .almostnode-claude-auth-banner__message {
      font: 500 0.84rem/1.45 "Instrument Sans", system-ui, sans-serif;
      color: rgba(230, 237, 247, 0.96);
      margin: 0;
    }

    #${CLAUDE_AUTH_BANNER_ID} .almostnode-claude-auth-banner__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }

    #${CLAUDE_AUTH_BANNER_ID} button {
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

    #${CLAUDE_AUTH_BANNER_ID} button:hover:not(:disabled) {
      border-color: rgba(255, 122, 89, 0.45);
      background: rgba(255, 122, 89, 0.12);
    }

    #${CLAUDE_AUTH_BANNER_ID} button[data-primary="true"] {
      border-color: rgba(255, 122, 89, 0.55);
      background: rgba(255, 122, 89, 0.18);
      color: #fff3ee;
    }

    #${CLAUDE_AUTH_BANNER_ID} button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  `;

  document.head.appendChild(style);
}

export class ClaudeAuthVault {
  private readonly vfs: VirtualFS;
  private readonly overlayRoot: HTMLElement | null;
  private readonly onStateChange?: (state: ClaudeAuthVaultState) => void;
  private watchers: FSWatcher[] = [];
  private pendingHandle = 0;
  private unlockedKey: CryptoKey | null = null;
  private bannerMode: BannerMode = null;
  private bannerMessage: string | null = null;
  private busy = false;
  private ignoredWrite = false;
  private dismissedSaveDigest: string | null = null;
  private supportState: SupportState = 'unknown';

  constructor(options: ClaudeAuthVaultOptions) {
    this.vfs = options.vfs;
    this.overlayRoot = options.overlayRoot ?? null;
    this.onStateChange = options.onStateChange;
  }

  async init(): Promise<void> {
    ensureBannerStyles();
    this.ensureBannerElement();
    await this.detectSupport();
    this.watchers.push(this.vfs.watch(CLAUDE_AUTH_DIRECTORY, { recursive: true }, (_eventType, filename) => {
      const path = filename?.startsWith('/')
        ? filename
        : `${CLAUDE_AUTH_DIRECTORY}/${filename || ''}`.replace(/\/+$/g, '');
      if (!filename || isClaudeStatePath(path)) {
        this.scheduleCredentialsInspection();
      }
    }));
    this.watchers.push(this.vfs.watch(CLAUDE_LEGACY_CONFIG_PATH, () => {
      this.scheduleCredentialsInspection();
    }));
    this.updateBannerForCurrentState();
  }

  async prepareForCommand(command: string): Promise<boolean> {
    if (!matchesClaudeLaunchCommand(command)) {
      return true;
    }

    if (!await this.detectSupport()) {
      return true;
    }

    const stored = this.getStoredVault();
    if (!stored) {
      return true;
    }

    const inspection = inspectCredentialsFile(this.vfs);
    if (inspection.kind === 'valid' && hasRestoredClaudeState(this.vfs, stored)) {
      return true;
    }

    try {
      await this.restoreSavedCredentials();
      return true;
    } catch (error) {
      this.showUnlockBanner(this.toUserFacingError(error));
      return false;
    }
  }

  async handlePrimaryAction(): Promise<void> {
    if (!await this.detectSupport()) {
      const message = 'This browser does not support the WebAuthn PRF extension.';
      if (this.getStoredVault()) {
        this.showUnlockBanner(message);
      } else {
        this.showSaveBanner(message);
      }
      return;
    }

    if (this.getStoredVault()) {
      await this.runBusyAction(async () => {
        await this.restoreSavedCredentials();
        this.hideBanner();
      }, (error) => {
        this.showUnlockBanner(this.toUserFacingError(error));
      });
      return;
    }

    const inspection = inspectCredentialsFile(this.vfs);
    if (inspection.kind !== 'valid') {
      this.showSaveBanner('No Claude auth file is available to save yet.');
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

  getState(): ClaudeAuthVaultState {
    return {
      supported: this.supportState === 'supported',
      hasStoredVault: Boolean(this.getStoredVault()),
      hasUnlockedKey: this.unlockedKey !== null,
      hasLiveCredentials: inspectCredentialsFile(this.vfs).kind === 'valid',
      bannerMode: this.bannerMode,
      bannerMessage: this.bannerMessage,
      busy: this.busy,
      path: CLAUDE_AUTH_CREDENTIALS_PATH,
    };
  }

  private scheduleCredentialsInspection(): void {
    window.clearTimeout(this.pendingHandle);
    this.pendingHandle = window.setTimeout(() => {
      void this.handleCredentialsChange();
    }, CLAUDE_AUTH_WATCH_DEBOUNCE_MS);
  }

  private async handleCredentialsChange(): Promise<void> {
    if (this.ignoredWrite) {
      return;
    }

    if (!await this.detectSupport()) {
      this.hideBanner();
      return;
    }

    const inspection = inspectCredentialsFile(this.vfs);
    if (inspection.kind === 'missing' || inspection.kind === 'withoutAuth') {
      if (this.getStoredVault()) {
        this.clearStoredVault();
      } else {
        this.hideBanner();
      }
      return;
    }

    if (inspection.kind === 'invalid') {
      this.emitState();
      return;
    }

    const rawSnapshot = serializeClaudeStateSnapshot(readClaudeStateSnapshot(this.vfs));

    if (this.getStoredVault() && this.unlockedKey) {
      try {
        await this.persistCredentialsPayload(rawSnapshot, this.unlockedKey);
        this.hideBanner();
      } catch (error) {
        this.showSaveBanner(this.toUserFacingError(error));
      }
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
    const rawSnapshot = serializeClaudeStateSnapshot(readClaudeStateSnapshot(this.vfs));
    const snapshotPaths = readClaudeStateSnapshot(this.vfs).map((entry) => entry.path);

    if (!key) {
      if (existing) {
        key = await unlockVaultKey(existing.credentialId, base64URLStringToBuffer(existing.prfSalt));
      } else {
        const prfSalt = crypto.getRandomValues(new Uint8Array(32)).buffer;
        const registration = await registerVaultCredential(prfSalt);
        const encrypted = await encryptData(registration.key, rawSnapshot);
        this.storeVault({
          version: CLAUDE_AUTH_VERSION,
          path: CLAUDE_AUTH_CREDENTIALS_PATH,
          files: snapshotPaths,
          credentialId: registration.credentialId,
          prfSalt: bufferToBase64URLString(prfSalt),
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          updatedAt: new Date().toISOString(),
        });
        this.unlockedKey = registration.key;
        this.dismissedSaveDigest = null;
        this.emitState();
        return;
      }
    }

    if (!key) {
      throw new WebAuthnError('Unable to derive a passkey-backed vault key.');
    }

    this.unlockedKey = key;
    await this.persistCredentialsPayload(rawSnapshot, key, snapshotPaths);
    this.dismissedSaveDigest = null;
  }

  private async persistCredentialsPayload(rawText: string, key: CryptoKey, paths = readClaudeStateSnapshot(this.vfs).map((entry) => entry.path)): Promise<void> {
    const existing = this.getStoredVault();
    if (!existing) {
      throw new WebAuthnError('No saved Claude auth vault is available to update.');
    }

    const encrypted = await encryptData(key, rawText);
    this.storeVault({
      ...existing,
      files: paths,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      updatedAt: new Date().toISOString(),
    });
    this.emitState();
  }

  private async restoreSavedCredentials(): Promise<void> {
    const stored = this.getStoredVault();
    if (!stored) {
      throw new WebAuthnError('No saved Claude auth vault was found for this browser.');
    }

    const key = this.unlockedKey ?? await unlockVaultKey(stored.credentialId, base64URLStringToBuffer(stored.prfSalt));
    const decrypted = await decryptData(key, stored.ciphertext, stored.iv);
    const snapshot = parseClaudeStateSnapshotPayload(decrypted);
    if (!snapshot.some((entry) => entry.path === CLAUDE_AUTH_CREDENTIALS_PATH)) {
      throw new WebAuthnError('The saved Claude auth payload is missing credentials.');
    }

    this.ignoredWrite = true;
    try {
      this.vfs.mkdirSync(CLAUDE_AUTH_DIRECTORY, { recursive: true });
      for (const entry of snapshot) {
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
    this.emitState();
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
      ? 'Claude auth changed. Update the saved passkey-protected copy?'
      : 'Claude auth detected. Save this sign-in for this browser?');
    this.renderBanner();
    this.emitState();
  }

  private showUnlockBanner(message?: string): void {
    this.bannerMode = 'unlock';
    this.bannerMessage = message || 'Saved Claude auth is available for this browser.';
    this.renderBanner();
    this.emitState();
  }

  private hideBanner(): void {
    this.bannerMode = null;
    this.bannerMessage = null;
    this.renderBanner();
    this.emitState();
  }

  private handleDismiss(): void {
    if (this.bannerMode === 'save') {
      const inspection = inspectCredentialsFile(this.vfs);
      if (inspection.kind === 'valid') {
        this.dismissedSaveDigest = serializeClaudeStateSnapshot(readClaudeStateSnapshot(this.vfs));
      }
    }
    this.hideBanner();
  }

  private handleForget(): void {
    this.clearStoredVault();
    this.hideBanner();
  }

  private updateBannerForCurrentState(): void {
    if (this.supportState !== 'supported') {
      this.hideBanner();
      return;
    }

    const stored = this.getStoredVault();
    if (stored && !hasRestoredClaudeState(this.vfs, stored)) {
      this.showUnlockBanner();
      return;
    }
    this.hideBanner();
  }

  private storeVault(vault: StoredClaudeAuthVault): void {
    localStorage.setItem(CLAUDE_AUTH_STORAGE_KEY, serializeStoredClaudeAuthVault(vault));
  }

  private clearStoredVault(): void {
    localStorage.removeItem(CLAUDE_AUTH_STORAGE_KEY);
    this.unlockedKey = null;
    this.emitState();
  }

  private getStoredVault(): StoredClaudeAuthVault | null {
    const raw = localStorage.getItem(CLAUDE_AUTH_STORAGE_KEY);
    const parsed = parseStoredClaudeAuthVault(raw);
    if (parsed) {
      return parsed;
    }

    if (raw) {
      localStorage.removeItem(CLAUDE_AUTH_STORAGE_KEY);
    }
    return null;
  }

  private ensureBannerElement(): HTMLElement {
    let banner = document.getElementById(CLAUDE_AUTH_BANNER_ID) as HTMLDivElement | null;
    if (banner) {
      return banner;
    }

    banner = document.createElement('div');
    banner.id = CLAUDE_AUTH_BANNER_ID;
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
    body.className = 'almostnode-claude-auth-banner__body';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'almostnode-claude-auth-banner__eyebrow';
    eyebrow.textContent = this.bannerMode === 'save' ? 'Claude Auth Detected' : 'Claude Auth Available';
    body.appendChild(eyebrow);

    const message = document.createElement('p');
    message.className = 'almostnode-claude-auth-banner__message';
    message.textContent = this.bannerMessage || '';
    body.appendChild(message);

    const actionRow = document.createElement('div');
    actionRow.className = 'almostnode-claude-auth-banner__actions';

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
      button.id = 'almostnodeClaudeAuthSaveButton';
      button.addEventListener('click', () => {
        void this.handlePrimaryAction();
      });
      return button;
    }

    if (config.action === 'unlock') {
      button.id = 'almostnodeClaudeAuthUnlockButton';
      button.addEventListener('click', () => {
        void this.handlePrimaryAction();
      });
      return button;
    }

    if (config.action === 'forget') {
      button.id = 'almostnodeClaudeAuthForgetButton';
      button.addEventListener('click', () => {
        this.handleForget();
      });
      return button;
    }

    button.id = 'almostnodeClaudeAuthDismissButton';
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
    return 'An unexpected Claude auth error occurred.';
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
