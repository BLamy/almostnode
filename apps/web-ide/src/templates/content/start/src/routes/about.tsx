import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

function AboutPage() {
  return (
    <section className="max-w-2xl">
      <h2 className="text-3xl font-semibold tracking-tight">About this starter</h2>
      <p className="mt-4 text-muted-foreground">
        The internal dev server generates <code>routeTree.gen.ts</code> from the
        route files before the preview starts.
      </p>
    </section>
  );
}
