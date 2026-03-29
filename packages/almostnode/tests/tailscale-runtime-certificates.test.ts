import { describe, expect, it } from 'vitest';
import {
  installTailscaleRuntimeCertificates,
  TAILSCALE_RUNTIME_CERT_BUNDLE_PATH,
  TAILSCALE_RUNTIME_CERT_DIR,
  withTailscaleCertificateEnv,
} from '../src/network/tailscale-runtime-certificates';
import { VirtualFS } from '../src/virtual-fs';

describe('tailscale runtime certificates', () => {
  it('installs a CA bundle into the runtime VFS', () => {
    const vfs = new VirtualFS();

    installTailscaleRuntimeCertificates(vfs);

    const bundle = vfs.readFileSync(TAILSCALE_RUNTIME_CERT_BUNDLE_PATH);
    const text = typeof bundle === 'string' ? bundle : new TextDecoder().decode(bundle);

    expect(vfs.statSync(TAILSCALE_RUNTIME_CERT_DIR).isDirectory()).toBe(true);
    expect(text).toContain('-----BEGIN CERTIFICATE-----');
    expect(text.length).toBeGreaterThan(1000);
  });

  it('adds SSL certificate environment variables for the Go runtime', () => {
    const env = withTailscaleCertificateEnv({
      HOME: '/tailscale',
    });

    expect(env.HOME).toBe('/tailscale');
    expect(env.SSL_CERT_FILE).toBe(TAILSCALE_RUNTIME_CERT_BUNDLE_PATH);
    expect(env.SSL_CERT_DIR).toBe(TAILSCALE_RUNTIME_CERT_DIR);
  });
});
