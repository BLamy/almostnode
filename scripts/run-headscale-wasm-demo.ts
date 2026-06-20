#!/usr/bin/env tsx

import { chromium } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import net from "node:net";

import {
  handleTailscaleAuthKeyApiRequest,
  TAILSCALE_AUTH_KEY_API_PATH,
  type TailscaleAuthKeyApiEnv,
  verifyAuth0Jwt,
} from "../apps/web-ide/src/features/tailscale-auth-key-api";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const headscaleRoot = join(repoRoot, "vendor", "headscale");
const replayDashboardEnvPath = join(
  process.env.HOME || "",
  "Dev",
  "replay",
  "dashboard",
  ".env.local",
);
const preferredDemoPort = 8080;
const preferredHeadscalePort = 18080;
const preferredMetricsPort = 19090;
const preferredGrpcPort = 15043;
const demoAccessTokenCookieName = "auth-token";
const demoAuthLoginPath = "/__demo/auth/login";
const demoAuthLogoutPath = "/__demo/auth/logout";
const demoAuthSessionPath = "/__demo/auth/session";
const demoConnectedPath = "/connected";

interface DemoArgs {
  keepOpen: boolean;
  noInteractiveAuth: boolean;
}

interface HeadscaleRuntime {
  apiKey: string;
  configPath: string;
  dataDir: string;
  headscalePort: number;
  metricsPort: number;
  grpcPort: number;
  process: ChildProcessWithoutNullStreams;
  userId: string;
}

interface ExitNodeRuntime {
  dataDir: string;
  hostname: string;
  nodeId: number;
  process: ChildProcessWithoutNullStreams;
  routes: unknown;
  socketPath: string;
  status: unknown;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function parseArgs(): DemoArgs {
  const argv = new Set(process.argv.slice(2));
  return {
    keepOpen: argv.has("--keep-open"),
    noInteractiveAuth: argv.has("--no-interactive-auth"),
  };
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    value = value.replace(/^['"]|['"]$/g, "");
    env[match[1]] = value;
  }
  return env;
}

function mergeAuth0Env(): Record<string, string> {
  const replayEnv = parseEnvFile(replayDashboardEnvPath);
  return {
    AUTH0_CLIENT_ID: "J0U5KKcVSO451nCeBO0XaOfgrQrtXpu2",
    AUTH0_ISSUER_BASE_URL: "https://webreplay.us.auth0.com",
    AUTH0_DOMAIN: "webreplay.us.auth0.com",
    AUTH0_AUDIENCE: "https://webreplay.us.auth0.com/me/",
    ...replayEnv,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => typeof value === "string"),
    ) as Record<string, string>,
  };
}

async function findFreePort(preferred: number): Promise<number> {
  if (await canListen(preferred)) {
    return preferred;
  }
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a TCP port.")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePort(true));
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

function writeHeadscaleConfig(input: {
  dataDir: string;
  headscalePort: number;
  metricsPort: number;
  grpcPort: number;
}): string {
  const templatePath = join(headscaleRoot, "config-example.yaml");
  let config = readFileSync(templatePath, "utf8");
  const replacements: Array<[RegExp, string]> = [
    [/server_url: http:\/\/127\.0\.0\.1:8080/, `server_url: http://127.0.0.1:${input.headscalePort}`],
    [/listen_addr: 127\.0\.0\.1:8080/, `listen_addr: 127.0.0.1:${input.headscalePort}`],
    [/metrics_listen_addr: 127\.0\.0\.1:9090/, `metrics_listen_addr: 127.0.0.1:${input.metricsPort}`],
    [/grpc_listen_addr: 127\.0\.0\.1:50443/, `grpc_listen_addr: 127.0.0.1:${input.grpcPort}`],
    [
      /private_key_path: \/var\/lib\/headscale\/noise_private\.key/,
      `private_key_path: ${join(input.dataDir, "noise_private.key")}`,
    ],
    [
      /private_key_path: \/var\/lib\/headscale\/derp_server_private\.key/,
      `private_key_path: ${join(input.dataDir, "derp_server_private.key")}`,
    ],
    [/path: \/var\/lib\/headscale\/db\.sqlite/, `path: ${join(input.dataDir, "db.sqlite")}`],
    [/unix_socket: \/var\/run\/headscale\/headscale\.sock/, `unix_socket: ${join(input.dataDir, "headscale.sock")}`],
  ];
  for (const [pattern, replacement] of replacements) {
    config = config.replace(pattern, replacement);
  }
  const configPath = join(input.dataDir, "config.yaml");
  writeFileSync(configPath, config);
  return configPath;
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function startHeadscale(): Promise<HeadscaleRuntime> {
  const dataDir = mkdtempSync(join(tmpdir(), "almostnode-headscale-wasm-demo-"));
  const headscalePort = await findFreePort(preferredHeadscalePort);
  const metricsPort = await findFreePort(preferredMetricsPort);
  const grpcPort = await findFreePort(preferredGrpcPort);
  const configPath = writeHeadscaleConfig({
    dataDir,
    headscalePort,
    metricsPort,
    grpcPort,
  });

  await runCommand("go", ["run", "./cmd/headscale", "-c", configPath, "configtest"], {
    cwd: headscaleRoot,
  });

  const child = spawn(
    "go",
    ["run", "./cmd/headscale", "-c", configPath, "serve"],
    {
      cwd: headscaleRoot,
      detached: true,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[headscale] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[headscale] ${chunk.toString()}`);
  });

  await waitForHttpOk(`http://127.0.0.1:${headscalePort}/key?v=113`, 45_000);

  const userResult = await runCommand(
    "go",
    ["run", "./cmd/headscale", "-c", configPath, "users", "create", "browser", "-o", "json"],
    { cwd: headscaleRoot },
  );
  const user = JSON.parse(userResult.stdout) as { id?: number | string };
  const userId = String(user.id || "1");
  const apiKeyResult = await runCommand(
    "go",
    ["run", "./cmd/headscale", "-c", configPath, "apikeys", "create", "-e", "24h"],
    { cwd: headscaleRoot },
  );
  const apiKey = apiKeyResult.stdout.trim();
  if (!apiKey.startsWith("hskey-api-")) {
    throw new Error("Headscale did not return an API key.");
  }

  return {
    apiKey,
    configPath,
    dataDir,
    headscalePort,
    metricsPort,
    grpcPort,
    process: child,
    userId,
  };
}

async function tryClientCredentialsToken(auth0: Record<string, string>): Promise<string | null> {
  if (!auth0.AUTH0_CLIENT_SECRET) {
    return null;
  }
  const response = await fetch(`https://${auth0.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: auth0.AUTH0_CLIENT_ID,
      client_secret: auth0.AUTH0_CLIENT_SECRET,
      audience: auth0.AUTH0_AUDIENCE,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(
      `[auth0] client_credentials unavailable: ${payload.error || response.status} ${payload.error_description || ""}`.trim(),
    );
    return null;
  }
  return typeof payload.access_token === "string" ? payload.access_token : null;
}

async function exchangeAuth0AuthorizationCode(input: {
  auth0: Record<string, string>;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(`https://${input.auth0.AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: input.auth0.AUTH0_CLIENT_ID,
      client_secret: input.auth0.AUTH0_CLIENT_SECRET,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`Auth0 token exchange failed: ${payload.error_description || payload.error || response.status}`);
  }
  return {
    accessToken: payload.access_token,
    expiresIn:
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : 3600,
  };
}

function buildAuth0AuthorizeUrl(input: {
  auth0: Record<string, string>;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): URL {
  const authorizeUrl = new URL(`https://${input.auth0.AUTH0_DOMAIN}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", input.auth0.AUTH0_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("audience", input.auth0.AUTH0_AUDIENCE);
  authorizeUrl.searchParams.set("state", input.state);
  authorizeUrl.searchParams.set("code_challenge", input.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return authorizeUrl;
}

async function getInteractiveAuth0Token(
  auth0: Record<string, string>,
  port: number,
): Promise<string> {
  if (!auth0.AUTH0_CLIENT_SECRET) {
    throw new Error("AUTH0_CLIENT_SECRET is required for interactive auth-code exchange.");
  }
  const redirectUri = `http://localhost:${port}/api/auth/callback`;
  const state = randomUUID();
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  const tokenPromise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveToken = resolvePromise;
    rejectToken = rejectPromise;
  });
  const callbackServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", redirectUri);
      if (url.pathname !== "/api/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        throw new Error("Auth0 callback state mismatch.");
      }
      const code = url.searchParams.get("code");
      if (!code) {
        throw new Error(url.searchParams.get("error_description") || "Auth0 callback did not include a code.");
      }
      const { accessToken } = await exchangeAuth0AuthorizationCode({
        auth0,
        code,
        codeVerifier,
        redirectUri,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      const demoUrl = `http://localhost:${port}/`;
      res.end(`<!doctype html>
<title>Authenticated</title>
<p>Auth0 token received. Open <a href="${demoUrl}">${demoUrl}</a> after the terminal prints that the demo is running.</p>`);
      resolveToken(accessToken);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(error instanceof Error ? error.message : String(error));
      rejectToken(error instanceof Error ? error : new Error(String(error)));
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    callbackServer.once("error", rejectListen);
    callbackServer.listen(port, "127.0.0.1", () => resolveListen());
  });

  const authorizeUrl = buildAuth0AuthorizeUrl({
    auth0,
    redirectUri,
    state,
    codeChallenge,
  });

  console.log(`[auth0] opening ${authorizeUrl.origin}/authorize for interactive login on localhost:${port}`);
  await runCommand("open", [authorizeUrl.toString()], { cwd: repoRoot }).catch(() => {
    console.log(`[auth0] open this URL in a browser to continue: ${authorizeUrl.toString()}`);
  });

  try {
    return await withTimeout(tokenPromise, 240_000, "Timed out waiting for Auth0 login callback.");
  } finally {
    await new Promise<void>((resolveClose) => callbackServer.close(() => resolveClose()));
  }
}

async function getAuth0Token(auth0: Record<string, string>, args: DemoArgs): Promise<string> {
  const existing = process.env.AUTH0_ACCESS_TOKEN || process.env.REPLAY_AUTH0_ACCESS_TOKEN;
  if (existing) {
    console.log("[auth0] using bearer token from environment");
    return existing;
  }
  const clientCredentialsToken = await tryClientCredentialsToken(auth0);
  if (clientCredentialsToken) {
    console.log("[auth0] acquired bearer token with client_credentials");
    return clientCredentialsToken;
  }
  if (args.noInteractiveAuth) {
    throw new Error(
      "No Auth0 bearer token available. Set AUTH0_ACCESS_TOKEN or rerun without --no-interactive-auth.",
    );
  }
  return getInteractiveAuth0Token(auth0, preferredDemoPort);
}

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function stopProcessTree(
  child: ChildProcessWithoutNullStreams,
  label: string,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closePromise = new Promise<void>((resolveClose) => {
    child.once("close", () => resolveClose());
  });
  try {
    if (child.pid) {
      process.kill(-child.pid, "SIGINT");
    } else {
      child.kill("SIGINT");
    }
  } catch {
    child.kill("SIGINT");
  }
  try {
    await withTimeout(closePromise, 8_000, `${label} did not stop after SIGINT.`);
  } catch {
    try {
      if (child.pid) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
    await withTimeout(closePromise, 5_000, `${label} did not stop after SIGKILL.`);
  }
}

async function stopHeadscaleProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  await stopProcessTree(child, "Headscale");
}

async function stopExitNodeProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  await stopProcessTree(child, "Exit-node tailscaled");
}

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 150));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headersFromIncoming(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("="));
    } catch {
      cookies[rawName] = rawValue.join("=");
    }
  }
  return cookies;
}

function readAccessTokenCookie(req: IncomingMessage): string | null {
  return parseCookieHeader(req.headers.cookie)[demoAccessTokenCookieName] || null;
}

function writeJsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function redirectResponse(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.end();
}

function setAccessTokenCookie(
  res: ServerResponse,
  token: string,
  maxAgeSeconds: number,
): void {
  res.setHeader(
    "set-cookie",
    `${demoAccessTokenCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`,
  );
}

function clearAccessTokenCookie(res: ServerResponse): void {
  res.setHeader(
    "set-cookie",
    `${demoAccessTokenCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

async function proxyHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetOrigin: string,
): Promise<void> {
  const target = new URL(req.url || "/", targetOrigin);
  const body = await readRequestBody(req);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
    } else if (typeof value === "string") {
      headers[key] = value;
    }
  }
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD" || body.length === 0
        ? undefined
        : body,
    redirect: "manual",
  });
  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function attachHeadscaleWebSocketProxy(
  httpServer: NonNullable<Awaited<ReturnType<typeof createViteServer>>["httpServer"]>,
  targetOrigin: string,
): void {
  const relayServer = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = req.url ? new URL(req.url, "http://127.0.0.1").pathname : "";
    if (pathname !== "/ts2021") {
      return;
    }
    relayServer.handleUpgrade(req, socket, head, (client) => {
      const target = new URL(req.url || "/ts2021", targetOrigin);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      const protocols = typeof req.headers["sec-websocket-protocol"] === "string"
        ? req.headers["sec-websocket-protocol"].split(",").map((item) => item.trim()).filter(Boolean)
        : undefined;
      const upstream = new WebSocket(target, protocols);
      client.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      });
      upstream.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });
      const closePeer = (peer: WebSocket, code: number, reason: Buffer) => {
        if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING) {
          const closeCode =
            code >= 1000 &&
            code <= 4999 &&
            ![1005, 1006, 1015].includes(code)
              ? code
              : 1000;
          peer.close(closeCode, reason.toString("utf8").slice(0, 123));
        }
      };
      client.on("close", (code, reason) => closePeer(upstream, code, reason));
      upstream.on("close", (code, reason) => closePeer(client, code, reason));
      client.on("error", () => upstream.terminate());
      upstream.on("error", () => client.terminate());
    });
  });
}

function writeDemoApp(root: string): void {
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Almostnode Headscale WASM Demo</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f5f7fb;
        color: #16202a;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button {
        border: 0;
        border-radius: 6px;
        cursor: pointer;
      }
      .app-shell {
        min-height: 100vh;
        padding: 40px 20px;
      }
      .wrap {
        width: min(960px, 100%);
        margin: 0 auto;
      }
      .topbar {
        align-items: center;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 24px;
      }
      .brand {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .panel {
        background: #ffffff;
        border: 1px solid #d8e0ea;
        border-radius: 8px;
        box-shadow: 0 16px 45px rgba(37, 51, 67, 0.08);
        padding: 28px;
      }
      .login-panel {
        margin-top: 14vh;
        max-width: 520px;
      }
      h1 {
        font-size: clamp(28px, 5vw, 46px);
        line-height: 1.04;
        letter-spacing: 0;
        margin: 0 0 14px;
      }
      h2 {
        font-size: 22px;
        letter-spacing: 0;
        margin: 0;
      }
      p {
        color: #536273;
        line-height: 1.55;
        margin: 0 0 22px;
      }
      .primary {
        align-items: center;
        background: #1663d8;
        color: #ffffff;
        display: inline-flex;
        font-weight: 700;
        gap: 8px;
        min-height: 44px;
        padding: 0 18px;
      }
      .secondary {
        background: #eef3f8;
        color: #243447;
        min-height: 36px;
        padding: 0 12px;
      }
      .status-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin: 20px 0;
      }
      .metric {
        border: 1px solid #dce4ee;
        border-radius: 8px;
        padding: 14px;
      }
      .metric-label {
        color: #67778a;
        display: block;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .metric-value {
        color: #152232;
        display: block;
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .state {
        align-items: center;
        display: inline-flex;
        gap: 8px;
      }
      .dot {
        background: #f0a429;
        border-radius: 999px;
        height: 10px;
        width: 10px;
      }
      .dot.running {
        background: #1d9a61;
      }
      .request-tool {
        border-top: 1px solid #dce4ee;
        margin-top: 22px;
        padding-top: 22px;
      }
      .request-form {
        display: grid;
        gap: 12px;
      }
      .request-row {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(100px, 130px) minmax(0, 1fr) auto;
      }
      .field-label {
        color: #536273;
        display: block;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      input,
      select,
      textarea {
        background: #ffffff;
        border: 1px solid #c9d4e2;
        border-radius: 6px;
        color: #16202a;
        min-height: 42px;
        padding: 0 12px;
        width: 100%;
      }
      textarea {
        line-height: 1.45;
        min-height: 88px;
        padding: 10px 12px;
        resize: vertical;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .advanced {
        border-top: 1px solid #edf1f6;
        padding-top: 10px;
      }
      .advanced summary {
        color: #35465a;
        cursor: pointer;
        font-weight: 700;
      }
      .advanced-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr 1fr;
        margin-top: 12px;
      }
      .exchange-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: 1fr 1fr;
        margin-top: 16px;
      }
      .exchange-title {
        color: #536273;
        font-size: 12px;
        font-weight: 700;
        margin: 0 0 8px;
        text-transform: uppercase;
      }
      pre {
        background: #101820;
        border-radius: 8px;
        color: #dbe7f4;
        font-size: 12px;
        line-height: 1.5;
        margin: 0;
        max-height: 360px;
        overflow: auto;
        padding: 16px;
        white-space: pre-wrap;
      }
      @media (max-width: 720px) {
        .app-shell {
          padding: 24px 14px;
        }
        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }
        .panel {
          padding: 20px;
        }
        .status-grid {
          grid-template-columns: 1fr;
        }
        .request-row,
        .advanced-grid,
        .exchange-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main id="app" class="app-shell"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  );
  writeFileSync(
    join(root, "src", "main.ts"),
    `import { createContainer } from "almostnode";

const appNode = document.getElementById("app")!;
const authLoginPath = ${JSON.stringify(demoAuthLoginPath)};
const authLogoutPath = ${JSON.stringify(demoAuthLogoutPath)};
const authSessionPath = ${JSON.stringify(demoAuthSessionPath)};
const connectedPath = ${JSON.stringify(demoConnectedPath)};
const events: unknown[] = [];
let networkContainer: ReturnType<typeof createContainer> | null = null;
let unloading = false;

interface DemoSession {
  authenticated: boolean;
  email?: string;
  subject?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readSession(): Promise<DemoSession> {
  const response = await fetch(authSessionPath, {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return { authenticated: false };
  }
  return (await response.json()) as DemoSession;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToText(value: string): string {
  if (!value) {
    return "";
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function truncate(value: string, maxLength = 64_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength) + "\\n\\n[truncated " + (value.length - maxLength) + " chars]";
}

function readInput(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return element?.value ?? "";
}

function writeOutput(id: string, value: unknown): void {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function normalizeRequestUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Enter a URL.");
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(trimmed)
    ? trimmed
    : "http://" + trimmed;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  return url.href;
}

function parseHeaderLines(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of value.split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error("Headers must use Name: value format.");
    }
    const name = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    if (name) {
      headers[name] = headerValue;
    }
  }
  return headers;
}

function setRequestControlsEnabled(enabled: boolean): void {
  for (const id of ["request-url", "request-method", "request-headers", "request-body", "send-request"]) {
    const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement | null;
    if (element) {
      element.disabled = !enabled;
    }
  }
}

function getSafeNetworkConfig(): Record<string, unknown> | null {
  if (!networkContainer) {
    return null;
  }
  const config = networkContainer.network.getConfig();
  return {
    provider: config.provider,
    useExitNode: config.useExitNode,
    exitNodeId: config.exitNodeId,
    activeExitNodeId: config.activeExitNodeId ?? null,
    tailscaleConnected: config.tailscaleConnected,
  };
}

async function handleRequestSubmit(event: Event): Promise<void> {
  event.preventDefault();
  if (!networkContainer) {
    writeOutput("response-output", "Tailscale client is not connected yet.");
    return;
  }

  const started = Date.now();
  const method = readInput("request-method").trim().toUpperCase() || "GET";
  const url = normalizeRequestUrl(readInput("request-url"));
  const headers = parseHeaderLines(readInput("request-headers"));
  const bodyText = readInput("request-body");
  const request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
    redirect: RequestRedirect;
    retryOnTailscaleRecovery: boolean;
  } = {
    url,
    method,
    headers,
    redirect: "follow",
    retryOnTailscaleRecovery: true,
  };
  if (bodyText && method !== "GET" && method !== "HEAD") {
    request.bodyBase64 = bytesToBase64(new TextEncoder().encode(bodyText));
  }

  writeOutput("request-output", {
    sentAt: new Date().toISOString(),
    network: getSafeNetworkConfig(),
    ...request,
    bodyText: bodyText || undefined,
    bodyBase64: request.bodyBase64 ? "<" + request.bodyBase64.length + " chars>" : undefined,
  });
  writeOutput("response-output", "waiting for response...");
  setRequestControlsEnabled(false);
  try {
    const response = await networkContainer.network.fetch(request);
    const responseBody = base64ToText(response.bodyBase64);
    writeOutput("response-output", {
      receivedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      bodyText: truncate(responseBody),
      bodyBase64Length: response.bodyBase64.length,
    });
  } catch (error) {
    writeOutput("response-output", {
      receivedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      network: getSafeNetworkConfig(),
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const status = await networkContainer.network.getStatus().catch(() => null);
    setRequestControlsEnabled(status?.state === "running");
  }
}

function record(event: unknown): void {
  events.push(event);
  (globalThis as any).__headscaleWasmDemo = {
    done: false,
    events,
    last: event,
  };
  const logNode = document.getElementById("log");
  if (logNode) {
    logNode.textContent = events.map((item) => JSON.stringify(item)).join("\\n");
    logNode.scrollTop = logNode.scrollHeight;
  }
}

function renderLogin(): void {
  appNode.innerHTML =
    '<div class="wrap login-panel">' +
      '<div class="brand">Almostnode Headscale</div>' +
      '<section class="panel">' +
        '<h1>Browser tailnet login</h1>' +
        '<p>Authenticate with Auth0 to provision an ephemeral Headscale auth key and join the browser WASM client to the demo tailnet.</p>' +
        '<button id="login" class="primary" type="button">Login with Auth0</button>' +
      '</section>' +
    '</div>';
  document.getElementById("login")?.addEventListener("click", () => {
    window.location.assign(authLoginPath);
  });
}

function renderConnected(session: DemoSession): void {
  const principal = session.email || session.subject || "Authenticated";
  appNode.innerHTML =
    '<div class="wrap">' +
      '<div class="topbar">' +
        '<div>' +
          '<div class="brand">Almostnode Headscale</div>' +
          '<h2>Connected session</h2>' +
        '</div>' +
        '<button id="logout" class="secondary" type="button">Log out</button>' +
      '</div>' +
      '<section class="panel">' +
        '<p>' + escapeHtml(principal) + '</p>' +
        '<div class="status-grid">' +
          '<div class="metric"><span class="metric-label">State</span><span id="state" class="metric-value state"><span class="dot"></span><span>Starting</span></span></div>' +
          '<div class="metric"><span class="metric-label">Node</span><span id="node" class="metric-value">Pending</span></div>' +
          '<div class="metric"><span class="metric-label">Tailnet</span><span id="tailnet" class="metric-value">Pending</span></div>' +
          '<div class="metric"><span class="metric-label">Exit node</span><span id="exit-node" class="metric-value">Pending</span></div>' +
        '</div>' +
        '<div class="request-tool">' +
          '<form id="request-form" class="request-form">' +
            '<label><span class="field-label">URL</span></label>' +
            '<div class="request-row">' +
              '<select id="request-method" disabled>' +
                '<option>GET</option>' +
                '<option>HEAD</option>' +
                '<option>POST</option>' +
                '<option>PUT</option>' +
                '<option>PATCH</option>' +
                '<option>DELETE</option>' +
              '</select>' +
              '<input id="request-url" type="text" inputmode="url" value="https://example.com/" placeholder="http://100.64.0.1:3000/ or https://example.com" disabled>' +
              '<button id="send-request" class="primary" type="submit" disabled>Send</button>' +
            '</div>' +
            '<details class="advanced">' +
              '<summary>Request options</summary>' +
              '<div class="advanced-grid">' +
                '<label><span class="field-label">Headers</span><textarea id="request-headers" placeholder="accept: application/json" disabled></textarea></label>' +
                '<label><span class="field-label">Body</span><textarea id="request-body" placeholder="{ }" disabled></textarea></label>' +
              '</div>' +
            '</details>' +
          '</form>' +
          '<div class="exchange-grid">' +
            '<section><h3 class="exchange-title">Request sent</h3><pre id="request-output">waiting for URL...</pre></section>' +
            '<section><h3 class="exchange-title">Response received</h3><pre id="response-output">waiting for response...</pre></section>' +
          '</div>' +
          '<h3 class="exchange-title">Connection log</h3>' +
          '<pre id="log">waiting for browser client...</pre>' +
        '</div>' +
      '</section>' +
    '</div>';
  document.getElementById("logout")?.addEventListener("click", () => {
    void networkContainer?.network.logout().finally(() => {
      window.location.assign(authLogoutPath);
    });
  });
  document.getElementById("request-form")?.addEventListener("submit", (event) => {
    void handleRequestSubmit(event);
  });
}

function updateStatus(status: Record<string, unknown>): void {
  const state = typeof status.state === "string" ? status.state : "unknown";
  const stateNode = document.getElementById("state");
  const dot = stateNode?.querySelector(".dot");
  const stateText = stateNode?.querySelector("span:last-child");
  if (stateText) {
    stateText.textContent = state;
  }
  dot?.classList.toggle("running", state === "running");

  const node = document.getElementById("node");
  if (node) {
    node.textContent = typeof status.selfName === "string" && status.selfName ? status.selfName : "Pending";
  }
  const tailnet = document.getElementById("tailnet");
  if (tailnet) {
    tailnet.textContent = typeof status.tailnetName === "string" && status.tailnetName ? status.tailnetName : "Pending";
  }
  const exitNode = document.getElementById("exit-node");
  if (exitNode) {
    const exitNodes = Array.isArray(status.exitNodes) ? status.exitNodes as Array<Record<string, unknown>> : [];
    const selectedExitNode = exitNodes.find((candidate) => candidate.selected) || exitNodes.find((candidate) => candidate.online) || null;
    exitNode.textContent = selectedExitNode
      ? String(selectedExitNode.name || selectedExitNode.id || "Available")
      : "Pending";
  }
  setRequestControlsEnabled(state === "running");
}

async function waitForRunning(container: ReturnType<typeof createContainer>): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const status = await container.network.getStatus();
    updateStatus(status as Record<string, unknown>);
    record({ type: "poll", status });
    if (status.state === "running") {
      return status;
    }
    if (status.state === "error" || status.state === "locked") {
      throw new Error(status.detail || "Tailscale failed to connect.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for Tailscale to reach running state.");
}

async function startTailnet(): Promise<void> {
  const provisionResponse = await fetch("/__api/tailscale/auth-key", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ hostname: "almostnode-wasm-demo" }),
  });
  const provisioned = await provisionResponse.json();
  record({
    type: "provision",
    ok: provisionResponse.ok,
    status: provisionResponse.status,
    body: { ...provisioned, authKey: provisioned.authKey ? "<redacted>" : undefined },
  });
  if (!provisionResponse.ok) {
    throw new Error(\`Provisioning failed with HTTP \${provisionResponse.status}\`);
  }

  const container = createContainer({
    network: {
      provider: "tailscale",
      authMode: "auth-key",
      authKey: provisioned.authKey,
      controlUrl: provisioned.controlUrl,
      hostname: provisioned.hostname || "almostnode-wasm-demo",
      useExitNode: provisioned.useExitNode !== false,
      acceptDns: true,
    },
  });
  networkContainer = container;
  container.network.subscribe((status) => {
    updateStatus(status as Record<string, unknown>);
    record({ type: "status", status });
  });
  const loginStatus = await container.network.login();
  updateStatus(loginStatus as Record<string, unknown>);
  record({ type: "login", status: loginStatus });
  const runningStatus = await waitForRunning(container);
  (globalThis as any).__headscaleWasmDemo = {
    done: true,
    events,
    status: runningStatus,
  };
}

async function main(): Promise<void> {
  window.addEventListener("pagehide", () => {
    if (unloading) {
      return;
    }
    unloading = true;
    void networkContainer?.network.logout();
  }, { once: true });

  const session = await readSession();
  if (!session.authenticated) {
    if (window.location.pathname !== "/") {
      window.location.replace("/");
      return;
    }
    renderLogin();
    return;
  }

  if (window.location.pathname !== connectedPath) {
    window.location.replace(connectedPath);
    return;
  }

  renderConnected(session);
  await startTailnet();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  appNode.innerHTML =
    '<div class="wrap login-panel"><section class="panel"><h1>Connection failed</h1><pre id="log"></pre></section></div>';
  record({ type: "error", message });
  (globalThis as any).__headscaleWasmDemo = {
    done: false,
    error: message,
    events,
  };
});
`,
  );
}

async function startDemoServer(input: {
  auth0: Record<string, string>;
  demoPort: number;
  headscale: HeadscaleRuntime;
  root: string;
}) {
  writeDemoApp(input.root);
  const targetOrigin = `http://127.0.0.1:${input.headscale.headscalePort}`;
  const apiEnv: TailscaleAuthKeyApiEnv = {
    AUTH0_ISSUER_BASE_URL: input.auth0.AUTH0_ISSUER_BASE_URL,
    AUTH0_AUDIENCE: input.auth0.AUTH0_AUDIENCE,
    AUTH0_CLIENT_ID: input.auth0.AUTH0_CLIENT_ID,
    AUTH0_JWKS_URI: `${input.auth0.AUTH0_ISSUER_BASE_URL.replace(/\/+$/, "")}/.well-known/jwks.json`,
    ALMOSTNODE_HEADSCALE_URL: `http://localhost:${input.demoPort}`,
    ALMOSTNODE_HEADSCALE_API_KEY: input.headscale.apiKey,
    ALMOSTNODE_HEADSCALE_USER: input.headscale.userId,
    ALMOSTNODE_HEADSCALE_EPHEMERAL: "true",
    ALMOSTNODE_HEADSCALE_REUSABLE: "false",
    ALMOSTNODE_HEADSCALE_AUTHKEY_EXPIRATION_SECONDS: "3600",
  };
  const callbackOrigin = `http://localhost:${input.demoPort}`;
  const pendingAuth = new Map<
    string,
    { codeVerifier: string; redirectUri: string; expiresAt: number }
  >();
  const cleanupPendingAuth = () => {
    const now = Date.now();
    for (const [state, pending] of pendingAuth) {
      if (pending.expiresAt <= now) {
        pendingAuth.delete(state);
      }
    }
  };
  const proxyPaths = new Set(["/key", "/api/v1/preauthkey"]);
  const proxyPlugin: Plugin = {
    name: "headscale-wasm-demo-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url ? new URL(req.url, "http://127.0.0.1").pathname : "";
        if (pathname === demoAuthSessionPath) {
          const token = readAccessTokenCookie(req);
          if (!token) {
            writeJsonResponse(res, 200, { authenticated: false });
            return;
          }
          try {
            const claims = await verifyAuth0Jwt(token, {
              env: apiEnv,
              fetchImpl: globalThis.fetch.bind(globalThis),
              now: new Date(),
            });
            writeJsonResponse(res, 200, {
              authenticated: true,
              subject: claims.sub,
              email: claims.email,
            });
          } catch {
            clearAccessTokenCookie(res);
            writeJsonResponse(res, 200, { authenticated: false });
          }
          return;
        }
        if (pathname === demoAuthLoginPath) {
          if (req.method !== "GET") {
            writeJsonResponse(res, 405, { error: "method_not_allowed" });
            return;
          }
          if (!input.auth0.AUTH0_CLIENT_SECRET) {
            writeJsonResponse(res, 500, { error: "missing_auth0_client_secret" });
            return;
          }
          cleanupPendingAuth();
          const state = randomUUID();
          const codeVerifier = base64Url(randomBytes(48));
          const codeChallenge = base64Url(
            createHash("sha256").update(codeVerifier).digest(),
          );
          const redirectUri = `${callbackOrigin}/api/auth/callback`;
          pendingAuth.set(state, {
            codeVerifier,
            redirectUri,
            expiresAt: Date.now() + 10 * 60 * 1000,
          });
          const authorizeUrl = buildAuth0AuthorizeUrl({
            auth0: input.auth0,
            redirectUri,
            state,
            codeChallenge,
          });
          redirectResponse(res, authorizeUrl.toString());
          return;
        }
        if (pathname === "/api/auth/callback") {
          if (req.method !== "GET") {
            writeJsonResponse(res, 405, { error: "method_not_allowed" });
            return;
          }
          try {
            const url = new URL(req.url || "/", callbackOrigin);
            const state = url.searchParams.get("state") || "";
            const pending = pendingAuth.get(state);
            pendingAuth.delete(state);
            if (!pending || pending.expiresAt <= Date.now()) {
              throw new Error("Auth0 callback state expired or was not found.");
            }
            const code = url.searchParams.get("code");
            if (!code) {
              throw new Error(url.searchParams.get("error_description") || "Auth0 callback did not include a code.");
            }
            const token = await exchangeAuth0AuthorizationCode({
              auth0: input.auth0,
              code,
              codeVerifier: pending.codeVerifier,
              redirectUri: pending.redirectUri,
            });
            setAccessTokenCookie(res, token.accessToken, token.expiresIn);
            redirectResponse(res, demoConnectedPath);
          } catch (error) {
            writeJsonResponse(res, 500, {
              error: "auth0_callback_failed",
              detail: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
        if (pathname === demoAuthLogoutPath) {
          clearAccessTokenCookie(res);
          redirectResponse(res, "/");
          return;
        }
        if (pathname === TAILSCALE_AUTH_KEY_API_PATH) {
          try {
            const body = await readRequestBody(req);
            const result = await handleTailscaleAuthKeyApiRequest(
              {
                method: req.method || "GET",
                headers: headersFromIncoming(req),
                bodyText: body.length > 0 ? body.toString("utf8") : undefined,
              },
              { env: apiEnv },
            );
            res.statusCode = result.status;
            for (const [key, value] of Object.entries(result.headers)) {
              res.setHeader(key, value);
            }
            res.end(result.body);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }
        if (proxyPaths.has(pathname)) {
          try {
            await proxyHttpRequest(req, res, targetOrigin);
          } catch (error) {
            res.statusCode = 502;
            res.end(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        next();
      });
      if (!server.httpServer) {
        throw new Error("Vite HTTP server is unavailable.");
      }
      attachHeadscaleWebSocketProxy(server.httpServer, targetOrigin);
    },
  };

  const server = await createViteServer({
    root: input.root,
    configFile: false,
    plugins: [wasm(), proxyPlugin],
    define: {
      "process.env": {},
      global: "globalThis",
    },
    server: {
      host: "127.0.0.1",
      port: input.demoPort,
      strictPort: true,
      headers: {
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
      fs: {
        allow: [
          input.root,
          repoRoot,
          join(repoRoot, "node_modules"),
          join(repoRoot, "packages", "almostnode"),
          join(repoRoot, "packages", "almostnode", "src", "network"),
          join(
            repoRoot,
            "packages",
            "almostnode",
            "src",
            "network",
            "tailscale-ca-certificates.pem",
          ),
        ],
        deny: [".env", ".env.*", "*.{crt,key}"],
      },
    },
    resolve: {
      alias: [
        {
          find: "almostnode",
          replacement: join(repoRoot, "packages", "almostnode", "src", "index.ts"),
        },
        {
          find: "node:zlib",
          replacement: join(repoRoot, "packages", "almostnode", "src", "shims", "zlib.ts"),
        },
        {
          find: "zlib",
          replacement: join(repoRoot, "packages", "almostnode", "src", "shims", "zlib.ts"),
        },
        {
          find: "node:dns",
          replacement: join(repoRoot, "packages", "almostnode", "src", "shims", "dns.ts"),
        },
        {
          find: "dns",
          replacement: join(repoRoot, "packages", "almostnode", "src", "shims", "dns.ts"),
        },
      ],
    },
    optimizeDeps: {
      exclude: ["@tailscale/connect", "@tailscale/connect/main.wasm?url"],
      esbuildOptions: { target: "esnext" },
    },
    worker: {
      format: "es",
    },
    assetsInclude: ["**/*.wasm", "**/*.pem"],
  });
  await server.listen(input.demoPort, "127.0.0.1");
  return server;
}

async function runBrowserDemo(url: string, token: string): Promise<unknown> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: demoAccessTokenCookieName,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    }
  });
  await page.goto(new URL(demoConnectedPath, url).toString(), { waitUntil: "domcontentloaded" });
  const result = await page.waitForFunction(
    () => {
      const demo = (globalThis as unknown as { __headscaleWasmDemo?: { done?: boolean; error?: string } }).__headscaleWasmDemo;
      if (demo?.error) {
        throw new Error(demo.error);
      }
      return demo?.done ? demo : false;
    },
    undefined,
    { timeout: 150_000 },
  );
  const value = await result.jsonValue();
  const runRequestProbe = async (requestUrl: string) => {
    await page.fill("#request-url", requestUrl);
    await page.click("#send-request");
    await page.waitForFunction(
      () => {
        const text = document.getElementById("response-output")?.textContent || "";
        return text.includes('"status"') || text.includes('"error"');
      },
      undefined,
      { timeout: 45_000 },
    );
    return page.evaluate(() => ({
      request: document.getElementById("request-output")?.textContent || "",
      response: document.getElementById("response-output")?.textContent || "",
    }));
  };
  const headscaleProbe = await runRequestProbe("http://localhost:8080/key?v=113");
  const publicProbe = await runRequestProbe("https://example.com/");
  const publicResponse = JSON.parse(publicProbe.response || "{}") as {
    url?: string;
    error?: string;
  };
  if (publicResponse.error) {
    throw new Error(`Public exit-node probe failed: ${publicResponse.error}`);
  }
  if (publicResponse.url?.includes("almostnode-cors-proxy")) {
    throw new Error(`Public exit-node probe used CORS proxy: ${publicResponse.url}`);
  }
  await browser.close();
  if (value && typeof value === "object") {
    return {
      ...value,
      requestProbe: {
        headscale: headscaleProbe,
        public: publicProbe,
      },
    };
  }
  return {
    value,
    requestProbe: {
      headscale: headscaleProbe,
      public: publicProbe,
    },
  };
}

async function listHeadscaleNodes(headscale: HeadscaleRuntime): Promise<unknown> {
  const result = await runCommand(
    "go",
    ["run", "./cmd/headscale", "-c", headscale.configPath, "nodes", "list", "-o", "json"],
    { cwd: headscaleRoot },
  );
  return JSON.parse(result.stdout);
}

function extractHeadscaleNodeArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => (
      Boolean(item)
      && typeof item === "object"
      && !Array.isArray(item)
    ));
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["nodes", "machines", "items"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        return extractHeadscaleNodeArray(value);
      }
    }
  }
  return [];
}

function getHeadscaleNodeId(node: Record<string, unknown>): number | null {
  for (const key of ["id", "ID", "identifier"]) {
    const value = node[key];
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number.parseInt(value, 10);
    }
  }
  return null;
}

function getHeadscaleNodeStringValues(node: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const value of Object.values(node)) {
    if (typeof value === "string") {
      values.push(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nestedValue of Object.values(value as Record<string, unknown>)) {
        if (typeof nestedValue === "string") {
          values.push(nestedValue);
        }
      }
    }
  }
  return values;
}

function nodeMatchesHostname(node: Record<string, unknown>, hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return getHeadscaleNodeStringValues(node).some((value) => {
    const normalized = value.toLowerCase();
    return (
      normalized === normalizedHostname
      || normalized.startsWith(`${normalizedHostname}.`)
      || normalized.includes(normalizedHostname)
    );
  });
}

async function waitForHeadscaleNode(input: {
  headscale: HeadscaleRuntime;
  hostname: string;
  timeoutMs: number;
}): Promise<{ id: number; node: Record<string, unknown> }> {
  const started = Date.now();
  let lastNodes: unknown = null;
  while (Date.now() - started < input.timeoutMs) {
    lastNodes = await listHeadscaleNodes(input.headscale);
    const node = extractHeadscaleNodeArray(lastNodes).find((candidate) => (
      nodeMatchesHostname(candidate, input.hostname)
    ));
    const id = node ? getHeadscaleNodeId(node) : null;
    if (node && id !== null) {
      return { id, node };
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 500));
  }
  throw new Error(
    `Timed out waiting for Headscale node ${input.hostname}. Last nodes: ${JSON.stringify(lastNodes)}`,
  );
}

async function createHeadscalePreauthKey(headscale: HeadscaleRuntime): Promise<string> {
  const result = await runCommand(
    "go",
    [
      "run",
      "./cmd/headscale",
      "-c",
      headscale.configPath,
      "preauthkeys",
      "create",
      "-u",
      headscale.userId,
      "--ephemeral",
      "--expiration",
      "24h",
    ],
    { cwd: headscaleRoot },
  );
  const key =
    result.stdout
      .split(/\s+/)
      .map((item) => item.trim())
      .find((item) => item.startsWith("hskey"))
    || result.stdout.trim();
  if (!key.startsWith("hskey")) {
    throw new Error(`Headscale did not return a preauth key: ${result.stdout}`);
  }
  return key;
}

async function getHeadscaleNodeRoutes(
  headscale: HeadscaleRuntime,
  nodeId: number,
): Promise<unknown> {
  const result = await runCommand(
    "go",
    [
      "run",
      "./cmd/headscale",
      "-c",
      headscale.configPath,
      "nodes",
      "list-routes",
      "-i",
      String(nodeId),
      "-o",
      "json",
    ],
    { cwd: headscaleRoot },
  );
  return JSON.parse(result.stdout);
}

async function approveExitNodeRoutes(
  headscale: HeadscaleRuntime,
  nodeId: number,
): Promise<unknown> {
  await runCommand(
    "go",
    [
      "run",
      "./cmd/headscale",
      "-c",
      headscale.configPath,
      "nodes",
      "approve-routes",
      "-i",
      String(nodeId),
      "-r",
      "0.0.0.0/0,::/0",
    ],
    { cwd: headscaleRoot },
  );
  return getHeadscaleNodeRoutes(headscale, nodeId);
}

async function startExitNode(headscale: HeadscaleRuntime): Promise<ExitNodeRuntime> {
  const hostname = "almostnode-exit-node";
  const dataDir = join(headscale.dataDir, "exit-node");
  mkdirSync(dataDir, { recursive: true });
  const socketPath = join("/tmp", `almostnode-ts-${randomBytes(6).toString("hex")}.sock`);
  rmSync(socketPath, { force: true });
  const statePath = join(dataDir, "tailscaled.state");
  const child = spawn(
    "tailscaled",
    [
      "--tun",
      "userspace-networking",
      "--socket",
      socketPath,
      "--state",
      statePath,
      "--statedir",
      dataDir,
      "--port",
      "0",
      "--no-logs-no-support",
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[exit-node] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[exit-node] ${chunk.toString()}`);
  });

  try {
    await waitForPath(socketPath, 20_000);
    const authKey = await createHeadscalePreauthKey(headscale);
    await runCommand(
      "tailscale",
      [
        "--socket",
        socketPath,
        "up",
        "--login-server",
        `http://127.0.0.1:${headscale.headscalePort}`,
        "--auth-key",
        authKey,
        "--hostname",
        hostname,
        "--advertise-exit-node",
        "--accept-dns=false",
        "--accept-routes=false",
        "--reset",
        "--timeout",
        "45s",
      ],
      { cwd: repoRoot },
    );
    const node = await waitForHeadscaleNode({
      headscale,
      hostname,
      timeoutMs: 20_000,
    });
    const routes = await approveExitNodeRoutes(headscale, node.id);
    const statusResult = await runCommand(
      "tailscale",
      ["--socket", socketPath, "status", "--json"],
      { cwd: repoRoot },
    );
    return {
      dataDir,
      hostname,
      nodeId: node.id,
      process: child,
      routes,
      socketPath,
      status: JSON.parse(statusResult.stdout),
    };
  } catch (error) {
    await stopExitNodeProcess(child).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!existsSync(headscaleRoot)) {
    throw new Error("vendor/headscale is missing. Run git submodule update --init vendor/headscale.");
  }
  const auth0 = mergeAuth0Env();
  const token = args.keepOpen ? null : await getAuth0Token(auth0, args);
  const tempRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "almostnode-headscale-wasm-app-")),
  );
  const srcDir = join(tempRoot, "src");
  writeFileSync(join(tempRoot, ".gitkeep"), "");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(srcDir, { recursive: true }));

  const demoPort = preferredDemoPort;
  let headscale: HeadscaleRuntime | null = null;
  let exitNode: ExitNodeRuntime | null = null;
  let viteServer: Awaited<ReturnType<typeof startDemoServer>> | null = null;
  let cleaningUp = false;
  let signalExitCode: number | null = null;
  let resolveShutdownSignal!: () => void;
  const shutdownSignal = new Promise<void>((resolve) => {
    resolveShutdownSignal = resolve;
  });
  const cleanupFiles = () => {
    if (exitNode) {
      rmSync(exitNode.socketPath, { force: true });
    }
    rmSync(tempRoot, { recursive: true, force: true });
    if (headscale) {
      rmSync(headscale.dataDir, { recursive: true, force: true });
    }
  };
  const cleanup = async () => {
    if (cleaningUp) {
      return;
    }
    cleaningUp = true;
    if (exitNode) {
      await stopExitNodeProcess(exitNode.process).catch((error) => {
        console.warn(`[demo] failed to stop exit-node tailscaled cleanly: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (headscale) {
      await stopHeadscaleProcess(headscale.process).catch((error) => {
        console.warn(`[demo] failed to stop Headscale cleanly: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (viteServer) {
      await withTimeout(viteServer.close(), 8_000, "Vite server did not close.").catch((error) => {
        console.warn(`[demo] failed to stop Vite cleanly: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    cleanupFiles();
  };
  const handleSignal = (signal: NodeJS.Signals) => {
    if (signalExitCode !== null) {
      return;
    }
    signalExitCode = signal === "SIGINT" ? 130 : 143;
    console.log(`[demo] received ${signal}; shutting down`);
    resolveShutdownSignal();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  process.on("exit", cleanupFiles);
  try {
    headscale = await startHeadscale();
    exitNode = await startExitNode(headscale);
    viteServer = await startDemoServer({
      auth0,
      demoPort,
      headscale,
      root: tempRoot,
    });
    const url = `http://localhost:${demoPort}/`;
    console.log(`[demo] running ${url}`);
    if (token) {
      const browserResult = await runBrowserDemo(url, token);
      const nodes = await listHeadscaleNodes(headscale);
      console.log(
        JSON.stringify(
          {
            browserResult,
            exitNode: {
              hostname: exitNode.hostname,
              nodeId: exitNode.nodeId,
              routes: exitNode.routes,
              status: exitNode.status,
            },
            headscale: {
              controlUrl: url,
              dataDir: headscale.dataDir,
              nodes,
            },
          },
          null,
          2,
        ),
      );
    }
    if (args.keepOpen) {
      console.log(`[demo] keeping Headscale and browser demo server open at ${url}`);
      await shutdownSignal;
    }
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    await cleanup();
    process.off("exit", cleanupFiles);
    if (signalExitCode !== null) {
      process.exitCode = signalExitCode;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
