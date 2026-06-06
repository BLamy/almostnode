/**
 * RFC 7591 Dynamic Client Registration.
 *
 * We always register as a public client (PKCE-only, no client secret).
 * If the AS chooses to issue a `client_secret` regardless, we honour it and
 * stash it in the encrypted token file — some servers (notably ones using
 * `client_secret_basic` for refresh) require it.
 */

import { oauthFetch, type OAuthFetchOptions } from "./proxy-fetch";

export class OAuthRegistrationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OAuthRegistrationError";
  }
}

export interface DynamicClientRegistrationRequest {
  registrationEndpoint: string;
  redirectUri: string;
  clientName: string;
  scope?: string;
}

export interface DynamicClientRegistrationResult {
  clientId: string;
  clientSecret?: string;
  /**
   * The redirect URIs the AS confirmed are registered. Echoed back verbatim
   * for diagnostics.
   */
  redirectUris: string[];
  /** Raw response body for debugging. */
  raw: unknown;
}

interface RegistrationResponse {
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
}

/**
 * POST to the AS's `registration_endpoint`. Returns the issued client
 * credentials.
 */
export async function registerDynamicClient(
  request: DynamicClientRegistrationRequest,
  fetchOptions: OAuthFetchOptions = {},
): Promise<DynamicClientRegistrationResult> {
  if (!request.registrationEndpoint) {
    throw new OAuthRegistrationError(
      "This authorization server does not advertise a registration_endpoint.",
    );
  }

  const body: Record<string, unknown> = {
    redirect_uris: [request.redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: request.clientName,
  };
  if (request.scope) {
    body.scope = request.scope;
  }

  let response: Response;
  try {
    response = await oauthFetch(
      request.registrationEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      fetchOptions,
    );
  } catch (cause) {
    throw new OAuthRegistrationError(
      `Network error contacting ${request.registrationEndpoint}.`,
      cause,
    );
  }

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const text = await response.text();
      if (text) detail = `${response.status} — ${text}`;
    } catch {
      // ignore
    }
    throw new OAuthRegistrationError(
      `Dynamic client registration failed (${detail}).`,
    );
  }

  let parsed: RegistrationResponse;
  try {
    parsed = (await response.json()) as RegistrationResponse;
  } catch (cause) {
    throw new OAuthRegistrationError(
      "Dynamic client registration response was not valid JSON.",
      cause,
    );
  }

  if (!parsed.client_id || typeof parsed.client_id !== "string") {
    throw new OAuthRegistrationError(
      "Dynamic client registration response did not include a client_id.",
    );
  }

  return {
    clientId: parsed.client_id,
    clientSecret: typeof parsed.client_secret === "string" ? parsed.client_secret : undefined,
    redirectUris: Array.isArray(parsed.redirect_uris)
      ? parsed.redirect_uris.filter((value): value is string => typeof value === "string")
      : [request.redirectUri],
    raw: parsed,
  };
}
