/**
 * executor.sh connection auth flows.
 *
 * All five OAuth-ish methods converge on the shared keychain machinery: an
 * `OAuthServiceConfig` in the OS-wide registry + an encrypted token file in
 * the VFS, so the orchestrator's refresh loop maintains every executor
 * connection like any other keychain OAuth service.
 *
 *  - `oauth-dcr`    — discovery → RFC 7591 registration → PKCE popup.
 *  - `oauth-cimd`   — Client ID Metadata Document: the `client_id` IS the
 *                     URL of our hosted metadata JSON; no registration call.
 *  - `oauth-client` — user-pasted client_id (+ optional secret) → PKCE popup.
 *  - `oidc`         — code flow with `openid` scopes + nonce; the id_token
 *                     claims become the connection's identity.
 *  - `oauth-device` — RFC 8628 device grant ("CLI auth"), no popup at all.
 *
 * This module intentionally re-implements the popup flow instead of calling
 * `OAuthServiceOrchestrator.addService` — the orchestrator's monolith hides
 * the raw token response, and OIDC needs `id_token` + nonce.
 */

import type { VirtualFS } from "@agent-wasm/core";
import {
  awaitAuthorizationCallback,
  buildAuthorizeUrl,
  buildCallbackUrl,
  buildTokenFile,
  discoverAuthorizationServer,
  discoverOAuthService,
  generatePkcePair,
  generateServiceId,
  oauthFetch,
  randomState,
  readTokenFile,
  registerDynamicClient,
  secondsUntilExpiry,
  tokenFilePathForService,
  writeTokenFile,
  type OAuthDiscoveryPreview,
  type OAuthFetchOptions,
  type OAuthServiceConfig,
  type OAuthServiceRegistry,
  type OrchestratorKeychain,
  type TokenEndpointResponse,
} from "@agent-wasm/keychain/oauth";
import { runDeviceCodeFlow, type DeviceCodePrompt } from "./device-code";
import type { ExecutorAuthMethod } from "./executor-types";

export class ExecutorAuthError extends Error {
  constructor(message: string, readonly code: "needs_auth" | "flow_failed" | "unsupported") {
    super(message);
    this.name = "ExecutorAuthError";
  }
}

/** Discovery preview plus the extended AS metadata executor.sh cares about. */
export interface ExtendedDiscovery {
  preview: OAuthDiscoveryPreview;
  /** RFC 8628 — present when the AS supports the device grant. */
  deviceAuthorizationEndpoint?: string;
  /** True when the AS advertises Client ID Metadata Document support. */
  supportsCimd: boolean;
}

/**
 * Run the standard discovery chain (RFC 9728 → RFC 8414 → OIDC), then
 * re-read the raw AS metadata for the fields the shared preview omits.
 */
export async function discoverService(
  url: string,
  fetchOptions: OAuthFetchOptions = {},
): Promise<ExtendedDiscovery> {
  const preview = await discoverOAuthService(url, fetchOptions);
  let deviceAuthorizationEndpoint: string | undefined;
  let supportsCimd = false;
  try {
    const raw = (await discoverAuthorizationServer(preview.issuer, fetchOptions)) as Record<
      string,
      unknown
    >;
    if (typeof raw.device_authorization_endpoint === "string") {
      deviceAuthorizationEndpoint = raw.device_authorization_endpoint;
    }
    supportsCimd = raw.client_id_metadata_document_supported === true;
  } catch {
    // The preview already succeeded; the extended fields are best-effort.
  }
  return { preview, deviceAuthorizationEndpoint, supportsCimd };
}

/**
 * The Client ID Metadata Document URL — this URL *is* the `client_id` for
 * the `oauth-cimd` method. Served from `public/` (dev: filled in by the
 * client-metadata vite plugin). Note the AS must be able to fetch it, so
 * CIMD only fully works on a publicly reachable deployment.
 */
export function clientMetadataDocumentUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  return `${window.location.origin}${base.endsWith("/") ? base : `${base}/`}oauth/client-metadata.json`;
}

/** Decode a JWT payload without verifying the signature (display only). */
export function parseJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function callTokenEndpoint(
  tokenEndpoint: string,
  body: Record<string, string>,
  fetchOptions: OAuthFetchOptions,
): Promise<TokenEndpointResponse & { id_token?: string }> {
  let response: Response;
  try {
    response = await oauthFetch(
      tokenEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(body).toString(),
      },
      fetchOptions,
    );
  } catch (cause) {
    throw new ExecutorAuthError(
      `Network error contacting the token endpoint: ${cause instanceof Error ? cause.message : String(cause)}`,
      "flow_failed",
    );
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // fall through to the status check below
  }
  if (!response.ok || typeof payload.access_token !== "string") {
    const detail = typeof payload.error === "string"
      ? `${payload.error}${typeof payload.error_description === "string" ? ` — ${payload.error_description}` : ""}`
      : `HTTP ${response.status}`;
    throw new ExecutorAuthError(`Token exchange failed (${detail}).`, "flow_failed");
  }
  return payload as unknown as TokenEndpointResponse & { id_token?: string };
}

export type PopupAuthMethod = Extract<
  ExecutorAuthMethod,
  "oauth-dcr" | "oauth-cimd" | "oauth-client" | "oidc"
>;

export interface ConnectPopupParams {
  vfs: VirtualFS;
  registry: OAuthServiceRegistry;
  keychain: OrchestratorKeychain;
  discovery: ExtendedDiscovery;
  method: PopupAuthMethod;
  displayName: string;
  scopes: string[];
  /** `oauth-client` (required) and `oidc` (optional — else DCR). */
  clientId?: string;
  clientSecret?: string;
  /** MUST be invoked synchronously from the click handler. */
  openPopup: (url: string) => Window | null;
  fetchOptions?: OAuthFetchOptions;
  baseHref?: string;
  now?: () => Date;
}

export interface ConnectResult {
  service: OAuthServiceConfig;
  identity?: { sub?: string; email?: string; name?: string };
}

/**
 * Authorization-code + PKCE popup flow shared by DCR / CIMD / manual-client
 * / OIDC. Resolves the client_id per method, runs the popup, exchanges the
 * code, persists the registry entry + encrypted token file.
 */
export async function connectWithPopup(params: ConnectPopupParams): Promise<ConnectResult> {
  const { discovery, method } = params;
  const preview = discovery.preview;
  const fetchOptions = params.fetchOptions ?? {};
  const now = params.now ?? (() => new Date());
  const redirectUri = buildCallbackUrl(params.baseHref);

  const scopes = [...params.scopes];
  if (method === "oidc" && !scopes.includes("openid")) {
    scopes.unshift("openid");
    if (scopes.length === 1) scopes.push("profile", "email");
  }

  let clientId = params.clientId?.trim() ?? "";
  let clientSecret = params.clientSecret?.trim() || undefined;
  if (method === "oauth-cimd") {
    clientId = clientMetadataDocumentUrl();
  } else if (method === "oauth-client") {
    if (!clientId) {
      throw new ExecutorAuthError("Generic OAuth needs a client_id.", "flow_failed");
    }
  } else if (!clientId) {
    // oauth-dcr always registers; oidc registers when no client_id was given.
    if (!preview.supportsDynamicRegistration || !preview.registrationEndpoint) {
      throw new ExecutorAuthError(
        "This authorization server does not offer dynamic client registration — paste a client_id instead.",
        "unsupported",
      );
    }
    const registration = await registerDynamicClient(
      {
        registrationEndpoint: preview.registrationEndpoint,
        redirectUri,
        clientName: params.displayName || preview.suggestedDisplayName,
        scope: scopes.join(" ") || undefined,
      },
      fetchOptions,
    );
    clientId = registration.clientId;
    if (registration.clientSecret) clientSecret = registration.clientSecret;
  }

  const pkce = await generatePkcePair();
  const state = randomState();
  const nonce = method === "oidc" ? randomState() : undefined;

  const service: OAuthServiceConfig = {
    id: generateServiceId(preview.suggestedDisplayName),
    displayName: params.displayName.trim() || preview.suggestedDisplayName,
    issuer: preview.issuer,
    resourceUrl: preview.resourceUrl,
    authorizationEndpoint: preview.authorizationEndpoint,
    tokenEndpoint: preview.tokenEndpoint,
    registrationEndpoint: preview.registrationEndpoint,
    revocationEndpoint: preview.revocationEndpoint,
    scopesRequested: scopes,
    scopesSupported: preview.scopesSupported,
    clientId,
    clientSecret,
    redirectUri,
    codeChallengeMethod: "S256",
    addedAt: now().toISOString(),
    discoveredAt: now().toISOString(),
  };

  let authorizeUrl = buildAuthorizeUrl({
    authorizationEndpoint: service.authorizationEndpoint,
    clientId: service.clientId,
    redirectUri: service.redirectUri,
    scope: scopes.join(" ") || undefined,
    state,
    codeChallenge: pkce.codeChallenge,
    resource: service.resourceUrl,
  });
  if (nonce) {
    const url = new URL(authorizeUrl);
    url.searchParams.set("nonce", nonce);
    authorizeUrl = url.toString();
  }

  const popup = params.openPopup(authorizeUrl);
  const callback = await awaitAuthorizationCallback(popup, {
    authorizeUrl,
    expectedState: state,
  });

  const response = await callTokenEndpoint(
    service.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: service.redirectUri,
      client_id: service.clientId,
      code_verifier: pkce.codeVerifier,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    },
    fetchOptions,
  );

  let identity: ConnectResult["identity"];
  if (method === "oidc" && typeof response.id_token === "string") {
    const claims = parseJwtClaims(response.id_token);
    if (claims) {
      if (nonce && claims.nonce !== undefined && claims.nonce !== nonce) {
        throw new ExecutorAuthError("id_token nonce mismatch — aborting.", "flow_failed");
      }
      identity = {
        sub: typeof claims.sub === "string" ? claims.sub : undefined,
        email: typeof claims.email === "string" ? claims.email : undefined,
        name: typeof claims.name === "string" ? claims.name : undefined,
      };
    }
  }

  // Slot first, so the keychain watcher accepts the token write.
  params.keychain.registerSlot(service.id, [tokenFilePathForService(service.id)]);
  params.registry.upsert(service);
  writeTokenFile(params.vfs, buildTokenFile({ service, response, now: now() }));
  params.keychain.notifyExternalStateChanged?.();

  return { service, identity };
}

export interface ConnectDeviceParams {
  vfs: VirtualFS;
  registry: OAuthServiceRegistry;
  keychain: OrchestratorKeychain;
  discovery: ExtendedDiscovery;
  displayName: string;
  scopes: string[];
  clientId: string;
  clientSecret?: string;
  onPrompt: (prompt: DeviceCodePrompt) => void;
  signal?: AbortSignal;
  fetchOptions?: OAuthFetchOptions;
  now?: () => Date;
}

/** RFC 8628 device grant — "CLI auth". No popup, no redirect URI needed. */
export async function connectWithDeviceCode(
  params: ConnectDeviceParams,
): Promise<ConnectResult> {
  const preview = params.discovery.preview;
  const fetchOptions = params.fetchOptions ?? {};
  const now = params.now ?? (() => new Date());
  const deviceEndpoint = params.discovery.deviceAuthorizationEndpoint;
  if (!deviceEndpoint) {
    throw new ExecutorAuthError(
      "This authorization server does not advertise a device_authorization_endpoint.",
      "unsupported",
    );
  }
  if (!params.clientId.trim()) {
    throw new ExecutorAuthError("Device login needs a client_id.", "flow_failed");
  }

  const response = await runDeviceCodeFlow({
    deviceAuthorizationEndpoint: deviceEndpoint,
    tokenEndpoint: preview.tokenEndpoint,
    clientId: params.clientId.trim(),
    clientSecret: params.clientSecret?.trim() || undefined,
    scopes: params.scopes,
    fetchImpl: (url, init) => oauthFetch(url, init, fetchOptions),
    onPrompt: params.onPrompt,
    signal: params.signal,
  });

  const service: OAuthServiceConfig = {
    id: generateServiceId(preview.suggestedDisplayName),
    displayName: params.displayName.trim() || preview.suggestedDisplayName,
    issuer: preview.issuer,
    resourceUrl: preview.resourceUrl,
    authorizationEndpoint: preview.authorizationEndpoint,
    tokenEndpoint: preview.tokenEndpoint,
    registrationEndpoint: preview.registrationEndpoint,
    revocationEndpoint: preview.revocationEndpoint,
    scopesRequested: [...params.scopes],
    scopesSupported: preview.scopesSupported,
    clientId: params.clientId.trim(),
    clientSecret: params.clientSecret?.trim() || undefined,
    redirectUri: buildCallbackUrl(),
    codeChallengeMethod: "S256",
    addedAt: now().toISOString(),
    discoveredAt: now().toISOString(),
  };

  params.keychain.registerSlot(service.id, [tokenFilePathForService(service.id)]);
  params.registry.upsert(service);
  writeTokenFile(params.vfs, buildTokenFile({ service, response, now: now() }));
  params.keychain.notifyExternalStateChanged?.();

  return { service };
}

export interface ResolveAuthDeps {
  vfs: VirtualFS;
  /** `refreshIfNeeded` from the orchestrator (injected for tests). */
  refreshIfNeeded: (serviceId: string) => Promise<void>;
}

/**
 * Resolve the auth headers for an OAuth-backed connection, refreshing
 * near-expired tokens first. Secrets stay host-side — the caller attaches
 * the returned headers to the outgoing HTTP request.
 */
export async function resolveOAuthHeaders(
  serviceId: string,
  deps: ResolveAuthDeps,
): Promise<Record<string, string>> {
  let file = readTokenFile(deps.vfs, serviceId);
  if (file) {
    const remaining = secondsUntilExpiry(file);
    if (remaining != null && remaining < 60 && file.refreshToken) {
      await deps.refreshIfNeeded(serviceId).catch(() => undefined);
      file = readTokenFile(deps.vfs, serviceId) ?? file;
    }
  }
  if (!file?.accessToken) {
    throw new ExecutorAuthError(
      "No access token on disk for this connection — connect (or unlock the keychain vault) first.",
      "needs_auth",
    );
  }
  return { Authorization: `Bearer ${file.accessToken}` };
}
