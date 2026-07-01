import { useSyncExternalStore } from "react";

export interface ChromeGroup {
  id: string;
  name: string;
  color: string;
}

export interface ChromeTab {
  id: string;
  title: string;
  url: string;
  groupId: string | null;
  /** Agent-created tabs are view-only: the user can watch but not interact. */
  viewOnly: boolean;
}

interface ChromeState {
  tabs: ChromeTab[];
  groups: ChromeGroup[];
  activeId: string | null;
  /** Route tab iframes through the dev CORS/framing proxy. */
  proxy: boolean;
  /** Inject the Eruda devtools console into the active page. */
  devtools: boolean;
}

const GROUP_COLORS = ["#f6a04d", "#5aa9ff", "#7ed492", "#c77dff", "#ff8a8a", "#54c7c7"];

export const CORS_PROXY_PATH = "/__api/cors-proxy";

/** The URL to put in an iframe — direct, or routed through the proxy. */
export function frameSrc(url: string, proxy: boolean): string {
  if (!proxy || url.startsWith("about:") || url.startsWith("data:")) return url;
  return `${CORS_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

// Proxy on by default: the browser always routes through the active network
// layer (CORS/framing proxy → Tailscale when connected).
let state: ChromeState = { tabs: [], groups: [], activeId: null, proxy: true, devtools: false };
const listeners = new Set<() => void>();
let counter = 0;
const nextId = (prefix: string) => `${prefix}${(counter += 1)}`;

function commit(next: ChromeState) {
  state = next;
  for (const listener of listeners) listener();
}

export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return "about:blank";
  if (/^(https?:|about:|data:)/.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const chromeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ChromeState {
    return state;
  },
  createGroup(name: string, color?: string): string {
    const id = nextId("g");
    const group: ChromeGroup = {
      id,
      name,
      color: color ?? GROUP_COLORS[state.groups.length % GROUP_COLORS.length],
    };
    commit({ ...state, groups: [...state.groups, group] });
    return id;
  },
  ensureGroup(name: string, color?: string): string {
    const existing = state.groups.find((g) => g.name === name);
    return existing ? existing.id : chromeStore.createGroup(name, color);
  },
  createTab(opts: {
    url: string;
    title?: string;
    groupId?: string | null;
    viewOnly?: boolean;
    activate?: boolean;
  }): string {
    const id = nextId("t");
    const tab: ChromeTab = {
      id,
      url: normalizeUrl(opts.url),
      title: opts.title ?? hostOf(opts.url),
      groupId: opts.groupId ?? null,
      viewOnly: opts.viewOnly ?? false,
    };
    commit({
      ...state,
      tabs: [...state.tabs, tab],
      activeId: opts.activate === false ? (state.activeId ?? id) : id,
    });
    return id;
  },
  activate(id: string) {
    if (state.activeId === id) return;
    commit({ ...state, activeId: id });
  },
  close(id: string) {
    const tabs = state.tabs.filter((t) => t.id !== id);
    let activeId = state.activeId;
    if (activeId === id) activeId = tabs[tabs.length - 1]?.id ?? null;
    commit({ ...state, tabs, activeId });
  },
  setUrl(id: string, url: string) {
    commit({
      ...state,
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, url: normalizeUrl(url), title: hostOf(url) } : t,
      ),
    });
  },
  toggleProxy() {
    commit({ ...state, proxy: !state.proxy });
  },
  setProxy(on: boolean) {
    commit({ ...state, proxy: on });
  },
  toggleDevtools() {
    commit({ ...state, devtools: !state.devtools });
  },
  setDevtools(on: boolean) {
    commit({ ...state, devtools: on });
  },
};

export function useChrome(): ChromeState {
  return useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot, chromeStore.getSnapshot);
}

/** Expose the agent-facing API on window so in-page agents/console can drive it. */
export function installChromeBridge(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { almostOS?: { chrome?: unknown } }).almostOS = {
    ...((window as unknown as { almostOS?: object }).almostOS ?? {}),
    chrome: {
      createGroup: (name: string, color?: string) => chromeStore.createGroup(name, color),
      createTab: (opts: Parameters<typeof chromeStore.createTab>[0]) => chromeStore.createTab(opts),
      openTab: (url: string, group = "Agent") =>
        chromeStore.createTab({ url, groupId: chromeStore.ensureGroup(group), viewOnly: true }),
      close: (id: string) => chromeStore.close(id),
    },
  };
}
