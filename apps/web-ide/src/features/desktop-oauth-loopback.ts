import type { DesktopBridge } from '../desktop/bridge';

export interface DesktopOAuthLoopbackBridge {
  createSession(input?: {
    allowedOrigins?: string[];
    callbackPath?: string;
    captureBody?: boolean;
    matchAnyPath?: boolean;
    preferredPort?: number;
  }): Promise<{
    sessionId: string;
    redirectUri: string;
  }>;
  openExternal(input: { sessionId: string; url: string }): Promise<{ opened: true }>;
  waitForCallback(input: {
    sessionId: string;
    timeoutMs?: number;
    successHtml?: string;
  }): Promise<{
    callbackUrl: string;
    requestBody?: string | null;
    requestHeaders?: Record<string, string> | null;
    requestMethod?: string | null;
  }>;
}

const DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY = Symbol.for(
  'almostnode.desktopOAuthLoopback',
);

type OAuthGlobal = typeof globalThis & {
  [DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY]?: DesktopOAuthLoopbackBridge;
};

export function installDesktopOAuthLoopbackBridge(
  desktopBridge: DesktopBridge,
): () => void {
  const target = globalThis as OAuthGlobal;
  const bridge: DesktopOAuthLoopbackBridge = {
    createSession: (input) => desktopBridge.invoke('oauth-loopback:create', input),
    openExternal: (input) => desktopBridge.invoke('oauth-loopback:open-external', input),
    waitForCallback: (input) => desktopBridge.invoke('oauth-loopback:wait', input),
  };

  target[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY] = bridge;

  return () => {
    if (target[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY] === bridge) {
      delete target[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY];
    }
  };
}
