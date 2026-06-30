import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';

function Success() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session_id') || 'checkout-session';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-4 py-3">
          <Link to="/" className="text-sm font-semibold text-foreground hover:text-foreground/80">Store</Link>
          <Link to="/todos" className="text-sm font-semibold text-muted-foreground hover:text-foreground">Todos</Link>
          <Link to="/about" className="text-sm font-semibold text-muted-foreground hover:text-foreground">About</Link>
        </nav>

        <section className="flex flex-1 items-center">
          <div className="w-full rounded-lg border border-border bg-card p-6 shadow-[0_28px_90px_-54px_rgba(15,23,42,0.72)] sm:p-8">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Payment complete
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Stripe emulator checkout succeeded.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              The hosted checkout page redirected back into this app with session <span className="font-mono text-foreground">{sessionId}</span>.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/')}>
                Back to store
              </Button>
              <Button variant="outline" onClick={() => navigate('/todos')}>
                Open todos
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Success;
