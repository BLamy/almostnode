import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const REPLAY_AUTH_PATH = '/home/user/.replay/auth.json';

export interface ReplayAuthConfig {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms, from JWT exp claim
  userInfo?: string | null; // email/sub from JWT
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(vfs: VirtualFS, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function readReplayAuth(vfs: VirtualFS): ReplayAuthConfig | null {
  if (!vfs.existsSync(REPLAY_AUTH_PATH)) return null;
  try {
    const content = vfs.readFileSync(REPLAY_AUTH_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed as ReplayAuthConfig;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeReplayAuth(vfs: VirtualFS, config: ReplayAuthConfig): void {
  ensureDir(vfs, REPLAY_AUTH_PATH);
  vfs.writeFileSync(REPLAY_AUTH_PATH, JSON.stringify(config, null, 2));
}

export function deleteReplayAuth(vfs: VirtualFS): boolean {
  if (!vfs.existsSync(REPLAY_AUTH_PATH)) return false;
  try {
    vfs.unlinkSync(REPLAY_AUTH_PATH);
  } catch {
    // ignore
  }
  return true;
}

export function hasReplayAuth(vfs: VirtualFS): boolean {
  const config = readReplayAuth(vfs);
  return config !== null && config.accessToken !== '';
}
