import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { MarkdownContent } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";
import { defaultAgentWasmAuthManifest } from "@agent-wasm/sdk/auth";
import type { WorkspaceController } from "@agent-wasm/sdk";
import "./docs.css";
import {
  docsPages,
  legacyHashRedirects,
  type CodeDemo,
  type CodeExample,
  type DocsBlock,
  type DocsGroup,
  type DocsPage,
} from "./content";
import { blockToMarkdown, codeToMarkdown } from "./to-markdown";

export { docsPages, legacyHashRedirects } from "./content";
export type { DocsGroup, DocsPage } from "./content";

const groupOrder: readonly DocsGroup[] = [
  "Start",
  "Tutorials",
  "React",
  "Editors",
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

function MarkdownBlock({ block }: { block: DocsBlock }) {
  const markdown = useMemo(() => blockToMarkdown(block), [block]);
  return <MarkdownContent markdown={markdown} />;
}

function CodeMarkdown({ example }: { example: CodeExample }) {
  const markdown = useMemo(() => codeToMarkdown(example), [example]);
  return <MarkdownContent markdown={markdown} />;
}

function RuntimeOutputDemo({ demo }: { demo: CodeDemo }) {
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [output, setOutput] = useState("$ node /index.js\n");

  useEffect(() => {
    let cancelled = false;

    async function runDemo() {
      try {
        const { createContainer } = await import("@agent-wasm/core");
        const container = createContainer();
        container.vfs.writeFileSync("/index.js", "console.log('hello')");
        const result = await container.run("node /index.js", {
          onStdout: (chunk) => {
            if (!cancelled) {
              setOutput((current) => `${current}${chunk}`);
            }
          },
          onStderr: (chunk) => {
            if (!cancelled) {
              setOutput((current) => `${current}${chunk}`);
            }
          },
        });
        if (!cancelled) {
          setOutput((current) => `${current}\nexit ${result.exitCode}`);
          setStatus(result.exitCode === 0 ? "done" : "error");
        }
      } catch (error) {
        if (!cancelled) {
          setOutput((current) => `${current}${error instanceof Error ? error.message : String(error)}`);
          setStatus("error");
        }
      }
    }

    void runDemo();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="gb-demo gb-demo-runtime">
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <pre data-status={status}>{output}</pre>
    </div>
  );
}

type ReactWorkbenchModules = {
  AgentPanel: ComponentType<{ adapterId?: string }>;
  AlmostnodeProvider: ComponentType<{ workspace: unknown; children: ReactNode }>;
  EditorPane: ComponentType;
  PreviewPane: ComponentType<{ autoStart?: boolean }>;
  TerminalPane: ComponentType<{
    cwd?: string;
    env?: Record<string, string>;
    initialCommand?: string;
    initialCommandDelayMs?: number;
  }>;
};

type DemoWorkspace = WorkspaceController;

function ReactWorkbenchDemo({ demo }: { demo: CodeDemo }) {
  const [modules, setModules] = useState<ReactWorkbenchModules | null>(null);
  const [workspace, setWorkspace] = useState<DemoWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveWorkspace: DemoWorkspace | null = null;

    async function boot() {
      try {
        const [sdk, react] = await Promise.all([
          import("@agent-wasm/sdk"),
          import("@agent-wasm/react/workbench"),
        ]);
        if (cancelled) {
          return;
        }

        const snapshotStore = {
          load: async () => null,
          save: async () => undefined,
          clear: async () => undefined,
        };
        const nextWorkspace = sdk.createWorkspace({
          autoStartPreview: true,
          installMode: "lazy",
          snapshotStore,
        }) as DemoWorkspace;

        liveWorkspace = nextWorkspace;
        setModules({
          AgentPanel: react.AgentPanel,
          AlmostnodeProvider: react.AlmostnodeProvider as ReactWorkbenchModules["AlmostnodeProvider"],
          EditorPane: react.EditorPane,
          PreviewPane: react.PreviewPane,
          TerminalPane: react.TerminalPane,
        });
        setWorkspace(nextWorkspace);
        await nextWorkspace.ready;
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      liveWorkspace?.destroy();
    };
  }, []);

  if (error) {
    return (
      <div className="gb-demo gb-demo-error">
        <strong>Demo failed to start</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!modules || !workspace) {
    return (
      <div className="gb-demo gb-demo-loading">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
        <div className="gb-demo-progress" aria-hidden="true" />
      </div>
    );
  }

  const Provider = modules.AlmostnodeProvider;
  const Editor = modules.EditorPane;
  const Preview = modules.PreviewPane;

  return (
    <div className="gb-demo gb-demo-workbench">
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <Provider workspace={workspace}>
        <div className="gb-demo-workbench-grid">
          <Editor />
          <Preview autoStart />
        </div>
      </Provider>
    </div>
  );
}

function createDemoSnapshotStore() {
  return {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
}

const CODEX_CLI_DEMO_DOC_PATH = "/project/docs/brief.md";

const CODEX_CLI_DEMO_DOC = [
  "# Demo brief",
  "",
  "Ask Codex to update this document after you sign in.",
  "",
  "- Keep the brief concise.",
  "- Mention that editor, terminal, and preview share one VFS.",
  "- Save changes to this markdown file, not a generated fixture.",
].join("\n");

const CODEX_CLI_DEMO_PREVIEW_SOURCE = [
  "import brief from '../docs/brief.md?raw';",
  "",
  "const root = document.getElementById('app');",
  "",
  "function escapeHtml(value) {",
  "  return value",
  "    .replaceAll('&', '&amp;')",
  "    .replaceAll('<', '&lt;')",
  "    .replaceAll('>', '&gt;');",
  "}",
  "",
  "root.innerHTML = `",
  "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;\">",
  "    <section style=\"width:min(720px,100%);\">",
  "      <p style=\"letter-spacing:.16em;text-transform:uppercase;color:#93c5fd;font-size:12px;margin:0 0 12px;\">docs/brief.md</p>",
  "      <h1 style=\"font-size:44px;line-height:1.05;margin:0 0 18px;\">Document preview</h1>",
  "      <pre style=\"white-space:pre-wrap;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.35);border-radius:12px;padding:18px;color:#dbeafe;\">${escapeHtml(brief)}</pre>",
  "    </section>",
  "  </main>`;",
].join("\n");

const OPENCODE_TUI_DEMO_DOC_PATH = "/project/docs/brief.md";

const OPENCODE_TUI_DEMO_DOC = [
  "# Demo brief",
  "",
  "Ask OpenCode to update this document after you sign in.",
  "",
  "- Keep the brief concise.",
  "- Mention that OpenCode, editor, and preview share one VFS.",
  "- Save changes to this markdown file, not a generated fixture.",
].join("\n");

const OPENCODE_TUI_DEMO_PREVIEW_SOURCE = [
  "import brief from '../docs/brief.md?raw';",
  "",
  "const root = document.getElementById('app');",
  "",
  "function escapeHtml(value) {",
  "  return value",
  "    .replaceAll('&', '&amp;')",
  "    .replaceAll('<', '&lt;')",
  "    .replaceAll('>', '&gt;');",
  "}",
  "",
  "root.innerHTML = `",
  "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:#111827;color:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;\">",
  "    <section style=\"width:min(720px,100%);\">",
  "      <p style=\"letter-spacing:.16em;text-transform:uppercase;color:#86efac;font-size:12px;margin:0 0 12px;\">docs/brief.md</p>",
  "      <h1 style=\"font-size:44px;line-height:1.05;margin:0 0 18px;\">OpenCode document preview</h1>",
  "      <pre style=\"white-space:pre-wrap;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(2,6,23,.7);border:1px solid rgba(134,239,172,.35);border-radius:12px;padding:18px;color:#dcfce7;\">${escapeHtml(brief)}</pre>",
  "    </section>",
  "  </main>`;",
].join("\n");

type TerminalAgentDemoId = Extract<CodeDemo, { kind: "terminal-agent-editor" }>["agentId"];

type TerminalAgentDemoConfig = {
  readonly docPath: string;
  readonly doc: string;
  readonly extraFiles?: Record<string, string>;
  readonly previewSource: string;
  readonly initialCommand: string;
  readonly terminalEnv?: Record<string, string>;
};

const CLAUDE_CLI_DEMO_DOC_PATH = "/project/docs/brief.md";

const CLAUDE_CLI_DEMO_DOC = [
  "# Demo brief",
  "",
  "Ask Claude Code to update this document after you sign in.",
  "",
  "- Keep the brief concise.",
  "- Mention that Claude Code, editor, and preview share one VFS.",
  "- Save changes to this markdown file, not a generated fixture.",
].join("\n");

const CLAUDE_EXTENSION_TO_LANGUAGE = {
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
};

const CLAUDE_PLUGIN_FILES = {
  "/project/.claude-plugin/plugin.json": JSON.stringify(
    {
      name: "almostnode-lsp",
      version: "0.1.0",
      description: "Workspace-local oxlint and tsgo LSP wiring for Claude Code.",
      lspServers: "./.lsp.json",
    },
    null,
    2,
  ),
  "/project/.claude-plugin/.lsp.json": JSON.stringify(
    {
      oxlint: {
        command: "almostnode-lsp-bridge",
        args: ["oxlint"],
        extensionToLanguage: CLAUDE_EXTENSION_TO_LANGUAGE,
        transport: "stdio",
      },
      tsgo: {
        command: "almostnode-lsp-bridge",
        args: ["tsgo"],
        extensionToLanguage: CLAUDE_EXTENSION_TO_LANGUAGE,
        transport: "stdio",
      },
    },
    null,
    2,
  ),
};

const CLAUDE_CLI_DEMO_PREVIEW_SOURCE = [
  "import brief from '../docs/brief.md?raw';",
  "",
  "const root = document.getElementById('app');",
  "",
  "function escapeHtml(value) {",
  "  return value",
  "    .replaceAll('&', '&amp;')",
  "    .replaceAll('<', '&lt;')",
  "    .replaceAll('>', '&gt;');",
  "}",
  "",
  "root.innerHTML = `",
  "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:#111827;color:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;\">",
  "    <section style=\"width:min(720px,100%);\">",
  "      <p style=\"letter-spacing:.16em;text-transform:uppercase;color:#f0abfc;font-size:12px;margin:0 0 12px;\">docs/brief.md</p>",
  "      <h1 style=\"font-size:44px;line-height:1.05;margin:0 0 18px;\">Claude Code document preview</h1>",
  "      <pre style=\"white-space:pre-wrap;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(17,24,39,.74);border:1px solid rgba(240,171,252,.34);border-radius:12px;padding:18px;color:#fae8ff;\">${escapeHtml(brief)}</pre>",
  "    </section>",
  "  </main>`;",
].join("\n");

const PI_CLI_DEMO_DOC_PATH = "/project/docs/brief.md";

const PI_CLI_DEMO_DOC = [
  "# Demo brief",
  "",
  "Ask Pi to update this document after you sign in.",
  "",
  "- Keep the brief concise.",
  "- Mention that Pi, editor, and preview share one VFS.",
  "- Save changes to this markdown file, not a generated fixture.",
].join("\n");

const PI_CLI_DEMO_PREVIEW_SOURCE = [
  "import brief from '../docs/brief.md?raw';",
  "",
  "const root = document.getElementById('app');",
  "",
  "function escapeHtml(value) {",
  "  return value",
  "    .replaceAll('&', '&amp;')",
  "    .replaceAll('<', '&lt;')",
  "    .replaceAll('>', '&gt;');",
  "}",
  "",
  "root.innerHTML = `",
  "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:#172554;color:#eff6ff;font-family:ui-sans-serif,system-ui,sans-serif;\">",
  "    <section style=\"width:min(720px,100%);\">",
  "      <p style=\"letter-spacing:.16em;text-transform:uppercase;color:#67e8f9;font-size:12px;margin:0 0 12px;\">docs/brief.md</p>",
  "      <h1 style=\"font-size:44px;line-height:1.05;margin:0 0 18px;\">Pi document preview</h1>",
  "      <pre style=\"white-space:pre-wrap;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(15,23,42,.68);border:1px solid rgba(103,232,249,.34);border-radius:12px;padding:18px;color:#cffafe;\">${escapeHtml(brief)}</pre>",
  "    </section>",
  "  </main>`;",
].join("\n");

const TERMINAL_AGENT_DEMO_CONFIG: Record<TerminalAgentDemoId, TerminalAgentDemoConfig> = {
  claude: {
    docPath: CLAUDE_CLI_DEMO_DOC_PATH,
    doc: CLAUDE_CLI_DEMO_DOC,
    extraFiles: CLAUDE_PLUGIN_FILES,
    previewSource: CLAUDE_CLI_DEMO_PREVIEW_SOURCE,
    initialCommand:
      "/usr/local/bin/claude-wrapper --plugin-dir /project/.claude-plugin --permission-mode bypassPermissions --help",
  },
  pi: {
    docPath: PI_CLI_DEMO_DOC_PATH,
    doc: PI_CLI_DEMO_DOC,
    previewSource: PI_CLI_DEMO_PREVIEW_SOURCE,
    initialCommand: "npx @earendil-works/pi-coding-agent --version",
    terminalEnv: {
      PI_CODING_AGENT_DIR: "/home/user/.pi/agent",
    },
  },
};

function writeAgentDemoFile(workspace: DemoWorkspace, agentLabel: string) {
  workspace.writeFile(
    "/project/src/main.js",
    [
      "const root = document.getElementById('app')",
      "root.innerHTML = `",
      "  <main style=\"min-height:100vh;display:grid;place-items:center;padding:32px;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;\">",
      "    <section style=\"max-width:560px;text-align:center;\">",
      `      <p style=\"letter-spacing:.18em;text-transform:uppercase;color:#93c5fd;font-size:12px;\">${agentLabel} editor demo</p>`,
      `      <h1 style=\"font-size:44px;line-height:1.05;margin:16px 0 12px;\">${agentLabel} wrote this file through the workspace VFS.</h1>`,
      "      <p style=\"font-size:18px;line-height:1.6;color:#cbd5e1;\">The React editor pane is syntax highlighted, and every edit calls workspace.writeFile(), so the preview server sees the same change event as an agent write.</p>",
      "    </section>",
      "  </main>`",
    ].join("\n"),
  );
}

function createLocalAgentDemoAdapter(demo: Extract<CodeDemo, { kind: "agent-editor" }>) {
  return {
    id: demo.agentId,
    label: demo.agentLabel,
    mount({ element, workspace }: { element: HTMLElement; workspace: DemoWorkspace }) {
      let disposed = false;
      let editCount = 0;
      const root = document.createElement("div");
      root.className = "gb-agent-demo-panel";

      const eyebrow = document.createElement("span");
      eyebrow.textContent = "local adapter demo";

      const title = document.createElement("strong");
      title.textContent = demo.agentLabel;

      const copy = document.createElement("p");
      copy.textContent =
        "This adapter is mounted through AgentPanel. It edits the same VFS file the editor pane is showing, so the preview can hot reload without any app-local glue.";

      const status = document.createElement("code");
      status.textContent = "mounted";

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Apply VFS edit";
      button.onclick = () => {
        editCount += 1;
        writeAgentDemoFile(workspace, demo.agentLabel);
        status.textContent = `wrote /project/src/main.js (${editCount})`;
      };

      root.append(eyebrow, title, copy, button, status);
      element.replaceChildren(root);

      const timer = window.setTimeout(() => {
        if (!disposed) {
          button.click();
        }
      }, 1200);

      return {
        dispose() {
          disposed = true;
          window.clearTimeout(timer);
          if (element.contains(root)) {
            element.replaceChildren();
          }
        },
      };
    },
  };
}

function AgentEditorDemo({ demo }: { demo: Extract<CodeDemo, { kind: "agent-editor" }> }) {
  const [modules, setModules] = useState<ReactWorkbenchModules | null>(null);
  const [workspace, setWorkspace] = useState<DemoWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveWorkspace: DemoWorkspace | null = null;

    async function boot() {
      try {
        const [sdk, react] = await Promise.all([
          import("@agent-wasm/sdk"),
          import("@agent-wasm/react/workbench"),
        ]);
        if (cancelled) return;

        const nextWorkspace = sdk.createWorkspace({
          autoStartPreview: true,
          installMode: "lazy",
          snapshotStore: createDemoSnapshotStore(),
        }) as DemoWorkspace;
        nextWorkspace.agents.register(createLocalAgentDemoAdapter(demo));
        liveWorkspace = nextWorkspace;
        setModules({
          AgentPanel: react.AgentPanel,
          AlmostnodeProvider: react.AlmostnodeProvider as ReactWorkbenchModules["AlmostnodeProvider"],
          EditorPane: react.EditorPane,
          PreviewPane: react.PreviewPane,
          TerminalPane: react.TerminalPane,
        });
        setWorkspace(nextWorkspace);
        await nextWorkspace.ready;
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      liveWorkspace?.destroy();
    };
  }, [demo]);

  if (error) {
    return (
      <div className="gb-demo gb-demo-error">
        <strong>Demo failed to start</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!modules || !workspace) {
    return (
      <div className="gb-demo gb-demo-loading">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
        <div className="gb-demo-progress" aria-hidden="true" />
      </div>
    );
  }

  const Provider = modules.AlmostnodeProvider;
  const Agent = modules.AgentPanel;
  const Editor = modules.EditorPane;
  const Preview = modules.PreviewPane;

  return (
    <div className="gb-demo gb-demo-workbench gb-demo-agent-editor">
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <Provider workspace={workspace}>
        <div className="gb-demo-agent-grid">
          <Agent adapterId={demo.agentId} />
          <Editor />
          <Preview autoStart />
        </div>
      </Provider>
    </div>
  );
}

function OpenCodeTuiPane({ workspace }: { workspace: DemoWorkspace }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Starting OpenCode...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: { dispose(): void; exited: Promise<void> } | null = null;

    async function mount() {
      const host = hostRef.current;
      if (!host) return;

      try {
        const opencode = await import("../opencode-browser-session");
        if (cancelled) return;

        const mounted = await opencode.mountOpenCodeBrowserSession({
          container: workspace.container,
          element: host,
          cwd: "/project",
          env: {},
          opencodeDirectory: "/docs/opencode-editor",
          themeMode: window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
        });

        if (cancelled) {
          mounted.dispose();
          return;
        }

        session = mounted;
        setStatus("OpenCode ready");
        void mounted.exited.finally(() => {
          if (!cancelled) {
            setStatus("OpenCode exited");
          }
        });
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setStatus("OpenCode failed");
        }
      }
    }

    void mount();

    return () => {
      cancelled = true;
      session?.dispose();
    };
  }, [workspace]);

  return (
    <section className="gb-demo-opencode-pane">
      <header>
        <strong>OpenCode</strong>
        <span>{status}</span>
      </header>
      <div ref={hostRef} className="gb-demo-opencode-host">
        {error ? (
          <div className="gb-demo-opencode-error">
            <strong>OpenCode failed to start</strong>
            <pre>{error}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OpenCodeTuiEditorDemo({ demo }: { demo: Extract<CodeDemo, { kind: "opencode-tui-editor" }> }) {
  const [modules, setModules] = useState<ReactWorkbenchModules | null>(null);
  const [workspace, setWorkspace] = useState<DemoWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveWorkspace: DemoWorkspace | null = null;

    async function boot() {
      try {
        const [sdk, react] = await Promise.all([
          import("@agent-wasm/sdk"),
          import("@agent-wasm/react/workbench"),
        ]);
        if (cancelled) return;

        const nextWorkspace = sdk.createWorkspace({
          autoStartPreview: true,
          installMode: "lazy",
          snapshotStore: createDemoSnapshotStore(),
          initialFiles: {
            [OPENCODE_TUI_DEMO_DOC_PATH]: OPENCODE_TUI_DEMO_DOC,
            "/project/src/main.js": OPENCODE_TUI_DEMO_PREVIEW_SOURCE,
          },
        });

        liveWorkspace = nextWorkspace;
        await nextWorkspace.ready;
        nextWorkspace.setCurrentFile(OPENCODE_TUI_DEMO_DOC_PATH);
        if (cancelled) return;

        setModules({
          AgentPanel: react.AgentPanel,
          AlmostnodeProvider: react.AlmostnodeProvider as ReactWorkbenchModules["AlmostnodeProvider"],
          EditorPane: react.EditorPane,
          PreviewPane: react.PreviewPane,
          TerminalPane: react.TerminalPane,
        });
        setWorkspace(nextWorkspace);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      liveWorkspace?.destroy();
    };
  }, []);

  if (error) {
    return (
      <div className="gb-demo gb-demo-error">
        <strong>Demo failed to start</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!modules || !workspace) {
    return (
      <div className="gb-demo gb-demo-loading">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
        <div className="gb-demo-progress" aria-hidden="true" />
      </div>
    );
  }

  const Provider = modules.AlmostnodeProvider;
  const Editor = modules.EditorPane;
  const Preview = modules.PreviewPane;

  return (
    <div className="gb-demo gb-demo-workbench gb-demo-opencode-tui-editor">
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <Provider workspace={workspace}>
        <div className="gb-demo-opencode-tui-grid">
          <OpenCodeTuiPane workspace={workspace} />
          <Editor />
          <Preview autoStart />
        </div>
      </Provider>
    </div>
  );
}

function TerminalAgentEditorDemo({ demo }: { demo: Extract<CodeDemo, { kind: "terminal-agent-editor" }> }) {
  const [modules, setModules] = useState<ReactWorkbenchModules | null>(null);
  const [workspace, setWorkspace] = useState<DemoWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = TERMINAL_AGENT_DEMO_CONFIG[demo.agentId];

  useEffect(() => {
    let cancelled = false;
    let liveWorkspace: DemoWorkspace | null = null;

    async function boot() {
      try {
        const [sdk, react] = await Promise.all([
          import("@agent-wasm/sdk"),
          import("@agent-wasm/react/workbench"),
        ]);
        if (cancelled) return;

        const nextWorkspace = sdk.createWorkspace({
          autoStartPreview: true,
          installMode: "lazy",
          snapshotStore: createDemoSnapshotStore(),
          initialFiles: {
            ...config.extraFiles,
            [config.docPath]: config.doc,
            "/project/src/main.js": config.previewSource,
          },
        });

        liveWorkspace = nextWorkspace;
        await nextWorkspace.ready;
        nextWorkspace.setCurrentFile(config.docPath);
        if (cancelled) return;

        setModules({
          AgentPanel: react.AgentPanel,
          AlmostnodeProvider: react.AlmostnodeProvider as ReactWorkbenchModules["AlmostnodeProvider"],
          EditorPane: react.EditorPane,
          PreviewPane: react.PreviewPane,
          TerminalPane: react.TerminalPane,
        });
        setWorkspace(nextWorkspace);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      liveWorkspace?.destroy();
    };
  }, [config]);

  if (error) {
    return (
      <div className="gb-demo gb-demo-error">
        <strong>Demo failed to start</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!modules || !workspace) {
    return (
      <div className="gb-demo gb-demo-loading">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
        <div className="gb-demo-progress" aria-hidden="true" />
      </div>
    );
  }

  const Provider = modules.AlmostnodeProvider;
  const Terminal = modules.TerminalPane;
  const Editor = modules.EditorPane;
  const Preview = modules.PreviewPane;

  return (
    <div
      className={`gb-demo gb-demo-workbench gb-demo-terminal-agent-editor gb-demo-terminal-agent-editor--${demo.agentId}`}
    >
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <Provider workspace={workspace}>
        <div className="gb-demo-terminal-agent-grid">
          <Terminal
            cwd="/project"
            env={config.terminalEnv}
            initialCommand={config.initialCommand}
            initialCommandDelayMs={350}
          />
          <Editor />
          <Preview autoStart />
        </div>
      </Provider>
    </div>
  );
}

function CodexCliEditorDemo({ demo }: { demo: Extract<CodeDemo, { kind: "codex-cli-editor" }> }) {
  const [modules, setModules] = useState<ReactWorkbenchModules | null>(null);
  const [workspace, setWorkspace] = useState<DemoWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveWorkspace: DemoWorkspace | null = null;

    async function boot() {
      try {
        const [sdk, react, codexCli, codexAuth] = await Promise.all([
          import("@agent-wasm/sdk"),
          import("@agent-wasm/react/workbench"),
          import("../codex-cli-browser-session"),
          import("../codex-auth"),
        ]);
        if (cancelled) return;

        const nextWorkspace = sdk.createWorkspace({
          autoStartPreview: true,
          installMode: "lazy",
          snapshotStore: createDemoSnapshotStore(),
          initialFiles: {
            [CODEX_CLI_DEMO_DOC_PATH]: CODEX_CLI_DEMO_DOC,
            "/project/src/main.js": CODEX_CLI_DEMO_PREVIEW_SOURCE,
          },
        });

        nextWorkspace.container.registerShellCommand(
          codexCli.createWebIdeCodexCliShellCommand({
            container: nextWorkspace.container,
            cwd: "/project",
            requestBrowserLogin: ({ login, context }) =>
              codexAuth.runCodexBrowserLogin({
                method: login.type,
                vfs: nextWorkspace.vfs,
                signal: context.signal,
                writeStdout: context.writeStdout,
              }),
          }),
        );

        liveWorkspace = nextWorkspace;
        await nextWorkspace.ready;
        nextWorkspace.setCurrentFile(CODEX_CLI_DEMO_DOC_PATH);
        if (cancelled) return;

        setModules({
          AgentPanel: react.AgentPanel,
          AlmostnodeProvider: react.AlmostnodeProvider as ReactWorkbenchModules["AlmostnodeProvider"],
          EditorPane: react.EditorPane,
          PreviewPane: react.PreviewPane,
          TerminalPane: react.TerminalPane,
        });
        setWorkspace(nextWorkspace);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      liveWorkspace?.destroy();
    };
  }, []);

  if (error) {
    return (
      <div className="gb-demo gb-demo-error">
        <strong>Demo failed to start</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!modules || !workspace) {
    return (
      <div className="gb-demo gb-demo-loading">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
        <div className="gb-demo-progress" aria-hidden="true" />
      </div>
    );
  }

  const Provider = modules.AlmostnodeProvider;
  const Terminal = modules.TerminalPane;
  const Editor = modules.EditorPane;
  const Preview = modules.PreviewPane;

  return (
    <div className="gb-demo gb-demo-workbench gb-demo-codex-cli-editor">
      <div className="gb-demo-copy">
        <strong>{demo.title}</strong>
        <span>{demo.description}</span>
      </div>
      <Provider workspace={workspace}>
        <div className="gb-demo-codex-cli-grid">
          <Terminal cwd="/project" initialCommand="codex --help" initialCommandDelayMs={350} />
          <Editor />
          <Preview autoStart />
        </div>
      </Provider>
    </div>
  );
}

function DocsExampleDemo({ demo }: { demo: CodeDemo }) {
  switch (demo.kind) {
    case "runtime-output":
      return <RuntimeOutputDemo demo={demo} />;
    case "react-workbench":
      return <ReactWorkbenchDemo demo={demo} />;
    case "agent-editor":
      return <AgentEditorDemo demo={demo} />;
    case "codex-cli-editor":
      return <CodexCliEditorDemo demo={demo} />;
    case "opencode-tui-editor":
      return <OpenCodeTuiEditorDemo demo={demo} />;
    case "terminal-agent-editor":
      return <TerminalAgentEditorDemo demo={demo} />;
  }
}

function CodeExamplePanel({ example }: { example: CodeExample }) {
  const storageKey = `agent-wasm-docs-example-tab:${example.id}`;
  const readStoredTab = (): "code" | "demo" => {
    if (!example.demo || typeof window === "undefined") return "code";
    return window.sessionStorage.getItem(storageKey) === "demo" ? "demo" : "code";
  };
  const [tab, setTabState] = useState<"code" | "demo">(readStoredTab);
  const setTab = (nextTab: "code" | "demo") => {
    setTabState(nextTab);
    try {
      window.sessionStorage.setItem(storageKey, nextTab);
    } catch {
      // Session storage can be unavailable in locked-down browser contexts.
    }
  };

  useEffect(() => {
    setTabState(readStoredTab());
  }, [example.demo, storageKey]);

  if (!example.demo) {
    return <CodeMarkdown example={example} />;
  }

  return (
    <section className="gb-code-example" aria-label={example.title}>
      <header className="gb-code-example-header">
        <div>
          <span>{example.title}</span>
          <small>{example.language}</small>
        </div>
        <div className="gb-code-tabs" role="tablist" aria-label={`${example.title} views`}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "code"}
            className={tab === "code" ? "active" : undefined}
            onClick={() => setTab("code")}
          >
            Code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "demo"}
            className={tab === "demo" ? "active" : undefined}
            onClick={() => setTab("demo")}
          >
            Demo
          </button>
        </div>
      </header>
      <div className="gb-code-example-body">
        {tab === "code" ? (
          <CodeMarkdown example={example} />
        ) : (
          <DocsExampleDemo demo={example.demo} />
        )}
      </div>
    </section>
  );
}

function BlockRenderer({ block }: { block: DocsBlock }) {
  if (block.type === "code") {
    return <CodeExamplePanel example={block.example} />;
  }
  return <MarkdownBlock block={block} />;
}

function Page({ page }: { page: DocsPage }) {
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
        {page.blocks.map((block, index) => (
          <BlockRenderer key={index} block={block} />
        ))}
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
