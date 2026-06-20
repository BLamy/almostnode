import { Link, Route, Routes } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/80">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-semibold tracking-tight">
            React Router + shadcn
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link to="/about" className="text-muted-foreground hover:text-foreground">
              About
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
        </Routes>
      </main>
    </div>
  );
}

function HomePage() {
  return (
    <section className="grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-center">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          shadcn template
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          React Router running inside almostnode.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          This starter uses client-side routes, shadcn-style components, Tailwind
          tokens, and the browser-backed virtual filesystem.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button>Project ready</Button>
          <Button variant="outline" asChild>
            <Link to="/about">View route</Link>
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium">Runtime checks</p>
        <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
          <li>Vite dev server on the virtual port bridge</li>
          <li>React Router SPA fallback enabled by dependency detection</li>
          <li>shadcn component aliases through <code>@/</code></li>
        </ul>
      </div>
    </section>
  );
}

function AboutPage() {
  return (
    <section className="max-w-2xl">
      <h2 className="text-3xl font-semibold tracking-tight">About this route</h2>
      <p className="mt-4 text-muted-foreground">
        Add pages in <code>src/App.tsx</code> or split routes into separate files.
        The almostnode Vite adapter handles browser refreshes for nested paths.
      </p>
    </section>
  );
}
