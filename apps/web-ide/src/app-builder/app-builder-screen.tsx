import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  normalizeAppBuildingSetupDraft,
  readAppBuildingSetup,
  validateAppBuildingSetupDraft,
  type AppBuildingSetupDraft,
} from '../features/app-building-setup';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type WebIDEHost = import('../workbench/workbench-host').WebIDEHost;

const ACTIVE_PROJECT_STORAGE_KEY = 'almostnode-active-project-id';
const APP_BUILDER_PROJECT_ID = 'almostnode-app-builder';

type BootState = 'booting' | 'ready' | 'error';
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';

type ServiceSlot = 'github' | 'replay' | 'infisical' | 'fly' | 'netlify' | 'neon';

interface ServiceDescriptor {
  slot: ServiceSlot;
  label: string;
  description: string;
  loginMethod: keyof Pick<
    WebIDEHost,
    'loginToGithub' | 'loginToReplay' | 'loginToInfisical' | 'loginToFly' | 'loginToNetlify' | 'loginToNeon'
  >;
}

const SERVICES: readonly ServiceDescriptor[] = [
  { slot: 'github', label: 'GitHub', description: 'Repository access for cloning and pushing builder output.', loginMethod: 'loginToGithub' },
  { slot: 'replay', label: 'Replay', description: 'Replay recordings and debug sessions during app building.', loginMethod: 'loginToReplay' },
  { slot: 'infisical', label: 'Infisical', description: 'Shared secrets pulled by remote app-building workers.', loginMethod: 'loginToInfisical' },
  { slot: 'fly', label: 'Fly.io', description: 'Launches and deploys worker VMs for the builder.', loginMethod: 'loginToFly' },
  { slot: 'netlify', label: 'Netlify', description: 'Preview deployments for generated apps.', loginMethod: 'loginToNetlify' },
  { slot: 'neon', label: 'Neon', description: 'Serverless Postgres provisioning for generated apps.', loginMethod: 'loginToNeon' },
];

type ServiceSignedInMap = Record<ServiceSlot, boolean>;

function initialServiceSignedInMap(): ServiceSignedInMap {
  return {
    github: false,
    replay: false,
    infisical: false,
    fly: false,
    netlify: false,
    neon: false,
  };
}

function readAllSignedIn(host: WebIDEHost): ServiceSignedInMap {
  const next = initialServiceSignedInMap();
  for (const service of SERVICES) {
    next[service.slot] = host.isServiceSignedIn(service.slot);
  }
  return next;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ServiceSignInGrid({
  signedIn,
  pendingSlot,
  onLogin,
}: {
  signedIn: ServiceSignedInMap;
  pendingSlot: ServiceSlot | null;
  onLogin: (service: ServiceDescriptor) => void;
}) {
  return (
    <div className="app-builder-route__service-grid">
      {SERVICES.map((service) => {
        const isSignedIn = signedIn[service.slot];
        const isPending = pendingSlot === service.slot;
        return (
          <div key={service.slot} className="app-builder-route__service-row">
            <div className="app-builder-route__service-copy">
              <div className="app-builder-route__service-label">{service.label}</div>
              <p>{service.description}</p>
            </div>
            <div className="app-builder-route__service-actions">
              <span className={`app-builder-route__pill ${isSignedIn ? 'is-active' : ''}`}>
                {isSignedIn ? 'Signed in' : 'Not signed in'}
              </span>
              <Button type="button" onClick={() => onLogin(service)} disabled={isPending}>
                {isPending
                  ? 'Opening login...'
                  : isSignedIn
                    ? `Re-authenticate ${service.label}`
                    : `Login to ${service.label}`}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BuilderSetupForm({
  draft,
  signedIn,
  pendingSlot,
  savePending,
  setupError,
  notice,
  showCancel,
  onCancel,
  onFieldChange,
  onLogin,
  onSave,
}: {
  draft: AppBuildingSetupDraft;
  signedIn: ServiceSignedInMap;
  pendingSlot: ServiceSlot | null;
  savePending: boolean;
  setupError: string | null;
  notice: string | null;
  showCancel?: boolean;
  onCancel?: () => void;
  onFieldChange: (field: keyof AppBuildingSetupDraft, value: string) => void;
  onLogin: (service: ServiceDescriptor) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="app-builder-route__setup-form" onSubmit={onSave}>
      <div className="app-builder-route__step">
        <div className="app-builder-route__step-index">01</div>
        <div className="app-builder-route__step-copy">
          <h2>Sign in to every app-building service</h2>
          <p>
            App building talks to GitHub, Replay, Infisical, Fly.io, Netlify, and Neon. Each login stores
            credentials in the shared keychain and unlocks the builder surface once all six are green.
          </p>
        </div>
      </div>

      <ServiceSignInGrid signedIn={signedIn} pendingSlot={pendingSlot} onLogin={onLogin} />

      <div className="app-builder-route__step">
        <div className="app-builder-route__step-index">02</div>
        <div className="app-builder-route__step-copy">
          <h2>Builder configuration</h2>
          <p>
            Remote worker launches still need the shared Fly app, deploy token, and Infisical machine
            identity. Workers default to cloning `replayio/app-building` into `/app`.
          </p>
        </div>
      </div>

      <div className="app-builder-route__field-grid">
        <label className="app-builder-route__field">
          <span>Shared Fly app</span>
          <Input
            placeholder="my-app-building-workers"
            value={draft.flyAppName}
            onChange={(event) => onFieldChange('flyAppName', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field">
          <span>Fly deploy token</span>
          <Input
            placeholder="FlyV1 ... or raw token"
            type="password"
            autoComplete="off"
            value={draft.flyApiToken}
            onChange={(event) => onFieldChange('flyApiToken', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field">
          <span>Infisical client ID</span>
          <Input
            placeholder="universal-auth client id"
            value={draft.infisicalClientId}
            onChange={(event) => onFieldChange('infisicalClientId', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field">
          <span>Infisical client secret</span>
          <Input
            placeholder="universal-auth client secret"
            type="password"
            autoComplete="off"
            value={draft.infisicalClientSecret}
            onChange={(event) => onFieldChange('infisicalClientSecret', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field">
          <span>Infisical project ID</span>
          <Input
            placeholder="project id"
            value={draft.infisicalProjectId}
            onChange={(event) => onFieldChange('infisicalProjectId', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field">
          <span>Infisical environment</span>
          <Input
            placeholder="prod"
            value={draft.infisicalEnvironment}
            onChange={(event) => onFieldChange('infisicalEnvironment', event.target.value)}
          />
        </label>

        <label className="app-builder-route__field app-builder-route__field--full">
          <span>Worker image ref</span>
          <Input
            placeholder="ghcr.io/replayio/app-building:latest"
            value={draft.imageRef}
            onChange={(event) => onFieldChange('imageRef', event.target.value)}
          />
        </label>
      </div>

      {notice ? (
        <div className="app-builder-route__message app-builder-route__message--info">
          {notice}
        </div>
      ) : null}

      {setupError ? (
        <div className="app-builder-route__message app-builder-route__message--error">
          {setupError}
        </div>
      ) : null}

      <div className="app-builder-route__setup-actions">
        {showCancel && onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={savePending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={savePending}>
          {savePending ? 'Saving setup...' : 'Save builder setup'}
        </Button>
      </div>
    </form>
  );
}

export function AppBuilderScreen() {
  const navigate = useNavigate();
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<WebIDEHost | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previousProjectIdRef = useRef<string | null>(null);

  const [bootState, setBootState] = useState<BootState>('booting');
  const [bootError, setBootError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState<ServiceSignedInMap>(initialServiceSignedInMap());
  const [savedSetup, setSavedSetup] = useState<AppBuildingSetupDraft>(normalizeAppBuildingSetupDraft());
  const [setupDraft, setSetupDraft] = useState<AppBuildingSetupDraft>(normalizeAppBuildingSetupDraft());
  const [setupOpen, setSetupOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<ServiceSlot | null>(null);
  const [savePending, setSavePending] = useState(false);

  const savedSetupValid = useMemo(
    () => validateAppBuildingSetupDraft(savedSetup) === null,
    [savedSetup],
  );
  const allServicesSignedIn = useMemo(
    () => SERVICES.every((service) => signedIn[service.slot]),
    [signedIn],
  );
  const builderReady = bootState === 'ready' && allServicesSignedIn && savedSetupValid;

  useEffect(() => {
    const workbenchElement = workbenchRef.current;
    if (!workbenchElement) {
      return;
    }

    let cancelled = false;

    document.body.classList.add('ide-active');
    try {
      previousProjectIdRef.current = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, APP_BUILDER_PROJECT_ID);
    } catch {
      previousProjectIdRef.current = null;
    }

    setBootState('booting');
    setPreviewState('loading');
    setPreviewError(null);

    void import('../workbench/workbench-host').then(({ WebIDEHost }) => WebIDEHost.bootstrap({
      elements: { workbench: workbenchElement },
      template: 'app-building',
      previewMode: 'external',
    })).then(async (host) => {
      if (cancelled) {
        host.registerExternalPreviewWindow(null);
        return;
      }

      hostRef.current = host;
      host.setActiveProjectId(APP_BUILDER_PROJECT_ID);

      const persistedSetup = normalizeAppBuildingSetupDraft(readAppBuildingSetup(host.getVfs()));
      setSavedSetup(persistedSetup);
      setSetupDraft(persistedSetup);
      setSignedIn(readAllSignedIn(host));
      setBootState('ready');

      try {
        const nextPreviewUrl = await host.ensurePreviewServerReady(30_000);
        if (cancelled) {
          return;
        }
        setPreviewUrl(nextPreviewUrl);
        setPreviewState('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPreviewState('error');
        setPreviewError(getErrorMessage(error));
      }
    }).catch((error) => {
      if (cancelled) {
        return;
      }
      setBootState('error');
      setPreviewState('error');
      setBootError(getErrorMessage(error));
    });

    return () => {
      cancelled = true;
      hostRef.current?.registerExternalPreviewWindow(null);
      try {
        if (previousProjectIdRef.current) {
          localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, previousProjectIdRef.current);
        } else {
          localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
        }
      } catch {
        // Ignore storage cleanup issues.
      }
      document.body.classList.remove('ide-active');
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const iframe = iframeRef.current;
    if (!host || !iframe || !builderReady || !previewUrl) {
      return;
    }

    host.registerExternalPreviewWindow(iframe.contentWindow);
    return () => {
      host.registerExternalPreviewWindow(null);
    };
  }, [builderReady, previewUrl]);

  useEffect(() => {
    setFrameLoaded(false);
  }, [previewUrl]);

  const updateField = (field: keyof AppBuildingSetupDraft, value: string) => {
    setSetupDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const openSetup = () => {
    setSetupDraft(savedSetup);
    setSetupError(null);
    setNotice(null);
    setSetupOpen(true);
  };

  const closeSetup = () => {
    setSetupDraft(savedSetup);
    setSetupError(null);
    setNotice(null);
    setSetupOpen(false);
  };

  const retryPreview = async () => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    setPreviewState('loading');
    setPreviewError(null);

    try {
      const nextPreviewUrl = await host.ensurePreviewServerReady(30_000);
      setPreviewUrl(nextPreviewUrl);
      setPreviewState('ready');
    } catch (error) {
      setPreviewState('error');
      setPreviewError(getErrorMessage(error));
    }
  };

  const handleLogin = async (service: ServiceDescriptor) => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    setPendingSlot(service.slot);
    setNotice(null);

    try {
      const method = host[service.loginMethod].bind(host) as () => Promise<void>;
      await method();
      const nextSignedIn = readAllSignedIn(host);
      setSignedIn(nextSignedIn);
      if (!nextSignedIn[service.slot]) {
        setNotice(`${service.label} login did not complete. If the keychain banner asked you to unlock first, finish that step and retry.`);
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setPendingSlot(null);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const host = hostRef.current;
    if (!host) {
      return;
    }

    const normalized = normalizeAppBuildingSetupDraft(setupDraft);
    const validationError = validateAppBuildingSetupDraft(normalized);
    if (validationError) {
      setSetupError(validationError);
      return;
    }

    setSavePending(true);
    setSetupError(null);
    setNotice(null);

    try {
      await host.saveAppBuildingSetup(normalized);
      setSavedSetup(normalized);
      setSetupDraft(normalized);
      setSetupOpen(false);
      if (!previewUrl || previewState === 'error') {
        await retryPreview();
      }
    } catch (error) {
      setSetupError(getErrorMessage(error));
    } finally {
      setSavePending(false);
    }
  };

  const handleFinish = () => {
    void navigate({ to: '/projects' });
  };

  if (bootState === 'error') {
    return (
      <div className="app-builder-route app-builder-route--centered">
        <div className="app-builder-route__error-card">
          <p className="app-builder-route__eyebrow">App Builder</p>
          <h1>Couldn&apos;t start the runtime</h1>
          <p>{bootError || 'The app-builder host failed to boot.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-builder-route">
      <div className="app-builder-route__host-shell">
        <div id="appBuilderWorkbench" ref={workbenchRef} className="app-builder-route__hidden-workbench" />
      </div>

      {builderReady ? (
        <div className="app-builder-route__preview-shell">
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              title="App Builder"
              src={previewUrl}
              className="app-builder-route__frame"
              onLoad={() => {
                setFrameLoaded(true);
                hostRef.current?.registerExternalPreviewWindow(iframeRef.current?.contentWindow ?? null);
              }}
            />
          ) : null}

          <div className="app-builder-route__floating-bar">
            <div>
              <p className="app-builder-route__floating-label">App Builder</p>
              <span className="app-builder-route__floating-status">
                {previewState === 'ready' ? 'Template preview live' : 'Preparing template preview'}
              </span>
            </div>
            <div className="app-builder-route__floating-actions">
              <Button variant="outline" size="sm" onClick={openSetup}>
                Builder settings
              </Button>
              <Button size="sm" onClick={handleFinish}>
                Finish &amp; open projects
              </Button>
            </div>
          </div>

          {(previewState !== 'ready' || !frameLoaded) ? (
            <div className="app-builder-route__preview-overlay">
              <p className="app-builder-route__eyebrow">Launching preview</p>
              <h1>Starting the app-building template</h1>
              <p>
                {previewState === 'error'
                  ? (previewError || 'The preview server did not become ready.')
                  : 'Booting the builder workspace and attaching the standalone iframe.'}
              </p>
              {previewState === 'error' ? (
                <Button onClick={() => void retryPreview()}>
                  Retry preview
                </Button>
              ) : null}
            </div>
          ) : null}

          {setupOpen ? (
            <div className="app-builder-route__sheet-backdrop">
              <div className="app-builder-route__sheet">
                <div className="app-builder-route__sheet-header">
                  <div>
                    <p className="app-builder-route__eyebrow">Builder settings</p>
                    <h2>Update sign-ins or builder configuration</h2>
                  </div>
                  <Button variant="ghost" size="sm" onClick={closeSetup}>
                    Close
                  </Button>
                </div>
                <BuilderSetupForm
                  draft={setupDraft}
                  signedIn={signedIn}
                  pendingSlot={pendingSlot}
                  savePending={savePending}
                  setupError={setupError}
                  notice={notice}
                  showCancel
                  onCancel={closeSetup}
                  onFieldChange={updateField}
                  onLogin={(service) => void handleLogin(service)}
                  onSave={(event) => void handleSave(event)}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="app-builder-route__onboarding">
          <div className="app-builder-route__hero">
            <p className="app-builder-route__eyebrow">Standalone workflow</p>
            <h1>Run the app builder without the IDE chrome.</h1>
            <p className="app-builder-route__lede">
              This route keeps the builder runtime alive in the background, strips out the VS Code workbench,
              and promotes the app-building template to the entire screen once every service is signed in and
              the builder configuration is saved.
            </p>
            <div className="app-builder-route__hero-statuses">
              <span className={`app-builder-route__pill ${allServicesSignedIn ? 'is-active' : ''}`}>
                {allServicesSignedIn
                  ? 'All sign-ins complete'
                  : `${SERVICES.filter((service) => signedIn[service.slot]).length}/${SERVICES.length} signed in`}
              </span>
              <span className={`app-builder-route__pill ${savedSetupValid ? 'is-active' : ''}`}>
                {savedSetupValid ? 'Builder config saved' : 'Builder config required'}
              </span>
              <span className={`app-builder-route__pill ${previewState === 'ready' ? 'is-active' : ''}`}>
                {previewState === 'ready' ? 'Preview runtime warmed' : 'Preview warming'}
              </span>
            </div>
          </div>

          <div className="app-builder-route__setup-card">
            <div className="app-builder-route__setup-card-header">
              <div>
                <p className="app-builder-route__eyebrow">Onboarding</p>
                <h2>Authenticate and unlock the builder surface</h2>
              </div>
            </div>

            <BuilderSetupForm
              draft={setupDraft}
              signedIn={signedIn}
              pendingSlot={pendingSlot}
              savePending={savePending}
              setupError={setupError}
              notice={notice}
              onFieldChange={updateField}
              onLogin={(service) => void handleLogin(service)}
              onSave={(event) => void handleSave(event)}
            />

            {previewState === 'error' ? (
              <div className="app-builder-route__message app-builder-route__message--error">
                {previewError}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
