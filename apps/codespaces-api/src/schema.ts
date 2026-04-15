import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const githubSessions = sqliteTable("github_sessions", {
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  userId: integer("user_id").notNull(),
  avatarUrl: text("avatar_url"),
  accessTokenCiphertext: text("access_token_ciphertext").notNull(),
  accessTokenIv: text("access_token_iv").notNull(),
  accessTokenExpiresAt: integer("access_token_expires_at"),
  scopes: text("scopes"),
  tokenType: text("token_type"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const githubDeviceSessions = sqliteTable("github_device_sessions", {
  deviceCode: text("device_code").primaryKey(),
  userCode: text("user_code").notNull(),
  verificationUri: text("verification_uri").notNull(),
  verificationUriComplete: text("verification_uri_complete"),
  intervalSeconds: integer("interval_seconds").notNull(),
  expiresAt: integer("expires_at").notNull(),
  sessionId: text("session_id"),
  createdAt: integer("created_at").notNull(),
  lastPolledAt: integer("last_polled_at"),
});

export const projectCodespaces = sqliteTable("project_codespaces", {
  projectId: text("project_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  branch: text("branch").notNull(),
  remoteUrl: text("remote_url").notNull(),
  codespaceName: text("codespace_name"),
  codespaceDisplayName: text("codespace_display_name"),
  codespaceWebUrl: text("codespace_web_url"),
  codespaceState: text("codespace_state"),
  codespaceMachine: text("codespace_machine"),
  idleTimeoutMinutes: integer("idle_timeout_minutes"),
  retentionHours: integer("retention_hours"),
  supportsBridge: integer("supports_bridge", { mode: "boolean" }).notNull(),
  lastSyncedAt: integer("last_synced_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const syncJobs = sqliteTable("sync_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  codespaceName: text("codespace_name").notNull(),
  secretName: text("secret_name").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
