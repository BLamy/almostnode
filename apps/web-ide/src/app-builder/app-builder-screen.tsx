import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@agent-wasm/react/ui';
import {
  extractCredentials,
  type ExtractedCredentials,
} from './standalone-credentials';
import {
  completeNeonManualLogin,
  listNeonOrganizations,
  provisionNeonProjectAndKey,
  startNeonManualLogin,
  type NeonOrganization,
  type NeonPendingLogin,
} from './neon-provisioning';
import { ControlPlaneView } from './control-plane-view';
import { FlyLogsPanel } from './fly-logs-panel';
import {
  forgetStoredVault,
  isVaultSupported,
  readStoredVault,
  unlockVault,
} from './standalone-vault';
import {
  SERVICE_COMMANDS,
  createLightweightAppBuilderContainer,
  type LightweightAppBuilderContainer,
  type ServiceSlot,
} from './lightweight-container';
import {
  emptySelections,
  fetchFlyAppList,
  fetchInfisicalProjectList,
  fetchNetlifyAccountList,
  readSelections,
  writeSelections,
  type AppBuilderSelections,
  type FlyAppSummary,
  type InfisicalProjectInfo,
  type NetlifyAccount,
} from './service-pickers';
import {
  ensureInfisicalFolder,
  upsertInfisicalSecret,
} from '../../../../packages/almostnode/src/shims/infisical-auth';
import { KEYCHAIN_STORAGE_KEY } from '@agent-wasm/keychain';

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'no-vault' }
  | { kind: 'locked' }
  | { kind: 'unlocking' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; credentials: ExtractedCredentials }
  | { kind: 'launched'; credentials: ExtractedCredentials };

interface ServiceDescriptor {
  slot: ServiceSlot;
  label: string;
  description: string;
  requiredKeyGroups: readonly (readonly (keyof ExtractedCredentials)[])[];
  /** Selection key on AppBuilderSelections that must be non-null for the service to count as ready. */
  selectionKey?: keyof AppBuilderSelections;
  /** Extra selection key (used for Infisical, which needs both project + environment). */
  extraSelectionKey?: keyof AppBuilderSelections;
}

const SERVICES: readonly ServiceDescriptor[] = [
  {
    slot: 'github',
    label: 'GitHub',
    description: 'Repository access for cloning and pushing builder output.',
    requiredKeyGroups: [['GITHUB_TOKEN']],
  },
  {
    slot: 'replay',
    label: 'Replay',
    description: 'Replay recordings and debug sessions during app building.',
    requiredKeyGroups: [['RECORD_REPLAY_API_KEY']],
  },
  {
    slot: 'infisical',
    label: 'Infisical',
    description: 'Shared secrets pulled by remote app-building workers.',
    requiredKeyGroups: [['INFISICAL_CLIENT_ID'], ['INFISICAL_CLIENT_SECRET']],
    selectionKey: 'infisicalProjectId',
    extraSelectionKey: 'infisicalEnvironment',
  },
  {
    slot: 'fly',
    label: 'Fly.io',
    description: 'Launches and deploys worker VMs for the builder.',
    requiredKeyGroups: [['FLY_API_TOKEN']],
    selectionKey: 'flyApp',
  },
  {
    slot: 'netlify',
    label: 'Netlify',
    description: 'Preview deployments for generated apps.',
    requiredKeyGroups: [['NETLIFY_AUTH_TOKEN']],
    selectionKey: 'netlifyAccountSlug',
  },
  {
    slot: 'neon',
    label: 'Neon',
    description: 'Serverless Postgres provisioning for generated apps.',
    requiredKeyGroups: [['NEON_ACCESS_TOKEN', 'NEON_API_KEY']],
    selectionKey: 'neonProjectId',
  },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function readScreenState(): ScreenState {
  const vault = readStoredVault();
  if (!vault) {
    return { kind: 'no-vault' };
  }
  return { kind: 'locked' };
}

function credsFilled(
  service: ServiceDescriptor,
  credentials: ExtractedCredentials,
): boolean {
  return service.requiredKeyGroups.every((group) =>
    group.some((key) => Boolean(credentials[key])),
  );
}

function selectionsFilled(
  service: ServiceDescriptor,
  selections: AppBuilderSelections,
): boolean {
  if (service.selectionKey && !selections[service.selectionKey]) return false;
  if (service.extraSelectionKey && !selections[service.extraSelectionKey]) return false;
  return true;
}

function isServiceReady(
  service: ServiceDescriptor,
  credentials: ExtractedCredentials,
  selections: AppBuilderSelections,
): boolean {
  return credsFilled(service, credentials) && selectionsFilled(service, selections);
}

// ── Dropdown data loaders ────────────────────────────────────────────────────

interface PickerData {
  flyApps: FlyAppSummary[] | null;
  flyError: string | null;
  netlifyAccounts: NetlifyAccount[] | null;
  netlifyError: string | null;
  infisicalProjects: InfisicalProjectInfo[] | null;
  infisicalError: string | null;
  neonOrganizations: NeonOrganization[] | null;
  neonOrganizationsError: string | null;
}

function emptyPickerData(): PickerData {
  return {
    flyApps: null,
    flyError: null,
    netlifyAccounts: null,
    netlifyError: null,
    infisicalProjects: null,
    infisicalError: null,
    neonOrganizations: null,
    neonOrganizationsError: null,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressSidebar({
  credentials,
  selections,
  pendingSlot,
}: {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  pendingSlot: ServiceSlot | null;
}) {
  const readyServices = SERVICES.filter((service) =>
    isServiceReady(service, credentials, selections),
  );
  const readyCount = readyServices.length;
  const total = SERVICES.length;
  const percentage = Math.round((readyCount / total) * 100);
  const builderReady = readyCount === total;

  return (
    <aside className="app-builder-route__progress">
      <p className="app-builder-route__eyebrow">Launch readiness</p>
      <h2 className="app-builder-route__progress-title">
        {builderReady ? 'Ready to launch' : `${readyCount}/${total} services ready`}
      </h2>
      <div className="app-builder-route__progress-bar" aria-label={`${percentage}% ready`}>
        <div
          className={`app-builder-route__progress-fill ${builderReady ? 'is-complete' : ''}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <ul className="app-builder-route__progress-list">
        {SERVICES.map((service) => {
          const signedIn = credsFilled(service, credentials);
          const ready = isServiceReady(service, credentials, selections);
          const pending = pendingSlot === service.slot;
          let status = 'Pending';
          if (pending) status = 'Running…';
          else if (ready) status = 'Ready';
          else if (signedIn) status = 'Pick option';
          return (
            <li
              key={service.slot}
              className={`${ready ? 'is-ready' : ''} ${pending ? 'is-pending' : ''}`.trim()}
            >
              <span className="app-builder-route__progress-dot" aria-hidden />
              <span>{service.label}</span>
              <span className="app-builder-route__progress-status">{status}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

interface NeonProvisionState {
  status: 'idle' | 'running' | 'error';
  message: string | null;
}

interface NeonLoginState {
  pending: NeonPendingLogin | null;
  pasteValue: string;
  submitting: boolean;
  error: string | null;
}

function emptyNeonLoginState(): NeonLoginState {
  return { pending: null, pasteValue: '', submitting: false, error: null };
}

interface InfisicalSyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  message: string | null;
}

/**
 * Env vars we push to the Infisical project's /global folder when the user clicks "Save".
 *
 * INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET are deliberately excluded — they're
 * the credentials that authorize the sync itself, so storing them inside Infisical
 * would be circular.
 *
 * ANTHROPIC_API_KEY is resolved at sync-time: the value pasted on this page takes
 * precedence over whatever the vault decoded from ~/.claude/.credentials.json.
 */
function buildInfisicalSyncEntries(
  credentials: ExtractedCredentials,
  selections: AppBuilderSelections,
): Array<{ key: string; value: string }> {
  const anthropic =
    selections.anthropicApiKey?.trim() || credentials.ANTHROPIC_API_KEY || '';
  const neonApiKey = selections.neonApiKey || credentials.NEON_API_KEY || '';

  return [
    { key: 'ANTHROPIC_API_KEY', value: anthropic },
    { key: 'GITHUB_TOKEN', value: credentials.GITHUB_TOKEN ?? '' },
    { key: 'RECORD_REPLAY_API_KEY', value: credentials.RECORD_REPLAY_API_KEY ?? '' },
    { key: 'NETLIFY_AUTH_TOKEN', value: credentials.NETLIFY_AUTH_TOKEN ?? '' },
    { key: 'NETLIFY_ACCOUNT_SLUG', value: selections.netlifyAccountSlug ?? '' },
    { key: 'NEON_API_KEY', value: neonApiKey },
    { key: 'NEON_ACCESS_TOKEN', value: credentials.NEON_ACCESS_TOKEN ?? '' },
    { key: 'NEON_PROJECT_ID', value: selections.neonProjectId ?? '' },
    { key: 'FLY_API_TOKEN', value: credentials.FLY_API_TOKEN ?? '' },
    { key: 'FLY_APP', value: selections.flyApp ?? '' },
  ].filter((entry) => entry.value.trim().length > 0);
}

function ServicePicker({
  service,
  credentials,
  selections,
  pickerData,
  neonState,
  neonLogin,
  onSelect,
  onExtraSelect,
  onProvisionNeon,
  onSetNeonProjectName,
  onSetNeonPaste,
  onSubmitNeonPaste,
  onCancelNeonLogin,
}: {
  service: ServiceDescriptor;
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  pickerData: PickerData;
  neonState?: NeonProvisionState;
  neonLogin?: NeonLoginState;
  onSelect: (key: keyof AppBuilderSelections, value: string | null) => void;
  onExtraSelect?: (key: keyof AppBuilderSelections, value: string | null) => void;
  onProvisionNeon?: () => void;
  onSetNeonProjectName?: (value: string) => void;
  onSetNeonPaste?: (value: string) => void;
  onSubmitNeonPaste?: () => void;
  onCancelNeonLogin?: () => void;
}) {
  if (service.slot === 'neon') {
    if (!credsFilled(service, credentials)) {
      // Not yet signed in. The row's generic "Login" button kicks off the manual OAuth
      // flow; this picker only renders the paste step once the authorization URL is ready.
      if (!neonLogin?.pending) {
        if (neonLogin?.error) {
          return (
            <div className="app-builder-route__picker">
              <p className="app-builder-route__picker-hint">{neonLogin.error}</p>
            </div>
          );
        }
        return null;
      }
      return (
        <div className="app-builder-route__picker app-builder-route__picker--neon-login">
          <div className="app-builder-route__neon-login-step">
            <p className="app-builder-route__picker-label">Step 1 — authorize in a new tab</p>
            <a
              className="app-builder-route__neon-login-link"
              href={neonLogin.pending.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Neon authorization page ↗
            </a>
            <p className="app-builder-route__picker-sub">
              Neon will redirect to{' '}
              <code>{neonLogin.pending.redirectUri}</code>. That loopback URL won't load anywhere
              useful — just copy the full URL from your address bar after approving.
            </p>
          </div>
          <div className="app-builder-route__neon-login-step">
            <label>
              <span>Step 2 — paste the redirect URL</span>
              <textarea
                rows={3}
                placeholder="http://127.0.0.1:44555/callback?code=…&state=…"
                value={neonLogin.pasteValue}
                onChange={(event) => onSetNeonPaste?.(event.target.value)}
              />
            </label>
            <div className="app-builder-route__unlock-actions">
              <Button
                type="button"
                size="sm"
                onClick={onSubmitNeonPaste}
                disabled={!neonLogin.pasteValue.trim() || neonLogin.submitting}
              >
                {neonLogin.submitting ? 'Exchanging…' : 'Exchange code'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelNeonLogin}>
                Start over
              </Button>
            </div>
            {neonLogin.error ? (
              <p className="app-builder-route__picker-hint">{neonLogin.error}</p>
            ) : null}
          </div>
        </div>
      );
    }
    const hasKey = Boolean(selections.neonApiKey && selections.neonProjectId);
    return (
      <div className="app-builder-route__picker app-builder-route__picker--neon">
        {hasKey ? (
          <div className="app-builder-route__neon-summary">
            <div>
              <span className="app-builder-route__picker-label">Neon project</span>
              <code>{selections.neonProjectName ?? selections.neonProjectId}</code>
            </div>
            <div>
              <span className="app-builder-route__picker-label">Project ID</span>
              <code>{selections.neonProjectId}</code>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelect('neonProjectId', null);
                onExtraSelect?.('neonApiKey', null);
                onSelect('neonProjectName', null);
              }}
            >
              Reset provisioned project
            </Button>
          </div>
        ) : (
          <div className="app-builder-route__neon-create">
            <label>
              <span>Organization</span>
              <select
                value={selections.neonOrgId ?? ''}
                onChange={(event) => {
                  const value = event.target.value || null;
                  const match = (pickerData.neonOrganizations ?? []).find(
                    (org) => org.id === value,
                  );
                  onSelect('neonOrgId', value);
                  onExtraSelect?.('neonOrgName', match?.name ?? null);
                }}
              >
                <option value="">
                  {pickerData.neonOrganizations === null
                    ? 'Loading organizations…'
                    : pickerData.neonOrganizationsError
                      ? `Error: ${pickerData.neonOrganizationsError}`
                      : pickerData.neonOrganizations.length === 0
                        ? 'Personal account (no organizations)'
                        : 'Personal account'}
                </option>
                {(pickerData.neonOrganizations ?? []).map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                    {org.handle ? ` (${org.handle})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>New project name</span>
              <input
                type="text"
                placeholder="e.g. my-builder-db"
                value={selections.neonProjectName ?? ''}
                onChange={(event) => onSetNeonProjectName?.(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              onClick={onProvisionNeon}
              disabled={neonState?.status === 'running' || !selections.neonProjectName?.trim()}
            >
              {neonState?.status === 'running'
                ? 'Creating project + key…'
                : selections.neonOrgId
                  ? 'Create project & mint org-wide key'
                  : 'Create project & mint key'}
            </Button>
          </div>
        )}
        {neonState?.status === 'error' && neonState.message ? (
          <p className="app-builder-route__picker-hint">{neonState.message}</p>
        ) : null}
      </div>
    );
  }

  if (!service.selectionKey) return null;
  if (!credsFilled(service, credentials)) return null;

  if (service.slot === 'fly') {
    const listLoaded = pickerData.flyApps !== null && !pickerData.flyError;
    const apps = pickerData.flyApps ?? [];
    return (
      <div className="app-builder-route__picker">
        <label>
          <span>Fly app</span>
          {listLoaded && apps.length > 0 ? (
            <select
              value={selections.flyApp ?? ''}
              onChange={(event) => onSelect('flyApp', event.target.value || null)}
            >
              <option value="">Select a Fly app</option>
              {apps.map((app) => (
                <option key={app.name} value={app.name}>
                  {app.name}
                  {app.organizationSlug ? ` (${app.organizationSlug})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder={
                pickerData.flyApps === null
                  ? 'Loading apps…'
                  : 'Type the Fly app name (e.g. my-app-building-workers)'
              }
              value={selections.flyApp ?? ''}
              onChange={(event) => onSelect('flyApp', event.target.value.trim() || null)}
            />
          )}
        </label>
        {pickerData.flyError ? (
          <p className="app-builder-route__picker-hint">{pickerData.flyError}</p>
        ) : null}
      </div>
    );
  }

  if (service.slot === 'netlify') {
    return (
      <div className="app-builder-route__picker">
        <label>
          <span>Netlify account</span>
          <select
            value={selections.netlifyAccountSlug ?? ''}
            onChange={(event) => onSelect('netlifyAccountSlug', event.target.value || null)}
          >
            <option value="">
              {pickerData.netlifyAccounts === null
                ? 'Loading accounts…'
                : pickerData.netlifyError
                  ? `Error: ${pickerData.netlifyError}`
                  : pickerData.netlifyAccounts.length === 0
                    ? 'No accounts found'
                    : 'Select an account'}
            </option>
            {(pickerData.netlifyAccounts ?? []).map((account) => (
              <option key={account.slug ?? account.id} value={account.slug ?? ''}>
                {account.name ?? account.slug ?? account.id}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (service.slot === 'infisical') {
    const selectedProject = pickerData.infisicalProjects?.find(
      (project) => project.id === selections.infisicalProjectId,
    );
    const environments = selectedProject?.environments ?? [];
    return (
      <div className="app-builder-route__picker app-builder-route__picker--two">
        <label>
          <span>Project</span>
          <select
            value={selections.infisicalProjectId ?? ''}
            onChange={(event) => {
              onSelect('infisicalProjectId', event.target.value || null);
              onExtraSelect?.('infisicalEnvironment', null);
            }}
          >
            <option value="">
              {pickerData.infisicalProjects === null
                ? 'Loading projects…'
                : pickerData.infisicalError
                  ? `Error: ${pickerData.infisicalError}`
                  : pickerData.infisicalProjects.length === 0
                    ? 'No projects found'
                    : 'Select a project'}
            </option>
            {(pickerData.infisicalProjects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Environment</span>
          <select
            value={selections.infisicalEnvironment ?? ''}
            onChange={(event) => onExtraSelect?.('infisicalEnvironment', event.target.value || null)}
            disabled={!selectedProject}
          >
            <option value="">
              {!selectedProject ? 'Pick a project first' : 'Select an environment'}
            </option>
            {environments.map((env) =>
              env.slug ? (
                <option key={env.slug} value={env.slug}>
                  {env.name ?? env.slug}
                </option>
              ) : null,
            )}
          </select>
        </label>
      </div>
    );
  }

  return null;
}

function ServiceRows({
  credentials,
  selections,
  pickerData,
  pendingSlot,
  lastOutput,
  neonState,
  neonLogin,
  onLogin,
  onLogout,
  onSelect,
  onProvisionNeon,
  onSetNeonProjectName,
  onSetNeonPaste,
  onSubmitNeonPaste,
  onCancelNeonLogin,
}: {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  pickerData: PickerData;
  pendingSlot: ServiceSlot | null;
  lastOutput: { slot: ServiceSlot; output: string } | null;
  neonState: NeonProvisionState;
  neonLogin: NeonLoginState;
  onLogin: (slot: ServiceSlot) => void;
  onLogout: (slot: ServiceSlot) => void;
  onSelect: (key: keyof AppBuilderSelections, value: string | null) => void;
  onProvisionNeon: () => void;
  onSetNeonProjectName: (value: string) => void;
  onSetNeonPaste: (value: string) => void;
  onSubmitNeonPaste: () => void;
  onCancelNeonLogin: () => void;
}) {
  return (
    <div className="app-builder-route__service-grid">
      {SERVICES.map((service) => {
        const signedIn = credsFilled(service, credentials);
        const ready = isServiceReady(service, credentials, selections);
        const pending = pendingSlot === service.slot;
        const cmd = SERVICE_COMMANDS[service.slot];
        return (
          <div key={service.slot} className="app-builder-route__service-row">
            <div className="app-builder-route__service-copy">
              <div className="app-builder-route__service-label">{service.label}</div>
              <p>{service.description}</p>
              <code className="app-builder-route__service-cmd">
                {signedIn ? cmd.logout : cmd.login}
              </code>
              <ServicePicker
                service={service}
                credentials={credentials}
                selections={selections}
                pickerData={pickerData}
                neonState={service.slot === 'neon' ? neonState : undefined}
                neonLogin={service.slot === 'neon' ? neonLogin : undefined}
                onSelect={onSelect}
                onExtraSelect={onSelect}
                onProvisionNeon={service.slot === 'neon' ? onProvisionNeon : undefined}
                onSetNeonProjectName={
                  service.slot === 'neon' ? onSetNeonProjectName : undefined
                }
                onSetNeonPaste={service.slot === 'neon' ? onSetNeonPaste : undefined}
                onSubmitNeonPaste={service.slot === 'neon' ? onSubmitNeonPaste : undefined}
                onCancelNeonLogin={service.slot === 'neon' ? onCancelNeonLogin : undefined}
              />
              {lastOutput && lastOutput.slot === service.slot ? (
                <pre className="app-builder-route__service-output">{lastOutput.output}</pre>
              ) : null}
            </div>
            <div className="app-builder-route__service-actions">
              <span className={`app-builder-route__pill ${ready ? 'is-active' : ''}`}>
                {ready ? 'Ready' : signedIn ? 'Needs selection' : 'Not signed in'}
              </span>
              <div className="app-builder-route__service-buttons">
                {signedIn ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onLogout(service.slot)}
                    disabled={pending}
                  >
                    {pending ? 'Running…' : 'Logout'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onLogin(service.slot)}
                    disabled={pending}
                  >
                    {pending ? 'Running…' : 'Login'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function maskValue(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(value.length - 8, 24))}${value.slice(-4)}`;
}

const CREDENTIAL_KEYS_DISPLAY_ORDER: readonly (keyof ExtractedCredentials)[] = [
  'GITHUB_TOKEN',
  'RECORD_REPLAY_API_KEY',
  'FLY_API_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'NEON_API_KEY',
  'NEON_ACCESS_TOKEN',
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
  'INFISICAL_ACCESS_TOKEN',
  'INFISICAL_DOMAIN',
  'ANTHROPIC_API_KEY',
];

function CredentialsPanel({
  credentials,
  selections,
}: {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      // ignore
    }
  };

  // Project-scoped Neon key takes precedence over the personal-api-key read from VFS.
  const envLines = CREDENTIAL_KEYS_DISPLAY_ORDER.map((key) => ({
    key,
    value:
      key === 'NEON_API_KEY' && selections.neonApiKey
        ? selections.neonApiKey
        : credentials[key],
  })).filter((row) => row.value);

  const selectionRows = [
    { key: 'FLY_APP', value: selections.flyApp },
    { key: 'NETLIFY_ACCOUNT_SLUG', value: selections.netlifyAccountSlug },
    { key: 'INFISICAL_PROJECT_ID', value: selections.infisicalProjectId },
    { key: 'INFISICAL_ENVIRONMENT', value: selections.infisicalEnvironment },
    { key: 'NEON_PROJECT_ID', value: selections.neonProjectId },
  ].filter((row) => row.value);

  const envDotEnv = [
    ...envLines.map((row) => `${row.key}=${row.value}`),
    ...selectionRows.map((row) => `${row.key}=${row.value}`),
  ].join('\n');

  return (
    <div className="app-builder-route__credentials">
      <div className="app-builder-route__credentials-header">
        <div>
          <p className="app-builder-route__eyebrow">Decrypted credentials</p>
          <h3>In-memory env vars</h3>
        </div>
        <div className="app-builder-route__credentials-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRevealAll((v) => !v)}
          >
            {revealAll ? 'Hide all' : 'Show all'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void copy('__all__', envDotEnv)}
          >
            {copiedKey === '__all__' ? 'Copied .env' : 'Copy as .env'}
          </Button>
        </div>
      </div>

      <ul className="app-builder-route__cred-table">
        {envLines.map(({ key, value }) => {
          const show = revealAll || revealed[key];
          const display = !value ? '' : show ? value : maskValue(value);
          return (
            <li key={key}>
              <span className="app-builder-route__cred-table-name">{key}</span>
              <code className="app-builder-route__cred-table-value">{display}</code>
              <div className="app-builder-route__cred-table-actions">
                <button
                  type="button"
                  onClick={() =>
                    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                >
                  {show ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={() => value && void copy(key, value)}
                  disabled={!value}
                >
                  {copiedKey === key ? 'Copied' : 'Copy'}
                </button>
              </div>
            </li>
          );
        })}
        {selectionRows.map(({ key, value }) => (
          <li key={key} className="is-selection">
            <span className="app-builder-route__cred-table-name">{key}</span>
            <code className="app-builder-route__cred-table-value">{value}</code>
            <div className="app-builder-route__cred-table-actions">
              <button
                type="button"
                onClick={() => value && void copy(key, value)}
                disabled={!value}
              >
                {copiedKey === key ? 'Copied' : 'Copy'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnthropicKeyAndSyncPanel({
  credentials,
  selections,
  syncState,
  onChangeAnthropicKey,
  onSync,
}: {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
  syncState: InfisicalSyncState;
  onChangeAnthropicKey: (value: string) => void;
  onSync: () => void;
}) {
  const vaultAnthropic = credentials.ANTHROPIC_API_KEY;
  const pastedAnthropic = selections.anthropicApiKey;
  const effectiveAnthropic = pastedAnthropic?.trim() || vaultAnthropic;

  const infisicalReady = Boolean(
    credentials.INFISICAL_ACCESS_TOKEN &&
      credentials.INFISICAL_DOMAIN &&
      selections.infisicalProjectId &&
      selections.infisicalEnvironment,
  );

  const entryCount = buildInfisicalSyncEntries(credentials, selections).length;
  const busy = syncState.status === 'syncing';
  const disabled = busy || !infisicalReady || entryCount === 0;

  const messageKind =
    syncState.status === 'error'
      ? 'error'
      : syncState.status === 'success' || syncState.status === 'syncing'
        ? 'info'
        : null;

  const keyPlaceholder = vaultAnthropic
    ? 'Paste to override the Claude OAuth token stored in your vault'
    : 'sk-ant-api03-…';

  return (
    <div className="app-builder-route__setup-card-section">
      <div className="app-builder-route__setup-card-header">
        <div>
          <p className="app-builder-route__eyebrow">Anthropic API key</p>
          <h2>Paste a key, then sync every secret to Infisical</h2>
        </div>
      </div>
      <p className="app-builder-route__picker-sub">
        The vault's <code>ANTHROPIC_API_KEY</code>{' '}
        {vaultAnthropic
          ? 'currently holds the Claude OAuth token decoded from .claude/.credentials.json — paste a real Anthropic API key here to override it before syncing.'
          : "is empty — paste your Anthropic API key here so it gets pushed alongside the other service secrets."}
      </p>
      <div className="app-builder-route__picker">
        <label>
          <span>ANTHROPIC_API_KEY</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={keyPlaceholder}
            value={pastedAnthropic ?? ''}
            onChange={(event) => onChangeAnthropicKey(event.target.value)}
          />
        </label>
        <p className="app-builder-route__picker-sub">
          {effectiveAnthropic ? (
            <>
              Will sync <code>ANTHROPIC_API_KEY</code> from{' '}
              {pastedAnthropic ? 'this input' : 'your vault'}.
            </>
          ) : (
            <>No Anthropic key available yet — paste one above or sign into Claude in the IDE.</>
          )}
        </p>
      </div>
      {!infisicalReady ? (
        <div className="app-builder-route__message app-builder-route__message--info">
          Before saving, sign into Infisical and pick a project + environment in the Infisical slot
          above. We push secrets via the Infisical access token from <code>infisical login</code>.
        </div>
      ) : null}
      {messageKind ? (
        <div
          className={`app-builder-route__message app-builder-route__message--${messageKind}`}
          role={syncState.status === 'error' ? 'alert' : undefined}
        >
          {syncState.message}
        </div>
      ) : null}
      <div className="app-builder-route__launch-row">
        <Button type="button" onClick={onSync} disabled={disabled}>
          {busy
            ? 'Syncing secrets…'
            : entryCount === 0
              ? 'Nothing to sync yet'
              : `Save & sync ${entryCount} secret${entryCount === 1 ? '' : 's'} to Infisical`}
        </Button>
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function AppBuilderScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [pendingSlot, setPendingSlot] = useState<ServiceSlot | null>(null);
  const [lastOutput, setLastOutput] = useState<{ slot: ServiceSlot; output: string } | null>(null);
  const [selections, setSelections] = useState<AppBuilderSelections>(() => readSelections());
  const [pickerData, setPickerData] = useState<PickerData>(emptyPickerData());
  const [neonProvision, setNeonProvision] = useState<NeonProvisionState>({
    status: 'idle',
    message: null,
  });
  const [neonLogin, setNeonLogin] = useState<NeonLoginState>(emptyNeonLoginState());
  const [infisicalSync, setInfisicalSync] = useState<InfisicalSyncState>({
    status: 'idle',
    message: null,
  });
  const containerRef = useRef<LightweightAppBuilderContainer | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const pickerFetchTokensRef = useRef<{
    fly: string | null;
    netlify: string | null;
    infisical: string | null;
    neonOrgs: string | null;
  }>({ fly: null, netlify: null, infisical: null, neonOrgs: null });

  useEffect(() => {
    writeSelections(selections);
  }, [selections]);

  const refreshCredentialsFromContainer = useCallback(() => {
    const holder = containerRef.current;
    if (!holder) return;
    const credentials = holder.readCurrentCredentials();
    setState((current) =>
      current.kind === 'ready' ? { ...current, credentials } : current,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supported = await isVaultSupported();
      if (cancelled) return;
      if (!supported) {
        setState({ kind: 'unsupported' });
        return;
      }
      setState(readScreenState());
    })();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEYCHAIN_STORAGE_KEY) return;
      setState((current) => (current.kind === 'ready' || current.kind === 'unlocking' ? current : readScreenState()));
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      unwatchRef.current?.();
      unwatchRef.current = null;
    };
  }, []);

  // Kick off picker fetches when the relevant tokens appear.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const { credentials } = state;
    const flyToken = credentials.FLY_API_TOKEN;
    const netlifyToken = credentials.NETLIFY_AUTH_TOKEN;
    const infisicalAccessToken = credentials.INFISICAL_ACCESS_TOKEN;
    const infisicalDomain = credentials.INFISICAL_DOMAIN;

    if (flyToken && pickerFetchTokensRef.current.fly !== flyToken) {
      pickerFetchTokensRef.current.fly = flyToken;
      void fetchFlyAppList(flyToken)
        .then((apps) => setPickerData((prev) => ({ ...prev, flyApps: apps, flyError: null })))
        .catch((error: unknown) => {
          const raw = getErrorMessage(error);
          const message = /Not authorized/i.test(raw)
            ? 'Fly token is scoped too narrowly to list apps. Use a personal access token (flyctl auth token) with org read access.'
            : raw;
          setPickerData((prev) => ({ ...prev, flyApps: [], flyError: message }));
        });
    }

    if (netlifyToken && pickerFetchTokensRef.current.netlify !== netlifyToken) {
      pickerFetchTokensRef.current.netlify = netlifyToken;
      void fetchNetlifyAccountList(netlifyToken)
        .then((accounts) =>
          setPickerData((prev) => ({ ...prev, netlifyAccounts: accounts, netlifyError: null })),
        )
        .catch((error: unknown) =>
          setPickerData((prev) => ({
            ...prev,
            netlifyAccounts: [],
            netlifyError: getErrorMessage(error),
          })),
        );
    }

    // Infisical projects need the short-lived OAuth bearer minted by `infisical login`
    // (the Universal Auth client/secret pair alone can't hit /projects without an exchange).
    if (infisicalAccessToken && infisicalDomain) {
      const fingerprint = `${infisicalDomain}|${infisicalAccessToken}`;
      if (pickerFetchTokensRef.current.infisical !== fingerprint) {
        pickerFetchTokensRef.current.infisical = fingerprint;
        void fetchInfisicalProjectList(infisicalAccessToken, infisicalDomain)
          .then((projects) =>
            setPickerData((prev) => ({
              ...prev,
              infisicalProjects: projects,
              infisicalError: null,
            })),
          )
          .catch((error: unknown) =>
            setPickerData((prev) => ({
              ...prev,
              infisicalProjects: [],
              infisicalError: getErrorMessage(error),
            })),
          );
      }
    } else if (pickerFetchTokensRef.current.infisical !== 'missing') {
      pickerFetchTokensRef.current.infisical = 'missing';
      setPickerData((prev) => ({
        ...prev,
        infisicalProjects: [],
        infisicalError: 'Run `infisical login` in the IDE first; the access token is what lets us list projects.',
      }));
    }

    const neonToken = credentials.NEON_ACCESS_TOKEN;
    if (neonToken && pickerFetchTokensRef.current.neonOrgs !== neonToken) {
      pickerFetchTokensRef.current.neonOrgs = neonToken;
      void listNeonOrganizations(neonToken)
        .then((orgs) =>
          setPickerData((prev) => ({
            ...prev,
            neonOrganizations: orgs,
            neonOrganizationsError: null,
          })),
        )
        .catch((error: unknown) =>
          setPickerData((prev) => ({
            ...prev,
            neonOrganizations: [],
            neonOrganizationsError: getErrorMessage(error),
          })),
        );
    }
  }, [state]);

  const handleUnlock = useCallback(async () => {
    const vault = readStoredVault();
    if (!vault) {
      setState({ kind: 'no-vault' });
      return;
    }
    setState({ kind: 'unlocking' });
    try {
      const result = await unlockVault(vault);
      const credentials = extractCredentials(result.files);
      const holder = createLightweightAppBuilderContainer(result.files);
      containerRef.current = holder;

      unwatchRef.current?.();
      unwatchRef.current = holder.watch(
        [
          '/home/user/.config/gh/hosts.yml',
          '/home/user/.replay/auth.json',
          '/home/user/.config/netlify/config.json',
          '/home/user/.netlify/config.json',
          '/home/user/.config/neonctl/credentials.json',
          '/home/user/.infisical/infisical-config.json',
          '/home/user/.infisical/auth.json',
          '/home/user/.fly/config.yml',
          '/home/user/.claude/.credentials.json',
        ],
        refreshCredentialsFromContainer,
      );

      setState({ kind: 'ready', credentials });
    } catch (error) {
      setState({ kind: 'error', message: getErrorMessage(error) });
    }
  }, [refreshCredentialsFromContainer]);

  const handleForget = useCallback(() => {
    forgetStoredVault();
    setState({ kind: 'no-vault' });
  }, []);

  const runServiceCommand = useCallback(
    async (slot: ServiceSlot, command: string) => {
      const holder = containerRef.current;
      if (!holder) return;
      setPendingSlot(slot);
      setLastOutput(null);
      try {
        const result = await holder.runCommand(command);
        const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        setLastOutput({
          slot,
          output: combined || `exited with code ${result.exitCode}`,
        });
        refreshCredentialsFromContainer();
      } catch (error) {
        setLastOutput({ slot, output: getErrorMessage(error) });
      } finally {
        setPendingSlot(null);
      }
    },
    [refreshCredentialsFromContainer],
  );

  const handleStartNeonLogin = useCallback(async () => {
    setNeonLogin({ pending: null, pasteValue: '', submitting: false, error: null });
    try {
      const pending = await startNeonManualLogin();
      setNeonLogin({ pending, pasteValue: '', submitting: false, error: null });
      try {
        window.open(pending.authorizationUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // Popup blocked — the link in the UI is still clickable.
      }
    } catch (error) {
      setNeonLogin({
        pending: null,
        pasteValue: '',
        submitting: false,
        error: getErrorMessage(error),
      });
    }
  }, []);

  const handleCancelNeonLogin = useCallback(() => {
    setNeonLogin(emptyNeonLoginState());
  }, []);

  const handleSetNeonPaste = useCallback((value: string) => {
    setNeonLogin((prev) => ({ ...prev, pasteValue: value, error: null }));
  }, []);

  const handleSubmitNeonPaste = useCallback(async () => {
    const holder = containerRef.current;
    if (!holder) return;
    const pending = neonLogin.pending;
    if (!pending) return;
    setNeonLogin((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      const creds = await completeNeonManualLogin(pending, neonLogin.pasteValue);
      const vfs = holder.container.vfs;
      const path = '/home/user/.config/neonctl/credentials.json';
      const dir = path.slice(0, path.lastIndexOf('/')) || '/';
      if (dir !== '/' && !vfs.existsSync(dir)) {
        vfs.mkdirSync(dir, { recursive: true });
      }
      vfs.writeFileSync(path, JSON.stringify(creds, null, 2));
      refreshCredentialsFromContainer();
      setNeonLogin(emptyNeonLoginState());
    } catch (error) {
      setNeonLogin((prev) => ({
        ...prev,
        submitting: false,
        error: getErrorMessage(error),
      }));
    }
  }, [neonLogin.pending, neonLogin.pasteValue, refreshCredentialsFromContainer]);

  const handleLogin = useCallback(
    (slot: ServiceSlot) => {
      if (slot === 'neon') {
        // Neon's OAuth loopback can't round-trip inside the browser, so we use the
        // manual paste-callback flow instead of shelling out to `neon auth login`.
        void handleStartNeonLogin();
        return;
      }
      void runServiceCommand(slot, SERVICE_COMMANDS[slot].login);
    },
    [runServiceCommand, handleStartNeonLogin],
  );

  const handleLogout = useCallback(
    (slot: ServiceSlot) => void runServiceCommand(slot, SERVICE_COMMANDS[slot].logout),
    [runServiceCommand],
  );

  const handleSelect = useCallback(
    (key: keyof AppBuilderSelections, value: string | null) => {
      setSelections((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleProvisionNeon = useCallback(async () => {
    if (state.kind !== 'ready') return;
    const accessToken = state.credentials.NEON_ACCESS_TOKEN;
    if (!accessToken) {
      setNeonProvision({
        status: 'error',
        message:
          'No Neon access token in memory. Run `neon auth login` first so the provisioner can authenticate.',
      });
      return;
    }
    const projectName = selections.neonProjectName?.trim();
    if (!projectName) {
      setNeonProvision({ status: 'error', message: 'Enter a project name first.' });
      return;
    }
    setNeonProvision({ status: 'running', message: null });
    try {
      const result = await provisionNeonProjectAndKey(accessToken, {
        projectName,
        orgId: selections.neonOrgId,
        keyName: `${projectName}-app-builder`,
      });
      setSelections((prev) => ({
        ...prev,
        neonProjectId: result.project.id,
        neonProjectName: result.project.name,
        neonApiKey: result.apiKey.key,
        neonOrgId: result.orgId ?? prev.neonOrgId,
      }));
      setNeonProvision({ status: 'idle', message: null });
    } catch (error) {
      setNeonProvision({ status: 'error', message: getErrorMessage(error) });
    }
  }, [state, selections.neonProjectName, selections.neonOrgId]);

  const handleSetAnthropicKey = useCallback((value: string) => {
    const trimmed = value.trim();
    setSelections((prev) => ({
      ...prev,
      anthropicApiKey: trimmed ? trimmed : null,
    }));
    setInfisicalSync((prev) =>
      prev.status === 'error' || prev.status === 'success'
        ? { status: 'idle', message: null }
        : prev,
    );
  }, []);

  const handleSyncToInfisical = useCallback(async () => {
    if (state.kind !== 'ready') return;
    const { credentials } = state;
    const domain = credentials.INFISICAL_DOMAIN;
    const token = credentials.INFISICAL_ACCESS_TOKEN;
    const projectId = selections.infisicalProjectId;
    const environment = selections.infisicalEnvironment;

    if (!domain || !token) {
      setInfisicalSync({
        status: 'error',
        message:
          'Sign into Infisical first — run `infisical login` in the IDE so we have an access token.',
      });
      return;
    }
    if (!projectId || !environment) {
      setInfisicalSync({
        status: 'error',
        message: 'Pick an Infisical project and environment above before syncing.',
      });
      return;
    }

    const entries = buildInfisicalSyncEntries(credentials, selections);
    if (entries.length === 0) {
      setInfisicalSync({
        status: 'error',
        message: 'No secrets to sync yet — sign into at least one service or paste an Anthropic key.',
      });
      return;
    }

    setInfisicalSync({
      status: 'syncing',
      message: `Syncing ${entries.length} secret${entries.length === 1 ? '' : 's'} to ${environment} • /global…`,
    });

    try {
      await ensureInfisicalFolder({
        domain,
        token,
        projectId,
        environment,
        secretPath: '/global',
      });
    } catch (error) {
      setInfisicalSync({
        status: 'error',
        message: `Couldn't prepare /global folder: ${getErrorMessage(error)}`,
      });
      return;
    }

    let created = 0;
    let updated = 0;
    const failures: string[] = [];
    for (const entry of entries) {
      try {
        const result = await upsertInfisicalSecret({
          domain,
          token,
          projectId,
          environment,
          key: entry.key,
          value: entry.value,
          secretPath: '/global',
        });
        if (result === 'created') created += 1;
        else updated += 1;
      } catch (error) {
        failures.push(`${entry.key}: ${getErrorMessage(error)}`);
      }
    }

    if (failures.length === 0) {
      setInfisicalSync({
        status: 'success',
        message: `Synced ${entries.length} secret${entries.length === 1 ? '' : 's'} to ${environment} • /global (${created} created, ${updated} updated).`,
      });
    } else if (failures.length === entries.length) {
      setInfisicalSync({
        status: 'error',
        message: `Sync failed: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`,
      });
    } else {
      setInfisicalSync({
        status: 'error',
        message: `Synced ${entries.length - failures.length}/${entries.length}. First failure — ${failures[0]}`,
      });
    }
  }, [state, selections]);

  const allServicesReady = useMemo(() => {
    if (state.kind !== 'ready') return false;
    return SERVICES.every((service) => isServiceReady(service, state.credentials, selections));
  }, [state, selections]);

  const handleLaunchBuilder = useCallback(() => {
    // The builder lives inline in this page — no iframe, no separate template bundle.
    setState((current) =>
      current.kind === 'ready'
        ? { kind: 'launched', credentials: current.credentials }
        : current,
    );
  }, []);

  const handleBackFromLaunched = useCallback(() => {
    const holder = containerRef.current;
    if (holder) {
      setState({ kind: 'ready', credentials: holder.readCurrentCredentials() });
    } else {
      setState(readScreenState());
    }
  }, []);

  return (
    <div className="app-builder-route app-builder-route--standalone">
      <div className="app-builder-route__standalone-shell">
        <header className="app-builder-route__standalone-header">
          <p className="app-builder-route__eyebrow">Standalone workflow</p>
          <h1>App builder sign-in</h1>
          <p className="app-builder-route__lede">
            Decrypts your saved sign-ins with a passkey, runs auth commands and fetches account
            lists in a lightweight internal almostnode runtime (no full IDE), and opens the builder inline
            once every service is ready.
          </p>
        </header>

        {state.kind === 'loading' ? (
          <div className="app-builder-route__setup-card">
            <p>Checking for saved credentials…</p>
          </div>
        ) : null}

        {state.kind === 'unsupported' ? (
          <div className="app-builder-route__setup-card">
            <h2>WebAuthn PRF isn't available in this browser</h2>
            <p>
              The keychain uses WebAuthn's PRF extension to derive the decryption key. Try the
              latest Chrome or Safari on a device with a platform passkey.
            </p>
          </div>
        ) : null}

        {state.kind === 'no-vault' ? (
          <div className="app-builder-route__setup-card">
            <div className="app-builder-route__unlock-card app-builder-route__unlock-card--hint">
              <div className="app-builder-route__unlock-copy">
                <p className="app-builder-route__eyebrow">No saved keychain yet</p>
                <h3>Save your IDE sign-ins first</h3>
                <p>
                  Open the IDE, sign into every service, then click <strong>Save with passkey</strong>
                  in the keychain banner. This page will pick up the vault automatically.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => navigate({ to: '/ide' })}>
                Open IDE
              </Button>
            </div>
          </div>
        ) : null}

        {state.kind === 'locked' || state.kind === 'unlocking' ? (
          <div className="app-builder-route__setup-card">
            <div className="app-builder-route__unlock-card">
              <div className="app-builder-route__unlock-copy">
                <p className="app-builder-route__eyebrow">Saved keychain detected</p>
                <h3>Unlock with your passkey</h3>
                <p>
                  We'll prompt for your platform passkey, derive a key via WebAuthn PRF, and
                  decrypt the vault in memory.
                </p>
              </div>
              <div className="app-builder-route__unlock-actions">
                <Button
                  type="button"
                  onClick={() => void handleUnlock()}
                  disabled={state.kind === 'unlocking'}
                >
                  {state.kind === 'unlocking' ? 'Waiting for passkey…' : 'Unlock with passkey'}
                </Button>
                <Button type="button" variant="ghost" onClick={handleForget}>
                  Forget vault
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className="app-builder-route__setup-card">
            <div className="app-builder-route__message app-builder-route__message--error">
              {state.message}
            </div>
            <div className="app-builder-route__unlock-actions">
              <Button type="button" onClick={() => void handleUnlock()}>
                Retry unlock
              </Button>
            </div>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="app-builder-route__standalone-grid">
            <div className="app-builder-route__setup-card">
              <div className="app-builder-route__setup-card-header">
                <div>
                  <p className="app-builder-route__eyebrow">Services</p>
                  <h2>Sign into every service</h2>
                </div>
              </div>
              <ServiceRows
                credentials={state.credentials}
                selections={selections}
                pickerData={pickerData}
                pendingSlot={pendingSlot}
                lastOutput={lastOutput}
                neonState={neonProvision}
                neonLogin={neonLogin}
                onLogin={handleLogin}
                onLogout={handleLogout}
                onSelect={handleSelect}
                onProvisionNeon={() => void handleProvisionNeon()}
                onSetNeonProjectName={(value) =>
                  setSelections((prev) => ({ ...prev, neonProjectName: value || null }))
                }
                onSetNeonPaste={handleSetNeonPaste}
                onSubmitNeonPaste={() => void handleSubmitNeonPaste()}
                onCancelNeonLogin={handleCancelNeonLogin}
              />
              <AnthropicKeyAndSyncPanel
                credentials={state.credentials}
                selections={selections}
                syncState={infisicalSync}
                onChangeAnthropicKey={handleSetAnthropicKey}
                onSync={() => void handleSyncToInfisical()}
              />
              <div className="app-builder-route__launch-row">
                <Button
                  type="button"
                  onClick={handleLaunchBuilder}
                  disabled={!allServicesReady}
                >
                  {allServicesReady ? 'Launch builder' : 'Finish sign-ins to launch'}
                </Button>
              </div>
            </div>
            <ProgressSidebar
              credentials={state.credentials}
              selections={selections}
              pendingSlot={pendingSlot}
            />
          </div>
        ) : null}

        {state.kind === 'launched' ? (
          <div className="app-builder-route__inline-builder">
            <div className="app-builder-route__setup-card-header">
              <div>
                <p className="app-builder-route__eyebrow">Control plane</p>
                <h2>App builder</h2>
              </div>
              <Button type="button" variant="ghost" onClick={handleBackFromLaunched}>
                ← Sign-ins & credentials
              </Button>
            </div>
            <ControlPlaneView credentials={state.credentials} selections={selections} />
            <FlyLogsPanel
              appName={selections.flyApp}
              token={state.credentials.FLY_API_TOKEN}
              label={selections.flyApp ? `app ${selections.flyApp}` : undefined}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
