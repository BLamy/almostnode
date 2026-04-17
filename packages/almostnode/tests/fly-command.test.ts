import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runFlyCommand } from '../src/shims/fly-command';
import {
  FLY_CONFIG_PATH,
  readFlyAccessToken,
  readFlyAppName,
  readFlyConfig,
  writeFlyAppName,
} from '../src/shims/fly-auth';
import { VirtualFS } from '../src/virtual-fs';

const APP_BUILDING_CONFIG_PATH = '/__almostnode/keychain/app-building-config.json';

function makeCtx(env: Record<string, string> = {}, cwd = '/'): CommandContext {
  return { cwd, env } as unknown as CommandContext;
}

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

function writeAppBuildingConfig(
  vfs: VirtualFS,
  value: {
    flyAppName: string;
    flyApiToken: string;
  },
): void {
  vfs.mkdirSync('/__almostnode/keychain', { recursive: true });
  vfs.writeFileSync(APP_BUILDING_CONFIG_PATH, JSON.stringify(value, null, 2));
}

describe('fly command', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.restoreAllMocks();

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('completes Fly browser login and persists the access token', async () => {
    const vfs = new VirtualFS();
    const open = vi.fn(() => null);

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open,
        location: {
          hostname: 'web-ide.local',
        },
      },
    });

    const requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push({
          url: request.url,
          method: request.method || 'GET',
          headers: request.headers || {},
        });

        if (
          request.method === 'POST'
          && request.url === 'https://api.fly.io/api/v1/cli_sessions'
        ) {
          return jsonResponse(request.url, {
            id: 'session-1',
            auth_url: 'https://fly.io/app/auth/cli/session-1',
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.fly.io/api/v1/cli_sessions/session-1'
        ) {
          return jsonResponse(request.url, {
            id: 'session-1',
            access_token: 'fm2_test-token',
          });
        }

        if (
          request.method === 'POST'
          && request.url === 'https://api.fly.io/graphql'
        ) {
          expect(request.headers?.authorization).toBe('FlyV1 fm2_test-token');
          return jsonResponse(request.url, {
            data: {
              viewer: {
                id: 'user-1',
                email: 'test@example.com',
              },
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runFlyCommand(['login'], makeCtx(), vfs);

    if (result.exitCode !== 0) {
      throw new Error(
        `fly login failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    expect(result.stdout).toContain('Opening https://fly.io/app/auth/cli/session-1 ...');
    expect(result.stdout).toContain('Successfully logged in as test@example.com');
    expect(open).toHaveBeenCalledWith('https://fly.io/app/auth/cli/session-1', '_blank');
    expect(readFlyAccessToken(vfs)).toBe('fm2_test-token');
    expect(vfs.readFileSync(FLY_CONFIG_PATH, 'utf8')).toContain('access_token: "fm2_test-token"');
    expect(requests.some((request) => request.url.endsWith('/graphql'))).toBe(true);
  });

  it('prints the saved auth token', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(FLY_CONFIG_PATH, 'access_token: "fm2_saved-token"\n');

    const result = await runFlyCommand(['auth', 'token'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('fm2_saved-token\n');
  });

  it('clears Fly auth state on logout', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(
      FLY_CONFIG_PATH,
      [
        'access_token: "fm2_saved-token"',
        'last_login: "2026-04-15T12:00:00.000Z"',
        'auto_update: true',
        '',
      ].join('\n'),
    );

    const result = await runFlyCommand(['auth', 'logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Fly.io login state.');
    expect(vfs.readFileSync(FLY_CONFIG_PATH, 'utf8')).toBe('auto_update: true\n');
    expect(readFlyAccessToken(vfs)).toBeNull();
  });

  it('uses bearer auth for whoami when the token is not a macaroon', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(FLY_CONFIG_PATH, 'access_token: "plain-token"\n');

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.headers?.authorization).toBe('Bearer plain-token');
        return jsonResponse(request.url, {
          data: {
            viewer: {
              email: 'plain@example.com',
            },
          },
        });
      }),
    } as any);

    const result = await runFlyCommand(['auth', 'whoami'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('plain@example.com\n');
  });

  it('lists machines using the saved app-building Fly defaults', async () => {
    const vfs = new VirtualFS();
    writeAppBuildingConfig(vfs, {
      flyAppName: 'shared-fly-app',
      flyApiToken: 'fm2_builder-token',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.headers?.authorization).toBe('FlyV1 fm2_builder-token');
        expect(request.url).toBe('https://api.machines.dev/v1/apps/shared-fly-app/machines');
        return jsonResponse(request.url, [
          {
            id: 'machine-123',
            instance_id: 'instance-123',
            name: 'app-building-123',
            state: 'started',
            region: 'iad',
            config: {
              image: 'ghcr.io/replayio/app-building:latest',
            },
          },
        ]);
      }),
    } as any);

    const result = await runFlyCommand(['list'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('MACHINE ID');
    expect(result.stdout).toContain('machine-123');
    expect(result.stdout).toContain('instance-123');
    expect(result.stdout).toContain('app-building-123');
  });

  it('fetches logs for a specific machine by passing the machine id as the instance filter', async () => {
    const vfs = new VirtualFS();
    writeAppBuildingConfig(vfs, {
      flyAppName: 'shared-fly-app',
      flyApiToken: 'fm2_builder-token',
    });

    const requests: string[] = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push(request.url);

        if (
          request.url
          === 'https://api.fly.io/api/v1/apps/shared-fly-app/logs?next_token=&instance=machine-123'
        ) {
          expect(request.headers?.authorization).toBe('FlyV1 fm2_builder-token');
          return jsonResponse(request.url, {
            data: [
              {
                attributes: {
                  timestamp: '2026-04-16T14:00:00Z',
                  region: 'iad',
                  instance: 'instance-123',
                  level: 'info',
                  message: 'Worker booted',
                },
              },
            ],
            meta: {
              next_token: '',
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runFlyCommand(['logs', 'machine-123', '--lines', '5'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Worker booted');
    expect(requests).toEqual([
      'https://api.fly.io/api/v1/apps/shared-fly-app/logs?next_token=&instance=machine-123',
    ]);
  });

  it('lists machines using the app name saved in fly config.yml', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(
      FLY_CONFIG_PATH,
      [
        'access_token: "fm2_saved-token"',
        'app: "sidebar-chosen-app"',
        '',
      ].join('\n'),
    );

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.headers?.authorization).toBe('FlyV1 fm2_saved-token');
        expect(request.url).toBe(
          'https://api.machines.dev/v1/apps/sidebar-chosen-app/machines',
        );
        return jsonResponse(request.url, []);
      }),
    } as any);

    const result = await runFlyCommand(['list'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No Fly Machines found');
  });

  it('reads and writes the app name scalar in fly config.yml', () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(
      FLY_CONFIG_PATH,
      'access_token: "fm2_saved-token"\nlast_login: "2026-04-16T00:00:00.000Z"\n',
    );

    expect(readFlyAppName(vfs)).toBeNull();

    writeFlyAppName(vfs, 'my-app');

    expect(readFlyAppName(vfs)).toBe('my-app');
    const config = readFlyConfig(vfs);
    expect(config.accessToken).toBe('fm2_saved-token');
    expect(config.appName).toBe('my-app');

    writeFlyAppName(vfs, 'renamed-app');
    expect(readFlyAppName(vfs)).toBe('renamed-app');
    expect(
      (vfs.readFileSync(FLY_CONFIG_PATH, 'utf8') as string).match(/^app:/gm)?.length ?? 0,
    ).toBe(1);

    writeFlyAppName(vfs, '');
    expect(readFlyAppName(vfs)).toBeNull();
    expect(readFlyAccessToken(vfs)).toBe('fm2_saved-token');
  });
});
