import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <section>
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        shadcn template
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        TanStack Start template, running on almostnode.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        This starter keeps the shadcn `start` surface available while using the
        browser-compatible TanStack Router preview path.
      </p>
      <div className="mt-8">
        <Button>Project ready</Button>
      </div>
    </section>
  );
}
