// Bridges the almost-os Auth0 session to the `napster` CLI running inside the
// almostnode sandbox (packages/almostnode/src/shims/soundcloud-command.ts).
// The whole desktop already requires an Auth0 login, and the napster gateway
// (napster/src/index.ts) verifies that exact ID token directly — so there's no
// separate SoundCloud sign-in step; the CLI just asks for whatever token is
// currently active.

import { getSession } from "../auth/auth0";

export function installSoundcloudBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    soundcloud: {
      getIdToken: () => getSession()?.id_token ?? null,
    },
  };
}
