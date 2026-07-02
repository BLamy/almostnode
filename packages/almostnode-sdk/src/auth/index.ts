export type AuthProviderKind =
  | "browser-oauth"
  | "cli"
  | "manual"
  | "workspace";

export type CredentialSlotCategory =
  | "agent"
  | "cloud"
  | "database"
  | "network"
  | "source-control"
  | "system"
  | "oauth";

export interface AuthCommandSet {
  readonly login?: string;
  readonly logout?: string;
  readonly refresh?: string;
}

export interface CredentialEnvMapping {
  readonly name: string;
  readonly sourcePath: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface CredentialSlotDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: CredentialSlotCategory;
  readonly paths: readonly string[];
  readonly description?: string;
  readonly mirrorByDefault?: boolean;
  readonly synthetic?: boolean;
}

export interface AuthProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: AuthProviderKind;
  readonly slotId: string;
  readonly description?: string;
  readonly commands?: AuthCommandSet;
  readonly env?: readonly CredentialEnvMapping[];
}

export interface CredentialMirrorRule {
  readonly id: string;
  readonly sourcePath: string;
  readonly target: "vfs" | "env";
  readonly envName?: string;
  readonly required?: boolean;
}

export interface AgentWasmAuthManifest {
  readonly slots: readonly CredentialSlotDefinition[];
  readonly providers: readonly AuthProviderDefinition[];
  readonly mirrorRules: readonly CredentialMirrorRule[];
}

export const agentWasmCredentialPaths = {
  claudeCredentials: "/home/user/.claude/.credentials.json",
  claudeConfig: "/home/user/.claude/.config.json",
  claudeLegacyConfig: "/home/user/.claude.json",
  codexAuth: "/home/user/.codex/auth.json",
  codexConfigToml: "/home/user/.codex/config.toml",
  codexConfigJson: "/home/user/.codex/config.json",
  piAuth: "/home/user/.pi/agent/auth.json",
  piSettings: "/home/user/.pi/agent/settings.json",
  piModels: "/home/user/.pi/agent/models.json",
  githubHosts: "/home/user/.config/gh/hosts.yml",
  awsConfig: "/home/user/.config/almostnode/aws/config.json",
  awsAuth: "/home/user/.config/almostnode/aws/auth.json",
  infisicalConfig: "/home/user/.infisical/infisical-config.json",
  infisicalAuth: "/home/user/.infisical/auth.json",
  flyConfig: "/home/user/.fly/config.yml",
  netlifyConfig: "/home/user/.config/netlify/config.json",
  netlifyLegacyConfig: "/home/user/.netlify/config.json",
  wranglerConfig: "/home/user/.config/.wrangler/config/default.toml",
  wranglerLegacyConfig: "/home/user/.wrangler/config/default.toml",
  neonCredentials: "/home/user/.config/neonctl/credentials.json",
  appBuildingConfig: "/__almostnode/keychain/app-building-config.json",
  opencodeAuth: "/opencode/data/opencode/auth.json",
  opencodeMcpAuth: "/opencode/data/opencode/mcp-auth.json",
  opencodeConfig: "/opencode/config/opencode/opencode.json",
  opencodeConfigJsonc: "/opencode/config/opencode/opencode.jsonc",
  opencodeLegacyConfig: "/opencode/config/opencode/config.json",
  replayAuth: "/home/user/.replay/auth.json",
  tailscaleSession: "/__almostnode/keychain/tailscale-session.json",
} as const;

export function defineCredentialSlot(
  slot: CredentialSlotDefinition,
): CredentialSlotDefinition {
  return slot;
}

export function defineAuthProvider(
  provider: AuthProviderDefinition,
): AuthProviderDefinition {
  return provider;
}

export const defaultCredentialSlots = [
  defineCredentialSlot({
    id: "claude",
    label: "Claude Code",
    category: "agent",
    description: "Claude Code OAuth and legacy credentials.",
    paths: [
      agentWasmCredentialPaths.claudeCredentials,
      agentWasmCredentialPaths.claudeConfig,
      agentWasmCredentialPaths.claudeLegacyConfig,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "codex",
    label: "Codex",
    category: "agent",
    description: "Codex ChatGPT auth, API key, and CLI config.",
    paths: [
      agentWasmCredentialPaths.codexAuth,
      agentWasmCredentialPaths.codexConfigToml,
      agentWasmCredentialPaths.codexConfigJson,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "opencode",
    label: "OpenCode",
    category: "agent",
    description: "OpenCode auth, MCP auth, and config files.",
    paths: [
      agentWasmCredentialPaths.opencodeAuth,
      agentWasmCredentialPaths.opencodeMcpAuth,
      agentWasmCredentialPaths.opencodeConfigJsonc,
      agentWasmCredentialPaths.opencodeConfig,
      agentWasmCredentialPaths.opencodeLegacyConfig,
    ],
  }),
  defineCredentialSlot({
    id: "pi",
    label: "Pi Agent",
    category: "agent",
    paths: [
      agentWasmCredentialPaths.piAuth,
      agentWasmCredentialPaths.piSettings,
      agentWasmCredentialPaths.piModels,
    ],
  }),
  defineCredentialSlot({
    id: "github",
    label: "GitHub",
    category: "source-control",
    paths: [agentWasmCredentialPaths.githubHosts],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "aws",
    label: "AWS",
    category: "cloud",
    paths: [
      agentWasmCredentialPaths.awsConfig,
      agentWasmCredentialPaths.awsAuth,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "infisical",
    label: "Infisical",
    category: "cloud",
    paths: [
      agentWasmCredentialPaths.infisicalConfig,
      agentWasmCredentialPaths.infisicalAuth,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "fly",
    label: "Fly.io",
    category: "cloud",
    paths: [agentWasmCredentialPaths.flyConfig],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "netlify",
    label: "Netlify",
    category: "cloud",
    paths: [
      agentWasmCredentialPaths.netlifyConfig,
      agentWasmCredentialPaths.netlifyLegacyConfig,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "cloudflare",
    label: "Cloudflare",
    category: "cloud",
    paths: [
      agentWasmCredentialPaths.wranglerConfig,
      agentWasmCredentialPaths.wranglerLegacyConfig,
    ],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "neon",
    label: "Neon",
    category: "database",
    paths: [agentWasmCredentialPaths.neonCredentials],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "app-building",
    label: "App Building",
    category: "system",
    paths: [agentWasmCredentialPaths.appBuildingConfig],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "replay",
    label: "Replay.io",
    category: "cloud",
    paths: [agentWasmCredentialPaths.replayAuth],
    mirrorByDefault: true,
  }),
  defineCredentialSlot({
    id: "tailscale",
    label: "Tailscale",
    category: "network",
    paths: [agentWasmCredentialPaths.tailscaleSession],
    synthetic: true,
  }),
] as const satisfies readonly CredentialSlotDefinition[];

export const defaultAuthProviders = [
  defineAuthProvider({
    id: "claude",
    label: "Claude Code",
    kind: "cli",
    slotId: "claude",
    env: [
      {
        name: "ANTHROPIC_API_KEY",
        sourcePath: agentWasmCredentialPaths.claudeCredentials,
        description: "Claude OAuth access token exposed for agent harnesses.",
      },
    ],
  }),
  defineAuthProvider({
    id: "codex",
    label: "Codex",
    kind: "browser-oauth",
    slotId: "codex",
    commands: {
      login: "codex login",
      logout: "codex logout",
    },
    env: [
      {
        name: "OPENAI_API_KEY",
        sourcePath: agentWasmCredentialPaths.codexAuth,
      },
      {
        name: "CODEX_API_KEY",
        sourcePath: agentWasmCredentialPaths.codexAuth,
      },
      {
        name: "CODEX_ACCESS_TOKEN",
        sourcePath: agentWasmCredentialPaths.codexAuth,
      },
      {
        name: "CODEX_CHATGPT_ACCOUNT_ID",
        sourcePath: agentWasmCredentialPaths.codexAuth,
      },
    ],
  }),
  defineAuthProvider({
    id: "github",
    label: "GitHub",
    kind: "cli",
    slotId: "github",
    commands: {
      login: "gh auth login",
      logout: "gh auth logout",
    },
    env: [
      {
        name: "GITHUB_TOKEN",
        sourcePath: agentWasmCredentialPaths.githubHosts,
      },
    ],
  }),
  defineAuthProvider({
    id: "aws",
    label: "AWS",
    kind: "cli",
    slotId: "aws",
  }),
  defineAuthProvider({
    id: "infisical",
    label: "Infisical",
    kind: "cli",
    slotId: "infisical",
    commands: {
      login: "infisical login",
      logout: "infisical logout",
    },
  }),
  defineAuthProvider({
    id: "fly",
    label: "Fly.io",
    kind: "browser-oauth",
    slotId: "fly",
    commands: {
      login: "fly auth login",
      logout: "fly auth logout",
    },
  }),
  defineAuthProvider({
    id: "netlify",
    label: "Netlify",
    kind: "browser-oauth",
    slotId: "netlify",
    commands: {
      login: "netlify login",
      logout: "netlify logout",
    },
  }),
  defineAuthProvider({
    id: "cloudflare",
    label: "Cloudflare",
    kind: "browser-oauth",
    slotId: "cloudflare",
    commands: {
      login: "wrangler login",
      logout: "wrangler logout",
    },
  }),
  defineAuthProvider({
    id: "neon",
    label: "Neon",
    kind: "cli",
    slotId: "neon",
    commands: {
      login: "neon auth login",
      logout: "neon auth logout",
    },
  }),
  defineAuthProvider({
    id: "replay",
    label: "Replay.io",
    kind: "cli",
    slotId: "replay",
    commands: {
      login: "replayio login",
      logout: "replayio logout",
    },
    env: [
      {
        name: "RECORD_REPLAY_API_KEY",
        sourcePath: agentWasmCredentialPaths.replayAuth,
      },
    ],
  }),
  defineAuthProvider({
    id: "tailscale",
    label: "Tailscale",
    kind: "workspace",
    slotId: "tailscale",
  }),
] as const satisfies readonly AuthProviderDefinition[];

export function getCredentialSlot(
  slots: readonly CredentialSlotDefinition[],
  slotId: string,
): CredentialSlotDefinition | undefined {
  return slots.find((slot) => slot.id === slotId);
}

export function getCredentialPathsForSlots(
  slots: readonly CredentialSlotDefinition[],
  slotIds: readonly string[],
): string[] {
  const selected = new Set(slotIds);
  return uniqueStrings(
    slots
      .filter((slot) => selected.has(slot.id))
      .flatMap((slot) => slot.paths),
  );
}

export function getDefaultCredentialMirrorPaths(
  slots: readonly CredentialSlotDefinition[] = defaultCredentialSlots,
): string[] {
  return uniqueStrings(
    slots
      .filter((slot) => slot.mirrorByDefault)
      .flatMap((slot) => slot.paths),
  );
}

export function createCredentialMirrorRules(
  paths: readonly string[],
): CredentialMirrorRule[] {
  return paths.map((path) => ({
    id: `vfs:${path}`,
    sourcePath: path,
    target: "vfs",
  }));
}

export function createAuthManifest(input: {
  slots?: readonly CredentialSlotDefinition[];
  providers?: readonly AuthProviderDefinition[];
  mirrorRules?: readonly CredentialMirrorRule[];
} = {}): AgentWasmAuthManifest {
  const slots = input.slots ?? defaultCredentialSlots;
  return {
    slots,
    providers: input.providers ?? defaultAuthProviders,
    mirrorRules:
      input.mirrorRules ?? createCredentialMirrorRules(getDefaultCredentialMirrorPaths(slots)),
  };
}

export const defaultAgentWasmAuthManifest = createAuthManifest();

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}
