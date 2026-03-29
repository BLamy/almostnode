import { useState } from 'react';
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

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, templateId: TemplateId) => void;
}

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'vite', label: 'Vite + React', description: 'React SPA with Vite' },
  { id: 'nextjs', label: 'Next.js', description: 'Pages + App Router' },
  { id: 'tanstack', label: 'TanStack Start', description: 'Full-stack React' },
];

export function NewProjectDialog({ open, onOpenChange, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId>('vite');

  const handleCreate = () => {
    const trimmed = name.trim() || 'Untitled Project';
    onCreate(trimmed, templateId);
    setName('');
    setTemplateId('vite');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>Create a new project from a template.</DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              Project name
            </label>
            <Input
              placeholder="My Project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleCreate}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
