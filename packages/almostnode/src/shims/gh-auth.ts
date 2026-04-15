import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const GH_HOSTS_PATH = '/home/user/.config/gh/hosts.yml';

export interface GhHostConfig {
  oauth_token: string;
  user: string;
  git_protocol: string;
  oauth_scopes?: string;
}

// ── Minimal YAML helpers ────────────────────────────────────────────────────
// hosts.yml is a simple 2-level key-value file:
//   github.com:
//     oauth_token: gho_xxx
//     user: octocat
//     git_protocol: https
//     oauth_scopes: repo read:org gist codespace

function serializeHostsYml(hosts: Record<string, GhHostConfig>): string {
  const lines: string[] = [];
  for (const [host, config] of Object.entries(hosts)) {
    lines.push(`${host}:`);
    lines.push(`    oauth_token: ${config.oauth_token}`);
    lines.push(`    user: ${config.user}`);
    lines.push(`    git_protocol: ${config.git_protocol}`);
    if (config.oauth_scopes?.trim()) {
      lines.push(`    oauth_scopes: ${config.oauth_scopes.trim()}`);
    }
  }
  return lines.join('\n') + '\n';
}

function parseHostsYml(content: string): Record<string, GhHostConfig> {
  const hosts: Record<string, GhHostConfig> = {};
  let currentHost: string | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Top-level key (no leading whitespace)
    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':')) {
      currentHost = trimmed.slice(0, -1);
      hosts[currentHost] = {
        oauth_token: '',
        user: '',
        git_protocol: 'https',
      };
      continue;
    }

    // Indented key-value pair
    if (currentHost) {
      const match = line.trim().match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (
          key === 'oauth_token'
          || key === 'user'
          || key === 'git_protocol'
          || key === 'oauth_scopes'
        ) {
          (hosts[currentHost] as any)[key] = value;
        }
      }
    }
  }

  return hosts;
}

// ── Public API ──────────────────────────────────────────────────────────────

function ensureDir(vfs: VirtualFS, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
}

function readAllHosts(vfs: VirtualFS): Record<string, GhHostConfig> {
  if (!vfs.existsSync(GH_HOSTS_PATH)) return {};
  try {
    const content = vfs.readFileSync(GH_HOSTS_PATH, 'utf8');
    return parseHostsYml(content);
  } catch {
    return {};
  }
}

function writeAllHosts(vfs: VirtualFS, hosts: Record<string, GhHostConfig>): void {
  ensureDir(vfs, GH_HOSTS_PATH);
  vfs.writeFileSync(GH_HOSTS_PATH, serializeHostsYml(hosts));
}

export function readGhToken(vfs: VirtualFS, host = 'github.com'): GhHostConfig | null {
  const hosts = readAllHosts(vfs);
  return hosts[host] || null;
}

export function writeGhToken(vfs: VirtualFS, config: GhHostConfig, host = 'github.com'): void {
  const hosts = readAllHosts(vfs);
  hosts[host] = config;
  writeAllHosts(vfs, hosts);
}

export function deleteGhToken(vfs: VirtualFS, host = 'github.com'): boolean {
  const hosts = readAllHosts(vfs);
  if (!hosts[host]) return false;
  delete hosts[host];
  if (Object.keys(hosts).length === 0) {
    // Remove the file entirely
    try {
      vfs.unlinkSync(GH_HOSTS_PATH);
    } catch {
      // ignore
    }
  } else {
    writeAllHosts(vfs, hosts);
  }
  return true;
}

export function hasGhToken(vfs: VirtualFS, host = 'github.com'): boolean {
  const config = readGhToken(vfs, host);
  return config !== null && config.oauth_token !== '';
}
