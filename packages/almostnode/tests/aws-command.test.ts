import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runAwsCommand, parseAwsGlobalArgs } from '../src/shims/aws-command';
import {
  readAwsAuth,
  readAwsConfig,
  writeAwsAuth,
  writeAwsConfig,
  type AwsAuthFile,
  type AwsConfigFile,
} from '../src/shims/aws-storage';
import { VirtualFS } from '../src/virtual-fs';

const STATIC_AWS_ENV = {
  AWS_ACCESS_KEY_ID: 'AKIATEST1234567890',
  AWS_SECRET_ACCESS_KEY: 'secret-test-key',
  AWS_REGION: 'us-east-1',
};

function makeCtx(env: Record<string, string> = {}, cwd = '/'): CommandContext {
  return { cwd, env } as unknown as CommandContext;
}

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf8').toString('base64');
}

function jsonResponse(url: string, body: unknown, status = 200, headers: Record<string, string> = {}) {
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

function xmlResponse(url: string, body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    url,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/xml',
      ...headers,
    },
    bodyBase64: encodeBody(body),
  };
}

function emptyResponse(url: string, status = 200, headers: Record<string, string> = {}) {
  return {
    url,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    bodyBase64: '',
  };
}

function createConfiguredVfs(): VirtualFS {
  const vfs = new VirtualFS();
  const config: AwsConfigFile = {
    version: 1,
    defaultProfile: 'dev',
    ssoSessions: {
      dev: {
        startUrl: 'https://example.awsapps.com/start',
        region: 'us-east-1',
        registrationScopes: ['sso:account:access'],
      },
    },
    profiles: {
      dev: {
        ssoSession: 'dev',
        accountId: '123456789012',
        roleName: 'AdministratorAccess',
        region: 'us-east-1',
        output: 'json',
      },
    },
  };
  writeAwsConfig(vfs, config);
  return vfs;
}

describe('aws command', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }

    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: Navigator }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('parses global flags and leaves the command payload intact', () => {
    const parsed = parseAwsGlobalArgs([
      '--profile', 'dev',
      '--region=us-west-2',
      '--output', 'text',
      '--debug',
      'sts',
      'get-caller-identity',
    ]);

    expect('error' in parsed).toBe(false);
    expect(parsed).toMatchObject({
      profile: 'dev',
      region: 'us-west-2',
      output: 'text',
      debug: true,
      commandArgs: ['sts', 'get-caller-identity'],
    });
  });

  it('configures sessions and profiles, then lists them', async () => {
    const vfs = new VirtualFS();
    const ctx = makeCtx();

    const sessionResult = await runAwsCommand([
      'configure',
      'sso-session',
      '--name', 'dev',
      '--start-url', 'https://example.awsapps.com/start',
      '--region', 'us-east-1',
    ], ctx, vfs);

    const profileResult = await runAwsCommand([
      'configure',
      'profile',
      '--name', 'dev',
      '--sso-session', 'dev',
      '--account-id', '123456789012',
      '--role-name', 'AdministratorAccess',
      '--region', 'us-east-1',
    ], ctx, vfs);

    const listResult = await runAwsCommand(['configure', 'list'], ctx, vfs);

    expect(sessionResult.exitCode).toBe(0);
    expect(profileResult.exitCode).toBe(0);
    expect(readAwsConfig(vfs).defaultProfile).toBe('dev');
    const listed = JSON.parse(listResult.stdout);
    expect(listed.ssoSessions[0].name).toBe('dev');
    expect(listed.profiles[0].name).toBe('dev');
    expect(listed.profiles[0].hasValidRoleCredentials).toBe(false);
  });

  it('tells the user to set up AWS before logging in when no SSO session exists', async () => {
    const result = await runAwsCommand(['sso', 'login'], makeCtx(), new VirtualFS());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AWS isn't configured yet.");
    expect(result.stderr).toContain('Open Keychain > AWS > Set up AWS');
    expect(result.stderr).toContain("aws configure sso-session --name <name> --start-url <url> --region <region>");
  });

  it('performs device-code login and stores the resulting session', async () => {
    const vfs = createConfiguredVfs();
    const ctx = makeCtx();
    const requests: string[] = [];

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn(),
        alert: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push(request.url);
        if (request.url.includes('/client/register')) {
          return jsonResponse(request.url, {
            clientId: 'client-1',
            clientSecret: 'secret-1',
            clientSecretExpiresAt: 2208988800,
          });
        }
        if (request.url.includes('/device_authorization')) {
          return jsonResponse(request.url, {
            deviceCode: 'device-1',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://device.example/verify',
            verificationUriComplete: 'https://device.example/verify?user_code=ABCD-EFGH',
            expiresIn: 600,
            interval: 1,
          });
        }
        if (request.url.includes('/token')) {
          return jsonResponse(request.url, {
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresIn: 3600,
            tokenType: 'Bearer',
          });
        }
        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const result = await runAwsCommand([
      'sso',
      'login',
      '--sso-session', 'dev',
      '--no-browser',
    ], ctx, vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authentication complete');
    expect((globalThis.window as any).open).not.toHaveBeenCalled();
    expect(requests.some((url) => url.includes('/client/register'))).toBe(true);
    expect(requests.some((url) => url.includes('/device_authorization'))).toBe(true);
    expect(requests.filter((url) => url.includes('/token'))).toHaveLength(1);
    expect(readAwsAuth(vfs).sessions.dev.accessToken).toBe('access-1');
  }, 15000);

  it('uploads a local file with aws s3 cp', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });
    vfs.mkdirSync('/project/dist', { recursive: true });
    vfs.writeFileSync('/project/dist/index.html', '<html>hello</html>');

    const uploads: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        const body = request.bodyBase64
          ? Buffer.from(request.bodyBase64, 'base64').toString('utf8')
          : '';
        uploads.push({
          url: request.url,
          method: request.method,
          headers: request.headers || {},
          body,
        });
        return emptyResponse(request.url, 200, {
          etag: '"etag-1"',
        });
      }),
    } as any);

    const result = await runAwsCommand(
      ['s3', 'cp', 'dist/index.html', 's3://demo-site/releases/index.html'],
      makeCtx(STATIC_AWS_ENV, '/project'),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'cp',
      bucket: 'demo-site',
      key: 'releases/index.html',
      uploadedCount: 1,
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].method).toBe('PUT');
    expect(uploads[0].url).toContain('demo-site');
    expect(uploads[0].url).toContain('/releases/index.html');
    expect(uploads[0].headers['content-type']).toBe('text/html; charset=utf-8');
    expect(uploads[0].body).toBe('<html>hello</html>');
  });

  it('syncs a local directory to S3 and deletes stale remote keys', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });
    vfs.mkdirSync('/project/dist/assets', { recursive: true });
    vfs.writeFileSync('/project/dist/index.html', '<html>home</html>');
    vfs.writeFileSync('/project/dist/assets/app.js', 'console.log("hi")');

    const requests: Array<{ url: string; method: string; body: string }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        const body = request.bodyBase64
          ? Buffer.from(request.bodyBase64, 'base64').toString('utf8')
          : '';
        requests.push({
          url: request.url,
          method: request.method,
          body,
        });

        if (request.method === 'GET' && request.url.includes('list-type=2')) {
          return xmlResponse(request.url, `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>demo-site</Name>
  <Prefix>prod</Prefix>
  <KeyCount>3</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>prod/index.html</Key></Contents>
  <Contents><Key>prod/assets/app.js</Key></Contents>
  <Contents><Key>prod/old.js</Key></Contents>
</ListBucketResult>`);
        }

        if (request.method === 'POST' && request.url.includes('delete=')) {
          return xmlResponse(request.url, `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Deleted><Key>prod/old.js</Key></Deleted>
</DeleteResult>`);
        }

        return emptyResponse(request.url, 200, {
          etag: '"etag-1"',
        });
      }),
    } as any);

    const result = await runAwsCommand(
      ['s3', 'sync', 'dist', 's3://demo-site/prod', '--delete'],
      makeCtx(STATIC_AWS_ENV, '/project'),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'sync',
      bucket: 'demo-site',
      prefix: 'prod',
      uploadedCount: 2,
      deletedCount: 1,
    });
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(2);
    expect(requests.some((request) => request.url.includes('list-type=2'))).toBe(true);
    expect(requests.some((request) => request.method === 'POST' && request.body.includes('<Key>prod/old.js</Key>'))).toBe(true);
  });

  it('reads website config from file:// for s3api bucket setup commands', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/project', { recursive: true });
    vfs.writeFileSync(
      '/project/website.json',
      JSON.stringify({
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'error.html' },
      }),
    );

    const requests: Array<{ url: string; method: string; body: string }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        const body = request.bodyBase64
          ? Buffer.from(request.bodyBase64, 'base64').toString('utf8')
          : '';
        requests.push({
          url: request.url,
          method: request.method,
          body,
        });
        return emptyResponse(request.url);
      }),
    } as any);

    const result = await runAwsCommand(
      [
        's3api',
        'put-bucket-website',
        '--bucket', 'demo-site',
        '--website-configuration', 'file://website.json',
      ],
      makeCtx(STATIC_AWS_ENV, '/project'),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      bucket: 'demo-site',
      configured: 'website',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('website');
    expect(requests[0].body).toContain('<IndexDocument>');
    expect(requests[0].body).toContain('<Suffix>index.html</Suffix>');
  });

  it('refreshes expired SSO tokens, fetches role credentials, and routes service calls through the network controller', async () => {
    const vfs = createConfiguredVfs();
    const auth: AwsAuthFile = {
      version: 1,
      clients: {
        dev: {
          clientId: 'client-1',
          clientSecret: 'secret-1',
          clientSecretExpiresAt: '2099-01-01T00:00:00.000Z',
          region: 'us-east-1',
          startUrl: 'https://example.awsapps.com/start',
          registrationScopes: ['sso:account:access'],
        },
      },
      sessions: {
        dev: {
          accessToken: 'expired-access',
          refreshToken: 'refresh-1',
          issuedAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-01T00:05:00.000Z',
          region: 'us-east-1',
          startUrl: 'https://example.awsapps.com/start',
          registrationScopes: ['sso:account:access'],
        },
      },
      roleCredentials: {
        dev: {
          accessKeyId: 'ASIAOLD',
          secretAccessKey: 'old-secret',
          sessionToken: 'old-token',
          expiresAt: '2024-01-01T00:05:00.000Z',
          accountId: '123456789012',
          roleName: 'AdministratorAccess',
          region: 'us-east-1',
          ssoSession: 'dev',
        },
      },
    };
    writeAwsAuth(vfs, auth);

    const globalFetch = vi.fn();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: globalFetch,
    });

    const requests: string[] = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push(request.url);
        const body = request.bodyBase64
          ? Buffer.from(request.bodyBase64, 'base64').toString('utf8')
          : '';
        if (request.url.includes('/token')) {
          return jsonResponse(request.url, {
            accessToken: 'new-access',
            refreshToken: 'refresh-2',
            expiresIn: 3600,
            tokenType: 'Bearer',
          });
        }
        if (request.url.includes('/federation/credentials')) {
          return jsonResponse(request.url, {
            roleCredentials: {
              accessKeyId: 'ASIANEW',
              secretAccessKey: 'new-secret',
              sessionToken: 'new-session',
              expiration: 4102444800000,
            },
          });
        }
        if (body.includes('Action=GetCallerIdentity')) {
          return xmlResponse(request.url, `<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:sts::123456789012:assumed-role/AdministratorAccess/demo</Arn>
    <UserId>AIDAEXAMPLE</UserId>
    <Account>123456789012</Account>
  </GetCallerIdentityResult>
  <ResponseMetadata>
    <RequestId>req-1</RequestId>
  </ResponseMetadata>
</GetCallerIdentityResponse>`);
        }
        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const result = await runAwsCommand(['--profile', 'dev', 'sts', 'get-caller-identity'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('123456789012');
    expect(globalFetch).not.toHaveBeenCalled();
    expect(requests.some((url) => url.includes('/token'))).toBe(true);
    expect(requests.some((url) => url.includes('/federation/credentials'))).toBe(true);
    const updatedAuth = readAwsAuth(vfs);
    expect(updatedAuth.sessions.dev.accessToken).toBe('new-access');
    expect(updatedAuth.sessions.dev.refreshToken).toBe('refresh-2');
    expect(updatedAuth.roleCredentials.dev.accessKeyId).toBe('ASIANEW');
  });

  it('starts EC2 instances through the shared AWS service router', async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        const body = request.bodyBase64
          ? Buffer.from(request.bodyBase64, 'base64').toString('utf8')
          : '';
        requests.push({
          url: request.url,
          method: request.method,
          body,
        });

        return xmlResponse(request.url, `<?xml version="1.0" encoding="UTF-8"?>
<StartInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <requestId>req-1</requestId>
  <instancesSet>
    <item>
      <instanceId>i-1234567890</instanceId>
      <currentState><code>0</code><name>pending</name></currentState>
      <previousState><code>80</code><name>stopped</name></previousState>
    </item>
  </instancesSet>
</StartInstancesResponse>`);
      }),
    } as any);

    const result = await runAwsCommand(
      ['ec2', 'start-instances', '--instance-id', 'i-1234567890'],
      makeCtx(STATIC_AWS_ENV),
      new VirtualFS(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('i-1234567890');
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toContain('Action=StartInstances');
    expect(requests[0].body).toContain('InstanceId.1=i-1234567890');
  });

  it('clears unusable auth and tells the user to log in again when refresh fails', async () => {
    const vfs = createConfiguredVfs();
    writeAwsAuth(vfs, {
      version: 1,
      clients: {
        dev: {
          clientId: 'client-1',
          clientSecret: 'secret-1',
          clientSecretExpiresAt: '2099-01-01T00:00:00.000Z',
          region: 'us-east-1',
          startUrl: 'https://example.awsapps.com/start',
          registrationScopes: ['sso:account:access'],
        },
      },
      sessions: {
        dev: {
          accessToken: 'expired-access',
          refreshToken: 'refresh-1',
          issuedAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-01T00:05:00.000Z',
          region: 'us-east-1',
          startUrl: 'https://example.awsapps.com/start',
          registrationScopes: ['sso:account:access'],
        },
      },
      roleCredentials: {},
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url.includes('/token')) {
          return jsonResponse(request.url, {
            error: 'invalid_client',
          }, 400, {
            'x-amzn-errortype': 'InvalidClientException',
          });
        }
        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const result = await runAwsCommand(['--profile', 'dev', 'sts', 'get-caller-identity'], makeCtx(), vfs);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Run 'aws sso login --sso-session dev'");
    expect(readAwsAuth(vfs).sessions.dev).toBeUndefined();
  });
});
