export interface AwsSetupDraft {
  sessionName: string;
  startUrl: string;
  region: string;
}

export const DEFAULT_AWS_SESSION_NAME = 'default';
export const DEFAULT_AWS_REGION = 'us-east-1';

export function normalizeAwsSetupDraft(
  value?: Partial<AwsSetupDraft> | null,
): AwsSetupDraft {
  return {
    sessionName: String(value?.sessionName || DEFAULT_AWS_SESSION_NAME).trim() || DEFAULT_AWS_SESSION_NAME,
    startUrl: String(value?.startUrl || '').trim(),
    region: String(value?.region || DEFAULT_AWS_REGION).trim() || DEFAULT_AWS_REGION,
  };
}

export function validateAwsSetupDraft(draft: AwsSetupDraft): string | null {
  if (!draft.startUrl) {
    return 'Access portal URL is required.';
  }
  if (!draft.region) {
    return 'SSO region is required.';
  }
  if (!draft.sessionName) {
    return 'Session name is required.';
  }

  let url: URL;
  try {
    url = new URL(draft.startUrl);
  } catch {
    return 'Access portal URL must be a valid absolute URL.';
  }

  if (!/^https?:$/.test(url.protocol)) {
    return 'Access portal URL must start with http:// or https://.';
  }

  return null;
}
