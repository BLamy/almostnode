import { useMemo, useState } from "react";
import { MarkdownContent } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";
import { defaultAgentWasmAuthManifest } from "@agent-wasm/sdk/auth";
import "./docs.css";
import {
  docsPages,
  legacyHashRedirects,
  type DocsGroup,
  type DocsPage,
} from "./content";
import { pageToMarkdown } from "./to-markdown";

export { docsPages, legacyHashRedirects } from "./content";
export type { DocsGroup, DocsPage } from "./content";

const groupOrder: readonly DocsGroup[] = [
  "Start",
  "Tutorials",
  "React",
  "API",
  "Reference",
];

const pageByPath = new Map(docsPages.map((page) => [page.path, page]));

/** Default docs page path shown when none is selected. */
export const DEFAULT_DOCS_PATH = "/overview";

/**
 * Resolve a raw path/slug (from a hash, search param, or legacy redirect) to a
 * canonical docs page path. Host-agnostic so both the web-ide route and the
 * standalone docs app share one normalization.
 */
export function resolveDocsPath(raw: string | null | undefined): string {
  const cleaned = decodeURIComponent((raw ?? "").replace(/^#/, "")).replace(/^\/?$/, "");
  if (!cleaned) return DEFAULT_DOCS_PATH;
  if (cleaned.startsWith("/")) {
    return pageByPath.has(cleaned) ? cleaned : DEFAULT_DOCS_PATH;
  }
  const redirected = legacyHashRedirects[cleaned] ?? `/${cleaned}`;
  return pageByPath.has(redirected) ? redirected : DEFAULT_DOCS_PATH;
}

export function getDocsPage(path: string): DocsPage {
  return pageByPath.get(path) ?? docsPages[0];
}

function Sidebar({
  current,
  query,
  onQuery,
  hrefForPath,
  onNavigate,
}: {
  current: DocsPage;
  query: string;
  onQuery: (value: string) => void;
  hrefForPath: (path: string) => string;
  onNavigate: (path: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  return (
    <aside className="gb-sidebar" aria-label="Documentation navigation">
      <a
        className="gb-brand"
        href={hrefForPath(DEFAULT_DOCS_PATH)}
        aria-label="agent-wasm docs home"
        onClick={(event) => {
          event.preventDefault();
          onNavigate(DEFAULT_DOCS_PATH);
        }}
      >
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
                    href={hrefForPath(page.path)}
                    className={page.path === current.path ? "active" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(page.path);
                    }}
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
  if (page.path !== DEFAULT_DOCS_PATH) return null;
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

export interface DocsViewProps {
  /** Canonical path of the page to render (e.g. "/overview"). */
  currentPath: string;
  /** Called when the user picks a different page. */
  onNavigate: (path: string) => void;
  /**
   * Compute the href for a docs page path — lets the host use hash links
   * (standalone) or router search params (web-ide) while keeping anchors
   * crawlable. Defaults to a hash link.
   */
  hrefForPath?: (path: string) => string;
}

/**
 * The full GitBook-style docs reader: searchable sidebar, rendered markdown
 * page, and feedback panel. Host-agnostic — navigation and URL shape are
 * injected so it works as a web-ide route and as the standalone docs app.
 */
export function DocsView({ currentPath, onNavigate, hrefForPath }: DocsViewProps) {
  const [query, setQuery] = useState("");
  const page = getDocsPage(currentPath);
  const href = hrefForPath ?? ((path: string) => `#${path}`);
  return (
    <div className="gb-shell">
      <Sidebar
        current={page}
        query={query}
        onQuery={setQuery}
        hrefForPath={href}
        onNavigate={onNavigate}
      />
      <main className="gb-main">
        <Page page={page} />
      </main>
      <HelpfulPanel />
    </div>
  );
}
