import { createFileRoute } from '@tanstack/react-router';
import { WorkbenchScreen } from '../desktop/workbench-screen';
import { TEMPLATE_IDS, type TemplateId } from '../features/workspace-seed';
type IDESearch = {
  template?: string;
  name?: string;
  project?: string;
  debug?: string;
  marketplace?: string;
  corsProxy?: string;
};

export const Route = createFileRoute('/ide')({
  validateSearch: (search: Record<string, unknown>): IDESearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    name: typeof search.name === 'string' ? search.name : undefined,
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
    && TEMPLATE_IDS.includes(template as TemplateId)
      ? template
      : 'vite'
  ) as TemplateId;

  return <WorkbenchScreen template={templateId} debug={debug} marketplace={marketplace} corsProxy={corsProxy} />;
}
