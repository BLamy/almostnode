import { Outlet, Link, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div style={{ minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <nav style={{
        display: 'flex',
        gap: '1rem',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid #e5e7eb',
        background: '#fff',
      }}>
        <Link
          to="/"
          style={{ textDecoration: 'none', color: '#111', fontWeight: 600 }}
          activeProps={{ style: { color: '#2563eb' } }}
        >
          Home
        </Link>
        <Link
          to="/about"
          style={{ textDecoration: 'none', color: '#111', fontWeight: 600 }}
          activeProps={{ style: { color: '#2563eb' } }}
        >
          About
        </Link>
      </nav>
      <main style={{ padding: '1.5rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
