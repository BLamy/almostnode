import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
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
import {
  DEFAULT_APP_BUILDING_IMAGE_REF,
  normalizeAppBuildingSetupDraft,
  validateAppBuildingSetupDraft,
  type AppBuildingSetupDraft,
} from '../features/app-building-setup';

interface AppBuildingSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft?: AppBuildingSetupDraft | null;
  onSave: (draft: AppBuildingSetupDraft) => Promise<void> | void;
}

export function AppBuildingSetupDialog({
  open,
  onOpenChange,
  initialDraft,
  onSave,
}: AppBuildingSetupDialogProps) {
  const [draft, setDraft] = useState<AppBuildingSetupDraft>(
    normalizeAppBuildingSetupDraft(initialDraft),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(normalizeAppBuildingSetupDraft(initialDraft));
    setIsSaving(false);
    setError(null);
  }, [initialDraft, open]);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    const normalized = normalizeAppBuildingSetupDraft(draft);
    const validationError = validateAppBuildingSetupDraft(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(normalized);
      onOpenChange(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message || 'Failed to save app-building setup.');
    } finally {
      setIsSaving(false);
    }
  };

  const bindField = <T extends keyof AppBuildingSetupDraft>(key: T) => ({
    value: draft[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft((current) => ({
        ...current,
        [key]: event.target.value,
      }));
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        void handleSave();
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up App Building</DialogTitle>
          <DialogDescription>
            Configure the shared Fly app and Infisical access for remote app-building workers.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Shared Fly app</span>
            <Input placeholder="my-app-building-workers" autoFocus {...bindField('flyAppName')} />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Fly API token</span>
            <Input
              placeholder="Fly deploy or org token"
              type="password"
              autoComplete="off"
              {...bindField('flyApiToken')}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              Use an app-scoped deploy token or org-scoped token, not the short-lived Fly login token. Pasting the
              `FlyV1 ...` output from `fly tokens create` is fine.
            </span>
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Infisical client ID</span>
            <Input placeholder="universal-auth client id" {...bindField('infisicalClientId')} />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Infisical client secret</span>
            <Input
              placeholder="universal-auth client secret"
              type="password"
              autoComplete="off"
              {...bindField('infisicalClientSecret')}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Infisical project ID</span>
            <Input placeholder="project id" {...bindField('infisicalProjectId')} />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Infisical environment</span>
            <Input placeholder="prod" {...bindField('infisicalEnvironment')} />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>Image ref</span>
            <Input placeholder={DEFAULT_APP_BUILDING_IMAGE_REF} {...bindField('imageRef')} />
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              Optional. Leave blank to use the default upstream app-building image. Workers clone the default
              `replayio/app-building` repo into `/app` using the `GITHUB_TOKEN` already stored in Infisical.
            </span>
          </label>

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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isSaving}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save setup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
