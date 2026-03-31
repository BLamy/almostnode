import { describe, expect, it } from 'vitest';
import { createContainer } from '../src';
import { NETWORK_CA_BUNDLE_PATH } from '../src/network';

describe('network env projection', () => {
  it('projects proxy and CA env vars into child processes and lets user overrides win', async () => {
    const container = createContainer({
      network: {
        proxy: {
          httpUrl: 'http://proxy.internal:8080',
          httpsUrl: 'http://proxy.internal:8443',
          noProxy: 'localhost,.example.com',
          caBundlePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
        },
        corsProxy: 'https://proxy.example/?url=',
      },
    });

    container.vfs.writeFileSync(
      '/print-env.js',
      [
        'console.log(JSON.stringify({',
        '  HTTP_PROXY: process.env.HTTP_PROXY || null,',
        '  HTTPS_PROXY: process.env.HTTPS_PROXY || null,',
        '  NO_PROXY: process.env.NO_PROXY || null,',
        '  SSL_CERT_FILE: process.env.SSL_CERT_FILE || null,',
        '  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || null,',
        '  REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE || null,',
        '  CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE || null,',
        '  CORS_PROXY_URL: process.env.CORS_PROXY_URL || null,',
        '}));',
      ].join('\n'),
    );

    const result = await container.run('node /print-env.js', {
      env: {
        HTTPS_PROXY: 'http://override.internal:9999',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      HTTP_PROXY: 'http://proxy.internal:8080',
      HTTPS_PROXY: 'http://override.internal:9999',
      NO_PROXY: 'localhost,.example.com',
      SSL_CERT_FILE: NETWORK_CA_BUNDLE_PATH,
      NODE_EXTRA_CA_CERTS: NETWORK_CA_BUNDLE_PATH,
      REQUESTS_CA_BUNDLE: NETWORK_CA_BUNDLE_PATH,
      CURL_CA_BUNDLE: NETWORK_CA_BUNDLE_PATH,
      CORS_PROXY_URL: 'https://proxy.example/?url=',
    });
    expect(container.vfs.readFileSync(NETWORK_CA_BUNDLE_PATH, 'utf8')).toContain('BEGIN CERTIFICATE');
  });
});
