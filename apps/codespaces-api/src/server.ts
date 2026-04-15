import Fastify from "fastify";
import cors from "@fastify/cors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { decryptString, encryptString } from "./crypto.js";
import { database } from "./db.js";
import {
  GitHubApiClient,
  pollGitHubDeviceCode,
  startGitHubDeviceCode,
  type GitHubCodespaceSummary,
} from "./github.js";
import {
  githubDeviceSessions,
  githubSessions,
  projectCodespaces,
  syncJobs,
} from "./schema.js";

const config = loadConfig();
const app = Fastify({ logger: true });

class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

await app.register(cors, {
  origin: true,
  credentials: true,
});

const ensureCodespaceBodySchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  repoRef: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
    remoteUrl: z.string().min(1),
  }),
  displayName: z.string().min(1),
  machine: z.string().nullable(),
  idleTimeoutMinutes: z.number().int().nullable(),
  retentionHours: z.number().int().nullable(),
  supportsBridge: z.boolean(),
});

const pollBodySchema = z.object({
  deviceCode: z.string().min(1),
});

const accessTokenSessionBodySchema = z.object({
  accessToken: z.string().min(1),
});

const syncCredentialsBodySchema = z.object({
  projectId: z.string().min(1),
  codespaceName: z.string().min(1),
  repoRef: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
    remoteUrl: z.string().min(1),
  }),
  payload: z.string().min(1),
});

app.post("/auth/github/device/start", async () => {
  if (!config.githubClientId) {
    throw new AppError(
      "GITHUB_CODESPACES_CLIENT_ID is required before GitHub Codespaces auth can start.",
      400,
    );
  }

  const deviceAuth = await startGitHubDeviceCode(config.githubClientId);
  const now = Date.now();

  await database.db
    .insert(githubDeviceSessions)
    .values({
      deviceCode: deviceAuth.deviceCode,
      userCode: deviceAuth.userCode,
      verificationUri: deviceAuth.verificationUri,
      verificationUriComplete: deviceAuth.verificationUriComplete,
      intervalSeconds: deviceAuth.interval,
      expiresAt: now + deviceAuth.expiresIn * 1000,
      sessionId: null,
      createdAt: now,
      lastPolledAt: null,
    })
    .onConflictDoUpdate({
      target: githubDeviceSessions.deviceCode,
      set: {
        userCode: deviceAuth.userCode,
        verificationUri: deviceAuth.verificationUri,
        verificationUriComplete: deviceAuth.verificationUriComplete,
        intervalSeconds: deviceAuth.interval,
        expiresAt: now + deviceAuth.expiresIn * 1000,
        sessionId: null,
        createdAt: now,
        lastPolledAt: null,
      },
    });

  return deviceAuth;
});

app.post("/auth/github/device/poll", async (request, reply) => {
  const body = pollBodySchema.parse(request.body);
  const existing = await database.db.query.githubDeviceSessions.findFirst({
    where: eq(githubDeviceSessions.deviceCode, body.deviceCode),
  });
  if (!existing) {
    return reply.code(404).send({
      error: "Unknown GitHub device flow session.",
    });
  }

  if (Date.now() >= existing.expiresAt) {
    return reply.code(410).send({
      error: "GitHub device flow session expired.",
    });
  }

  const result = await pollGitHubDeviceCode({
    clientId: config.githubClientId,
    deviceCode: body.deviceCode,
  });

  await database.db
    .update(githubDeviceSessions)
    .set({
      lastPolledAt: Date.now(),
    })
    .where(eq(githubDeviceSessions.deviceCode, body.deviceCode));

  if (result.status === "pending") {
    return {
      status: "pending",
    };
  }

  const githubClient = new GitHubApiClient(result.accessToken);
  const { user } = await githubClient.getAuthenticatedSession();
  const sessionId = await upsertGitHubSession({
    accessToken: result.accessToken,
    user,
    scopes: result.scopes,
    tokenType: result.tokenType,
  });

  await database.db
    .update(githubDeviceSessions)
    .set({
      sessionId,
      lastPolledAt: Date.now(),
    })
    .where(eq(githubDeviceSessions.deviceCode, body.deviceCode));

  return {
    status: "authorized",
    sessionId,
    user,
    accessTokenExpiresAt: null,
  };
});

app.post("/auth/github/session", async (request) => {
  const body = accessTokenSessionBodySchema.parse(request.body);
  const githubClient = new GitHubApiClient(body.accessToken);
  const { user, scopes } = await githubClient.getAuthenticatedSession();

  try {
    await githubClient.assertCodespacesAccess();
  } catch (error) {
    throw new AppError(
      "GitHub is connected, but this token does not have Codespaces access. Run `gh auth refresh --scopes codespace` or authenticate with a token that includes the `codespace` scope.",
      403,
    );
  }

  const sessionId = await upsertGitHubSession({
    accessToken: body.accessToken,
    user,
    scopes,
    tokenType: "Bearer",
  });

  return {
    sessionId,
    user,
    scopes,
  };
});

app.get("/projects/:projectId/codespace", async (request, reply) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const projectId = (request.params as { projectId: string }).projectId;
  if (projectId === "__auth-check__") {
    return {
      projectId,
      repoRef: null,
      codespace: null,
    };
  }

  const project = await database.db.query.projectCodespaces.findFirst({
    where: eq(projectCodespaces.projectId, projectId),
  });
  if (!project) {
    return {
      projectId,
      repoRef: null,
      codespace: null,
    };
  }

  const github = new GitHubApiClient(session.accessToken);
  const refreshed = project.codespaceName
    ? await github.getCodespace(project.codespaceName).catch(() => null)
    : null;
  if (refreshed) {
    await upsertProjectCodespace(projectId, session.id, {
      owner: project.owner,
      repo: project.repo,
      branch: project.branch,
      remoteUrl: project.remoteUrl,
    }, refreshed, project.supportsBridge, project.lastSyncedAt);
  }

  return formatProjectResponse(
    projectId,
    refreshed
      ? await database.db.query.projectCodespaces.findFirst({
          where: eq(projectCodespaces.projectId, projectId),
        })
      : project,
  );
});

app.post("/projects/:projectId/codespace/ensure", async (request) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const body = ensureCodespaceBodySchema.parse(request.body);
  const github = new GitHubApiClient(session.accessToken);
  const existingRow = await database.db.query.projectCodespaces.findFirst({
    where: eq(projectCodespaces.projectId, body.projectId),
  });
  const existingCodespaces = await github.listRepositoryCodespaces(
    body.repoRef.owner,
    body.repoRef.repo,
  );
  const existingCodespace = resolvePreferredCodespace(
    existingRow?.codespaceName || null,
    body.repoRef.branch,
    existingCodespaces,
  );
  const codespace = existingCodespace
    ? normalizeLifecycleState(existingCodespace).state === "stopped"
      ? await github.startCodespace(existingCodespace.name)
      : existingCodespace
    : await github.createRepositoryCodespace({
        owner: body.repoRef.owner,
        repo: body.repoRef.repo,
        branch: body.repoRef.branch,
        machine: body.machine,
        displayName: body.displayName,
        idleTimeoutMinutes: body.idleTimeoutMinutes,
        retentionHours: body.retentionHours,
      });

  await upsertProjectCodespace(
    body.projectId,
    session.id,
    body.repoRef,
    codespace,
    body.supportsBridge,
    existingRow?.lastSyncedAt ?? null,
  );

  return formatProjectResponse(
    body.projectId,
    await database.db.query.projectCodespaces.findFirst({
      where: eq(projectCodespaces.projectId, body.projectId),
    }),
  );
});

app.post("/projects/:projectId/codespace/start", async (request) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const projectId = (request.params as { projectId: string }).projectId;
  const row = await getStoredProject(projectId);
  const github = new GitHubApiClient(session.accessToken);
  const codespace = await github.startCodespace(row.codespaceName!);
  await upsertProjectCodespace(projectId, session.id, toRepoRef(row), codespace, row.supportsBridge, row.lastSyncedAt);
  return formatProjectResponse(
    projectId,
    await database.db.query.projectCodespaces.findFirst({
      where: eq(projectCodespaces.projectId, projectId),
    }),
  );
});

app.post("/projects/:projectId/codespace/stop", async (request) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const projectId = (request.params as { projectId: string }).projectId;
  const row = await getStoredProject(projectId);
  const github = new GitHubApiClient(session.accessToken);
  const codespace = await github.stopCodespace(row.codespaceName!);
  await upsertProjectCodespace(projectId, session.id, toRepoRef(row), codespace, row.supportsBridge, row.lastSyncedAt);
  return formatProjectResponse(
    projectId,
    await database.db.query.projectCodespaces.findFirst({
      where: eq(projectCodespaces.projectId, projectId),
    }),
  );
});

app.post("/projects/:projectId/codespace/rebuild", async (request) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const projectId = (request.params as { projectId: string }).projectId;
  const row = await getStoredProject(projectId);
  const github = new GitHubApiClient(session.accessToken);
  if (row.codespaceName) {
    await github.deleteCodespace(row.codespaceName);
  }
  const rebuilt = await github.createRepositoryCodespace({
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    machine: row.codespaceMachine || null,
    displayName: row.codespaceDisplayName || `${row.owner}/${row.repo}`,
    idleTimeoutMinutes: row.idleTimeoutMinutes ?? null,
    retentionHours: row.retentionHours ?? null,
  });
  await upsertProjectCodespace(projectId, session.id, toRepoRef(row), rebuilt, row.supportsBridge, row.lastSyncedAt);
  return formatProjectResponse(
    projectId,
    await database.db.query.projectCodespaces.findFirst({
      where: eq(projectCodespaces.projectId, projectId),
    }),
  );
});

app.post("/projects/:projectId/codespace/sync-credentials", async (request) => {
  const session = await requireSession(request.headers["x-almostnode-codespaces-session"]);
  const body = syncCredentialsBodySchema.parse(request.body);
  const github = new GitHubApiClient(session.accessToken);
  const repoId = await github.getRepositoryId(body.repoRef.owner, body.repoRef.repo);
  const syncJobId = crypto.randomUUID();
  const now = Date.now();

  await database.db.insert(syncJobs).values({
    id: syncJobId,
    projectId: body.projectId,
    codespaceName: body.codespaceName,
    secretName: "ALMOSTNODE_KEYCHAIN_BUNDLE",
    status: "pending",
    error: null,
    createdAt: now,
    completedAt: null,
  });

  try {
    await github.createOrUpdateCodespacesUserSecret({
      name: "ALMOSTNODE_KEYCHAIN_BUNDLE",
      value: body.payload,
      selectedRepositoryIds: [repoId],
    });

    await database.db
      .update(syncJobs)
      .set({
        status: "completed",
        completedAt: Date.now(),
      })
      .where(eq(syncJobs.id, syncJobId));

    const project = await getStoredProject(body.projectId);
    await upsertProjectCodespace(
      body.projectId,
      session.id,
      toRepoRef(project),
      await github.getCodespace(body.codespaceName).catch(() => ({
        name: body.codespaceName,
        displayName: project.codespaceDisplayName || body.codespaceName,
        webUrl: project.codespaceWebUrl || "",
        state: project.codespaceState || "unknown",
        machine: project.codespaceMachine || null,
        idleTimeoutMinutes: project.idleTimeoutMinutes ?? null,
        retentionHours: project.retentionHours ?? null,
      })),
      true,
      Date.now(),
    );
  } catch (error) {
    await database.db
      .update(syncJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      })
      .where(eq(syncJobs.id, syncJobId));
    throw error;
  }

  return formatProjectResponse(
    body.projectId,
    await database.db.query.projectCodespaces.findFirst({
      where: eq(projectCodespaces.projectId, body.projectId),
    }),
  );
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(error instanceof AppError ? error.statusCode : 500).send({
    error: error instanceof Error ? error.message : String(error),
  });
});

await app.listen({
  port: config.port,
  host: config.host,
});

async function requireSession(
  headerValue: string | string[] | undefined,
): Promise<{ id: string; accessToken: string }> {
  const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!sessionId) {
    throw new AppError(
      "Codespaces session is not connected. Authenticate with GitHub first.",
      401,
    );
  }

  const session = await database.db.query.githubSessions.findFirst({
    where: eq(githubSessions.id, sessionId),
  });
  if (!session) {
    throw new AppError(
      "Codespaces session is not connected. Authenticate with GitHub first.",
      401,
    );
  }

  return {
    id: session.id,
    accessToken: decryptString(config.encryptionKey, {
      ciphertext: session.accessTokenCiphertext,
      iv: session.accessTokenIv,
    }),
  };
}

async function upsertGitHubSession(options: {
  accessToken: string;
  user: {
    login: string;
    id: number;
    avatarUrl: string | null;
  };
  scopes: string | null;
  tokenType: string | null;
}): Promise<string> {
  const existing = await database.db.query.githubSessions.findFirst({
    where: eq(githubSessions.userId, options.user.id),
  });
  const encrypted = encryptString(config.encryptionKey, options.accessToken);
  const now = Date.now();

  if (existing) {
    await database.db
      .update(githubSessions)
      .set({
        login: options.user.login,
        avatarUrl: options.user.avatarUrl,
        accessTokenCiphertext: encrypted.ciphertext,
        accessTokenIv: encrypted.iv,
        accessTokenExpiresAt: null,
        scopes: options.scopes,
        tokenType: options.tokenType,
        updatedAt: now,
      })
      .where(eq(githubSessions.id, existing.id));
    return existing.id;
  }

  const sessionId = crypto.randomUUID();
  await database.db.insert(githubSessions).values({
    id: sessionId,
    login: options.user.login,
    userId: options.user.id,
    avatarUrl: options.user.avatarUrl,
    accessTokenCiphertext: encrypted.ciphertext,
    accessTokenIv: encrypted.iv,
    accessTokenExpiresAt: null,
    scopes: options.scopes,
    tokenType: options.tokenType,
    createdAt: now,
    updatedAt: now,
  });
  return sessionId;
}

async function getStoredProject(projectId: string) {
  const row = await database.db.query.projectCodespaces.findFirst({
    where: eq(projectCodespaces.projectId, projectId),
  });
  if (!row) {
    throw new AppError(
      `Codespace project "${projectId}" was not found.`,
      404,
    );
  }
  return row;
}

function resolvePreferredCodespace(
  currentName: string | null,
  branch: string,
  codespaces: GitHubCodespaceSummary[],
): GitHubCodespaceSummary | null {
  return (
    codespaces.find((codespace) => codespace.name === currentName)
    || codespaces.find((codespace) => codespace.displayName === branch)
    || codespaces[0]
    || null
  );
}

function normalizeLifecycleState(codespace: GitHubCodespaceSummary): {
  state: string;
} {
  const normalized = codespace.state.trim().toLowerCase();
  return {
    state: normalized === "available"
      ? "running"
      : normalized === "shutdown"
        ? "stopped"
        : normalized,
  };
}

function toRepoRef(row: {
  owner: string;
  repo: string;
  branch: string;
  remoteUrl: string;
}) {
  return {
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    remoteUrl: row.remoteUrl,
  };
}

async function upsertProjectCodespace(
  projectId: string,
  sessionId: string,
  repoRef: {
    owner: string;
    repo: string;
    branch: string;
    remoteUrl: string;
  },
  codespace: GitHubCodespaceSummary,
  supportsBridge: boolean,
  lastSyncedAt: number | null,
): Promise<void> {
  await database.db
    .insert(projectCodespaces)
    .values({
      projectId,
      sessionId,
      owner: repoRef.owner,
      repo: repoRef.repo,
      branch: repoRef.branch,
      remoteUrl: repoRef.remoteUrl,
      codespaceName: codespace.name,
      codespaceDisplayName: codespace.displayName,
      codespaceWebUrl: codespace.webUrl,
      codespaceState: codespace.state,
      codespaceMachine: codespace.machine,
      idleTimeoutMinutes: codespace.idleTimeoutMinutes,
      retentionHours: codespace.retentionHours,
      supportsBridge,
      lastSyncedAt,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: projectCodespaces.projectId,
      set: {
        sessionId,
        owner: repoRef.owner,
        repo: repoRef.repo,
        branch: repoRef.branch,
        remoteUrl: repoRef.remoteUrl,
        codespaceName: codespace.name,
        codespaceDisplayName: codespace.displayName,
        codespaceWebUrl: codespace.webUrl,
        codespaceState: codespace.state,
        codespaceMachine: codespace.machine,
        idleTimeoutMinutes: codespace.idleTimeoutMinutes,
        retentionHours: codespace.retentionHours,
        supportsBridge,
        lastSyncedAt,
        updatedAt: Date.now(),
      },
    });
}

function formatProjectResponse(
  projectId: string,
  project:
    | {
        owner: string;
        repo: string;
        branch: string;
        remoteUrl: string;
        codespaceName: string | null;
        codespaceDisplayName: string | null;
        codespaceWebUrl: string | null;
        codespaceState: string | null;
        codespaceMachine: string | null;
        idleTimeoutMinutes: number | null;
        retentionHours: number | null;
        supportsBridge: boolean;
        lastSyncedAt: number | null;
      }
    | undefined,
) {
  if (!project) {
    return {
      projectId,
      repoRef: null,
      codespace: null,
    };
  }

  return {
    projectId,
    repoRef: {
      owner: project.owner,
      repo: project.repo,
      branch: project.branch,
      remoteUrl: project.remoteUrl,
    },
    codespace: project.codespaceName
      ? {
          name: project.codespaceName,
          displayName: project.codespaceDisplayName || project.codespaceName,
          webUrl: project.codespaceWebUrl || "",
          state: project.codespaceState || "unknown",
          machine: project.codespaceMachine,
          idleTimeoutMinutes: project.idleTimeoutMinutes,
          retentionHours: project.retentionHours,
          supportsBridge: project.supportsBridge,
          lastSyncedAt: project.lastSyncedAt,
        }
      : null,
  };
}
