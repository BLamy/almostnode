import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// Thin standalone host: the docs reader UI and content now live in the web-ide
// demo (apps/web-ide/src/features/docs) as the single source of truth. This app
// just wires hash-based routing around the shared <DocsView>.
import {
  DocsView,
  resolveDocsPath,
  DEFAULT_DOCS_PATH,
} from "../../web-ide/src/features/docs/docs-view";

function useHashPath(): string {
  const [path, setPath] = useState(() => resolveDocsPath(window.location.hash));
  useEffect(() => {
    const onHash = () => setPath(resolveDocsPath(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (window.location.hash !== `#${path}`) {
      window.history.replaceState(null, "", `#${path}`);
    }
    window.scrollTo({ top: 0, left: 0 });
  }, [path]);
  return path;
}

function App() {
  const path = useHashPath();
  return (
    <DocsView
      currentPath={path}
      onNavigate={(next) => {
        window.location.hash = next === DEFAULT_DOCS_PATH ? "#/overview" : `#${next}`;
      }}
      hrefForPath={(next) => `#${next}`}
    />
  );
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
