import { expect, test, type Page } from '@playwright/test';

async function loadAwsSmoke(page: Page) {
  await page.goto('/examples/aws-command-smoke.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean((window as any).__almostnodeAwsSmoke), {
    timeout: 30000,
  });
}

test('aws command smoke flow works in the browser runtime', async ({ page }) => {
  await loadAwsSmoke(page);

  const result = await page.evaluate(async () => {
    const runtime = (window as any).__almostnodeAwsSmoke;
    const container = runtime.container;
    const controller = container.network;
    const requests: Array<{ url: string; method?: string }> = [];

    const encodeBody = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    };

    const decodeBody = (value?: string) => {
      if (!value) return '';
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    };

    controller.fetch = async (request: any) => {
      requests.push({ url: request.url, method: request.method });
      const body = decodeBody(request.bodyBase64);

      if (request.url.includes('/client/register')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyBase64: encodeBody(JSON.stringify({
            clientId: 'client-1',
            clientSecret: 'secret-1',
            clientSecretExpiresAt: 2208988800,
          })),
        };
      }

      if (request.url.includes('/device_authorization')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyBase64: encodeBody(JSON.stringify({
            deviceCode: 'device-1',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://device.example/verify',
            verificationUriComplete: 'https://device.example/verify?user_code=ABCD-EFGH',
            expiresIn: 600,
            interval: 1,
          })),
        };
      }

      if (request.url.includes('/token')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyBase64: encodeBody(JSON.stringify({
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresIn: 3600,
            tokenType: 'Bearer',
          })),
        };
      }

      if (request.url.includes('/federation/credentials')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyBase64: encodeBody(JSON.stringify({
            roleCredentials: {
              accessKeyId: 'ASIAEXAMPLE',
              secretAccessKey: 'secret',
              sessionToken: 'session-token',
              expiration: 4102444800000,
            },
          })),
        };
      }

      if (body.includes('Action=GetCallerIdentity')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/xml' },
          bodyBase64: encodeBody(`<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:sts::123456789012:assumed-role/AdministratorAccess/demo</Arn>
    <UserId>AIDAEXAMPLE</UserId>
    <Account>123456789012</Account>
  </GetCallerIdentityResult>
  <ResponseMetadata>
    <RequestId>req-1</RequestId>
  </ResponseMetadata>
</GetCallerIdentityResponse>`),
        };
      }

      if (request.url.includes('s3.') || request.url.includes('x-id=ListBuckets')) {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/xml' },
          bodyBase64: encodeBody(`<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>owner</ID>
    <DisplayName>owner</DisplayName>
  </Owner>
  <Buckets>
    <Bucket>
      <Name>demo-bucket</Name>
      <CreationDate>2026-01-01T00:00:00.000Z</CreationDate>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`),
        };
      }

      throw new Error(`Unexpected request: ${request.url}`);
    };

    const outputs = [];
    outputs.push(await container.run('aws configure sso-session --name dev --start-url "https://example.awsapps.com/start" --region us-east-1'));
    outputs.push(await container.run('aws configure profile --name dev --sso-session dev --account-id 123456789012 --role-name AdministratorAccess --region us-east-1'));
    outputs.push(await container.run('aws sso login --no-browser'));
    outputs.push(await container.run('aws sts get-caller-identity'));
    outputs.push(await container.run('aws s3api list-buckets'));

    return { outputs, requests };
  });

  expect(result.outputs[0].exitCode).toBe(0);
  expect(result.outputs[1].exitCode).toBe(0);
  expect(result.outputs[2].exitCode).toBe(0);
  expect(result.outputs[2].stdout).toContain('Authentication complete');
  expect(result.outputs[3].exitCode).toBe(0);
  expect(result.outputs[3].stdout).toContain('123456789012');
  expect(result.outputs[4].exitCode).toBe(0);
  expect(result.outputs[4].stdout).toContain('demo-bucket');
  expect(result.requests.some((request) => request.url.includes('/client/register'))).toBe(true);
  expect(result.requests.some((request) => request.url.includes('/federation/credentials'))).toBe(true);
});
