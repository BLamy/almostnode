import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface CodespacesApiConfig {
  port: number;
  host: string;
  dbPath: string;
  githubClientId: string;
  encryptionKey: Buffer;
}

function resolveEncryptionKey(): Buffer {
  const configured = process.env.CODESPACES_API_ENCRYPTION_KEY?.trim();
  if (configured) {
    if (/^[0-9a-fA-F]{64}$/.test(configured)) {
      return Buffer.from(configured, "hex");
    }
    return Buffer.from(configured, "base64");
  }

  return createHash("sha256")
    .update("almostnode-codespaces-api-dev-key")
    .digest();
}

export function loadConfig(): CodespacesApiConfig {
  const dbPath = resolve(
    process.cwd(),
    process.env.CODESPACES_API_DB_PATH || ".data/codespaces-api.sqlite",
  );
  mkdirSync(dirname(dbPath), { recursive: true });

  return {
    port: Number(process.env.CODESPACES_API_PORT || 4167),
    host: process.env.CODESPACES_API_HOST || "127.0.0.1",
    dbPath,
    githubClientId:
      process.env.GITHUB_CODESPACES_CLIENT_ID
      || process.env.GITHUB_CLIENT_ID
      || "",
    encryptionKey: resolveEncryptionKey(),
  };
}
