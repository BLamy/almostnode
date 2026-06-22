/**
 * High-level controller for user-added OAuth services.
 *
 * Lifecycle:
 *   - construct with `{ vfs, registry, keychain }` and (optionally) overrides for
 *     fetch/proxy and the popup helpers (used by tests).
 *   - call `start()` once the keychain is unlocked, to begin the periodic
 *     refresh loop. `stop()` cleans up.
 *   - call `addService({ discovered, displayName, scopes, … })` from the
 *     "Connect" click handler. This SYNCHRONOUSLY opens the popup (the
 *     orchestrator delegates the open call to the caller via `openPopup`)
 *     and resolves once tokens have been written.
 *   - call `removeService(id)` to forget a service entirely.
 *   - call `refreshIfNeeded(id)` / `refreshAll()` to top up tokens. The
 *     refresh loop runs `refreshAll()` on `start()` and on each interval
 *     tick.
 *
 * Per-id refresh locks prevent concurrent refresh calls from double-spending
 * a single-use refresh token.
 */

import type { VirtualFS } from "@agent-wasm/core";
import {
  awaitAuthorizationCallback,
  buildAuthorizeUrl,
  buildCallbackUrl,
  OAUTH_CALLBACK_MESSAGE_TYPE,
  OAuthPopupError,
  type AuthorizeResult,
} from "./authorize-popup";
import { generatePkcePair, randomState, type PkcePair } from "./pkce";
import {
  oauthFetch,
  resolveOAuthCorsProxyUrl,
  type OAuthFetchOptions,
} from "./proxy-fetch";
import {
  generateServiceId,
  OAuthServiceRegistry,
  tokenFilePathForService,
} from "./registry";
import {
  registerDynamicClient,
  type DynamicClientRegistrationResult,
} from "./registration";
import {
  buildTokenFile,
  deleteTokenFile,
  readTokenFile,
  secondsUntilExpiry,
  writeTokenFile,
  type TokenEndpointResponse,
} from "./token-store";
import type {
  OAuthDiscoveryPreview,
  OAuthServiceConfig,
  OAuthServiceStatus,
  OAuthTokenFile,
} from "./types";

/**
 * Subset of {@link import("./../keychain").Keychain} the orchestrator needs.
 * Modeled as an interface so tests can drop in a fake.
 */
export interface OrchestratorKeychain {
  registerSlot(name: string, paths: string[]): void;
  hasSlotData(name: string): boolean;
  notifyExternalStateChanged?(): void;
}

export interface OrchestratorOptions {
  vfs: VirtualFS;
  registry: OAuthServiceRegistry;
  keychain: OrchestratorKeychain;
  /**
   * Open the OAuth popup. The default uses `window.open`. Tests inject a
   * custom function that returns a fake `Window`-like object.
   *
   * IMPORTANT: this MUST be called synchronously from a click handler in
   * production — that's why opening is parameterised (the caller decides the
   * exact moment to open).
   */
  openPopup?: (url: string) => Window | null;
  /** Override the proxy + fetch impl used for discovery/registration/token calls. */
  fetchOptions?: OAuthFetchOptions;
  /** Override the redirect URI base (defaults to `BASE_URL` resolution). */
  baseHref?: string;
  /** Refresh tick interval. Defaults to 60s. */
  refreshIntervalMs?: number;
  /** Refresh window — refresh anything that expires sooner than this. Defaults to 5 min. */
  refreshLeadTimeMs?: number;
  /** Inject `setInterval`/`clearInterval` for tests. */
  scheduler?: {
    setInterval: (cb: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
  /** Override `Date.now()` for tests. */
  now?: () => Date;
  /** Notified when the orchestrator's per-service status changes. */
  onStatusChange?: (statuses: OAuthServiceStatus[]) => void;
}

export interface AddServiceParams {
  discovered: OAuthDiscoveryPreview;
  displayName: string;
  scopes: string[];
  /** Optional manual `client_id` (used when the AS does not support DCR). */
  manualClientId?: string;
  /** Optional manual `client_secret` (rare — only when the AS requires one). */
  manualClientSecret?: string;
}

export interface AddServicePopupHandle {
  /**
   * Resolves with the new service config once the popup callback returns and
   * the token has been written.
   */
  result: Promise<OAuthServiceConfig>;
}

interface PendingFlow {
  pkce: PkcePair;
  state: string;
  service: OAuthServiceConfig;
}

/**
 * Hard-failure error returned by `refreshIfNeeded` so the UI can flag the
 * card as needing reauth.
 */
export class OAuthRefreshError extends Error {
  constructor(
    message: string,
    readonly serviceId: string,
    readonly kind: "invalid_grant" | "invalid_client" | "network" | "unknown",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}

interface ServiceRuntimeState {
  status: "pending" | "connected" | "needs-reauth" | "error";
  statusDetail?: string;
  refreshing: boolean;
}

export class OAuthServiceOrchestrator {
  private readonly vfs: VirtualFS;
  private readonly registry: OAuthServiceRegistry;
  private readonly keychain: OrchestratorKeychain;
  private readonly openPopupImpl: (url: string) => Window | null;
  private readonly fetchOptions: OAuthFetchOptions;
  private readonly baseHref: string;
  private readonly refreshIntervalMs: number;
  private readonly refreshLeadTimeMs: number;
  private readonly scheduler: {
    setInterval: (cb: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
  private readonly now: () => Date;
  private readonly onStatusChange?: (statuses: OAuthServiceStatus[]) => void;

  private refreshHandle: unknown = null;
  private refreshLocks = new Map<string, Promise<void>>();
  private runtimeState = new Map<string, ServiceRuntimeState>();

  constructor(options: OrchestratorOptions) {
    this.vfs = options.vfs;
    this.registry = options.registry;
    this.keychain = options.keychain;
    this.openPopupImpl =
      options.openPopup
      ?? ((url) => (typeof window !== "undefined" ? window.open(url, "almostnode-oauth", "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes") : null));
    this.fetchOptions = options.fetchOptions ?? {};
    this.baseHref = options.baseHref ?? "/";
    this.refreshIntervalMs = options.refreshIntervalMs ?? 60_000;
    this.refreshLeadTimeMs = options.refreshLeadTimeMs ?? 5 * 60_000;
    this.scheduler = options.scheduler ?? {
      setInterval: (cb, ms) => (typeof window !== "undefined" ? window.setInterval(cb, ms) : setInterval(cb, ms)),
      clearInterval: (handle) => {
        if (typeof window !== "undefined") {
          window.clearInterval(handle as number);
        } else {
          clearInterval(handle as ReturnType<typeof setInterval>);
        }
      },
    };
    this.now = options.now ?? (() => new Date());
    this.onStatusChange = options.onStatusChange;
  }

  /** Register every persisted service's slot. Call BEFORE `keychain.init()`. */
  registerAllSlots(): void {
    for (const service of this.registry.list()) {
      this.keychain.registerSlot(service.id, [tokenFilePathForService(service.id)]);
    }
  }

  /**
   * Begin the periodic refresh loop. Idempotent. Call when
   * `KeychainState.hasUnlockedKey` becomes true.
   */
  start(): void {
    if (this.refreshHandle) return;
    void this.refreshAll();
    this.refreshHandle = this.scheduler.setInterval(() => {
      void this.refreshAll();
    }, this.refreshIntervalMs);
  }

  /** Stop the periodic refresh loop. Idempotent. */
  stop(): void {
    if (!this.refreshHandle) return;
    this.scheduler.clearInterval(this.refreshHandle);
    this.refreshHandle = null;
  }

  /** Snapshot the current per-service status for the sidebar. */
  getStatuses(): OAuthServiceStatus[] {
    return this.registry.list().map((service) => this.computeStatus(service));
  }

  private computeStatus(service: OAuthServiceConfig): OAuthServiceStatus {
    const runtime = this.runtimeState.get(service.id);
    const tokenFile = readTokenFile(this.vfs, service.id);
    const status: OAuthServiceStatus["status"] = (() => {
      if (runtime?.status === "needs-reauth") return "needs-reauth";
      if (runtime?.status === "error") return "error";
      if (runtime?.status === "pending") return "pending";
      if (tokenFile?.accessToken) return "connected";
      return "pending";
    })();
    return {
      id: service.id,
      displayName: service.displayName,
      status,
      statusDetail: runtime?.statusDetail,
      scope: tokenFile?.scope,
      expiresAt: tokenFile?.expiresAt,
      refreshing: runtime?.refreshing ?? false,
    };
  }

  private setRuntime(serviceId: string, partial: Partial<ServiceRuntimeState>): void {
    const previous = this.runtimeState.get(serviceId) ?? { status: "pending", refreshing: false };
    const next: ServiceRuntimeState = { ...previous, ...partial };
    this.runtimeState.set(serviceId, next);
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatuses());
    }
  }

  /**
   * Add a service. The caller MUST invoke this synchronously inside a click
   * handler so `window.open` is allowed by the browser.
   *
   * Discovery and (when applicable) DCR happen first, then PKCE+state are
   * generated and the popup is opened. We then wait for the postMessage
   * callback and exchange the code for tokens.
   */
  async addService(params: AddServiceParams): Promise<OAuthServiceConfig> {
    const {
      discovered,
      displayName,
      scopes,
      manualClientId,
      manualClientSecret,
    } = params;
    const id = generateServiceId(discovered.suggestedDisplayName);
    const redirectUri = buildCallbackUrl(this.baseHref);

    let clientId = manualClientId?.trim() ?? "";
    let clientSecret = manualClientSecret?.trim() ? manualClientSecret.trim() : undefined;

    // ── DCR (synchronous-friendly path: we await BEFORE opening the popup) ──
    if (discovered.supportsDynamicRegistration && !clientId) {
      const registration: DynamicClientRegistrationResult = await registerDynamicClient(
        {
          registrationEndpoint: discovered.registrationEndpoint!,
          redirectUri,
          clientName: displayName || discovered.suggestedDisplayName,
          scope: scopes.join(" ") || undefined,
        },
        this.fetchOptions,
      );
      clientId = registration.clientId;
      if (registration.clientSecret) {
        clientSecret = registration.clientSecret;
      }
    }

    if (!clientId) {
      throw new Error(
        "No client_id available — paste one in the manual fallback or pick a service that supports dynamic registration.",
      );
    }

    const pkce = await generatePkcePair();
    const state = randomState();

    const service: OAuthServiceConfig = {
      id,
      displayName: displayName.trim() || discovered.suggestedDisplayName,
      issuer: discovered.issuer,
      resourceUrl: discovered.resourceUrl,
      authorizationEndpoint: discovered.authorizationEndpoint,
      tokenEndpoint: discovered.tokenEndpoint,
      registrationEndpoint: discovered.registrationEndpoint,
      revocationEndpoint: discovered.revocationEndpoint,
      scopesRequested: [...scopes],
      scopesSupported: discovered.scopesSupported,
      clientId,
      clientSecret,
      redirectUri,
      codeChallengeMethod: "S256",
      addedAt: this.now().toISOString(),
      discoveredAt: this.now().toISOString(),
    };

    // Register the slot BEFORE persisting anything to the VFS so the
    // keychain watcher accepts the file write.
    this.keychain.registerSlot(service.id, [tokenFilePathForService(service.id)]);
    this.registry.upsert(service);
    this.setRuntime(service.id, { status: "pending", statusDetail: "Awaiting authorization…", refreshing: false });

    // Build the authorize URL, then open the popup and await the callback.
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: service.authorizationEndpoint,
      clientId: service.clientId,
      redirectUri: service.redirectUri,
      scope: service.scopesRequested.join(" ") || undefined,
      state,
      codeChallenge: pkce.codeChallenge,
      resource: service.resourceUrl,
    });

    const popup = this.openPopupImpl(authorizeUrl);
    let callback: AuthorizeResult;
    try {
      callback = await awaitAuthorizationCallback(popup, {
        authorizeUrl,
        expectedState: state,
      });
    } catch (error) {
      this.setRuntime(service.id, {
        status: "error",
        statusDetail: error instanceof Error ? error.message : String(error),
        refreshing: false,
      });
      throw error;
    }

    // Exchange the code for tokens.
    let tokenResponse: TokenEndpointResponse;
    try {
      tokenResponse = await this.exchangeAuthorizationCode({
        service,
        code: callback.code,
        codeVerifier: pkce.codeVerifier,
      });
    } catch (error) {
      this.setRuntime(service.id, {
        status: "error",
        statusDetail: error instanceof Error ? error.message : String(error),
        refreshing: false,
      });
      throw error;
    }

    const tokenFile = buildTokenFile({
      service,
      response: tokenResponse,
      now: this.now(),
    });
    writeTokenFile(this.vfs, tokenFile);
    this.keychain.notifyExternalStateChanged?.();

    this.setRuntime(service.id, {
      status: "connected",
      statusDetail: undefined,
      refreshing: false,
    });

    return service;
  }

  /** Forget a service — removes its registry entry and deletes the token file. */
  removeService(id: string): void {
    if (!this.registry.has(id)) return;
    deleteTokenFile(this.vfs, id);
    this.registry.remove(id);
    this.runtimeState.delete(id);
    this.keychain.notifyExternalStateChanged?.();
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatuses());
    }
  }

  /** Refresh every persisted service in parallel. */
  async refreshAll(): Promise<void> {
    const services = this.registry.list();
    await Promise.all(services.map((service) => this.refreshIfNeeded(service.id).catch(() => undefined)));
  }

  /**
   * Refresh `id` if a refresh token is available and the access token is
   * expired (or near-expiring). Idempotent — concurrent calls reuse the same
   * in-flight refresh promise so we never double-spend a single-use refresh
   * token.
   */
  refreshIfNeeded(id: string): Promise<void> {
    const inflight = this.refreshLocks.get(id);
    if (inflight) return inflight;

    const promise = this.runRefresh(id).finally(() => {
      this.refreshLocks.delete(id);
    });
    this.refreshLocks.set(id, promise);
    return promise;
  }

  private async runRefresh(id: string): Promise<void> {
    const service = this.registry.get(id);
    if (!service) return;
    const file = readTokenFile(this.vfs, id);
    if (!file?.refreshToken) return;

    const remaining = secondsUntilExpiry(file, this.now());
    if (remaining != null && remaining * 1000 > this.refreshLeadTimeMs) {
      return;
    }

    this.setRuntime(id, { refreshing: true });

    try {
      const refreshed = await this.callTokenEndpoint({
        service,
        body: {
          grant_type: "refresh_token",
          refresh_token: file.refreshToken,
          client_id: service.clientId,
        },
      });
      const next = buildTokenFile({
        service,
        response: refreshed,
        previous: file,
        now: this.now(),
      });
      writeTokenFile(this.vfs, next);
      this.keychain.notifyExternalStateChanged?.();
      this.setRuntime(id, { status: "connected", statusDetail: undefined, refreshing: false });
    } catch (error) {
      if (error instanceof OAuthRefreshError && error.kind === "invalid_grant") {
        this.setRuntime(id, {
          status: "needs-reauth",
          statusDetail: "Refresh token rejected — reconnect to refresh access.",
          refreshing: false,
        });
        return;
      }
      this.setRuntime(id, {
        status: "error",
        statusDetail: error instanceof Error ? error.message : String(error),
        refreshing: false,
      });
    }
  }

  private async exchangeAuthorizationCode(params: {
    service: OAuthServiceConfig;
    code: string;
    codeVerifier: string;
  }): Promise<TokenEndpointResponse> {
    return this.callTokenEndpoint({
      service: params.service,
      body: {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.service.redirectUri,
        client_id: params.service.clientId,
        code_verifier: params.codeVerifier,
      },
    });
  }

  /**
   * POST to the token endpoint with the given body. Tries `client_secret`
   * in the body first; if the server replies `invalid_client` and a secret
   * is present, retries once with HTTP Basic auth (`client_secret_basic`).
   */
  private async callTokenEndpoint(params: {
    service: OAuthServiceConfig;
    body: Record<string, string>;
  }): Promise<TokenEndpointResponse> {
    const { service } = params;
    const baseBody: Record<string, string> = { ...params.body };

    if (service.clientSecret) {
      baseBody.client_secret = service.clientSecret;
    }

    const sendOnce = async (mode: "post-body" | "basic-auth"): Promise<Response> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      };
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(baseBody)) {
        if (mode === "basic-auth" && (key === "client_id" || key === "client_secret")) {
          continue;
        }
        body.set(key, value);
      }
      if (mode === "basic-auth" && service.clientSecret) {
        const token = btoa(`${service.clientId}:${service.clientSecret}`);
        headers.Authorization = `Basic ${token}`;
      }
      return oauthFetch(
        service.tokenEndpoint,
        { method: "POST", headers, body: body.toString() },
        this.fetchOptions,
      );
    };

    let response: Response;
    try {
      response = await sendOnce("post-body");
    } catch (error) {
      throw new OAuthRefreshError(
        "Network error contacting the token endpoint.",
        service.id,
        "network",
        error,
      );
    }

    if (!response.ok) {
      const errorPayload = await safeReadErrorPayload(response);
      if (errorPayload?.error === "invalid_client" && service.clientSecret) {
        try {
          response = await sendOnce("basic-auth");
        } catch (error) {
          throw new OAuthRefreshError(
            "Network error retrying token endpoint with client_secret_basic.",
            service.id,
            "network",
            error,
          );
        }
      }
    }

    if (!response.ok) {
      const errorPayload = await safeReadErrorPayload(response);
      const kind: OAuthRefreshError["kind"] = errorPayload?.error === "invalid_grant"
        ? "invalid_grant"
        : errorPayload?.error === "invalid_client"
          ? "invalid_client"
          : "unknown";
      throw new OAuthRefreshError(
        `Token endpoint returned ${response.status}${
          errorPayload?.error ? ` (${errorPayload.error})` : ""
        }${errorPayload?.error_description ? ` — ${errorPayload.error_description}` : ""}`,
        service.id,
        kind,
      );
    }

    let parsed: TokenEndpointResponse;
    try {
      parsed = (await response.json()) as TokenEndpointResponse;
    } catch (error) {
      throw new OAuthRefreshError(
        "Token endpoint response was not valid JSON.",
        service.id,
        "unknown",
        error,
      );
    }

    if (!parsed.access_token) {
      throw new OAuthRefreshError(
        "Token endpoint response did not include access_token.",
        service.id,
        "unknown",
      );
    }

    return parsed;
  }
}

interface ErrorPayload {
  error?: string;
  error_description?: string;
}

async function safeReadErrorPayload(response: Response): Promise<ErrorPayload | null> {
  try {
    const cloned = response.clone();
    const text = await cloned.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as ErrorPayload;
    } catch {
      return { error_description: text };
    }
  } catch {
    return null;
  }
}

// Re-export for callers that need to identify popup-message events without
// importing the popup module separately.
export { OAUTH_CALLBACK_MESSAGE_TYPE, OAuthPopupError };

export type { OAuthDiscoveryPreview } from "./types";

/**
 * Compute the resolved CORS proxy URL the orchestrator will use, for
 * surfacing in the modal alongside the redirect URI tip.
 */
export function describeOAuthProxy(): string {
  return resolveOAuthCorsProxyUrl();
}
