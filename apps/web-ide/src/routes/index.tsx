import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { startTransition, useEffect, type ReactNode } from 'react';
import {
  preloadWorkbenchScreen,
  scheduleWorkbenchScreenPreload,
} from '../desktop/workbench-screen-lazy';
import type { TemplateId } from '../features/workspace-seed';

type IndexSearch = {
  template?: string;
  name?: string;
  debug?: string;
  marketplace?: string;
  corsProxy?: string;
};

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    name: typeof search.name === 'string' ? search.name : undefined,
    debug: typeof search.debug === 'string' ? search.debug : undefined,
    marketplace: typeof search.marketplace === 'string' ? search.marketplace : undefined,
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
    description: 'Fast browser workspace for UI agents, component loops, and Playwright-backed iteration.',
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
    description: 'App Router starter for AI harnesses that need routes, layouts, and live preview feedback.',
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
    description: 'Type-safe SPA starter for harness-driven editing, routing, and fast verification cycles.',
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
  {
    id: 'app-building',
    title: 'App Building',
    description: 'Control-plane starter for spawning and orchestrating remote Fly.io app-building workers from one main chat.',
    tags: ['Fly.io', 'Infisical', 'Control Plane'],
    logo: (
      <svg className="hp-template__logo" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
        <rect width="160" height="160" rx="38" fill="#10273A" />
        <path d="M38 102 80 36l42 66H96l-16 24-16-24H38Z" fill="#FF7C3A" />
        <path d="M62 102h36" stroke="#FFF3E8" strokeWidth="10" strokeLinecap="round" />
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
    title: 'Browser-Native Harness Runtime',
    description: 'Run AI coding harnesses like OpenCode against a real terminal, real files, and browser-safe Node shims in one tab.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Real Workspace Semantics',
    description: 'Agents can read, write, watch, and diff a POSIX-like workspace instead of pretending a prompt is a filesystem.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    title: 'npm And CLI Tooling',
    description: 'Install packages and use commands like git, rg, curl, and npm inside the same browser harness.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: 'Harness-Driven Verification',
    description: 'Launch Playwright from the workspace, inspect failures, and let the harness close the loop without leaving the IDE.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    title: 'GitHub In The Loop',
    description: 'Clone repos, branch, commit, and push from the same harness that is editing and validating your code.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    title: 'Replayable Debug Sessions',
    description: 'Record browser runs and inspect the exact state an agent or user saw when a workflow goes sideways.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: 'Live Previews With HMR',
    description: 'Boot Next.js or Vite, keep HMR alive, and let the harness verify the real UI instead of reasoning from source alone.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: 'No Backend Control Plane',
    description: 'The workspace, preview, and AI harness all run in the browser. No VM fleet, remote runner, or per-project server.',
  },
];

const DEMO_LINES = [
  { prompt: true, text: 'opencode "Ship a settings screen and verify it with Playwright"' },
  { prompt: false, text: 'Launching browser harness in /workspace...' },
  { prompt: false, text: '' },
  { prompt: true, text: 'npm install' },
  { prompt: false, text: 'added 238 packages in 3.2s' },
  { prompt: false, text: '' },
  { prompt: true, text: 'npm run dev' },
  { prompt: false, text: '' },
  { prompt: false, text: '  VITE v5.4.2  ready in 140 ms' },
  { prompt: false, text: '' },
  { prompt: false, text: '  \u27A4  Local:   http://localhost:5173/' },
  { prompt: false, text: '' },
  { prompt: true, text: 'playwright-cli test e2e/settings.spec.ts' },
  { prompt: false, text: '\u2713  1 passed (1.2s)' },
];

const TAILSCALE_FACTS = [
  {
    title: 'Browser-to-tailnet routing',
    description: 'Use Tailscale Connect in-browser so OpenCode, curl, and your app traffic can reach private tailnet services directly.',
  },
  {
    title: 'AI keys stay in your vault',
    description: 'Store credentials in a passkey-backed keychain instead of leaving raw secrets in the workspace or prompt history.',
  },
  {
    title: 'Passkey-native access',
    description: 'Bring the same secure unlock flow to the devices and browsers where your passkey is available, without changing how the harness works.',
  },
];

const REPLAY_FACTS = [
  {
    title: 'Deterministic recordings',
    description: 'Every Playwright run is recorded. Replay the exact browser state, clicks, and network requests without re-running the test.',
  },
  {
    title: 'Shared debugging',
    description: 'Drop a recording URL in a PR comment or Slack thread. Everyone sees the same session, same state, same bug.',
  },
  {
    title: 'AI-native failure analysis',
    description: 'When a Playwright assertion fails, the harness attaches the Replay recording so the agent can inspect what actually happened.',
  },
];

const GITHUB_FACTS = [
  {
    title: 'Clone any repo',
    description: 'Pull public or private repositories into the browser workspace with full git history and branch tracking.',
  },
  {
    title: 'Commit from the harness',
    description: 'The AI agent stages changes, writes commit messages, and pushes directly to GitHub without leaving the IDE.',
  },
  {
    title: 'PR-ready workflows',
    description: 'Open pull requests from the browser with diffs the agent generated and Playwright verified. Review-ready on push.',
  },
];

const AWS_FACTS = [
  {
    title: 'Direct service access',
    description: 'Route harness traffic to S3, Lambda, DynamoDB, and other AWS services from the browser workspace.',
  },
  {
    title: 'Deploy from the IDE',
    description: 'Push static builds to S3, trigger Lambda deployments, or invalidate CloudFront caches without leaving the browser.',
  },
  {
    title: 'Credentials in the vault',
    description: 'AWS credentials live in the passkey-backed keychain, never exposed to the AI model or persisted in workspace files.',
  },
];

function TailscaleSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="hp-tailnet" id="tailscale">
      <div className="hp-tailnet__layout">
        <div className="hp-tailnet__copy">
          <div className="hp-tailnet__eyebrow">Tailscale support</div>
          <h2 className="hp-section-title hp-tailnet__title">
            Bring your browser harness onto the tailnet.
          </h2>
          <p className="hp-section-subtitle hp-tailnet__subtitle">
            replayio-agents can log into Tailscale from the browser, route harness traffic to
            private services, and keep AI credentials inside a passkey-backed keychain.
            The result is a browser-native workflow that still feels private and portable.
          </p>
          <div className="hp-tailnet__facts">
            {TAILSCALE_FACTS.map((fact) => (
              <div key={fact.title} className="hp-tailnet__fact">
                <div className="hp-tailnet__fact-title">{fact.title}</div>
                <p className="hp-tailnet__fact-copy">{fact.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hp-tailnet__visual" aria-hidden="true">
          <div className="hp-tailnet__frame">
            <svg
              className="hp-tailnet__graphic"
              viewBox="0 0 540 360"
              role="presentation"
            >
              <defs>
                <linearGradient id="hpTailnetBeam" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(91,240,191,0.08)" />
                  <stop offset="50%" stopColor="rgba(91,240,191,0.95)" />
                  <stop offset="100%" stopColor="rgba(255,195,82,0.12)" />
                </linearGradient>
                <linearGradient id="hpTailnetRail" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(91,240,191,0.15)" />
                  <stop offset="50%" stopColor="rgba(91,240,191,0.92)" />
                  <stop offset="100%" stopColor="rgba(255,122,89,0.1)" />
                </linearGradient>
                <radialGradient id="hpTailnetCore" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#152a3d" />
                  <stop offset="65%" stopColor="#0f1b27" />
                  <stop offset="100%" stopColor="#09121a" />
                </radialGradient>
                <linearGradient id="hpTailnetCard" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.11)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                </linearGradient>
              </defs>

              <rect x="14" y="14" width="512" height="332" rx="28" className="hp-tailnet__bg" />
              <circle cx="270" cy="162" r="120" className="hp-tailnet__ambient" />

              <path
                d="M164 128C196 128 204 137 220 148"
                className="hp-tailnet__beam"
              />
              <path
                d="M320 148C346 132 352 118 366 102"
                className="hp-tailnet__beam"
              />
              <path
                d="M438 144V304"
                className="hp-tailnet__rail"
              />

              <motion.circle
                cx="270"
                cy="162"
                r="92"
                className="hp-tailnet__pulse"
                animate={reduceMotion ? undefined : { scale: [0.98, 1.04, 0.98], opacity: [0.24, 0.48, 0.24] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '270px 162px' }}
              />

              <motion.g
                animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <rect x="32" y="84" width="132" height="92" rx="24" className="hp-tailnet__panel" />
                <rect x="48" y="102" width="44" height="28" rx="10" className="hp-tailnet__screen" />
                <circle cx="64" cy="116" r="4" className="hp-tailnet__accent-dot" />
                <path d="M54 142h66" className="hp-tailnet__panel-line" />
                <path d="M54 154h48" className="hp-tailnet__panel-line hp-tailnet__panel-line--muted" />
                <text x="48" y="78" className="hp-tailnet__label hp-tailnet__label--meta">Browser</text>
                <text x="48" y="194" className="hp-tailnet__label">AI harness</text>
                <text x="48" y="214" className="hp-tailnet__label hp-tailnet__label--muted">OpenCode + CLI</text>
              </motion.g>

              <motion.g
                animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
                transition={{ duration: 6.2, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
              >
                <rect x="366" y="56" width="142" height="88" rx="24" className="hp-tailnet__panel" />
                <path d="M396 92a14 14 0 0 1 28 0v12h-28Z" className="hp-tailnet__lock" />
                <rect x="392" y="104" width="36" height="28" rx="10" className="hp-tailnet__lock-body" />
                <circle cx="410" cy="118" r="4" className="hp-tailnet__accent-dot" />
                <text x="384" y="48" className="hp-tailnet__label hp-tailnet__label--meta">Secure storage</text>
                <text x="386" y="170" className="hp-tailnet__label">AI key vault</text>
                <text x="386" y="190" className="hp-tailnet__label hp-tailnet__label--muted">Passkey-backed</text>
              </motion.g>

              <motion.g
                animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '270px 162px' }}
              >
                <circle cx="270" cy="162" r="56" className="hp-tailnet__core-ring" />
                <circle cx="270" cy="162" r="48" fill="url(#hpTailnetCore)" />
                <text x="270" y="156" textAnchor="middle" className="hp-tailnet__core-text">Tailnet</text>
                <text x="270" y="176" textAnchor="middle" className="hp-tailnet__core-subtext">Browser VPN</text>
              </motion.g>

              {[
                { y: 172, title: 'Phone', detail: 'passkey ready', delay: 0.2 },
                { y: 224, title: 'Laptop', detail: 'same unlock', delay: 0.45 },
                { y: 276, title: 'Tablet', detail: 'portable setup', delay: 0.7 },
              ].map((device) => (
                <motion.g
                  key={device.title}
                  animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
                  transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: device.delay }}
                >
                  <rect x="374" y={device.y} width="134" height="36" rx="18" className="hp-tailnet__device" />
                  <circle cx="392" cy={device.y + 18} r="5" className="hp-tailnet__device-dot" />
                  <text x="408" y={device.y + 16} className="hp-tailnet__label">{device.title}</text>
                  <text x="408" y={device.y + 31} className="hp-tailnet__label hp-tailnet__label--muted">{device.detail}</text>
                </motion.g>
              ))}

              <motion.circle
                cx="164"
                cy="128"
                r="6"
                className="hp-tailnet__packet"
                animate={reduceMotion ? { cx: 192, cy: 138, opacity: 1 } : { cx: [164, 194, 220], cy: [128, 132, 148], opacity: [0, 1, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />
              <motion.circle
                cx="320"
                cy="148"
                r="6"
                className="hp-tailnet__packet hp-tailnet__packet--warm"
                animate={reduceMotion ? { cx: 344, cy: 126, opacity: 1 } : { cx: [320, 342, 366], cy: [148, 126, 102], opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', delay: 0.4 }}
              />
              <motion.circle
                cx="438"
                cy="154"
                r="6"
                className="hp-tailnet__packet"
                animate={reduceMotion ? { cy: 220, opacity: 1 } : { cy: [154, 220, 304], opacity: [0, 1, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'linear', delay: 0.8 }}
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReplaySection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="hp-replay" id="replay">
      <div className="hp-replay__layout">
        <div className="hp-replay__copy">
          <div className="hp-replay__eyebrow">Replay.io integration</div>
          <h2 className="hp-section-title hp-replay__title">
            Time-travel debug every browser session.
          </h2>
          <p className="hp-section-subtitle hp-replay__subtitle">
            replayio-agents records Playwright runs with Replay.io so every failure comes with
            a full time-travel recording. Inspect the exact DOM, network state, and React
            components the agent saw — no guesswork, no screenshots.
          </p>
          <div className="hp-replay__facts">
            {REPLAY_FACTS.map((fact) => (
              <div key={fact.title} className="hp-replay__fact">
                <div className="hp-replay__fact-title">{fact.title}</div>
                <p className="hp-replay__fact-copy">{fact.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hp-replay__visual" aria-hidden="true">
          <div className="hp-replay__frame">
            <svg
              className="hp-replay__graphic"
              viewBox="0 0 540 360"
              role="presentation"
            >
              <defs>
                <linearGradient id="hpReplayBeam" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(79,140,255,0.08)" />
                  <stop offset="50%" stopColor="rgba(79,140,255,0.95)" />
                  <stop offset="100%" stopColor="rgba(168,85,247,0.12)" />
                </linearGradient>
                <radialGradient id="hpReplayCore" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#1a2540" />
                  <stop offset="65%" stopColor="#111b2e" />
                  <stop offset="100%" stopColor="#0a1220" />
                </radialGradient>
              </defs>

              <rect x="14" y="14" width="512" height="332" rx="28" className="hp-replay__bg" />
              <circle cx="270" cy="162" r="120" className="hp-replay__ambient" />

              {/* Timeline bar */}
              <rect x="60" y="280" width="420" height="4" rx="2" className="hp-replay__timeline" />
              {[100, 180, 240, 320, 400].map((x, i) => (
                <motion.circle
                  key={x}
                  cx={x}
                  cy={282}
                  r="6"
                  className="hp-replay__event-dot"
                  animate={reduceMotion ? undefined : { scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
                  style={{ transformOrigin: `${x}px 282px` }}
                />
              ))}

              {/* Playhead */}
              <motion.g
                animate={reduceMotion ? { x: 200 } : { x: [0, 340, 0] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              >
                <rect x="60" y="270" width="2" height="24" rx="1" className="hp-replay__playhead" />
              </motion.g>

              {/* Browser panel */}
              <motion.g
                animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <rect x="32" y="60" width="200" height="140" rx="20" className="hp-replay__panel" />
                <rect x="48" y="82" width="168" height="80" rx="10" className="hp-replay__screen" />
                <circle cx="64" cy="100" r="4" className="hp-replay__accent-dot" />
                <rect x="80" y="94" width="60" height="6" rx="3" className="hp-replay__screen-line" />
                <rect x="80" y="106" width="40" height="6" rx="3" className="hp-replay__screen-line hp-replay__screen-line--muted" />
                <rect x="80" y="118" width="80" height="6" rx="3" className="hp-replay__screen-line" />
                <rect x="80" y="130" width="50" height="6" rx="3" className="hp-replay__screen-line hp-replay__screen-line--muted" />
                <text x="48" y="54" className="hp-replay__label hp-replay__label--meta">Browser session</text>
                <text x="48" y="220" className="hp-replay__label">Playwright run</text>
                <text x="48" y="240" className="hp-replay__label hp-replay__label--muted">Recorded by Replay</text>
              </motion.g>

              {/* Connection beam */}
              <path d="M232 130C264 130 276 140 308 150" className="hp-replay__beam" />

              {/* Recording core */}
              <motion.g
                animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '370px 130px' }}
              >
                <circle cx="370" cy="130" r="56" className="hp-replay__core-ring" />
                <circle cx="370" cy="130" r="48" fill="url(#hpReplayCore)" />
                <text x="370" y="124" textAnchor="middle" className="hp-replay__core-text">Replay</text>
                <text x="370" y="144" textAnchor="middle" className="hp-replay__core-subtext">Time-travel</text>
              </motion.g>

              <motion.circle
                cx="370"
                cy="130"
                r="64"
                className="hp-replay__pulse"
                animate={reduceMotion ? undefined : { scale: [0.98, 1.06, 0.98], opacity: [0.2, 0.45, 0.2] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '370px 130px' }}
              />

              {/* Recording indicator */}
              <motion.circle
                cx="370"
                cy="60"
                r="8"
                className="hp-replay__rec-dot"
                animate={reduceMotion ? undefined : { opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
              <text x="386" y="64" className="hp-replay__label" style={{ fontSize: '12px' }}>REC</text>

              {/* Inspect panels */}
              {[
                { y: 170, title: 'DOM', detail: 'element state', delay: 0.2 },
                { y: 210, title: 'Network', detail: 'request log', delay: 0.45 },
                { y: 250, title: 'React', detail: 'component tree', delay: 0.7 },
              ].map((item) => (
                <motion.g
                  key={item.title}
                  animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
                  transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: item.delay }}
                >
                  <rect x="310" y={item.y} width="134" height="32" rx="16" className="hp-replay__device" />
                  <circle cx="328" cy={item.y + 16} r="5" className="hp-replay__device-dot" />
                  <text x="342" y={item.y + 13} className="hp-replay__label">{item.title}</text>
                  <text x="342" y={item.y + 27} className="hp-replay__label hp-replay__label--muted">{item.detail}</text>
                </motion.g>
              ))}

              {/* Animated packet */}
              <motion.circle
                cx="232"
                cy="130"
                r="6"
                className="hp-replay__packet"
                animate={reduceMotion ? { cx: 270, cy: 140, opacity: 1 } : { cx: [232, 270, 308], cy: [130, 135, 150], opacity: [0, 1, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function GitHubSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="hp-github" id="github">
      <div className="hp-github__layout">
        <div className="hp-github__copy">
          <div className="hp-github__eyebrow">GitHub integration</div>
          <h2 className="hp-section-title hp-github__title">
            Ship from the browser, straight to GitHub.
          </h2>
          <p className="hp-section-subtitle hp-github__subtitle">
            replayio-agents runs git natively in the browser. Clone repos, create branches,
            commit changes, and open pull requests — all from the same workspace where the
            AI harness edits and verifies your code.
          </p>
          <div className="hp-github__facts">
            {GITHUB_FACTS.map((fact) => (
              <div key={fact.title} className="hp-github__fact">
                <div className="hp-github__fact-title">{fact.title}</div>
                <p className="hp-github__fact-copy">{fact.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hp-github__visual" aria-hidden="true">
          <div className="hp-github__frame">
            <svg
              className="hp-github__graphic"
              viewBox="0 0 540 360"
              role="presentation"
            >
              <defs>
                <radialGradient id="hpGithubCore" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#1f1535" />
                  <stop offset="65%" stopColor="#151020" />
                  <stop offset="100%" stopColor="#0d0a16" />
                </radialGradient>
              </defs>

              <rect x="14" y="14" width="512" height="332" rx="28" className="hp-github__bg" />
              <circle cx="270" cy="162" r="120" className="hp-github__ambient" />

              {/* Branch lines */}
              <path d="M100 180V60" className="hp-github__branch" />
              <path d="M100 140C100 120 140 120 160 100V60" className="hp-github__branch hp-github__branch--feature" />
              <path d="M160 80C160 100 140 120 100 120" className="hp-github__merge-line" />

              {/* Commit dots on main */}
              {[180, 140, 100, 60].map((y, i) => (
                <motion.circle
                  key={`main-${y}`}
                  cx={100}
                  cy={y}
                  r="7"
                  className="hp-github__commit"
                  animate={reduceMotion ? undefined : { scale: [1, 1.15, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
                  style={{ transformOrigin: `100px ${y}px` }}
                />
              ))}

              {/* Commit dots on feature branch */}
              {[100, 70].map((y, i) => (
                <motion.circle
                  key={`feat-${y}`}
                  cx={160}
                  cy={y}
                  r="7"
                  className="hp-github__commit hp-github__commit--feature"
                  animate={reduceMotion ? undefined : { scale: [1, 1.15, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.6 + i * 0.4 }}
                  style={{ transformOrigin: `160px ${y}px` }}
                />
              ))}

              {/* Workspace panel */}
              <motion.g
                animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <rect x="32" y="210" width="180" height="110" rx="20" className="hp-github__panel" />
                <text x="48" y="202" className="hp-github__label hp-github__label--meta">Workspace</text>
                <path d="M54 240h40" className="hp-github__panel-line" />
                <path d="M54 256h60" className="hp-github__panel-line" />
                <path d="M54 272h32" className="hp-github__panel-line hp-github__panel-line--muted" />
                <path d="M54 288h52" className="hp-github__panel-line" />
                <circle cx="60" cy="240" r="4" className="hp-github__accent-dot" />
              </motion.g>

              {/* Connection beam */}
              <path d="M212 260C260 260 280 200 310 180" className="hp-github__beam" />

              {/* GitHub core */}
              <motion.g
                animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '380px 160px' }}
              >
                <circle cx="380" cy="160" r="56" className="hp-github__core-ring" />
                <circle cx="380" cy="160" r="48" fill="url(#hpGithubCore)" />
                {/* GitHub mark */}
                <path
                  d="M380 136c-13.25 0-24 10.75-24 24 0 10.6 6.88 19.6 16.42 22.78 1.2.22 1.64-.52 1.64-1.16 0-.57-.02-2.08-.03-4.08-6.68 1.45-8.09-3.22-8.09-3.22-1.09-2.77-2.66-3.51-2.66-3.51-2.18-1.49.17-1.46.17-1.46 2.41.17 3.67 2.47 3.67 2.47 2.14 3.67 5.62 2.61 6.98 2 .22-1.55.84-2.61 1.52-3.21-5.33-.61-10.93-2.67-10.93-11.87 0-2.62.94-4.76 2.47-6.44-.25-.61-1.07-3.05.23-6.36 0 0 2.01-.64 6.59 2.46a22.94 22.94 0 0 1 12.07 0c4.58-3.1 6.59-2.46 6.59-2.46 1.3 3.31.48 5.75.24 6.36 1.54 1.68 2.47 3.82 2.47 6.44 0 9.22-5.61 11.25-10.96 11.84.86.74 1.63 2.21 1.63 4.45 0 3.21-.03 5.8-.03 6.59 0 .64.43 1.39 1.65 1.16C397.13 179.58 404 170.59 404 160c0-13.25-10.75-24-24-24z"
                  className="hp-github__octocat"
                />
              </motion.g>

              <motion.circle
                cx="380"
                cy="160"
                r="64"
                className="hp-github__pulse"
                animate={reduceMotion ? undefined : { scale: [0.98, 1.06, 0.98], opacity: [0.2, 0.45, 0.2] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '380px 160px' }}
              />

              {/* Action items */}
              {[
                { y: 80, title: 'Push', detail: 'main → origin', delay: 0.2 },
                { y: 120, title: 'PR #42', detail: 'ready for review', delay: 0.45 },
                { y: 240, title: 'Clone', detail: 'full history', delay: 0.7 },
              ].map((item) => (
                <motion.g
                  key={item.title}
                  animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
                  transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: item.delay }}
                >
                  <rect x="330" y={item.y} width="134" height="32" rx="16" className="hp-github__device" />
                  <circle cx="348" cy={item.y + 16} r="5" className="hp-github__device-dot" />
                  <text x="362" y={item.y + 13} className="hp-github__label">{item.title}</text>
                  <text x="362" y={item.y + 27} className="hp-github__label hp-github__label--muted">{item.detail}</text>
                </motion.g>
              ))}

              {/* Animated packet */}
              <motion.circle
                cx="212"
                cy="260"
                r="6"
                className="hp-github__packet"
                animate={reduceMotion ? { cx: 260, cy: 230, opacity: 1 } : { cx: [212, 260, 310], cy: [260, 230, 180], opacity: [0, 1, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function AWSSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="hp-aws" id="aws">
      <div className="hp-aws__layout">
        <div className="hp-aws__copy">
          <div className="hp-aws__eyebrow">AWS integration</div>
          <h2 className="hp-section-title hp-aws__title">
            Connect your browser harness to AWS.
          </h2>
          <p className="hp-section-subtitle hp-aws__subtitle">
            replayio-agents can route traffic to AWS services through Tailscale or direct HTTPS.
            Access S3 buckets, invoke Lambda functions, and hit API Gateway endpoints from
            the browser workspace without spinning up a backend.
          </p>
          <div className="hp-aws__facts">
            {AWS_FACTS.map((fact) => (
              <div key={fact.title} className="hp-aws__fact">
                <div className="hp-aws__fact-title">{fact.title}</div>
                <p className="hp-aws__fact-copy">{fact.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hp-aws__visual" aria-hidden="true">
          <div className="hp-aws__frame">
            <svg
              className="hp-aws__graphic"
              viewBox="0 0 540 360"
              role="presentation"
            >
              <defs>
                <radialGradient id="hpAwsCore" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#2a1f10" />
                  <stop offset="65%" stopColor="#1a1408" />
                  <stop offset="100%" stopColor="#120e06" />
                </radialGradient>
              </defs>

              <rect x="14" y="14" width="512" height="332" rx="28" className="hp-aws__bg" />
              <circle cx="270" cy="162" r="120" className="hp-aws__ambient" />

              {/* Browser harness panel */}
              <motion.g
                animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <rect x="32" y="84" width="160" height="120" rx="20" className="hp-aws__panel" />
                <rect x="48" y="102" width="128" height="64" rx="10" className="hp-aws__screen" />
                <circle cx="64" cy="118" r="4" className="hp-aws__accent-dot" />
                <path d="M80 112h60" className="hp-aws__panel-line" />
                <path d="M80 126h40" className="hp-aws__panel-line hp-aws__panel-line--muted" />
                <path d="M80 140h72" className="hp-aws__panel-line" />
                <text x="48" y="78" className="hp-aws__label hp-aws__label--meta">Browser</text>
                <text x="48" y="224" className="hp-aws__label">Harness</text>
                <text x="48" y="244" className="hp-aws__label hp-aws__label--muted">HTTPS traffic</text>
              </motion.g>

              {/* Connection beams */}
              <path d="M192 140C224 140 240 148 270 148" className="hp-aws__beam" />
              <path d="M320 148C340 148 360 130 380 110" className="hp-aws__beam" />
              <path d="M320 148C340 148 360 170 380 190" className="hp-aws__beam" />
              <path d="M320 148C340 148 360 220 380 260" className="hp-aws__beam" />

              {/* AWS Cloud core */}
              <motion.g
                animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '270px 148px' }}
              >
                <circle cx="270" cy="148" r="56" className="hp-aws__core-ring" />
                <circle cx="270" cy="148" r="48" fill="url(#hpAwsCore)" />
                {/* Cloud icon */}
                <path
                  d="M290 154h-40a12 12 0 0 1-1.6-23.9A16 16 0 0 1 278 126a10 10 0 0 1 12 8h0a10 10 0 0 1 0 20z"
                  className="hp-aws__cloud-icon"
                />
                <text x="270" y="170" textAnchor="middle" className="hp-aws__core-subtext">AWS Cloud</text>
              </motion.g>

              <motion.circle
                cx="270"
                cy="148"
                r="64"
                className="hp-aws__pulse"
                animate={reduceMotion ? undefined : { scale: [0.98, 1.06, 0.98], opacity: [0.2, 0.45, 0.2] }}
                transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{ transformOrigin: '270px 148px' }}
              />

              {/* Service panels */}
              {[
                { y: 80, title: 'S3', detail: 'static assets', delay: 0.15 },
                { y: 160, title: 'Lambda', detail: 'functions', delay: 0.4 },
                { y: 240, title: 'API GW', detail: 'endpoints', delay: 0.65 },
              ].map((svc) => (
                <motion.g
                  key={svc.title}
                  animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
                  transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: svc.delay }}
                >
                  <rect x="366" y={svc.y} width="134" height="48" rx="18" className="hp-aws__device" />
                  <circle cx="386" cy={svc.y + 24} r="5" className="hp-aws__device-dot" />
                  <text x="400" y={svc.y + 20} className="hp-aws__label">{svc.title}</text>
                  <text x="400" y={svc.y + 36} className="hp-aws__label hp-aws__label--muted">{svc.detail}</text>
                </motion.g>
              ))}

              {/* Animated packets */}
              <motion.circle
                cx="192"
                cy="140"
                r="6"
                className="hp-aws__packet"
                animate={reduceMotion ? { cx: 230, cy: 144, opacity: 1 } : { cx: [192, 230, 270], cy: [140, 144, 148], opacity: [0, 1, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />
              <motion.circle
                cx="320"
                cy="148"
                r="6"
                className="hp-aws__packet hp-aws__packet--warm"
                animate={reduceMotion ? { cx: 350, cy: 130, opacity: 1 } : { cx: [320, 350, 380], cy: [148, 130, 110], opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', delay: 0.4 }}
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function Homepage() {
  const navigate = useNavigate();
  const {
    template,
    name,
    debug,
    marketplace,
    corsProxy,
  } = Route.useSearch();

  const templateFromQuery = TEMPLATES.find((c) => c.id === template)?.id;

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
            <span className="hp-nav__wordmark">replayio-agents</span>
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
        <div className="hp-hero__badge">browser-native AI harnesses</div>
        <h1 className="hp-hero__title">
          Run AI harnesses in your browser.
          <br />
          <span className="hp-hero__title-accent">OpenCode, npm, git, and previews included.</span>
        </h1>
        <p className="hp-hero__subtitle">
          replayio-agents is a browser-native workspace for in-browser AI coding harnesses.
          Run OpenCode against a real filesystem, npm, git, dev servers, and Playwright
          without provisioning a backend runner.
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
            Launch replayio-agents
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
          <code className="hp-hero__install">OpenCode + git + Playwright, all in-browser</code>
        </div>
      </section>

      {/* ── Terminal Demo ── */}
      <section className="hp-demo">
        <div className="hp-demo__window">
          <div className="hp-demo__titlebar">
            <span className="hp-demo__dot hp-demo__dot--red" />
            <span className="hp-demo__dot hp-demo__dot--yellow" />
            <span className="hp-demo__dot hp-demo__dot--green" />
            <span className="hp-demo__titlebar-text">replayio-agents</span>
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

      <ReplaySection />
      <TailscaleSection />
      <GitHubSection />
      <AWSSection />

      {/* ── Features ── */}
      <section className="hp-features" id="features">
        <h2 className="hp-section-title">Everything you need to code in the browser</h2>
        <p className="hp-section-subtitle">
          Build an agent loop on top of a real browser runtime. Fix the platform, not the prompt.
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

      {/* ── Get Started (Templates) ── */}
      <section className="hp-start" id="start">
        <h2 className="hp-section-title">Get started</h2>
        <p className="hp-section-subtitle">Pick a workspace and drop straight into the browser harness.</p>
        <div className="hp-start__cards">
          {TEMPLATES.map((tmpl) => (
            <div
              key={tmpl.id}
              className="hp-template"
              onClick={() => openIde(tmpl.id)}
              onMouseEnter={() => {
                void preloadWorkbenchScreen();
              }}
              onFocus={() => {
                void preloadWorkbenchScreen();
              }}
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
          <span className="hp-footer__brand">replayio-agents</span>
          <span className="hp-footer__copy">MIT License</span>
        </div>
      </footer>
    </div>
  );
}
