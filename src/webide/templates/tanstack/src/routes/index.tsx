import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Welcome to TanStack Router
      </h1>
      <p style={{ color: '#6b7280', fontSize: '1.1rem', marginBottom: '1.5rem' }}>
        File-based routing with type-safe navigation, running in the browser via almostnode.
      </p>
      <div style={{
        padding: '1.25rem',
        background: '#f0f9ff',
        borderRadius: '0.5rem',
        border: '1px solid #bae6fd',
      }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#0c4a6e' }}>
          How it works
        </h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#0369a1', lineHeight: 1.8 }}>
          <li>Routes are defined in <code>src/routes/</code> as file-based routes</li>
          <li><code>routeTree.gen.ts</code> is auto-generated from the file structure</li>
          <li>Add a new file in <code>src/routes/</code> and the route tree updates automatically</li>
          <li>SPA fallback ensures client-side navigation works on all paths</li>
        </ul>
      </div>
    </div>
  );
}
