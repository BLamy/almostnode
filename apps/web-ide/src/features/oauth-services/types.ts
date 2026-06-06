/**
 * Shared types for the user-configurable OAuth services feature.
 *
 * The data model is split into two halves:
 *
 *  1. {@link OAuthServiceConfig} — non-secret config (display name, endpoints,
 *     client_id, scopes). Lives in localStorage so it can be loaded
 *     synchronously at boot, before the keychain is unlocked. Slot
 *     registration depends on this.
 *
 *  2. {@link OAuthTokenFile} — secrets (access token, refresh token,
 *     optionally a client_secret). Lives only in the VFS, encrypted into the
 *     vault by the existing keychain watcher. Token files duplicate enough of
 *     the registry config (`tokenEndpoint`, `clientId`, `clientSecret`) so a
 *     standalone refresh works even if the registry is somehow out of sync.
 */

/**
 * Persistent, non-secret configuration for a user-added OAuth service.
 */
export interface OAuthServiceConfig {
  /**
   * Unique identifier for the service, used to derive the VFS file path
   * (`/home/user/.config/oauth/{id}.json`) and slot name.
   *
   * Format: `<hostname-slug>-<6char-random>` to keep distinct entries from the
   * same provider distinguishable.
   */
  id: string;
  /** Display label shown in the keychain sidebar. */
  displayName: string;
  /**
   * The user-supplied issuer URL — typically the resource server URL or the
   * authorization server root. Stored verbatim for diagnostics.
   */
  issuer: string;
  /**
   * Optional URL of the protected resource (RFC 9728). When discovery starts
   * at a resource server this will be set.
   */
  resourceUrl?: string;
  /** RFC 8414 `authorization_endpoint`. */
  authorizationEndpoint: string;
  /** RFC 8414 `token_endpoint`. */
  tokenEndpoint: string;
  /** RFC 7591 dynamic client registration endpoint, if advertised. */
  registrationEndpoint?: string;
  /** Optional RFC 7009 token revocation endpoint. */
  revocationEndpoint?: string;
  /** Scopes we will request in the authorize URL. */
  scopesRequested: string[];
  /** Scopes the AS advertised it supports — for diagnostics / UI hints. */
  scopesSupported?: string[];
  /** Client identifier obtained from DCR or pasted manually. */
  clientId: string;
  /**
   * Optional confidential client secret. Present only if DCR returned one or
   * the user pasted one in the manual fallback. Always treated as a secret
   * (lives in the encrypted token file too).
   */
  clientSecret?: string;
  /**
   * Redirect URI registered with the AS — captured at registration time so we
   * use the same value in subsequent authorization runs.
   */
  redirectUri: string;
  /** Always `S256` — plain is rejected during discovery. */
  codeChallengeMethod: "S256";
  /** ISO timestamp of when the entry was added. */
  addedAt: string;
  /** ISO timestamp of when discovery last completed. */
  discoveredAt: string;
}

/**
 * Encrypted-into-vault token payload for a single OAuth service. Lives at
 * `/home/user/.config/oauth/{id}.json`.
 */
export interface OAuthTokenFile {
  version: 1;
  /** Mirrors {@link OAuthServiceConfig.id} for self-checks. */
  serviceId: string;
  tokenType: "Bearer";
  accessToken: string;
  refreshToken?: string;
  /** Absolute ISO timestamp when the access token expires, when known. */
  expiresAt?: string;
  /** Granted scopes (may differ from requested). */
  scope?: string;
  /** Duplicated for standalone refresh without the registry. */
  tokenEndpoint: string;
  /** Duplicated for standalone refresh without the registry. */
  clientId: string;
  /** Present iff confidential. Duplicated for standalone refresh. */
  clientSecret?: string;
  /** ISO timestamp when the access token was first obtained. */
  obtainedAt: string;
  /** ISO timestamp of the most recent successful refresh, when known. */
  refreshedAt?: string;
}

/**
 * The result of running discovery against a user-supplied URL — surfaced to
 * the UI before the user commits to "Connect".
 */
export interface OAuthDiscoveryPreview {
  /** The URL the user pasted, normalised. */
  inputUrl: string;
  /** The resolved authorization-server issuer. */
  issuer: string;
  /** Set when discovery began at a resource server. */
  resourceUrl?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  scopesSupported?: string[];
  /**
   * When true, the authorization server explicitly listed S256 in
   * `code_challenge_methods_supported`. When the metadata is silent we
   * optimistically allow it (RFC 7636 §4.2 — the field is OPTIONAL).
   */
  supportsS256: true;
  /**
   * `true` if the AS advertised a `registration_endpoint`. When false the UI
   * prompts the user for a `client_id` (and optional `client_secret`).
   */
  supportsDynamicRegistration: boolean;
  /**
   * Recommended display name (hostname of the issuer) the UI may pre-fill.
   */
  suggestedDisplayName: string;
}

/** Public metadata for a connected service surfaced to the sidebar. */
export interface OAuthServiceStatus {
  id: string;
  displayName: string;
  /**
   * Connection state for the sidebar:
   *  - `pending`: discovery succeeded, awaiting authorize callback.
   *  - `connected`: a valid access token is on disk.
   *  - `needs-reauth`: refresh failed with `invalid_grant` (or similar).
   *  - `error`: transient error to display next to the card.
   */
  status: "pending" | "connected" | "needs-reauth" | "error";
  /** Optional message accompanying the status (e.g. last error). */
  statusDetail?: string;
  /** Granted scopes from the latest token, when known. */
  scope?: string;
  /** Time when the token expires (ISO), when known. */
  expiresAt?: string;
  /** Whether the orchestrator currently has a refresh in flight. */
  refreshing: boolean;
}
