/**
 * Discovery: turn a user-pasted URL into an {@link OAuthDiscoveryPreview}.
 *
 * Resolution order, following the OpenAI Apps SDK / MCP auth conventions:
 *
 *   1. RFC 9728 — `<inputUrl>/.well-known/oauth-protected-resource` returns a
 *      list of `authorization_servers`. We follow the first entry. If this
 *      returns 404 or invalid JSON, we treat the URL as the AS itself.
 *
 *   2. RFC 8414 — `<as>/.well-known/oauth-authorization-server` returns
 *      `authorization_endpoint`, `token_endpoint`, etc.
 *
 *   3. OIDC fallback — `<as>/.well-known/openid-configuration`.
 *
 * `code_challenge_methods_supported`, when present, MUST include `S256`. The
 * spec says the field is OPTIONAL, so when it is omitted entirely we
 * optimistically assume S256 is supported (RFC 7636 §4.2 — most servers
 * implement it).
 */

import { oauthFetch, type OAuthFetchOptions } from "./proxy-fetch";
import type { OAuthDiscoveryPreview } from "./types";

export class OAuthDiscoveryError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OAuthDiscoveryError";
  }
}

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
  /**
   * Some implementations return additional fields like `bearer_methods_supported`
   * that we currently ignore.
   */
}

interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  /**
   * OIDC specific — kept for diagnostics but not required by RFC 8414.
   */
  jwks_uri?: string;
}

/**
 * Strip a trailing slash to make URL joining well-defined.
 */
function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Normalise the user input so we have something close to an origin/issuer.
 * If the user omits the scheme we assume `https://`.
 */
export function normalizeIssuerInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new OAuthDiscoveryError("Enter a URL.");
  }

  let candidate = trimmed;
  // If the user typed a scheme prefix (e.g. `ftp://...` or `mailto:...`)
  // validate it BEFORE auto-prefixing — otherwise `ftp://example.com` would
  // become `https://ftp://example.com`, which `new URL` happily parses as
  // `https://ftp//example.com`, hiding the user's intent.
  const schemeMatch = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new OAuthDiscoveryError(
        `Only http(s) URLs are supported (got ${scheme}:).`,
      );
    }
  } else {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (cause) {
    throw new OAuthDiscoveryError(`That doesn't look like a valid URL.`, cause);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OAuthDiscoveryError(
      `Only http(s) URLs are supported (got ${url.protocol}).`,
    );
  }

  return trimTrailingSlash(url.toString());
}

/**
 * Build the well-known URL for a given discovery type relative to the input.
 *
 * Discovery documents live at the ORIGIN ROOT, not underneath the resource
 * path. For example, for an MCP resource at `https://dispatch.replay.io/nut/mcp`,
 * protected-resource metadata is fetched from
 * `https://dispatch.replay.io/.well-known/oauth-protected-resource` — NOT
 * from `https://dispatch.replay.io/nut/mcp/.well-known/oauth-protected-resource`.
 *
 * RFC 9728 §3 / RFC 8414 §3 also define a path-insertion form
 * (`https://host/.well-known/xyz/path-suffix`) for disambiguating multiple
 * logical ASes/resources on the same host, but in practice both OAuth
 * servers and MCP servers publish a single metadata doc at the origin root,
 * which is what this helper produces.
 */
export function buildWellKnownUrl(
  baseUrl: string,
  wellKnownPath: string,
): string {
  const normalisedPath = wellKnownPath.startsWith("/")
    ? wellKnownPath
    : `/${wellKnownPath}`;
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}${normalisedPath}`;
  } catch {
    // If the caller passes a string that isn't parseable as a URL
    // (shouldn't happen — discovery inputs go through normalizeIssuerInput
    // first), fall back to the naive concat so the call still produces a
    // meaningful error downstream.
    return `${trimTrailingSlash(baseUrl)}${normalisedPath}`;
  }
}

async function fetchJson<T>(
  url: string,
  fetchOptions: OAuthFetchOptions,
): Promise<{ status: number; body: T | null }> {
  const response = await oauthFetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  }, fetchOptions);
  if (!response.ok) {
    return { status: response.status, body: null };
  }
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/**
 * Phase 1 — RFC 9728 protected resource discovery. Returns `null` when the
 * resource has no metadata document or the response was unparseable.
 */
export async function discoverProtectedResource(
  resourceUrl: string,
  fetchOptions: OAuthFetchOptions = {},
): Promise<ProtectedResourceMetadata | null> {
  const wellKnown = buildWellKnownUrl(
    resourceUrl,
    "/.well-known/oauth-protected-resource",
  );
  try {
    const result = await fetchJson<ProtectedResourceMetadata>(wellKnown, fetchOptions);
    if (!result.body) {
      return null;
    }
    return result.body;
  } catch {
    return null;
  }
}

/**
 * Phase 2/3 — RFC 8414 + OIDC fallback. Throws if neither well-known
 * document is reachable or both lack the required endpoints.
 */
export async function discoverAuthorizationServer(
  issuerUrl: string,
  fetchOptions: OAuthFetchOptions = {},
): Promise<AuthorizationServerMetadata> {
  const trimmedIssuer = trimTrailingSlash(issuerUrl);
  const candidates = [
    buildWellKnownUrl(trimmedIssuer, "/.well-known/oauth-authorization-server"),
    buildWellKnownUrl(trimmedIssuer, "/.well-known/openid-configuration"),
  ];

  let lastStatus: number | null = null;
  for (const candidate of candidates) {
    try {
      const result = await fetchJson<AuthorizationServerMetadata>(candidate, fetchOptions);
      if (result.body && result.body.authorization_endpoint && result.body.token_endpoint) {
        return result.body;
      }
      lastStatus = result.status;
    } catch (cause) {
      lastStatus = -1;
      if (candidate === candidates[candidates.length - 1]) {
        throw new OAuthDiscoveryError(
          `Could not fetch authorization server metadata for ${issuerUrl}.`,
          cause,
        );
      }
    }
  }

  throw new OAuthDiscoveryError(
    `${issuerUrl} did not return authorization server metadata${
      lastStatus != null ? ` (last HTTP status ${lastStatus})` : ""
    }.`,
  );
}

/**
 * Top-level discovery function used by the orchestrator and the modal.
 * Returns a fully-populated {@link OAuthDiscoveryPreview} or throws an
 * {@link OAuthDiscoveryError} explaining what went wrong.
 */
export async function discoverOAuthService(
  rawInput: string,
  fetchOptions: OAuthFetchOptions = {},
): Promise<OAuthDiscoveryPreview> {
  const input = normalizeIssuerInput(rawInput);

  // Phase 1 — RFC 9728. If present, take the first authorization server.
  const protectedResource = await discoverProtectedResource(input, fetchOptions);
  let authorizationServerUrl = input;
  let resourceUrl: string | undefined;
  let scopesFromResource: string[] | undefined;
  if (protectedResource) {
    if (
      Array.isArray(protectedResource.authorization_servers)
      && protectedResource.authorization_servers.length > 0
    ) {
      const candidate = protectedResource.authorization_servers[0];
      if (typeof candidate === "string" && candidate) {
        authorizationServerUrl = candidate;
      }
    }
    if (Array.isArray(protectedResource.scopes_supported)) {
      scopesFromResource = protectedResource.scopes_supported.filter(
        (scope): scope is string => typeof scope === "string" && scope.length > 0,
      );
    }
    resourceUrl = typeof protectedResource.resource === "string"
      ? protectedResource.resource
      : input;
  }

  // Phase 2/3 — RFC 8414 + OIDC fallback.
  const asMetadata = await discoverAuthorizationServer(authorizationServerUrl, fetchOptions);
  if (!asMetadata.authorization_endpoint || !asMetadata.token_endpoint) {
    throw new OAuthDiscoveryError(
      `Authorization server metadata is missing required endpoints.`,
    );
  }

  const codeChallengeMethods = asMetadata.code_challenge_methods_supported;
  if (
    Array.isArray(codeChallengeMethods)
    && codeChallengeMethods.length > 0
    && !codeChallengeMethods.some((method) => method?.toUpperCase() === "S256")
  ) {
    throw new OAuthDiscoveryError(
      `This authorization server does not list S256 in `
        + `code_challenge_methods_supported. Aborting to avoid downgrading PKCE.`,
    );
  }

  const issuer = asMetadata.issuer || authorizationServerUrl;
  const suggestedDisplayName = (() => {
    try {
      return new URL(issuer).hostname;
    } catch {
      return issuer;
    }
  })();

  const scopesSupported = asMetadata.scopes_supported && Array.isArray(asMetadata.scopes_supported)
    ? asMetadata.scopes_supported.filter(
        (scope): scope is string => typeof scope === "string" && scope.length > 0,
      )
    : scopesFromResource;

  return {
    inputUrl: input,
    issuer,
    resourceUrl,
    authorizationEndpoint: asMetadata.authorization_endpoint,
    tokenEndpoint: asMetadata.token_endpoint,
    registrationEndpoint: asMetadata.registration_endpoint,
    revocationEndpoint: asMetadata.revocation_endpoint,
    scopesSupported: scopesSupported && scopesSupported.length > 0 ? scopesSupported : undefined,
    supportsS256: true,
    supportsDynamicRegistration: typeof asMetadata.registration_endpoint === "string"
      && asMetadata.registration_endpoint.length > 0,
    suggestedDisplayName,
  };
}
