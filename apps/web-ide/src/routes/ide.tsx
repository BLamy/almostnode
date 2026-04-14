import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { LazyWorkbenchScreen } from '../desktop/workbench-screen-lazy';
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

  return (
    <Suspense fallback={<IDEWorkspaceFallback />}>
      <LazyWorkbenchScreen
        template={templateId}
        debug={debug}
        marketplace={marketplace}
        corsProxy={corsProxy}
      />
    </Suspense>
  );
}

function IDEWorkspaceFallback() {
  return (
    <div className="webide-shell ide-route-loading-shell" aria-label="Loading replayio-agents IDE">
      <header className="webide-header" />
      <main className="webide-body">
        <aside className="ide-route-loading__sidebar" aria-hidden="true">
          <div className="ide-route-loading__sidebar-header">
            <span className="ide-route-loading__sidebar-title">Projects</span>
            <div className="ide-route-loading__sidebar-actions">
              <span className="ide-route-loading__sidebar-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="ide-route-loading__sidebar-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
            </div>
          </div>
          <div className="ide-route-loading__sidebar-body">
            <div className="ide-route-loading__sidebar-card ide-route-loading__skeleton-block" />
            <div className="ide-route-loading__sidebar-card ide-route-loading__skeleton-block" />
            <div className="ide-route-loading__sidebar-card ide-route-loading__skeleton-block ide-route-loading__sidebar-card--wide" />
            <div className="ide-route-loading__sidebar-empty">
              <div className="ide-route-loading__sidebar-empty-title ide-route-loading__skeleton-block" />
              <div className="ide-route-loading__sidebar-empty-copy ide-route-loading__skeleton-block" />
              <div className="ide-route-loading__sidebar-empty-copy ide-route-loading__skeleton-block ide-route-loading__sidebar-empty-copy--short" />
            </div>
          </div>
        </aside>

        <div className="webide-workbench-shell ide-route-loading__workspace">
          <div className="ide-route-loading__workbench" />
          <div className="ide-route-loading__center" aria-hidden="true">
            <div className="ide-route-loading__center-icon ide-route-loading__skeleton-block" />
            <div className="ide-route-loading__center-line ide-route-loading__skeleton-block ide-route-loading__center-line--eyebrow" />
            <div className="ide-route-loading__center-line ide-route-loading__skeleton-block ide-route-loading__center-line--title" />
            <div className="ide-route-loading__center-line ide-route-loading__skeleton-block ide-route-loading__center-line--copy" />
            <div className="ide-route-loading__center-line ide-route-loading__skeleton-block ide-route-loading__center-line--copy-short" />
            <div className="ide-route-loading__center-cta ide-route-loading__skeleton-block" />
          </div>
          <div className="ide-route-loading__live-region" role="status" aria-live="polite">
            Loading replayio-agents IDE
          </div>
        </div>
      </main>
    </div>
  );
}
