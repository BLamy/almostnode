import { useEffect, useState } from 'react';
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
  normalizeAwsSetupDraft,
  validateAwsSetupDraft,
  type AwsSetupDraft,
} from '../features/aws-setup';

interface AwsSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft?: AwsSetupDraft | null;
  onSave: (draft: AwsSetupDraft) => Promise<void> | void;
}

export function AwsSetupDialog({
  open,
  onOpenChange,
  initialDraft,
  onSave,
}: AwsSetupDialogProps) {
  const [sessionName, setSessionName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [region, setRegion] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = normalizeAwsSetupDraft(initialDraft);

    setSessionName(normalized.sessionName);
    setStartUrl(normalized.startUrl);
    setRegion(normalized.region);
    setIsSaving(false);
    setError(null);
  }, [initialDraft, open]);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    const draft = normalizeAwsSetupDraft({
      sessionName,
      startUrl,
      region,
    });
    const validationError = validateAwsSetupDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message || 'Failed to save AWS setup.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up AWS</DialogTitle>
          <DialogDescription>
            Add your AWS access portal and region before signing in.
            You can choose an AWS account and role after sign-in.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              AWS access portal URL
            </label>
            <Input
              placeholder="https://example.awsapps.com/start"
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleSave()}
              autoFocus
            />
            <p style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
              This is the IAM Identity Center start URL from your organization.
            </p>
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              SSO region
            </label>
            <Input
              placeholder="us-east-1"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleSave()}
            />
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: '0.35rem', color: 'var(--text)' }}
            >
              Session name
            </label>
            <Input
              placeholder="default"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleSave()}
            />
          </div>

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
