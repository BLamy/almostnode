import { Link } from 'react-router-dom';

function About() {
  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Home</Link>
        <Link to="/about" className="text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors">About</Link>
        <Link to="/todos" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Todos</Link>
      </nav>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-border/60 bg-background/82 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl sm:p-8">
          <div className="space-y-6">
            <div className="space-y-4">
              <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-secondary/70 px-3 py-1 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
                About this starter
              </span>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Built with React Router
              </h1>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                This starter uses React Router for client-side navigation. Routes are defined in
                <span className="font-mono text-foreground"> src/App.tsx</span> and each page lives in
                <span className="font-mono text-foreground"> src/pages/</span>.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-3xl border border-border/60 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                <p className="text-sm font-semibold tracking-tight">SPA routing</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Client-side navigation between pages with no full-page reloads. The dev server has SPA fallback enabled so direct URL access works too.
                </p>
              </article>
              <article className="rounded-3xl border border-border/60 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                <p className="text-sm font-semibold tracking-tight">Add more routes</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Create a new file in <span className="font-mono text-foreground">src/pages/</span>, import it in
                  <span className="font-mono text-foreground"> App.tsx</span>, and add a Route element.
                </p>
              </article>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default About;
