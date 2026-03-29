import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchScreen } from '../desktop/workbench-screen';
import type { TemplateId } from '../features/workspace-seed';

const VALID_TEMPLATES: TemplateId[] = ['vite', 'nextjs', 'tanstack'];
type IDESearch = {
  template?: string;
  project?: string;
  debug?: string;
  marketplace?: string;
  corsProxy?: string;
};

export const Route = createFileRoute('/ide')({
  validateSearch: (search: Record<string, unknown>): IDESearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    project: typeof search.project === 'string' ? search.project : undefined,
    debug: typeof search.debug === 'string' ? search.debug : undefined,
    marketplace: typeof search.marketplace === 'string' ? search.marketplace : undefined,
    corsProxy: typeof search.corsProxy === 'string' ? search.corsProxy : undefined,
  }),
  component: IDEWorkspace,
});

function IDEWorkspace() {
  const {
    template,
    project,
    debug,
    marketplace,
    corsProxy,
  } = Route.useSearch();
  const templateId = (
    !project
    && template
    && VALID_TEMPLATES.includes(template as TemplateId)
      ? template
      : 'vite'
  ) as TemplateId;

  return <WorkbenchScreen template={templateId} debug={debug} marketplace={marketplace} corsProxy={corsProxy} />;
}
