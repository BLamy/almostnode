import sodium from "libsodium-wrappers";

const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_REST_BASE_URL = "https://api.github.com";

export interface GitHubCodespaceSummary {
  name: string;
  displayName: string;
  webUrl: string;
  state: string;
  machine: string | null;
  idleTimeoutMinutes: number | null;
  retentionHours: number | null;
}

export interface GitHubRepositoryReference {
  owner: string;
  repo: string;
  branch: string;
  remoteUrl: string;
}

export interface GitHubDeviceCodeStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatarUrl: string | null;
}

export interface GitHubAuthenticatedSession {
  user: GitHubUser;
  scopes: string | null;
}

type GitHubCodespaceApiResponse = {
  name: string;
  display_name?: string | null;
  web_url?: string | null;
  state?: string | null;
  machine?: { name?: string | null } | null;
  idle_timeout_minutes?: number | null;
  retention_period_minutes?: number | null;
};

export class GitHubApiClient {
  constructor(private readonly accessToken: string) {}

  async getAuthenticatedSession(): Promise<GitHubAuthenticatedSession> {
    const { payload, response } = await this.requestWithResponse<Record<string, unknown>>(
      "/user",
    );

    return {
      user: {
        login: String(payload.login || ""),
        id: Number(payload.id || 0),
        avatarUrl: typeof payload.avatar_url === "string"
          ? payload.avatar_url
          : null,
      },
      scopes: response.headers.get("x-oauth-scopes"),
    };
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    const { user } = await this.getAuthenticatedSession();
    return user;
  }

  async assertCodespacesAccess(): Promise<void> {
    await this.request("/user/codespaces?per_page=1");
  }

  async getRepositoryId(owner: string, repo: string): Promise<number> {
    const payload = await this.request<Record<string, unknown>>(
      `/repos/${owner}/${repo}`,
    );
    return Number(payload.id || 0);
  }

  async listRepositoryCodespaces(
    owner: string,
    repo: string,
  ): Promise<GitHubCodespaceSummary[]> {
    const payload = await this.request<{ codespaces?: GitHubCodespaceApiResponse[] }>(
      `/repos/${owner}/${repo}/codespaces`,
    );
    return (payload.codespaces || []).map((codespace) =>
      this.normalizeCodespace(codespace),
    );
  }

  async createRepositoryCodespace(options: {
    owner: string;
    repo: string;
    branch: string;
    machine: string | null;
    displayName: string;
    idleTimeoutMinutes: number | null;
    retentionHours: number | null;
  }): Promise<GitHubCodespaceSummary> {
    const payload = await this.request<GitHubCodespaceApiResponse>(
      `/repos/${options.owner}/${options.repo}/codespaces`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: options.branch,
          machine: options.machine || undefined,
          display_name: options.displayName,
          idle_timeout_minutes: options.idleTimeoutMinutes ?? undefined,
          retention_period_minutes:
            typeof options.retentionHours === "number"
              ? options.retentionHours * 60
              : undefined,
        }),
      },
    );
    return this.normalizeCodespace(payload);
  }

  async getCodespace(name: string): Promise<GitHubCodespaceSummary> {
    const payload = await this.request<GitHubCodespaceApiResponse>(
      `/user/codespaces/${name}`,
    );
    return this.normalizeCodespace(payload);
  }

  async startCodespace(name: string): Promise<GitHubCodespaceSummary> {
    const payload = await this.request<GitHubCodespaceApiResponse>(
      `/user/codespaces/${name}/start`,
      {
        method: "POST",
      },
    );
    return this.normalizeCodespace(payload);
  }

  async stopCodespace(name: string): Promise<GitHubCodespaceSummary> {
    const payload = await this.request<GitHubCodespaceApiResponse>(
      `/user/codespaces/${name}/stop`,
      {
        method: "POST",
      },
    );
    return this.normalizeCodespace(payload);
  }

  async deleteCodespace(name: string): Promise<void> {
    await this.request<void>(`/user/codespaces/${name}`, {
      method: "DELETE",
    });
  }

  async createOrUpdateCodespacesUserSecret(options: {
    name: string;
    value: string;
    selectedRepositoryIds: number[];
  }): Promise<void> {
    const publicKey = await this.request<{
      key: string;
      key_id: string;
    }>("/user/codespaces/secrets/public-key");
    const encryptedValue = await encryptForGitHubSecret(
      options.value,
      publicKey.key,
    );

    await this.request(
      `/user/codespaces/secrets/${encodeURIComponent(options.name)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          encrypted_value: encryptedValue,
          key_id: publicKey.key_id,
          selected_repository_ids: options.selectedRepositoryIds,
        }),
      },
    );
  }

  private async requestWithResponse<T>(
    path: string,
    init?: RequestInit,
  ): Promise<{ payload: T; response: Response }> {
    const response = await this.fetchResponse(path, init);
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) {
      const message = typeof payload?.message === "string"
        ? payload.message
        : `GitHub API request failed (${response.status}).`;
      throw new Error(message);
    }

    return {
      payload: payload as T,
      response,
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const { payload } = await this.requestWithResponse<T>(path, init);
    return payload;
  }

  private async fetchResponse(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(`${GITHUB_REST_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  }

  private normalizeCodespace(
    payload: GitHubCodespaceApiResponse,
  ): GitHubCodespaceSummary {
    return {
      name: payload.name,
      displayName: payload.display_name || payload.name,
      webUrl: payload.web_url || "",
      state: payload.state || "unknown",
      machine: payload.machine?.name || null,
      idleTimeoutMinutes:
        typeof payload.idle_timeout_minutes === "number"
          ? payload.idle_timeout_minutes
          : null,
      retentionHours:
        typeof payload.retention_period_minutes === "number"
          ? Math.round(payload.retention_period_minutes / 60)
          : null,
    };
  }
}

export async function startGitHubDeviceCode(
  clientId: string,
): Promise<GitHubDeviceCodeStartResponse> {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "repo codespace",
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : "GitHub device auth failed.",
    );
  }

  return {
    deviceCode: String(payload.device_code),
    userCode: String(payload.user_code),
    verificationUri: String(payload.verification_uri),
    verificationUriComplete:
      typeof payload.verification_uri_complete === "string"
        ? payload.verification_uri_complete
        : null,
    expiresIn: Number(payload.expires_in || 0),
    interval: Number(payload.interval || 5),
  };
}

export async function pollGitHubDeviceCode(options: {
  clientId: string;
  deviceCode: string;
}): Promise<
  | { status: "pending" }
  | { status: "authorized"; accessToken: string; scopes: string | null; tokenType: string | null }
> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: options.clientId,
      device_code: options.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const payload = await response.json() as Record<string, unknown>;

  if (payload.error === "authorization_pending" || payload.error === "slow_down") {
    return { status: "pending" };
  }
  if (!response.ok || payload.error) {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : "GitHub device auth polling failed.",
    );
  }

  return {
    status: "authorized",
    accessToken: String(payload.access_token),
    scopes: typeof payload.scope === "string" ? payload.scope : null,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : null,
  };
}

async function encryptForGitHubSecret(
  value: string,
  base64PublicKey: string,
): Promise<string> {
  await sodium.ready;
  const message = sodium.from_string(value);
  const publicKey = sodium.from_base64(
    base64PublicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const encrypted = sodium.crypto_box_seal(message, publicKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}
