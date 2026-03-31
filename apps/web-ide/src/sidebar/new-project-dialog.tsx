import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { TemplateId } from '../features/workspace-seed';
import { resolveProjectName } from '../features/project-names';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasGitHubCredentials: boolean;
  initialTemplateId?: TemplateId;
  title?: string;
  description?: string;
  submitLabel?: string;
  onCreate: (
    name: string,
    templateId: TemplateId,
    options: { createGitHubRepo: boolean },
  ) => Promise<void> | void;
}

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'vite', label: 'Vite + React', description: 'React SPA with Vite' },
  { id: 'nextjs', label: 'Next.js', description: 'Pages + App Router' },
  { id: 'tanstack', label: 'TanStack Start', description: 'Full-stack React' },
];

export function NewProjectDialog({
  open,
  onOpenChange,
  hasGitHubCredentials,
  initialTemplateId = 'vite',
  title = 'New Project',
  description = 'Create a new project from a template.',
  submitLabel = 'Create',
  onCreate,
}: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId>(initialTemplateId);
  const [createGitHubRepo, setCreateGitHubRepo] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setTemplateId(initialTemplateId);
      setCreateGitHubRepo(false);
      setIsCreating(false);
      setError(null);
      return;
    }

    setTemplateId(initialTemplateId);
    setError(null);
  }, [initialTemplateId, open]);

  const handleCreate = async () => {
    if (isCreating) {
      return;
    }

    const trimmed = resolveProjectName(name);
    setIsCreating(true);
    setError(null);

    try {
      await onCreate(trimmed, templateId, { createGitHubRepo });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to create project.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              Project name
            </label>
            <Input
              placeholder="reponame or leave blank for magic-frisby"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <p style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
              Leave it blank to auto-generate a container-style name.
            </p>
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              Template
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => setTemplateId(tmpl.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: `1px solid ${templateId === tmpl.id ? 'var(--accent)' : 'var(--panel-border)'}`,
                    background: templateId === tmpl.id ? 'rgba(255, 122, 89, 0.08)' : 'transparent',
                    color: 'var(--text)',
                    font: 'inherit',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{tmpl.label}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{tmpl.description}</span>
                </button>
              ))}
            </div>
          </div>

          {hasGitHubCredentials && (
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.7rem 0.75rem',
                borderRadius: '0.6rem',
                border: '1px solid var(--panel-border)',
                background: 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={createGitHubRepo}
                onChange={(e) => setCreateGitHubRepo(e.target.checked)}
                style={{ marginTop: '0.15rem' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text)' }}>
                  Create GitHub repo
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  Creates a private repository and configures it as <code>origin</code>.
                </span>
              </span>
            </label>
          )}

          {error && (
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
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isCreating}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void handleCreate()} disabled={isCreating}>
            {isCreating ? 'Creating...' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
