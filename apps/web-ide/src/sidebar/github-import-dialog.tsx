import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import type { GitHubRepositorySummary } from '../features/github-repositories';

interface GitHubImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasGitHubCredentials: boolean;
  onLogin: () => Promise<void> | void;
  onLoadRepositories: () => Promise<GitHubRepositorySummary[]>;
  onImport: (repository: GitHubRepositorySummary) => Promise<void> | void;
}

export function GitHubImportDialog({
  open,
  onOpenChange,
  hasGitHubCredentials,
  onLogin,
  onLoadRepositories,
  onImport,
}: GitHubImportDialogProps) {
  const [repositories, setRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [importingRepositoryId, setImportingRepositoryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRepositories([]);
      setQuery('');
      setIsLoadingRepositories(false);
      setIsAuthenticating(false);
      setImportingRepositoryId(null);
      setError(null);
      return;
    }

    if (!hasGitHubCredentials) {
      setRepositories([]);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadRepositories = async () => {
      setIsLoadingRepositories(true);
      setError(null);
      try {
        const nextRepositories = await onLoadRepositories();
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
  }, [hasGitHubCredentials, onLoadRepositories, open]);

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return repositories;
    }

    return repositories.filter((repository) => {
      const haystack = [
        repository.fullName,
        repository.description ?? '',
      ].join('\n').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, repositories]);

  const handleLogin = async () => {
    if (isAuthenticating) {
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

  const handleImport = async (repository: GitHubRepositorySummary) => {
    if (importingRepositoryId !== null) {
      return;
    }

    setImportingRepositoryId(repository.id);
    setError(null);

    try {
      await onImport(repository);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to import GitHub repository.');
    } finally {
      setImportingRepositoryId(null);
    }
  };

  const isBusy = isLoadingRepositories || isAuthenticating || importingRepositoryId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: '42rem' }}>
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>
            Clone a repository into the web IDE and save it as a sidebar project.
          </DialogDescription>
        </DialogHeader>

        {!hasGitHubCredentials ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.9rem',
              borderRadius: '0.8rem',
              border: '1px solid var(--panel-border)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
              padding: '1rem',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>
                Connect GitHub first
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                This uses the same <code>gh auth login</code> flow as the keychain sidebar.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <Button onClick={() => void handleLogin()} disabled={isAuthenticating}>
                {isAuthenticating ? 'Opening login…' : 'Log in to GitHub'}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter repositories"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setRepositories([]);
                  setError(null);
                  setIsLoadingRepositories(true);
                  void onLoadRepositories()
                    .then((nextRepositories) => {
                      setRepositories(nextRepositories);
                    })
                    .catch((err) => {
                      const message = err instanceof Error ? err.message : String(err);
                      setError(message || 'Failed to load GitHub repositories.');
                    })
                    .finally(() => {
                      setIsLoadingRepositories(false);
                    });
                }}
                disabled={isBusy}
              >
                Refresh
              </Button>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.74rem',
                color: 'var(--muted)',
              }}
            >
              <span>{repositories.length} repositories available</span>
              {query.trim() ? <span>{filteredRepositories.length} shown</span> : null}
            </div>

            <div
              style={{
                borderRadius: '0.8rem',
                border: '1px solid var(--panel-border)',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.015)',
              }}
            >
              {isLoadingRepositories ? (
                <div style={{ padding: '1rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  Loading repositories…
                </div>
              ) : filteredRepositories.length === 0 ? (
                <div style={{ padding: '1rem', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  {repositories.length === 0
                    ? 'No repositories found for this account.'
                    : 'No repositories match that filter.'}
                </div>
              ) : (
                <ScrollArea style={{ maxHeight: '22rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredRepositories.map((repository) => {
                      const isImporting = importingRepositoryId === repository.id;

                      return (
                        <button
                          key={repository.id}
                          type="button"
                          onClick={() => void handleImport(repository)}
                          disabled={isBusy && !isImporting}
                          style={{
                            appearance: 'none',
                            border: 0,
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: 'transparent',
                            color: 'inherit',
                            textAlign: 'left',
                            padding: '0.85rem 0.95rem',
                            cursor: 'pointer',
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            gap: '0.8rem',
                          }}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', gap: '0.28rem', minWidth: 0 }}>
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                minWidth: 0,
                                color: 'var(--text)',
                              }}
                            >
                              <GitHubMark />
                              <span
                                style={{
                                  fontSize: '0.84rem',
                                  fontWeight: 600,
                                  minWidth: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {repository.fullName}
                              </span>
                            </span>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--muted)',
                                lineHeight: 1.45,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {repository.description || 'No description'}
                            </span>
                          </span>

                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              fontSize: '0.68rem',
                              color: 'var(--muted)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                            }}
                          >
                            <span
                              style={{
                                padding: '0.18rem 0.45rem',
                                borderRadius: '999px',
                                background: repository.private
                                  ? 'rgba(255, 122, 89, 0.12)'
                                  : 'rgba(108, 182, 255, 0.12)',
                                color: repository.private ? 'var(--accent)' : '#8ed3ff',
                              }}
                            >
                              {repository.private ? 'Private' : 'Public'}
                            </span>
                            <span style={{ color: 'var(--text)' }}>
                              {isImporting ? 'Importing…' : 'Import'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}

        {error ? (
          <div
            style={{
              borderRadius: '0.5rem',
              border: '1px solid rgba(255, 98, 98, 0.35)',
              background: 'rgba(255, 98, 98, 0.08)',
              color: '#ffb4b4',
              fontSize: '0.74rem',
              padding: '0.6rem 0.7rem',
            }}
          >
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isBusy}>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GitHubMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none', opacity: 0.78 }}>
      <path d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.73 5.47 7.82.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.97-.81-1.16-.27-.15-.65-.52-.01-.53.6-.01 1.03.57 1.17.81.69 1.2 1.79.86 2.23.65.07-.52.27-.86.5-1.06-1.78-.21-3.64-.92-3.64-4.07 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.19 0 0 .67-.22 2.2.84a7.3 7.3 0 0 1 4 0c1.53-1.06 2.2-.84 2.2-.84.44 1.14.16 1.98.08 2.19.51.58.82 1.31.82 2.22 0 3.16-1.87 3.86-3.65 4.07.29.26.54.75.54 1.52 0 1.1-.01 1.98-.01 2.25 0 .22.15.48.55.39A8.27 8.27 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z" />
    </svg>
  );
}
