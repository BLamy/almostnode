import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import type { TemplateId } from '../features/workspace-seed';
import { NewProjectDialog } from '../sidebar/new-project-dialog';

type IndexSearch = {
  template?: string;
  name?: string;
  corsProxy?: string;
};

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    name: typeof search.name === 'string' ? search.name : undefined,
    corsProxy: typeof search.corsProxy === 'string' ? search.corsProxy : undefined,
  }),
  component: Homepage,
});

const TEMPLATES: Array<{
  id: TemplateId;
  title: string;
  description: string;
  tags: string[];
  logo: ReactNode;
}> = [
  {
    id: 'vite',
    title: 'Vite + React',
    description: 'Fast dev server with HMR, Tailwind CSS, and shadcn-ready aliases.',
    tags: ['React 18', 'Vite 5', 'Tailwind'],
    logo: (
      <svg className="hp-template__logo" viewBox="0 0 256 257" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="viteA" x1="-.83%" y1="7.65%" x2="57.64%" y2="78.39%">
            <stop offset="0%" stopColor="#41D1FF" />
            <stop offset="100%" stopColor="#BD34FE" />
          </linearGradient>
          <linearGradient id="viteB" x1="43.38%" y1="2.24%" x2="50.32%" y2="60.15%">
            <stop offset="0%" stopColor="#FFBD4F" />
            <stop offset="100%" stopColor="#FF9640" />
          </linearGradient>
        </defs>
        <path d="M255.15 37.95 134.24 228.69c-2.13 3.36-7.01 3.49-9.32.25L1.58 38.17c-2.52-3.53.88-8.03 4.97-6.57l121.35 43.05a5.34 5.34 0 0 0 3.56-.01L251.94 31.3c4.06-1.5 7.52 2.92 5.02 6.46l-1.81.19Z" fill="url(#viteA)" />
        <path d="M185.58.64 96.35 17.53a2.67 2.67 0 0 0-2.14 2.24l-15.47 83.58a2.67 2.67 0 0 0 3.18 3.07l26.82-5.57c1.73-.36 3.27 1.14 2.96 2.89l-4.66 26.25a2.67 2.67 0 0 0 3.28 3.04l16.55-3.93c1.73-.41 3.29 1.1 2.97 2.86l-7.41 40.62c-.5 2.74 3.16 4.21 4.72 1.9l1.04-1.54 57.48-112.68c.9-1.77-.7-3.76-2.62-3.24l-27.94 7.54a2.67 2.67 0 0 1-3.18-3.34l18.27-62.23A2.67 2.67 0 0 0 167 .87L185.58.64Z" fill="url(#viteB)" />
      </svg>
    ),
  },
  {
    id: 'nextjs',
    title: 'Next.js',
    description: 'App Router with file-based routing, layouts, and Tailwind CSS.',
    tags: ['Next 14', 'App Router', 'Tailwind'],
    logo: (
      <svg className="hp-template__logo" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
        <mask id="nextMask" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180">
          <circle cx="90" cy="90" r="90" fill="black" />
        </mask>
        <g mask="url(#nextMask)">
          <circle cx="90" cy="90" r="90" fill="black" />
          <path d="M149.51 157.47L71.2 52H56v76.01h12.17V67.63l72.32 97.73A90.42 90.42 0 0 0 149.51 157.47Z" fill="url(#nextGradA)" />
          <rect x="113" y="52" width="12" height="76" fill="url(#nextGradB)" />
        </g>
        <defs>
          <linearGradient id="nextGradA" x1="109" y1="116.5" x2="144.5" y2="160.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="nextGradB" x1="121" y1="52" x2="120.8" y2="116.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    ),
  },
  {
    id: 'tanstack',
    title: 'TanStack Router',
    description: 'Type-safe file-based routing with SPA navigation on Vite.',
    tags: ['React 18', 'TanStack Router', 'Vite'],
    logo: (
      <svg className="hp-template__logo" viewBox="0 0 633 633" xmlns="http://www.w3.org/2000/svg">
        <path d="M316.5 0C142 0 0 142 0 316.5S142 633 316.5 633 633 491 633 316.5 491 0 316.5 0z" fill="#002B41" />
        <path d="M316.5 84c-58 0-105.5 90.4-105.5 200.5 0 8.8.3 17.4.9 25.8C152 327 117 358.5 117 395.5c0 58 90.4 105 200.5 105 8.2 0 16.2-.2 24.1-.7 16.5 56.6 47.7 90.7 82.9 90.7 58 0 105-90.4 105-200.5 0-7-.2-13.9-.5-20.7C584.5 352.3 617 321 617 285c0-58-90.4-105-200.5-105-9.5 0-18.8.3-27.9.8C372.3 126.5 341.8 84 316.5 84z" fill="#FFD94C" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" fill="#002B41" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" transform="rotate(60 316.5 316.5)" fill="#002B41" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" transform="rotate(-60 316.5 316.5)" fill="#002B41" />
        <circle cx="316.5" cy="316.5" r="45" fill="#FFD94C" />
      </svg>
    ),
  },
];

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    title: 'Native ESM Runtime',
    description: 'Full ESM module resolution with 43 built-in Node shims running natively in the browser. No bundler step required.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Virtual Filesystem',
    description: 'In-memory fs with full POSIX semantics. Read, write, watch, and stream — just like real Node.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    title: 'npm Package Manager',
    description: 'Install real npm packages. Dependencies are downloaded, extracted, and bundled for browser execution via esbuild.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: 'Playwright Testing',
    description: 'Run Playwright tests directly in the browser sandbox. Write, execute, and debug end-to-end tests without leaving the IDE.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    title: 'GitHub Integration',
    description: 'Clone repos, create branches, and push commits — all from the browser. Full git workflow without a local machine.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    title: 'Replay.io Integration',
    description: 'Record and replay browser sessions with time-travel debugging. Inspect any point in your app\'s execution after the fact.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: 'Dev Servers with HMR',
    description: 'Next.js and Vite dev servers with hot module replacement, intercepted via service worker. No backend required.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: 'Zero Backend',
    description: 'Everything runs in the browser. No Docker, no VM, no server. Just open a URL and start building.',
  },
];

const DEMO_LINES = [
  { prompt: true, text: 'npm create vite@latest my-app -- --template react' },
  { prompt: false, text: 'Scaffolding project in /my-app...' },
  { prompt: false, text: '' },
  { prompt: true, text: 'cd my-app && npm install' },
  { prompt: false, text: 'added 238 packages in 3.2s' },
  { prompt: false, text: '' },
  { prompt: true, text: 'npm run dev' },
  { prompt: false, text: '' },
  { prompt: false, text: '  VITE v5.4.2  ready in 140 ms' },
  { prompt: false, text: '' },
  { prompt: false, text: '  \u27A4  Local:   http://localhost:5173/' },
  { prompt: false, text: '  \u27A4  press h + enter to show help' },
];

function Homepage() {
  const navigate = useNavigate();
  const { template, name, corsProxy } = Route.useSearch();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>('vite');

  const templateFromQuery = TEMPLATES.find((c) => c.id === template)?.id;

  useEffect(() => {
    if (!templateFromQuery) return;
    void navigate({
      to: '/ide',
      replace: true,
      search: {
        template: templateFromQuery,
        ...(name !== undefined ? { name } : {}),
        ...(corsProxy !== undefined ? { corsProxy } : {}),
      },
    });
  }, [templateFromQuery, name, corsProxy, navigate]);

  const openNewProjectDialog = (templateId: TemplateId) => {
    setSelectedTemplateId(templateId);
    setNewProjectOpen(true);
  };

  const handleCreateProject = async (
    projectName: string,
    templateId: TemplateId,
  ) => {
    void navigate({
      to: '/ide',
      search: {
        template: templateId,
        name: projectName,
        ...(corsProxy !== undefined ? { corsProxy } : {}),
      },
    });
  };

  if (templateFromQuery) return null;

  return (
    <div className="hp">
      {/* ── Nav ── */}
      <nav className="hp-nav">
        <div className="hp-nav__inner">
          <Link className="hp-nav__brand" to="/">
            <span className="hp-nav__mark">
              <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="8" width="48" height="48" rx="14" fill="url(#navGrad)" />
                <path d="M32 17l12 30h-7l-2.1-5.7H29.2L27 47h-7l12-30zm0 10.1l-3.3 9.2h6.5z" fill="#071018" />
                <defs>
                  <linearGradient id="navGrad" x1="14" y1="12" x2="50" y2="52" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#ffc352" />
                    <stop offset="1" stopColor="#ff7a59" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <span className="hp-nav__wordmark">opensandbox</span>
          </Link>
          <div className="hp-nav__links">
            <a className="hp-nav__link" href="https://github.com/aspect-build/opensandbox" target="_blank" rel="noopener noreferrer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hp-hero">
        <div className="hp-hero__badge">open source</div>
        <h1 className="hp-hero__title">
          Open code in your browser.
          <br />
          <span className="hp-hero__title-accent">No server required.</span>
        </h1>
        <p className="hp-hero__subtitle">
          opensandbox is a browser-native coding environment — virtual filesystem,
          real npm packages, dev servers, and a full terminal. An open-source
          alternative to WebContainers.
        </p>
        <div className="hp-hero__actions">
          <button className="hp-hero__cta" onClick={() => openNewProjectDialog('vite')}>
            Open the IDE
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
          <code className="hp-hero__install">npm i opensandbox</code>
        </div>
      </section>

      {/* ── Terminal Demo ── */}
      <section className="hp-demo">
        <div className="hp-demo__window">
          <div className="hp-demo__titlebar">
            <span className="hp-demo__dot hp-demo__dot--red" />
            <span className="hp-demo__dot hp-demo__dot--yellow" />
            <span className="hp-demo__dot hp-demo__dot--green" />
            <span className="hp-demo__titlebar-text">opensandbox</span>
          </div>
          <div className="hp-demo__body">
            {DEMO_LINES.map((line, i) => (
              <div key={i} className="hp-demo__line">
                {line.prompt && <span className="hp-demo__prompt">$</span>}
                <span className={line.prompt ? 'hp-demo__cmd' : 'hp-demo__output'}>
                  {line.text}
                </span>
              </div>
            ))}
            <div className="hp-demo__line">
              <span className="hp-demo__prompt">$</span>
              <span className="hp-demo__cursor" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="hp-features" id="features">
        <h2 className="hp-section-title">Everything you need to code in the browser</h2>
        <p className="hp-section-subtitle">
          No shims per package. No CDN shortcuts. Real runtime compatibility — fix the platform, not the library.
        </p>
        <div className="hp-features__grid">
          {FEATURES.map((feat) => (
            <div key={feat.title} className="hp-feature">
              <div className="hp-feature__icon">{feat.icon}</div>
              <h3 className="hp-feature__title">{feat.title}</h3>
              <p className="hp-feature__desc">{feat.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Comparison ── */}
      <section className="hp-compare">
        <h2 className="hp-section-title">How it compares</h2>
        <div className="hp-compare__table-wrap">
          <table className="hp-compare__table">
            <thead>
              <tr>
                <th />
                <th className="hp-compare__highlight">opensandbox</th>
                <th>WebContainers</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['License', 'MIT', 'Proprietary'],
                ['npm install', 'Yes', 'Yes'],
                ['Next.js dev server', 'Yes', 'Yes'],
                ['Vite HMR', 'Yes', 'Yes'],
                ['Self-hostable', 'Yes', 'No'],
                ['Embeddable SDK', 'Yes', 'Yes'],
                ['Bash emulator', 'Yes', 'Yes (jsh)'],
                ['No backend needed', 'Yes', 'Yes'],
              ].map(([feature, ours, theirs]) => (
                <tr key={feature}>
                  <td className="hp-compare__feature">{feature}</td>
                  <td className="hp-compare__highlight">{ours}</td>
                  <td>{theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Get Started (Templates) ── */}
      <section className="hp-start" id="start">
        <h2 className="hp-section-title">Get started</h2>
        <p className="hp-section-subtitle">Pick a template and launch the IDE in seconds.</p>
        <div className="hp-start__cards">
          {TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.id}
              className="hp-template"
              onClick={() => openNewProjectDialog(tmpl.id)}
            >
              {tmpl.logo}
              <h3 className="hp-template__title">{tmpl.title}</h3>
              <p className="hp-template__desc">{tmpl.description}</p>
              <div className="hp-template__tags">
                {tmpl.tags.map((tag) => (
                  <span key={tag} className="hp-template__tag">{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="hp-footer">
        <div className="hp-footer__inner">
          <span className="hp-footer__brand">opensandbox</span>
          <span className="hp-footer__copy">MIT License</span>
        </div>
      </footer>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        hasGitHubCredentials={false}
        initialTemplateId={selectedTemplateId}
        title="Create a new project"
        description="Pick a starter, add a repo name if you want one, or let opensandbox generate a container-style name for you."
        submitLabel="Open project"
        onCreate={handleCreateProject}
      />
    </div>
  );
}
