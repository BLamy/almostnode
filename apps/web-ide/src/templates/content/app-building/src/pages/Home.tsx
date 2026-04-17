import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    title: 'shadcn dropdown-menu',
    body: 'A real @radix-ui/react-dropdown-menu component is already installed. Check src/components/ui/dropdown-menu.tsx for the source.',
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
  const navigate = useNavigate();

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
        <Link to="/todos" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Todos</Link>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Navigation</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => navigate('/')}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                  Home
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/about')}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  About
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/todos')}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
                  Todos
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTheme('light')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                Light mode
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme('dark')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                Dark mode
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
                <p className="text-sm font-semibold tracking-tight">Included components</p>
                <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
                  button, dropdown-menu
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
                <li><span className="font-mono text-foreground">src/components/ui/button.tsx</span> for the Button primitive.</li>
                <li><span className="font-mono text-foreground">src/components/ui/dropdown-menu.tsx</span> for the DropdownMenu component.</li>
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
