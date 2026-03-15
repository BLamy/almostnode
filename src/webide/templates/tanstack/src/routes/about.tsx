import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

function AboutPage() {
  return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        About
      </h1>
      <p style={{ color: '#6b7280', fontSize: '1.1rem', lineHeight: 1.7 }}>
        This is a TanStack Router project running entirely in the browser
        using almostnode. The virtual filesystem, npm package manager, and
        Vite dev server all run client-side — no backend needed.
      </p>
      <p style={{ color: '#6b7280', fontSize: '1.1rem', lineHeight: 1.7 }}>
        Try adding a new route file (e.g. <code>src/routes/contact.tsx</code>)
        and watch the route tree regenerate automatically!
      </p>
    </div>
  );
}
