import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";

// The desktop + almostnode runtime are browser-only. Keep them out of the SSR
// graph behind a lazy import that only mounts on the client.
const Desktop = lazy(() =>
  import("../desktop/Desktop").then((m) => ({ default: m.Desktop })),
);
const AuthGate = lazy(() =>
  import("../auth/AuthGate").then((m) => ({ default: m.AuthGate })),
);

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="os-boot" />;
  }

  return (
    <Suspense fallback={<div className="os-boot" />}>
      <AuthGate>
        <Desktop />
      </AuthGate>
    </Suspense>
  );
}
