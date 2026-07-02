import { useEffect, useState, type ReactNode } from "react";
import {
  getSession,
  handleRedirectCallback,
  subscribe,
  type Auth0Session,
} from "./auth0";
import { LoginScreen } from "./LoginScreen";

type BootState =
  | { phase: "completing-redirect" }
  | { phase: "ready"; session: Auth0Session | null };

/**
 * Gates `children` behind an Auth0 login. Handles the redirect-back from Auth0
 * (`?code&state`) once on boot, then renders <LoginScreen/> or `children`
 * depending on whether a session is present.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<BootState>({ phase: "completing-redirect" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void handleRedirectCallback()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBoot({ phase: "ready", session: getSession() });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribe(() => {
      setBoot((prev) => (prev.phase === "ready" ? { phase: "ready", session: getSession() } : prev));
    });
  }, []);

  if (boot.phase === "completing-redirect") {
    return <div className="os-boot" />;
  }
  if (!boot.session) {
    return <LoginScreen error={error} />;
  }
  return <>{children}</>;
}
