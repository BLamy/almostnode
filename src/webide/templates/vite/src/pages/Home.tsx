import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const PILLARS = [
  {
    title: 'Tailwind ready',
    detail: 'Utility classes are live immediately through the preview. No bootstrap command is required to start styling.',
  },
  {
    title: 'shadcn aliases',
    detail: 'The workspace already has components.json, @/ imports, CSS variables, and a local Button primitive wired up.',
  },
  {
    title: 'Terminal first',
    detail: 'Keep the preview open while you add packages or components from the same project root in the terminal panel.',
  },
];

const NOTES = [
  {
    title: 'Next useful command',
    body: 'Run npx shadcn@latest add dropdown-menu after you want a real shadcn component. The project is already configured for it.',
  },
  {
    title: 'Tailwind config',
    body: 'Edit tailwind.config.ts to extend colors, spacing, and radii. The Vite preview injects that config automatically.',
  },
  {
    title: 'Theme toggle',
    body: 'This starter uses the standard .dark class so shadcn-style color variables and utility classes stay aligned.',
  },
];

function Home() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors">Home</Link>
        <Link to="/about" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">About</Link>
      </nav>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_22rem]">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-background/82 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl sm:p-8">
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.22),transparent_62%)]" />
            <div className="relative flex flex-col gap-6">
              <div className="space-y-4">
                <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-secondary/70 px-3 py-1 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Tailwind + shadcn starter
                </span>
                <div className="space-y-4">
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                    Style the Web IDE app immediately instead of bootstrapping Tailwind by hand.
                  </h1>
                  <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                    The preview is already configured for Tailwind utility classes, CSS variables, and shadcn-style aliases.
                    Use this screen as a real starter instead of a plain CSS placeholder.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.hash = '#starter-notes';
                  }}
                >
                  Open starter notes
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PILLARS.map((pillar) => (
                  <article
                    key={pillar.title}
                    className="rounded-3xl border border-border/60 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                  >
                    <p className="text-sm font-semibold tracking-tight">{pillar.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{pillar.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border/60 bg-card/82 p-5 shadow-[0_28px_90px_-45px_rgba(15,23,42,0.7)] backdrop-blur-xl">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Start here</p>
                <code className="mt-3 block rounded-2xl border border-border/70 bg-secondary/70 px-4 py-3 font-mono text-sm text-foreground">
                  npm run dev
                </code>
              </div>

              <div className="rounded-3xl border border-border/60 bg-background/70 p-4">
                <p className="text-sm font-semibold tracking-tight">Suggested next command</p>
                <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
                  npx shadcn@latest add dropdown-menu
                </p>
              </div>

              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>The app already includes components.json, tailwind.config.ts, and a working @/ import map.</p>
                <p>Edit <span className="font-mono text-foreground">src/App.tsx</span> or drop new files into <span className="font-mono text-foreground">src/components</span>.</p>
              </div>

              <div className="rounded-3xl border border-border/60 bg-secondary/55 p-4">
                <p className="text-sm font-semibold tracking-tight">Aliases</p>
                <ul className="mt-3 space-y-2 font-mono text-xs text-muted-foreground">
                  <li>@/components</li>
                  <li>@/components/ui</li>
                  <li>@/lib/utils</li>
                </ul>
              </div>
            </div>
          </aside>
        </section>

        <section id="starter-notes" className="grid gap-4 md:grid-cols-3">
          {NOTES.map((note) => (
            <article
              key={note.title}
              className="rounded-[1.75rem] border border-border/60 bg-card/75 p-5 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.65)] backdrop-blur-xl"
            >
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Starter note</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">{note.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{note.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[2rem] border border-border/60 bg-background/80 p-5 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.72)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Preview stack</p>
              <h2 className="text-2xl font-semibold tracking-tight">A Vite-flavored workspace with Tailwind semantics built in.</h2>
            </div>
            <div className="rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              Edit <span className="font-mono text-foreground">tailwind.config.ts</span> to extend the design tokens.
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">What changed from the old seed</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Tailwind utility classes work without a manual init step.</li>
                <li>shadcn aliases and CSS variables are already in place.</li>
                <li>The starter now looks like a real app instead of a plain CSS scaffold.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">Useful files</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-mono text-foreground">src/App.tsx</span> for the landing surface.</li>
                <li><span className="font-mono text-foreground">src/components/ui/button.tsx</span> for a local shadcn-style primitive.</li>
                <li><span className="font-mono text-foreground">src/lib/utils.ts</span> for the shared cn helper.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Home;
