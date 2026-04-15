import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { loadConfig } from "./config.js";
import * as schema from "./schema.js";

export interface CodespacesDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

const config = loadConfig();
const sqlite = new Database(config.dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS github_sessions (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    avatar_url TEXT,
    access_token_ciphertext TEXT NOT NULL,
    access_token_iv TEXT NOT NULL,
    access_token_expires_at INTEGER,
    scopes TEXT,
    token_type TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS github_device_sessions (
    device_code TEXT PRIMARY KEY,
    user_code TEXT NOT NULL,
    verification_uri TEXT NOT NULL,
    verification_uri_complete TEXT,
    interval_seconds INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    session_id TEXT,
    created_at INTEGER NOT NULL,
    last_polled_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS project_codespaces (
    project_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    remote_url TEXT NOT NULL,
    codespace_name TEXT,
    codespace_display_name TEXT,
    codespace_web_url TEXT,
    codespace_state TEXT,
    codespace_machine TEXT,
    idle_timeout_minutes INTEGER,
    retention_hours INTEGER,
    supports_bridge INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    codespace_name TEXT NOT NULL,
    secret_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );
`);

export const database: CodespacesDatabase = {
  sqlite,
  db: drizzle(sqlite, { schema }),
};
