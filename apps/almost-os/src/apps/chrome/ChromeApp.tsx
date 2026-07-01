import { useEffect, useRef, useState } from "react";
import {
  chromeStore,
  frameSrc,
  hostOf,
  useChrome,
  type ChromeGroup,
  type ChromeTab,
} from "./chrome-store";
import { hideEruda, showEruda } from "./eruda-inject";

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (failed || !host || url.startsWith("about:")) {
    return (
      <svg className="chrome__favicon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#9aa0aa" strokeWidth="1.3" />
        <path d="M1.5 8h13M8 1.5c3 2 3 11 0 13M8 1.5c-3 2-3 11 0 13" fill="none" stroke="#9aa0aa" strokeWidth="1.1" />
      </svg>
    );
  }
  return (
    <img
      className="chrome__favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export function ChromeApp() {
  const { tabs, groups, activeId, proxy, devtools } = useChrome();
  const [omni, setOmni] = useState("");
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const seeded = useRef(false);

  // Seed a starter tab once so the browser isn't empty (example.com frames fine).
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (chromeStore.getSnapshot().tabs.length === 0) {
      chromeStore.createTab({ url: "https://example.com", title: "New Tab" });
    }
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  useEffect(() => {
    setOmni(activeTab && !activeTab.url.startsWith("about:") ? activeTab.url : "");
  }, [activeTab?.id, activeTab?.url]);

  const groupById = (id: string | null): ChromeGroup | undefined =>
    id ? groups.find((g) => g.id === id) : undefined;

  const submitOmni = () => {
    if (!activeTab || activeTab.viewOnly) return;
    chromeStore.setUrl(activeTab.id, omni);
  };

  const reloadTab = (id: string) =>
    setReloadKeys((k) => ({ ...k, [id]: (k[id] ?? 0) + 1 }));
  const reload = () => {
    if (activeTab) reloadTab(activeTab.id);
  };

  const newTab = () => {
    chromeStore.createTab({ url: "about:blank", title: "New Tab" });
  };

  return (
    <div className="chrome">
      {/* Tab strip */}
      <div className="chrome__tabstrip">
        {tabs.map((tab, i) => {
          const group = groupById(tab.groupId);
          const prev = tabs[i - 1];
          const startsGroup = group && (!prev || prev.groupId !== tab.groupId);
          return (
            <div className="chrome__tabwrap" key={tab.id}>
              {startsGroup && group && (
                <span className="chrome__group-chip" style={{ background: group.color }}>
                  {group.name}
                </span>
              )}
              <button
                type="button"
                className={`chrome__tab${tab.id === activeId ? " is-active" : ""}${group ? " is-grouped" : ""}`}
                style={group ? ({ "--group-color": group.color } as React.CSSProperties) : undefined}
                onClick={() => chromeStore.activate(tab.id)}
                title={tab.url}
              >
                <Favicon url={tab.url} />
                <span className="chrome__tab-title">{tab.title || hostOf(tab.url)}</span>
                {tab.viewOnly && <span className="chrome__tab-eye" title="View only">👁</span>}
                <span
                  className="chrome__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    chromeStore.close(tab.id);
                  }}
                  aria-label="Close tab"
                >
                  ✕
                </span>
              </button>
            </div>
          );
        })}
        <button type="button" className="chrome__newtab" onClick={newTab} aria-label="New tab">
          +
        </button>
      </div>

      {/* Toolbar / omnibox */}
      <div className="chrome__toolbar">
        <button type="button" className="chrome__navbtn" aria-label="Back" disabled>
          ‹
        </button>
        <button type="button" className="chrome__navbtn" aria-label="Forward" disabled>
          ›
        </button>
        <button type="button" className="chrome__navbtn" aria-label="Reload" onClick={reload}>
          ⟳
        </button>
        <div className="chrome__omnibox">
          <span className="chrome__omnibox-lock" aria-hidden="true">
            🔒
          </span>
          <input
            className="chrome__omnibox-input"
            value={omni}
            placeholder="Search or type a URL"
            readOnly={!activeTab || activeTab.viewOnly}
            onChange={(e) => setOmni(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitOmni();
            }}
          />
          {activeTab?.viewOnly && <span className="chrome__omnibox-badge">agent · view only</span>}
        </div>
        <button
          type="button"
          className={`chrome__navbtn chrome__devtools${devtools ? " is-active" : ""}`}
          aria-label="Toggle developer tools"
          aria-pressed={devtools}
          title="Developer tools (Eruda)"
          onClick={() => chromeStore.toggleDevtools()}
        >
          {"</>"}
        </button>
        <button type="button" className="chrome__navbtn" aria-label="Menu" disabled>
          ⋮
        </button>
      </div>

      {/* Content — one iframe per tab, kept mounted */}
      <div className="chrome__content">
        {tabs.length === 0 && <div className="chrome__blank">No tabs open</div>}
        {tabs.map((tab) => (
          <TabFrame
            key={`${tab.id}:${reloadKeys[tab.id] ?? 0}`}
            tab={tab}
            active={tab.id === activeId}
            proxy={proxy}
            devtools={devtools}
          />
        ))}
      </div>
    </div>
  );
}

interface TabFrameProps {
  tab: ChromeTab;
  active: boolean;
  proxy: boolean;
  devtools: boolean;
}

function TabFrame({ tab, active, proxy, devtools }: TabFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Devtools follow the active tab. Inject on toggle-on and re-inject on every
  // (re)load, since a navigation replaces the iframe's document.
  const wantEruda = devtools && active && tab.url !== "about:blank";

  useEffect(() => {
    const iframe = frameRef.current;
    if (!iframe) return;
    if (!wantEruda) {
      hideEruda(iframe);
      return;
    }
    const open = () => showEruda(iframe);
    open();
    iframe.addEventListener("load", open);
    return () => iframe.removeEventListener("load", open);
  }, [wantEruda, tab.url]);

  return (
    <div
      className={`chrome__frame${active ? " is-active" : ""}${tab.viewOnly ? " is-viewonly" : ""}`}
    >
      {tab.url === "about:blank" ? (
        <div className="chrome__newtab-page">
          <div className="chrome__newtab-logo" />
          <p>Type a URL above to browse.</p>
          <span>Pages route through your active network layer.</span>
        </div>
      ) : (
        <iframe
          ref={frameRef}
          className="chrome__iframe"
          src={frameSrc(tab.url, proxy)}
          title={tab.title}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
        />
      )}
      {tab.viewOnly && <div className="chrome__viewonly-overlay" aria-hidden="true" />}
    </div>
  );
}
