/**
 * RFC 8628 Device Authorization Grant — the "CLI auth" method.
 *
 * The classic terminal flow: request a device+user code pair, show the user
 * `verification_uri` + `user_code`, and poll the token endpoint until they
 * approve (honoring `interval` and `slow_down`). Used for services whose
 * OAuth clients are CLI-style (GitHub CLI, Codex device login, …).
 */

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: Date;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

export class DeviceCodeError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "authorization_declined"
      | "expired"
      | "network"
      | "protocol",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DeviceCodeError";
  }
}

export interface DeviceCodeFlowOptions {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  /** Called once the user code is available — render it in the UI. */
  onPrompt: (prompt: DeviceCodePrompt) => void;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

async function postForm(
  fetchImpl: DeviceCodeFlowOptions["fetchImpl"],
  url: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // GitHub's device endpoint answers form-encoded unless JSON is requested;
    // tolerate it anyway.
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run the whole flow: device authorization request → user prompt → token
 * polling. Resolves with the token response once the user approves.
 */
export async function runDeviceCodeFlow(
  options: DeviceCodeFlowOptions,
): Promise<DeviceTokenResponse> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  let authResponse: Response;
  try {
    authResponse = await postForm(options.fetchImpl, options.deviceAuthorizationEndpoint, {
      client_id: options.clientId,
      ...(options.scopes && options.scopes.length > 0
        ? { scope: options.scopes.join(" ") }
        : {}),
    });
  } catch (cause) {
    throw new DeviceCodeError(
      "Could not reach the device authorization endpoint.",
      "network",
      cause,
    );
  }
  const authPayload = await readJson(authResponse);
  if (!authResponse.ok || typeof authPayload.device_code !== "string") {
    throw new DeviceCodeError(
      `Device authorization failed (HTTP ${authResponse.status})${
        typeof authPayload.error === "string" ? ` — ${authPayload.error}` : ""
      }.`,
      "protocol",
    );
  }
  const auth = authPayload as unknown as DeviceAuthorizationResponse;
  const expiresAt = now() + (auth.expires_in > 0 ? auth.expires_in * 1000 : 900_000);
  let intervalMs = Math.max(1, auth.interval ?? 5) * 1000;

  options.onPrompt({
    userCode: auth.user_code,
    verificationUri: auth.verification_uri,
    verificationUriComplete: auth.verification_uri_complete,
    expiresAt: new Date(expiresAt),
  });

  for (;;) {
    if (options.signal?.aborted) {
      throw new DeviceCodeError("Device login was cancelled.", "authorization_declined");
    }
    if (now() >= expiresAt) {
      throw new DeviceCodeError("The device code expired before approval.", "expired");
    }
    await sleep(intervalMs);

    let tokenResponse: Response;
    try {
      tokenResponse = await postForm(options.fetchImpl, options.tokenEndpoint, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: auth.device_code,
        client_id: options.clientId,
        ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
      });
    } catch {
      // Transient network failure — keep polling until the code expires.
      continue;
    }
    const payload = await readJson(tokenResponse);

    if (tokenResponse.ok && typeof payload.access_token === "string") {
      return payload as unknown as DeviceTokenResponse;
    }

    const error = typeof payload.error === "string" ? payload.error : "";
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (error === "expired_token") {
      throw new DeviceCodeError("The device code expired before approval.", "expired");
    }
    if (error === "access_denied") {
      throw new DeviceCodeError("The user declined the device login.", "authorization_declined");
    }
    throw new DeviceCodeError(
      `Token polling failed (HTTP ${tokenResponse.status})${error ? ` — ${error}` : ""}.`,
      "protocol",
    );
  }
}
