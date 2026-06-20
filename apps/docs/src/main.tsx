import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownContent } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";
import { defaultAgentWasmAuthManifest } from "almostnode-sdk/auth";
import "./styles.css";
import {
  docsPages,
  legacyHashRedirects,
  type DocsGroup,
  type DocsPage,
} from "./content";
import { pageToMarkdown } from "./to-markdown";

const groupOrder: readonly DocsGroup[] = [
  "Start",
  "Tutorials",
  "React",
  "API",
  "Reference",
];

const pageByPath = new Map(docsPages.map((page) => [page.path, page]));

function normalizePath(hash: string): string {
  const raw = decodeURIComponent(hash.replace(/^#/, "")).replace(/^\/?$/, "");
  if (!raw) return "/overview";
  if (raw.startsWith("/")) return raw;
  return legacyHashRedirects[raw] ?? `/${raw}`;
}

function useCurrentPage(): DocsPage {
  const [path, setPath] = useState(() => normalizePath(window.location.hash));

  useEffect(() => {
    const onHash = () => setPath(normalizePath(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const page = pageByPath.get(path) ?? docsPages[0];

  useEffect(() => {
    if (page && window.location.hash !== `#${page.path}`) {
      window.history.replaceState(null, "", `#${page.path}`);
    }
    window.scrollTo({ top: 0, left: 0 });
  }, [page]);

  if (!page) throw new Error("No docs pages configured");
  return page;
}

function Sidebar({
  current,
  query,
  onQuery,
}: {
  current: DocsPage;
  query: string;
  onQuery: (value: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  return (
    <aside className="gb-sidebar" aria-label="Documentation navigation">
      <a className="gb-brand" href="#/overview" aria-label="agent-wasm docs home">
        <span className="gb-brand-mark" aria-hidden="true">aw</span>
        <span className="gb-brand-text">
          <strong>agent-wasm</strong>
          <small>Documentation</small>
        </span>
      </a>

      <div className="gb-search">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            fill="currentColor"
            d="M11.74 10.34a6 6 0 1 0-1.4 1.4l3.2 3.2a1 1 0 0 0 1.42-1.42l-3.22-3.18ZM3 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
          />
        </svg>
        <input
          type="search"
          placeholder="Search docs"
          autoComplete="off"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>

      <nav className="gb-nav">
        {groupOrder.map((group) => {
          const pages = docsPages
            .filter((page) => page.group === group)
            .filter((page) => {
              if (!needle) return true;
              return [page.navTitle, page.title, page.summary, page.eyebrow]
                .join(" ")
                .toLowerCase()
                .includes(needle);
            });
          if (pages.length === 0) return null;
          return (
            <section key={group} className="gb-nav-group">
              <h2>{group}</h2>
              <div>
                {pages.map((page) => (
                  <a
                    key={page.path}
                    href={`#${page.path}`}
                    className={page.path === current.path ? "active" : undefined}
                  >
                    {page.navTitle}
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

function HeaderStats({ page }: { page: DocsPage }) {
  if (page.path !== "/overview") return null;
  return (
    <div className="gb-stats">
      <div>
        <span>{docsPages.filter((item) => item.group === "API").length}</span>
        API reference pages
      </div>
      <div>
        <span>{docsPages.filter((item) => item.group === "Tutorials").length}</span>
        tutorials
      </div>
      <div>
        <span>{defaultAgentWasmAuthManifest.slots.length}</span>
        credential slots
      </div>
    </div>
  );
}

function Page({ page }: { page: DocsPage }) {
  const markdown = useMemo(() => pageToMarkdown(page), [page]);
  return (
    <article className="gb-page" data-docstream>
      <header className="gb-page-header">
        <div className="gb-breadcrumb">
          <span>{page.group}</span>
          <span>/</span>
          <span>{page.eyebrow}</span>
          {page.status ? (
            <span className={`gb-status gb-status-${page.status}`}>{page.status}</span>
          ) : null}
        </div>
        <h1>{page.title}</h1>
        <p className="gb-lead">{page.summary}</p>
        <HeaderStats page={page} />
      </header>
      <div className="docs-article">
        <MarkdownContent markdown={markdown} />
      </div>
    </article>
  );
}

function HelpfulPanel() {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <aside className="gb-aside" aria-label="Feedback">
      <span className="gb-aside-label">Was this helpful?</span>
      <div className="gb-vote">
        <button
          type="button"
          aria-pressed={vote === "up"}
          className={vote === "up" ? "active" : undefined}
          onClick={() => setVote("up")}
        >
          👍
        </button>
        <button
          type="button"
          aria-pressed={vote === "down"}
          className={vote === "down" ? "active" : undefined}
          onClick={() => setVote("down")}
        >
          👎
        </button>
      </div>
    </aside>
  );
}

function App() {
  const page = useCurrentPage();
  const [query, setQuery] = useState("");
  return (
    <div className="gb-shell">
      <Sidebar current={page} query={query} onQuery={setQuery} />
      <main className="gb-main">
        <Page page={page} />
      </main>
      <HelpfulPanel />
    </div>
  );
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
