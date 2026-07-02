import { useState } from "react";
import { Wallpaper } from "../desktop/Wallpaper";
import { isAuth0Configured, loginWithRedirect } from "./auth0";

export function LoginScreen({ error }: { error?: string | null }) {
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const configured = isAuth0Configured();

  const signIn = async () => {
    setLocalError(null);
    setPending(true);
    try {
      await loginWithRedirect();
    } catch (e) {
      setPending(false);
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="os-login">
      <Wallpaper />
      <div className="os-login__scrim" />
      <div className="os-login__card">
        <div className="os-login__avatar" aria-hidden="true">
          🖥️
        </div>
        <div className="os-login__name">AlmostOS</div>
        <p className="os-login__hint">Sign in to unlock your desktop.</p>

        {!configured ? (
          <div className="os-login__error">
            Auth0 isn't configured yet — set <code>VITE_AUTH0_CLIENT_ID</code> (and optionally{" "}
            <code>VITE_AUTH0_DOMAIN</code>) to enable sign-in.
          </div>
        ) : (
          <button
            type="button"
            className="os-login__button"
            onClick={() => void signIn()}
            disabled={pending}
          >
            {pending ? "Redirecting…" : "Sign in with Auth0"}
          </button>
        )}

        {(error || localError) && (
          <div className="os-login__error">{error || localError}</div>
        )}
      </div>
    </div>
  );
}
