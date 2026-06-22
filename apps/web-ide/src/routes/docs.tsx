import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  DocsView,
  resolveDocsPath,
  DEFAULT_DOCS_PATH,
} from '../features/docs/docs-view';

type DocsSearch = {
  page?: string;
};

export const Route = createFileRoute('/docs')({
  validateSearch: (search: Record<string, unknown>): DocsSearch => ({
    page: typeof search.page === 'string' ? search.page : undefined,
  }),
  component: DocsRoute,
});

function DocsRoute() {
  const { page } = Route.useSearch();
  const navigate = useNavigate();
  const currentPath = resolveDocsPath(page ?? DEFAULT_DOCS_PATH);
  return (
    <DocsView
      currentPath={currentPath}
      onNavigate={(path) =>
        navigate({ to: '/docs', search: path === DEFAULT_DOCS_PATH ? {} : { page: path } })
      }
      hrefForPath={(path) =>
        path === DEFAULT_DOCS_PATH
          ? `${import.meta.env.BASE_URL}docs`
          : `${import.meta.env.BASE_URL}docs?page=${encodeURIComponent(path)}`
      }
    />
  );
}
