import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { startTransition, useEffect, type CSSProperties } from 'react';
import {
  preloadWorkbenchScreen,
  scheduleWorkbenchScreenPreload,
} from '../desktop/workbench-screen-lazy';
import { TEMPLATE_IDS, type TemplateId } from '../features/workspace-seed';
import almostnodeLogoUrl from '../../readme-assets/logos/app-building.svg?url';
import codexLogoUrl from '../../readme-assets/logos/codex-openai.svg?url';
import opencodeLogoUrl from '../../readme-assets/logos/opencode.svg?url';
import pgliteLogoUrl from '../../readme-assets/logos/pglite.svg?url';
import replayLogoUrl from '../../readme-assets/logos/replay.svg?url';
import tailscaleLogoUrl from '../../readme-assets/logos/tailscale.svg?url';
import { LearnPage } from '../learn/LearnPage';
import '../learn/learn.css';

type IndexSearch = {
  template?: string;
  name?: string;
  debug?: string;
  marketplace?: string;
  corsProxy?: string;
  goto?: 'ide' | 'app-builder';
};

type StackStyle = CSSProperties & {
  '--stack-accent': string;
  '--stack-soft': string;
};

type StackSection = {
  id: string;
  name: string;
  navLabel: string;
  logo: string;
  accent: string;
  soft: string;
  eyebrow: string;
  title: string;
  summary: string;
  integrationSummary: string;
  capabilities: string[];
  commands: string[];
  layers: string[];
};

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    name: typeof search.name === 'string' ? search.name : undefined,
    debug: typeof search.debug === 'string' ? search.debug : undefined,
    marketplace: typeof search.marketplace === 'string' ? search.marketplace : undefined,
    corsProxy: typeof search.corsProxy === 'string' ? search.corsProxy : undefined,
    goto: search.goto === 'ide' || search.goto === 'app-builder' ? search.goto : undefined,
  }),
  component: Homepage,
});

const HOMEPAGE_TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_IDS;

const LOGOS = {
  almostnode: almostnodeLogoUrl,
  tailscale: tailscaleLogoUrl,
  opencode: opencodeLogoUrl,
  codex: codexLogoUrl,
  pglite: pgliteLogoUrl,
  replay: replayLogoUrl,
} as const;

const STACK_SECTIONS: StackSection[] = [
  {
    id: 'almostnode',
    name: 'almostnode',
    navLabel: 'almostnode',
    logo: LOGOS.almostnode,
    accent: '#e53e68',
    soft: 'rgba(229, 62, 104, 0.1)',
    eyebrow: 'Browser Node runtime',
    title: 'almostnode is the runtime layer under the IDE.',
    summary:
      'The package stays internal, but it is the engine: virtual filesystems, package installation, framework dev servers, service-worker previews, and browser-safe Node shims.',
    integrationSummary:
      'Browser-native Node compatibility for workspace files, npm packages, command shims, and live preview servers.',
    capabilities: [
      'POSIX-like workspace files and persistence',
      'npm installs and package metadata in the browser',
      'service-worker-backed dev servers and preview routing',
    ],
    commands: ['npm install', 'npm run dev', 'rg "TODO"'],
    layers: ['VFS', 'npm', 'dev server'],
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    navLabel: 'tailscale',
    logo: LOGOS.tailscale,
    accent: '#4b8df8',
    soft: 'rgba(75, 141, 248, 0.1)',
    eyebrow: 'Private network access',
    title: 'Tailscale brings browser agents onto the tailnet.',
    summary:
      'Agents can reach private services from the same browser workspace, while credentials stay scoped to the browser keychain and command traffic follows the same routing path.',
    integrationSummary:
      'Private tailnet access for internal APIs, databases, dashboards, and services without leaving the browser workspace.',
    capabilities: [
      'tailnet auth from the web IDE',
      'private APIs, databases, and preview endpoints',
      'the same route for terminal commands and app traffic',
    ],
    commands: ['tailscale status', 'curl http://service.tailnet', 'pg "<sql>"'],
    layers: ['auth', 'routing', 'private services'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    navLabel: 'opencode',
    logo: LOGOS.opencode,
    accent: '#f28a2e',
    soft: 'rgba(242, 138, 46, 0.12)',
    eyebrow: 'Agent terminal',
    title: 'OpenCode runs against a real workspace, not a prompt-shaped file tree.',
    summary:
      'The IDE launches OpenCode sessions with real files, terminal routing, command shims, package installs, browser previews, and verification loops available in one tab.',
    integrationSummary:
      'OpenCode agent sessions wired directly into the IDE terminal, filesystem, package manager, and preview feedback loop.',
    capabilities: [
      'agent sessions wired to terminal and filesystem state',
      'command execution through almostnode shims',
      'preview and Playwright feedback without leaving the IDE',
    ],
    commands: ['opencode', 'npm test', 'playwright-cli test'],
    layers: ['agent', 'terminal', 'feedback'],
  },
  {
    id: 'codex',
    name: 'Codex',
    navLabel: 'codex',
    logo: LOGOS.codex,
    accent: '#10a37f',
    soft: 'rgba(16, 163, 127, 0.12)',
    eyebrow: 'WASM agent runtime',
    title: 'Codex can live beside OpenCode as another browser-hosted agent.',
    summary:
      'The web IDE keeps the path open for vendored Codex CLI and TUI pieces to run through the browser host bridge, sharing the same files, auth surface, and command model.',
    integrationSummary:
      'Codex CLI and app-server WASM integration through the same workspace, auth, terminal, and host-bridge surface.',
    capabilities: [
      'host-bridge oriented CLI execution',
      'shared workspace, keychain, and terminal plumbing',
      'room for the upstream TUI path instead of a parallel adapter',
    ],
    commands: ['codex', 'git diff', 'npm run build'],
    layers: ['CLI', 'TUI bridge', 'workspace'],
  },
  {
    id: 'pglite',
    name: 'PGlite',
    navLabel: 'pglite',
    logo: LOGOS.pglite,
    accent: '#6b58ff',
    soft: 'rgba(107, 88, 255, 0.1)',
    eyebrow: 'Browser Postgres',
    title: 'PGlite gives every workspace a local Postgres layer.',
    summary:
      'Projects can run SQL, Drizzle workflows, migrations, and data-backed previews inside the browser so database state is available to both the app and the agent.',
    integrationSummary:
      'Local Postgres-compatible databases for SQL, Drizzle migrations, seeded app state, and browser-only data workflows.',
    capabilities: [
      'Postgres-compatible local project databases',
      'Drizzle generation, migration, and inspection loops',
      'SQL verification through the same command surface',
    ],
    commands: ['pglite start', 'drizzle-kit migrate', 'pg "select 1"'],
    layers: ['Postgres', 'Drizzle', 'SQL'],
  },
  {
    id: 'replay',
    name: 'Replay.io',
    navLabel: 'replay.io',
    logo: LOGOS.replay,
    accent: '#d444f2',
    soft: 'rgba(212, 68, 242, 0.1)',
    eyebrow: 'Time-travel debugging',
    title: 'Replay.io turns browser runs into inspectable traces.',
    summary:
      'When an agent or user hits a failure, the workspace can capture the browser session and preserve the DOM, console, network, and timing context that led to it.',
    integrationSummary:
      'Replayable browser and Playwright sessions with DOM, console, network, and timing context attached to failures.',
    capabilities: [
      'recorded Playwright and browser sessions',
      'debugging context beyond screenshots and logs',
      'shareable evidence for hard-to-reproduce agent failures',
    ],
    commands: ['replayio record', 'playwright-cli test', 'replayio upload'],
    layers: ['record', 'inspect', 'share'],
  },
];

function stackStyle(section: StackSection): StackStyle {
  return {
    '--stack-accent': section.accent,
    '--stack-soft': section.soft,
  };
}

function Homepage() {
  const navigate = useNavigate();
  const {
    template,
    name,
    debug,
    marketplace,
    corsProxy,
    goto,
  } = Route.useSearch();

  const templateFromQuery = HOMEPAGE_TEMPLATE_IDS.find((id) => id === template);

  useEffect(() => {
    if (!templateFromQuery) return;
    void preloadWorkbenchScreen();
    void navigate({
      to: '/ide',
      replace: true,
      search: {
        template: templateFromQuery,
        ...(name !== undefined ? { name } : {}),
        ...(debug !== undefined ? { debug } : {}),
        ...(marketplace !== undefined ? { marketplace } : {}),
        ...(corsProxy !== undefined ? { corsProxy } : {}),
      },
    });
  }, [templateFromQuery, name, debug, marketplace, corsProxy, navigate]);

  useEffect(() => {
    if (!goto) return;
    if (goto === 'ide') {
      void preloadWorkbenchScreen();
      void navigate({
        to: '/ide',
        replace: true,
        search: {
          ...(name !== undefined ? { name } : {}),
          ...(debug !== undefined ? { debug } : {}),
          ...(marketplace !== undefined ? { marketplace } : {}),
          ...(corsProxy !== undefined ? { corsProxy } : {}),
        },
      });
      return;
    }
    void navigate({ to: '/app-builder', replace: true });
  }, [goto, name, debug, marketplace, corsProxy, navigate]);

  useEffect(() => {
    return scheduleWorkbenchScreenPreload();
  }, []);

  const openIde = (templateId?: TemplateId) => {
    void preloadWorkbenchScreen();
    startTransition(() => {
      void navigate({
        to: '/ide',
        search: {
          ...(templateId !== undefined ? { template: templateId } : {}),
          ...(debug !== undefined ? { debug } : {}),
          ...(marketplace !== undefined ? { marketplace } : {}),
          ...(corsProxy !== undefined ? { corsProxy } : {}),
        },
      });
    });
  };

  if (templateFromQuery || goto) return null;

  return (
    <div className="hp">
      <nav className="hp-nav">
        <div className="hp-nav__inner">
          <Link className="hp-nav__brand" to="/">
            <span className="hp-nav__mark" aria-hidden="true">
              <img src={LOGOS.almostnode} alt="" />
            </span>
            <span className="hp-nav__wordmark">agent-wasm</span>
          </Link>
          <div className="hp-nav__section-links" aria-label="Technology sections">
            {STACK_SECTIONS.map((section) => (
              <a key={section.id} className="hp-nav__link hp-nav__link--text" href={`#${section.id}`}>
                {section.navLabel}
              </a>
            ))}
          </div>
          <div className="hp-nav__actions">
            <a className="hp-nav__link hp-nav__link--text" href="#learn">
              Learn
            </a>
            <Link className="hp-nav__link hp-nav__link--text" to="/app-builder">
              App Builder
            </Link>
            <button
              className="hp-nav__launch"
              onClick={() => openIde()}
              onMouseEnter={() => {
                void preloadWorkbenchScreen();
              }}
              onFocus={() => {
                void preloadWorkbenchScreen();
              }}
            >
              Launch IDE
            </button>
          </div>
        </div>
      </nav>

      <main>
        <section className="hp-hero" aria-labelledby="homepage-title">
          <div className="hp-hero__marks" aria-hidden="true">
            <span className="hp-hero__mark hp-hero__mark--ring hp-hero__mark--one" />
            <span className="hp-hero__mark hp-hero__mark--cross hp-hero__mark--two" />
            <span className="hp-hero__mark hp-hero__mark--dot hp-hero__mark--three" />
            <span className="hp-hero__mark hp-hero__mark--orbit hp-hero__mark--four" />
            <span className="hp-hero__mark hp-hero__mark--ring hp-hero__mark--five" />
            <span className="hp-hero__mark hp-hero__mark--cross hp-hero__mark--six" />
          </div>
          <p className="hp-hero__eyebrow">browser-native agent runtime</p>
          <h1 id="homepage-title" className="hp-hero__title">agent-wasm</h1>
          <p className="hp-hero__statement">
            Run AI agents in the browser without compromising the runtime.
          </p>
          <p className="hp-hero__subtitle">
            A web IDE stack for real files, real commands, private network access,
            local data, and replayable debugging. Built from almostnode, Tailscale,
            OpenCode, Codex, PGlite, and Replay.io.
          </p>
          <div className="hp-hero__actions">
            <button
              className="hp-hero__cta"
              onClick={() => openIde()}
              onMouseEnter={() => {
                void preloadWorkbenchScreen();
              }}
              onFocus={() => {
                void preloadWorkbenchScreen();
              }}
            >
              Launch agent-wasm
            </button>
            <a className="hp-hero__link" href="#stack">
              Explore the stack
            </a>
          </div>
        </section>

        <section className="hp-tech" aria-labelledby="tech-title">
          <div className="hp-tech__inner">
            <h2 id="tech-title" className="hp-section-title">
              Technology used by the browser agent stack
            </h2>
            <div className="hp-tech__logos">
              {STACK_SECTIONS.map((section) => (
                <a key={section.id} className="hp-tech__logo" href={`#${section.id}`}>
                  <img src={section.logo} alt="" />
                  <span>{section.name}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="hp-capabilities" aria-labelledby="capabilities-title">
          <div className="hp-capabilities__inner">
            <h2 id="capabilities-title" className="hp-section-title">
              Integrations supported by the web IDE
            </h2>
            <p className="hp-section-subtitle">
              Connect the browser workspace to the tools agents already need: private
              networks, agent CLIs, local databases, replayable browser sessions, and the
              almostnode runtime that ties them together.
            </p>
            <div className="hp-capabilities__grid">
              {STACK_SECTIONS.map((section) => (
                <article key={section.id} className="hp-capability" style={stackStyle(section)}>
                  <img className="hp-capability__logo" src={section.logo} alt="" />
                  <h3>{section.name}</h3>
                  <p>{section.integrationSummary}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="hp-learn" id="learn" aria-labelledby="learn-title">
          <div className="hp-learn__inner">
            <h2 id="learn-title" className="hp-section-title">
              Learn how it works
            </h2>
            <p className="hp-section-subtitle">
              Animated, narrated walkthroughs — the runtime, the keychain, the coding
              agents, the preview tooling, Tailscale, and the app-builder. Press play on
              a chapter to start; full screen lives at <Link to="/learn">/learn</Link>.
            </p>
            <div className="hp-learn__player">
              <LearnPage embedded />
            </div>
          </div>
        </section>

        <section className="hp-stack" id="stack" aria-labelledby="stack-title">
          <div className="hp-stack__layout">
            <aside className="hp-stack__index" aria-label="Stack navigation">
              <p className="hp-stack__index-title">The stack</p>
              <nav>
                {STACK_SECTIONS.map((section, index) => (
                  <a
                    key={section.id}
                    className={`hp-stack__index-link${index === 0 ? ' is-active' : ''}`}
                    href={`#${section.id}`}
                  >
                    {section.navLabel}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="hp-stack__content">
              <header className="hp-stack__header">
                <p className="hp-stack__eyebrow">Runtime modules</p>
                <h2 id="stack-title">What ships to the web IDE</h2>
                <p>
                  Tokio presents a stack as composable Rust crates. This homepage uses the same
                  pattern for agent-wasm: each layer contributes one concrete runtime job to the
                  browser IDE.
                </p>
              </header>

              {STACK_SECTIONS.map((section, index) => (
                <article
                  key={section.id}
                  id={section.id}
                  className="hp-stack-module"
                  style={stackStyle(section)}
                >
                  <div className="hp-stack-module__copy">
                    <p className="hp-stack-module__eyebrow">{section.eyebrow}</p>
                    <h3>{section.title}</h3>
                    <p>{section.summary}</p>
                    <ul>
                      {section.capabilities.map((capability) => (
                        <li key={capability}>{capability}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="hp-stack-module__visual" aria-label={`${section.name} runtime diagram`}>
                    <div className="hp-stack-module__visual-head">
                      <img src={section.logo} alt="" />
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <div className="hp-stack-module__layers">
                      {section.layers.map((layer) => (
                        <div key={layer} className="hp-stack-module__layer">
                          {layer}
                        </div>
                      ))}
                    </div>
                    <div className="hp-stack-module__commands">
                      {section.commands.map((command) => (
                        <code key={command}>{command}</code>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="hp-footer">
        <div className="hp-footer__inner">
          <span className="hp-footer__brand">agent-wasm</span>
          <Link to="/app-builder" className="hp-footer__link">
            Open App Builder
          </Link>
          <span className="hp-footer__copy">MIT License</span>
        </div>
      </footer>
    </div>
  );
}
