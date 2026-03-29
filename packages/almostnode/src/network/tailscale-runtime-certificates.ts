import type { VirtualFS } from '../virtual-fs';
import tailscaleCaCertificatesPem from './tailscale-ca-certificates.pem?raw';

export const TAILSCALE_RUNTIME_CERT_ROOT = '/etc/ssl';
export const TAILSCALE_RUNTIME_CERT_DIR = `${TAILSCALE_RUNTIME_CERT_ROOT}/certs`;
export const TAILSCALE_RUNTIME_CERT_BUNDLE_PATH = `${TAILSCALE_RUNTIME_CERT_ROOT}/cert.pem`;

export function installTailscaleRuntimeCertificates(vfs: VirtualFS): void {
  vfs.mkdirSync(TAILSCALE_RUNTIME_CERT_ROOT, { recursive: true });
  vfs.mkdirSync(TAILSCALE_RUNTIME_CERT_DIR, { recursive: true });
  vfs.writeFileSync(TAILSCALE_RUNTIME_CERT_BUNDLE_PATH, tailscaleCaCertificatesPem);
}

export function withTailscaleCertificateEnv(
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...env,
    SSL_CERT_FILE: TAILSCALE_RUNTIME_CERT_BUNDLE_PATH,
    SSL_CERT_DIR: TAILSCALE_RUNTIME_CERT_DIR,
  };
}
