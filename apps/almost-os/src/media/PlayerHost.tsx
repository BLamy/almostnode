import { useEffect, useRef } from "react";
import { attachIframe, installBridge } from "./player-store";
import { widgetPlayerUrl } from "./soundcloud-widget";

// The SoundCloud widget needs an initial track URL to instantiate; playback
// only begins once a surface calls into the player store. This benign public
// track just gives the widget something to bind to (auto_play is off).
const SEED_URL = "https://soundcloud.com/avishay-bassa/winamp-it-really-whips-the";

/**
 * Mounts the single hidden SoundCloud widget that is the whole desktop's audio
 * engine. Rendered once at the desktop root so playback survives any window
 * (Winamp, Terminal) opening or closing.
 */
// The desktop runs cross-origin-isolated (COOP: same-origin + COEP:
// credentialless) so its WASM tooling can use SharedArrayBuffer. Under COEP
// credentialless, a cross-origin <iframe> that doesn't send its own COEP header
// (like SoundCloud's widget) only loads if it opts into being fetched without
// credentials via the `credentialless` attribute — otherwise it renders blank
// and its Widget API never reaches READY, so nothing ever plays. React's iframe
// types don't include the attribute yet, hence the spread.
const CREDENTIALLESS = { credentialless: "" } as Record<string, string>;

export function PlayerHost() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (ref.current) attachIframe(ref.current);
    // Install the CLI/agent bridge eagerly so `sc queue`/`sc play` work even
    // before the widget finishes loading (attachIframe also calls it on READY).
    installBridge();
  }, []);

  return (
    <iframe
      {...CREDENTIALLESS}
      ref={ref}
      title="almost-os audio engine"
      src={widgetPlayerUrl(SEED_URL)}
      allow="autoplay"
      aria-hidden="true"
      tabIndex={-1}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        left: -9999,
        top: -9999,
        border: 0,
        opacity: 0,
        pointerEvents: "none",
      }}
    />
  );
}
