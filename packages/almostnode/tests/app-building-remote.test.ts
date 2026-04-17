import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDefaultNetworkController } from '../src/network';
import {
  createAppBuildingMachine,
  DEFAULT_FLY_LOG_BUFFER_LIMIT,
  fetchAppBuildingStatus,
  fetchFlyLogsSince,
  infisicalLogin,
  mergeFlyLogDelta,
  parseAddTaskLogMessage,
  setInfisicalGlobalSecret,
  workerHeaders,
} from '../src/shims/app-building-remote';

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf8').toString('base64');
}

function jsonResponse(
  url: string,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    url,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    bodyBase64: encodeBody(JSON.stringify(body)),
  };
}

describe('app-building remote helpers', () => {
  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.restoreAllMocks();
  });

  it('logs in to Infisical and fetches worker status through the forced-instance header', async () => {
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url === 'https://app.infisical.com/api/v1/auth/universal-auth/login') {
          expect(request.method).toBe('POST');
          return jsonResponse(request.url, { accessToken: 'inf_test_token' });
        }

        if (request.url === 'https://builder.fly.dev/status') {
          expect(request.headers?.['fly-force-instance-id']).toBe('instance-123');
          return jsonResponse(request.url, {
            state: 'idle',
            containerName: 'app-building-123',
            pushBranch: 'codex/weather-radar',
            pendingTasks: 0,
            tasksProcessed: 2,
            totalCost: 3.5,
            iteration: 6,
            detachRequested: true,
            revision: 'abc123',
            lastActivityAt: '2026-04-15T12:00:00.000Z',
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as never);

    expect(await infisicalLogin('client-id', 'client-secret')).toBe('inf_test_token');
    expect(await fetchAppBuildingStatus('https://builder.fly.dev', 'instance-123')).toMatchObject({
      state: 'idle',
      containerName: 'app-building-123',
      revision: 'abc123',
    });
    expect(workerHeaders('instance-123')).toEqual({
      'fly-force-instance-id': 'instance-123',
    });
    expect(workerHeaders(null)).toEqual({});
    expect(workerHeaders('')).toEqual({});
  });

  it('creates a Fly machine with the expected env payload', async () => {
    const fetch = vi.fn(async (request) => {
      if (
        request.url === 'https://api.machines.dev/v1/apps/shared-fly-app/ip_assignments'
        && (request.method === 'GET' || request.method === undefined)
      ) {
        return jsonResponse(request.url, { ips: [] });
      }

      if (
        request.url === 'https://api.machines.dev/v1/apps/shared-fly-app/ip_assignments'
        && request.method === 'POST'
      ) {
        const payload = JSON.parse(Buffer.from(request.bodyBase64 || '', 'base64').toString('utf8')) as {
          type: string;
        };

        if (payload.type === 'shared_v4') {
          return jsonResponse(request.url, { address: '66.241.124.58', type: 'shared_v4' });
        }

        if (payload.type === 'v6') {
          return jsonResponse(request.url, { address: '2a09:8280:1::102:d18a:0', type: 'v6' });
        }

        throw new Error(`Unexpected ip assignment payload: ${payload.type}`);
      }

      if (
        request.url === 'https://api.machines.dev/v1/apps/shared-fly-app/volumes'
        && request.method === 'POST'
      ) {
        expect(request.method).toBe('POST');
        expect(request.headers?.authorization).toBe('FlyV1 fm2_deploy-token');
        return jsonResponse(request.url, { id: 'volume-123' });
      }

      if (
        request.url === 'https://api.machines.dev/v1/apps/shared-fly-app/volumes'
        && (request.method === 'GET' || request.method === undefined)
      ) {
        return jsonResponse(request.url, []);
      }

      if (request.url === 'https://api.machines.dev/v1/apps/shared-fly-app/machines') {
        const payload = JSON.parse(Buffer.from(request.bodyBase64 || '', 'base64').toString('utf8')) as {
          name: string;
          config: {
            env: Record<string, string>;
            image: string;
            mounts: Array<{ path: string }>;
          };
        };

        expect(payload.name).toBe('app-building-job123');
        expect(payload.config.image).toBe('ghcr.io/replayio/app-building:latest');
        expect(payload.config.mounts).toEqual([{ volume: 'volume-123', path: '/app' }]);
        expect(payload.config.env.INITIAL_PROMPT).toBe('Build a dashboard');
        expect(payload.config.env.PUSH_BRANCH).toBe('codex/weather-radar-job123');
        expect(payload.config.env.FLY_API_TOKEN).toBe('fm2_deploy-token');
        expect(payload.config.env.INFISICAL_TOKEN).toBe('inf-token');

        return jsonResponse(request.url, {
          id: 'machine-123',
          instance_id: 'instance-123',
        });
      }

      throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
    });

    setDefaultNetworkController({ fetch } as never);

    const machine = await createAppBuildingMachine({
      appName: 'shared-fly-app',
      token: 'fm2_deploy-token',
      imageRef: 'ghcr.io/replayio/app-building:latest',
      machineName: 'app-building-job123',
      env: {
        INITIAL_PROMPT: 'Build a dashboard',
        PUSH_BRANCH: 'codex/weather-radar-job123',
        FLY_API_TOKEN: 'fm2_deploy-token',
        INFISICAL_TOKEN: 'inf-token',
      },
    });

    expect(machine).toEqual({
      machineId: 'machine-123',
      instanceId: 'instance-123',
      volumeId: 'volume-123',
      region: 'dfw',
    });
  });

  it('stores the app GitHub token in Infisical global secrets for worker startup', async () => {
    const fetch = vi.fn(async (request) => {
      if (
        request.url === 'https://app.infisical.com/api/v4/secrets/GITHUB_TOKEN'
        && request.method === 'POST'
      ) {
        const payload = JSON.parse(Buffer.from(request.bodyBase64 || '', 'base64').toString('utf8')) as {
          projectId: string;
          environment: string;
          secretPath: string;
          secretValue: string;
          type: string;
        };

        expect(payload).toEqual({
          projectId: 'project-123',
          environment: 'prod',
          secretPath: '/global/',
          secretValue: 'ghp_from_app',
          type: 'shared',
        });
        expect(request.headers?.authorization).toBe('Bearer inf-token');
        return jsonResponse(request.url, { secret: { secretKey: 'GITHUB_TOKEN' } });
      }

      throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
    });

    setDefaultNetworkController({ fetch } as never);

    await setInfisicalGlobalSecret({
      token: 'inf-token',
      projectId: 'project-123',
      environment: 'prod',
      name: 'GITHUB_TOKEN',
      value: 'ghp_from_app',
    });
  });

  describe('fetchFlyLogsSince', () => {
    function respondWithLogs(seen: string[]) {
      return vi.fn(async (request: { url: string; headers?: Record<string, string> }) => {
        seen.push(request.url);
        expect(request.headers?.authorization).toBe('FlyV1 fm2_token');
        return jsonResponse(request.url, {
          data: [
            {
              attributes: {
                timestamp: '2026-04-16T10:00:00Z',
                region: 'dfw',
                instance: 'machine-abc',
                level: 'info',
                message: 'hello',
              },
            },
          ],
          meta: { next_token: 'token-after' },
        });
      });
    }

    it('uses next_token when a cursor is supplied and omits start_time', async () => {
      const seen: string[] = [];
      setDefaultNetworkController({ fetch: respondWithLogs(seen) } as never);

      const page = await fetchFlyLogsSince('app-building', 'fm2_token', {
        machineId: 'machine-abc',
        cursor: 'cursor-42',
        startTime: '2026-01-01T00:00:00Z',
      });

      expect(page.entries).toHaveLength(1);
      expect(page.nextToken).toBe('token-after');
      expect(seen).toEqual([
        'https://api.fly.io/api/v1/apps/app-building/logs?next_token=cursor-42&instance=machine-abc',
      ]);
    });

    it('falls back to start_time when no cursor is given, passing machine id as instance and omitting region', async () => {
      const seen: string[] = [];
      setDefaultNetworkController({ fetch: respondWithLogs(seen) } as never);

      await fetchFlyLogsSince('app-building', 'fm2_token', {
        machineId: 'machine-abc',
        startTime: '2026-04-16T09:55:00Z',
      });

      expect(seen).toEqual([
        'https://api.fly.io/api/v1/apps/app-building/logs?next_token=&start_time=2026-04-16T09%3A55%3A00Z&instance=machine-abc',
      ]);
    });

    it('sends only next_token= (empty) when neither cursor nor start_time is set', async () => {
      const seen: string[] = [];
      setDefaultNetworkController({ fetch: respondWithLogs(seen) } as never);

      await fetchFlyLogsSince('app-building', 'fm2_token', {
        machineId: 'machine-abc',
      });

      expect(seen).toEqual([
        'https://api.fly.io/api/v1/apps/app-building/logs?next_token=&instance=machine-abc',
      ]);
    });

    it('surfaces API errors with status code and body', async () => {
      setDefaultNetworkController({
        fetch: vi.fn(async (request: { url: string }) => ({
          url: request.url,
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
          bodyBase64: encodeBody('{"error":"unauthorized"}'),
        })),
      } as never);

      await expect(
        fetchFlyLogsSince('app-building', 'fm2_token', { machineId: 'machine-abc' }),
      ).rejects.toThrow(/\(401\)/);
    });
  });

  describe('mergeFlyLogDelta', () => {
    const entry = (timestamp: string, message: string) => ({
      timestamp,
      region: 'dfw',
      instance: 'machine-abc',
      level: 'info',
      message,
    });

    it('returns only new entries and appends them to the buffer in order', () => {
      const existing: string[] = [];
      const result = mergeFlyLogDelta(existing, [
        entry('2026-04-16T10:00:00Z', 'one'),
        entry('2026-04-16T10:00:01Z', 'two'),
      ]);
      expect(result.newFormatted).toHaveLength(2);
      expect(result.newFormatted[0]).toContain('one');
      expect(result.mergedBuffer).toEqual(result.newFormatted);
      expect(result.latestTimestamp).toBe('2026-04-16T10:00:01Z');
    });

    it('dedups entries already present in the buffer', () => {
      const first = mergeFlyLogDelta([], [entry('2026-04-16T10:00:00Z', 'one')]);
      const second = mergeFlyLogDelta(first.mergedBuffer, [
        entry('2026-04-16T10:00:00Z', 'one'),
        entry('2026-04-16T10:00:05Z', 'two'),
      ], { lastTimestamp: first.latestTimestamp });

      expect(second.newFormatted).toHaveLength(1);
      expect(second.newFormatted[0]).toContain('two');
      expect(second.mergedBuffer).toHaveLength(2);
      expect(second.latestTimestamp).toBe('2026-04-16T10:00:05Z');
    });

    it('caps the merged buffer at the configured limit', () => {
      const many = Array.from({ length: 10 }, (_, i) =>
        entry(`2026-04-16T10:00:0${i}Z`, `msg-${i}`),
      );
      const result = mergeFlyLogDelta([], many, { bufferLimit: 4 });
      expect(result.mergedBuffer).toHaveLength(4);
      expect(result.mergedBuffer[0]).toContain('msg-6');
      expect(result.mergedBuffer[3]).toContain('msg-9');
    });

    it('preserves the lastTimestamp when incoming entries are older', () => {
      const result = mergeFlyLogDelta([], [entry('2026-04-16T09:00:00Z', 'old')], {
        lastTimestamp: '2026-04-16T10:00:00Z',
      });
      expect(result.latestTimestamp).toBe('2026-04-16T10:00:00Z');
    });

    it('uses the default buffer limit of 500', () => {
      expect(DEFAULT_FLY_LOG_BUFFER_LIMIT).toBe(500);
    });
  });

  describe('parseAddTaskLogMessage', () => {
    it('extracts subtasks from the worker add-task.ts tool invocation', () => {
      const message = `[2026-04-17T01:23:15.881Z] ${JSON.stringify({
        type: 'tool',
        tool: "$ npx tsx /repo/scripts/add-task.ts <<'EOF'\n"
          + '[{ "skill": "skills/tasks/build/testSpec.md", "app": "twitter-clone", '
          + '"subtasks": ["PlanPages: Read the spec, decide on pages, and add PlanPage tasks for each page"] }]\n'
          + 'EOF',
      })}`;

      const parsed = parseAddTaskLogMessage(message);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0]).toMatchObject({
        skill: 'skills/tasks/build/testSpec.md',
        app: 'twitter-clone',
        name: 'PlanPages',
        description: 'Read the spec, decide on pages, and add PlanPage tasks for each page',
      });
    });

    it('flattens multiple tasks and multiple subtasks in a single invocation', () => {
      const message = JSON.stringify({
        type: 'tool',
        tool: "$ npx tsx /app/scripts/add-task.ts --parallel <<'EOF'\n"
          + '[\n'
          + '  { "skill": "skills/tasks/build/writeApp.md", "app": "SalesCRM", '
          + '    "subtasks": ["WritePage1: do page 1", "WritePage2: do page 2"] },\n'
          + '  { "skill": "skills/tasks/build/writeTests.md", "app": "SalesCRM", '
          + '    "subtasks": ["WriteTestAuth: test auth"] }\n'
          + ']\n'
          + 'EOF',
      });

      const parsed = parseAddTaskLogMessage(message);
      expect(parsed).toHaveLength(3);
      expect(parsed?.map((s) => s.name)).toEqual([
        'WritePage1',
        'WritePage2',
        'WriteTestAuth',
      ]);
      expect(parsed?.[2].skill).toBe('skills/tasks/build/writeTests.md');
    });

    it('returns null for unrelated tool invocations', () => {
      const message = JSON.stringify({
        type: 'tool',
        tool: '$ npx tsx /repo/scripts/list-tasks.ts',
      });
      expect(parseAddTaskLogMessage(message)).toBeNull();
    });

    it('returns null for non-JSON log messages', () => {
      expect(parseAddTaskLogMessage('plain log line')).toBeNull();
    });

    it('returns null when the HEREDOC body is malformed JSON', () => {
      const message = JSON.stringify({
        type: 'tool',
        tool: "$ npx tsx /repo/scripts/add-task.ts <<'EOF'\nnot valid json\nEOF",
      });
      expect(parseAddTaskLogMessage(message)).toBeNull();
    });
  });
});
