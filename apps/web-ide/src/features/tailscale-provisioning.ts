import type { NetworkOptions } from "almostnode";

export const DEFAULT_TAILSCALE_AUTH_KEY_ENDPOINT = "/__api/tailscale/auth-key";
export const TAILSCALE_HOSTNAME_STORAGE_KEY =
  "almostnode.webide.tailscale.hostname.v1";

const UNAVAILABLE_ENDPOINT_STATUSES = new Set([404, 405, 501]);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface TailscaleAuthKeyProvisioningOptions {
  endpoint?: string | null;
  fetchImpl?: FetchLike;
  hostname?: string | null;
  storage?: StorageLike | null;
  signal?: AbortSignal;
}

export interface TailscaleAuthKeyProvisioningResult {
  authKey: string;
  controlUrl: string | null;
  hostname: string | null;
  useExitNode: boolean;
  acceptDns: boolean;
  expiresAt: string | null;
}

export class TailscaleAuthKeyProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailscaleAuthKeyProvisioningError";
  }
}

function getConfiguredEndpoint(): string {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, unknown>;
  }).env;
  const configured = env?.VITE_TAILSCALE_AUTH_KEY_ENDPOINT;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : DEFAULT_TAILSCALE_AUTH_KEY_ENDPOINT;
}

function getBrowserDurableStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function randomSuffix(): string {
  try {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function normalizeTailscaleHostname(
  value: string | null | undefined,
): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/^-|-$/g, "");
  return normalized || null;
}

export function getOrCreateTailscaleHostname(
  storage: StorageLike | null = getBrowserDurableStorage(),
): string {
  const stored = normalizeTailscaleHostname(
    storage?.getItem(TAILSCALE_HOSTNAME_STORAGE_KEY),
  );
  if (stored) {
    return stored;
  }

  const hostname = `almostnode-${randomSuffix()}`.slice(0, 63);
  try {
    storage?.setItem(TAILSCALE_HOSTNAME_STORAGE_KEY, hostname);
  } catch {
    // Hostname persistence is best effort; never block login on storage.
  }
  return hostname;
}

function readStringField(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readBooleanField(
  payload: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
}

function parseProvisioningPayload(
  payload: unknown,
  requestedHostname: string,
): TailscaleAuthKeyProvisioningResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TailscaleAuthKeyProvisioningError(
      "Tailscale provisioning returned an invalid response.",
    );
  }

  const record = payload as Record<string, unknown>;
  const authKey = readStringField(record, ["authKey", "auth_key", "key"]);
  if (!authKey) {
    throw new TailscaleAuthKeyProvisioningError(
      "Tailscale provisioning response did not include an auth key.",
    );
  }

  const responseHostname = normalizeTailscaleHostname(
    readStringField(record, ["hostname", "hostName", "nodeName"]),
  );

  return {
    authKey,
    controlUrl: readStringField(record, [
      "controlUrl",
      "controlURL",
      "control_url",
    ]),
    hostname: responseHostname || requestedHostname,
    useExitNode: readBooleanField(record, "useExitNode", true),
    acceptDns: readBooleanField(record, "acceptDns", true),
    expiresAt: readStringField(record, ["expiresAt", "expires_at"]),
  };
}

export function buildProvisionedTailscaleNetworkOptions(
  provisioned: TailscaleAuthKeyProvisioningResult,
): NetworkOptions {
  return {
    provider: "tailscale",
    authMode: "auth-key",
    authKey: provisioned.authKey,
    controlUrl: provisioned.controlUrl,
    hostname: provisioned.hostname,
    useExitNode: provisioned.useExitNode,
    acceptDns: provisioned.acceptDns,
  };
}

export async function requestTailscaleAuthKey(
  options: TailscaleAuthKeyProvisioningOptions = {},
): Promise<TailscaleAuthKeyProvisioningResult | null> {
  const endpoint = (options.endpoint ?? getConfiguredEndpoint()).trim();
  if (!endpoint) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    return null;
  }

  const requestedHostname =
    normalizeTailscaleHostname(options.hostname) ||
    getOrCreateTailscaleHostname(options.storage ?? getBrowserDurableStorage());

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        hostname: requestedHostname,
      }),
      signal: options.signal,
    });
  } catch {
    return null;
  }

  if (UNAVAILABLE_ENDPOINT_STATUSES.has(response.status)) {
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new TailscaleAuthKeyProvisioningError(
      "Tailscale provisioning requires an authenticated Auth0 session.",
    );
  }

  if (!response.ok) {
    throw new TailscaleAuthKeyProvisioningError(
      `Tailscale provisioning failed with HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TailscaleAuthKeyProvisioningError(
      "Tailscale provisioning returned malformed JSON.",
    );
  }

  return parseProvisioningPayload(payload, requestedHostname);
}
