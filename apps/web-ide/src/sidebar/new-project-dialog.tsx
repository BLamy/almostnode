import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../ui/cn';
import type { GitHubRepositorySummary } from '../features/github-repositories';
import { resolveProjectName } from '../features/project-names';
import type { TemplateId } from '../features/workspace-seed';

type ProjectLaunchTab = 'sandbox' | 'repository';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasGitHubCredentials: boolean;
  initialTemplateId?: TemplateId;
  initialTab?: ProjectLaunchTab;
  title?: string;
  description?: string;
  submitLabel?: string;
  onCreate: (
    name: string,
    templateId: TemplateId,
    options: { createGitHubRepo: boolean },
  ) => Promise<void> | void;
  onLogin?: () => Promise<void> | void;
  onLoadRepositories?: () => Promise<GitHubRepositorySummary[]>;
  onImport?: (repository: GitHubRepositorySummary) => Promise<void> | void;
}

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'vite', label: 'Vite + React', description: 'React SPA with hot reload.' },
  { id: 'nextjs', label: 'Next.js', description: 'App and pages router ready to ship.' },
  { id: 'tanstack', label: 'TanStack Start', description: 'Full-stack React with server helpers.' },
  { id: 'app-building', label: 'App Building', description: 'Control plane for remote Fly.io app-building workers.' },
];

export function NewProjectDialog({
  open,
  onOpenChange,
  hasGitHubCredentials,
  initialTemplateId = 'vite',
  initialTab = 'sandbox',
  title = 'Start a project',
  description = 'Create a clean sandbox or import a repository into the IDE.',
  submitLabel = 'Create project',
  onCreate,
  onLogin,
  onLoadRepositories,
  onImport,
}: NewProjectDialogProps) {
  const supportsRepositoryImport = Boolean(onLoadRepositories && onImport);
  const [activeTab, setActiveTab] = useState<ProjectLaunchTab>(
    supportsRepositoryImport && initialTab === 'repository' ? 'repository' : 'sandbox',
  );
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId>(initialTemplateId);
  const [createGitHubRepo, setCreateGitHubRepo] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | null>(null);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedProjectName = resolveProjectName(name);
  const selectedTemplate = TEMPLATES.find((template) => template.id === templateId) ?? TEMPLATES[0]!;

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return repositories;
    }

    return repositories.filter((repository) => {
      const haystack = [
        repository.fullName,
        repository.description ?? '',
        repository.ownerLogin,
      ].join('\n').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, repositories]);

  const selectedRepository = useMemo(
    () => filteredRepositories.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [filteredRepositories, selectedRepositoryId],
  );

  useEffect(() => {
    if (!open) {
      setActiveTab(supportsRepositoryImport && initialTab === 'repository' ? 'repository' : 'sandbox');
      setName('');
      setTemplateId(initialTemplateId);
      setCreateGitHubRepo(false);
      setRepositories([]);
      setQuery('');
      setSelectedRepositoryId(null);
      setIsCreating(false);
      setIsLoadingRepositories(false);
      setIsAuthenticating(false);
      setIsImporting(false);
      setError(null);
      return;
    }

    setTemplateId(initialTemplateId);
    setActiveTab(supportsRepositoryImport && initialTab === 'repository' ? 'repository' : 'sandbox');
    setError(null);
  }, [initialTab, initialTemplateId, open, supportsRepositoryImport]);

  useEffect(() => {
    if (selectedRepositoryId === null) {
      return;
    }
    if (repositories.some((repository) => repository.id === selectedRepositoryId)) {
      return;
    }
    setSelectedRepositoryId(null);
  }, [repositories, selectedRepositoryId]);

  useEffect(() => {
    if (!open || activeTab !== 'repository' || !supportsRepositoryImport) {
      return;
    }
    if (!hasGitHubCredentials) {
      setRepositories([]);
      setSelectedRepositoryId(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadRepositories = async () => {
      setIsLoadingRepositories(true);
      setError(null);
      try {
        const nextRepositories = await onLoadRepositories!();
        if (!cancelled) {
          setRepositories(nextRepositories);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || 'Failed to load GitHub repositories.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRepositories(false);
        }
      }
    };

    void loadRepositories();

    return () => {
      cancelled = true;
    };
  }, [activeTab, hasGitHubCredentials, onLoadRepositories, open, supportsRepositoryImport]);

  const handleCreate = async () => {
    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await onCreate(resolvedProjectName, templateId, { createGitHubRepo });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to create project.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRefreshRepositories = async () => {
    if (!onLoadRepositories || isLoadingRepositories) {
      return;
    }

    setIsLoadingRepositories(true);
    setError(null);

    try {
      const nextRepositories = await onLoadRepositories();
      setRepositories(nextRepositories);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to load GitHub repositories.');
    } finally {
      setIsLoadingRepositories(false);
    }
  };

  const handleLogin = async () => {
    if (!onLogin || isAuthenticating) {
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      await onLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'GitHub login did not complete.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleImport = async () => {
    if (!selectedRepository || !onImport || isImporting) {
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      await onImport(selectedRepository);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to import GitHub repository.');
    } finally {
      setIsImporting(false);
    }
  };

  const showRepositoryTab = supportsRepositoryImport;
  const showRepositoryPrimary = activeTab === 'repository' && hasGitHubCredentials;
  const isBusy = isCreating || isImporting || isAuthenticating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="almostnode-project-launch-dialog">
        <div className="almostnode-project-launch-dialog__frame">
          <DialogHeader className="almostnode-project-launch-dialog__header">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {showRepositoryTab ? (
            <div className="almostnode-project-launch-dialog__tabs" role="tablist" aria-label="Project source">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'sandbox'}
                className={cn(
                  'almostnode-project-launch-dialog__tab',
                  activeTab === 'sandbox' && 'is-active',
                )}
                onClick={() => {
                  setActiveTab('sandbox');
                  setError(null);
                }}
              >
                <PlusPanelIcon />
                <span>Empty sandbox</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'repository'}
                className={cn(
                  'almostnode-project-launch-dialog__tab',
                  activeTab === 'repository' && 'is-active',
                )}
                onClick={() => {
                  setActiveTab('repository');
                  setError(null);
                }}
              >
                <RepositoryIcon />
                <span>From repository</span>
              </button>
            </div>
          ) : null}

          {activeTab === 'sandbox' ? (
            <div className="almostnode-project-launch-dialog__panel">
              <div className="almostnode-project-launch-dialog__panel-group">
                <div className="almostnode-project-launch-dialog__panel-copy">
                  <span className="almostnode-project-launch-dialog__eyebrow">Project name</span>
                  <p className="almostnode-project-launch-dialog__helper">
                    Leave it blank and the IDE will generate a container-style name automatically.
                  </p>
                </div>
                <Input
                  placeholder="project-name or leave blank for something random"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleCreate();
                    }
                  }}
                  autoFocus
                />
              </div>

              <div className="almostnode-project-launch-dialog__panel-group">
                <div className="almostnode-project-launch-dialog__panel-copy">
                  <span className="almostnode-project-launch-dialog__eyebrow">Starter</span>
                  <p className="almostnode-project-launch-dialog__helper">
                    Pick the stack you want seeded into the workspace.
                  </p>
                </div>
                <div className="almostnode-project-launch-dialog__template-grid">
                  {TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={cn(
                        'almostnode-project-launch-dialog__template-card',
                        template.id === templateId && 'is-active',
                      )}
                      onClick={() => setTemplateId(template.id)}
                    >
                      <span className="almostnode-project-launch-dialog__template-label">
                        {template.label}
                      </span>
                      <span className="almostnode-project-launch-dialog__template-description">
                        {template.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="almostnode-project-launch-dialog__summary-strip">
                <div className="almostnode-project-launch-dialog__summary-pill">
                  <span className="almostnode-project-launch-dialog__summary-label">Ready as</span>
                  <span className="almostnode-project-launch-dialog__summary-value">{resolvedProjectName}</span>
                </div>
                <div className="almostnode-project-launch-dialog__summary-pill">
                  <span className="almostnode-project-launch-dialog__summary-label">Template</span>
                  <span className="almostnode-project-launch-dialog__summary-value">{selectedTemplate.label}</span>
                </div>
              </div>

              {hasGitHubCredentials ? (
                <label className="almostnode-project-launch-dialog__toggle-card">
                  <input
                    type="checkbox"
                    checked={createGitHubRepo}
                    onChange={(event) => setCreateGitHubRepo(event.target.checked)}
                  />
                  <span className="almostnode-project-launch-dialog__toggle-copy">
                    <span className="almostnode-project-launch-dialog__toggle-title">
                      Create a GitHub remote
                    </span>
                    <span className="almostnode-project-launch-dialog__toggle-description">
                      Creates a private repository and wires it up as <code>origin</code>.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="almostnode-project-launch-dialog__panel">
              {!hasGitHubCredentials ? (
                <div className="almostnode-project-launch-dialog__connect-card">
                  <div className="almostnode-project-launch-dialog__connect-copy">
                    <GitHubMark />
                    <div>
                      <span className="almostnode-project-launch-dialog__connect-title">
                        Connect GitHub first
                      </span>
                      <p className="almostnode-project-launch-dialog__helper">
                        This uses the same <code>gh auth login</code> flow that powers the keychain sidebar.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => void handleLogin()} disabled={isAuthenticating}>
                    {isAuthenticating ? 'Opening login…' : 'Log in to GitHub'}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="almostnode-project-launch-dialog__repo-toolbar">
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter repositories"
                    />
                    <Button
                      variant="outline"
                      onClick={() => void handleRefreshRepositories()}
                      disabled={isLoadingRepositories || isImporting}
                    >
                      Refresh
                    </Button>
                  </div>

                  <div className="almostnode-project-launch-dialog__repo-meta">
                    <span>{repositories.length} repositories found</span>
                    {query.trim() ? <span>{filteredRepositories.length} matching</span> : null}
                  </div>

                  <div className="almostnode-project-launch-dialog__repo-list">
                    {isLoadingRepositories ? (
                      <div className="almostnode-project-launch-dialog__repo-empty">
                        Loading repositories…
                      </div>
                    ) : filteredRepositories.length === 0 ? (
                      <div className="almostnode-project-launch-dialog__repo-empty">
                        {repositories.length === 0
                          ? 'No repositories found for this account.'
                          : 'No repositories match that filter.'}
                      </div>
                    ) : (
                      <ScrollArea style={{ maxHeight: '18.5rem' }}>
                        <div className="almostnode-project-launch-dialog__repo-items">
                          {filteredRepositories.map((repository) => (
                            <button
                              key={repository.id}
                              type="button"
                              className={cn(
                                'almostnode-project-launch-dialog__repo-item',
                                selectedRepositoryId === repository.id && 'is-selected',
                              )}
                              onClick={() => setSelectedRepositoryId(repository.id)}
                            >
                              <span className="almostnode-project-launch-dialog__repo-item-main">
                                <span className="almostnode-project-launch-dialog__repo-name-row">
                                  <GitHubMark />
                                  <span className="almostnode-project-launch-dialog__repo-name">
                                    {repository.fullName}
                                  </span>
                                </span>
                                <span className="almostnode-project-launch-dialog__repo-description">
                                  {repository.description || 'No description'}
                                </span>
                              </span>
                              <span className="almostnode-project-launch-dialog__repo-status">
                                <span
                                  className={cn(
                                    'almostnode-project-launch-dialog__repo-badge',
                                    repository.private && 'is-private',
                                  )}
                                >
                                  {repository.private ? 'Private' : 'Public'}
                                </span>
                                <span className="almostnode-project-launch-dialog__repo-action">
                                  {selectedRepositoryId === repository.id ? 'Selected' : 'Choose'}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {error ? (
            <div className="almostnode-project-launch-dialog__error">
              {error}
            </div>
          ) : null}

          <DialogFooter className="almostnode-project-launch-dialog__footer">
            {activeTab === 'repository' && selectedRepository ? (
              <div className="almostnode-project-launch-dialog__footer-note">
                <span className="almostnode-project-launch-dialog__summary-label">Selected repo</span>
                <span className="almostnode-project-launch-dialog__summary-value">
                  {selectedRepository.fullName}
                </span>
              </div>
            ) : (
              <div className="almostnode-project-launch-dialog__footer-note">
                {activeTab === 'sandbox'
                  ? 'Your project opens immediately in the IDE.'
                  : 'Choose a repository to import it into the workspace.'}
              </div>
            )}

            <div className="almostnode-project-launch-dialog__footer-actions">
              <DialogClose asChild>
                <Button variant="ghost" disabled={isBusy}>Cancel</Button>
              </DialogClose>
              {activeTab === 'sandbox' ? (
                <Button onClick={() => void handleCreate()} disabled={isCreating}>
                  {isCreating ? 'Creating…' : submitLabel}
                </Button>
              ) : null}
              {showRepositoryPrimary ? (
                <Button
                  onClick={() => void handleImport()}
                  disabled={isImporting || isLoadingRepositories || !selectedRepository}
                >
                  {isImporting ? 'Importing…' : 'Import repository'}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlusPanelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RepositoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.5a2 2 0 0 1 2 2v5a2 2 0 1 1-2-2h6a2 2 0 0 0 0-4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="10.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none', opacity: 0.82 }}>
      <path d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.73 5.47 7.82.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.97-.81-1.16-.27-.15-.65-.52-.01-.53.6-.01 1.03.57 1.17.81.69 1.2 1.79.86 2.23.65.07-.52.27-.86.5-1.06-1.78-.21-3.64-.92-3.64-4.07 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.19 0 0 .67-.22 2.2.84a7.3 7.3 0 0 1 4 0c1.53-1.06 2.2-.84 2.2-.84.44 1.14.16 1.98.08 2.19.51.58.82 1.31.82 2.22 0 3.16-1.87 3.86-3.65 4.07.29.26.54.75.54 1.52 0 1.1-.01 1.98-.01 2.25 0 .22.15.48.55.39A8.27 8.27 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z" />
    </svg>
  );
}
