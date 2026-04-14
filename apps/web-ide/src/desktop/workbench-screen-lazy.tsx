import { lazy } from 'react';

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
};

let workbenchScreenPromise: ReturnType<typeof importWorkbenchScreen> | null = null;

function loadWorkbenchScreen() {
  workbenchScreenPromise ??= importWorkbenchScreen();
  return workbenchScreenPromise;
}

function importWorkbenchScreen() {
  return import('./workbench-screen');
}

export const LazyWorkbenchScreen = lazy(async () => {
  const module = await loadWorkbenchScreen();
  return { default: module.WorkbenchScreen };
});

export function preloadWorkbenchScreen() {
  return loadWorkbenchScreen();
}

export function scheduleWorkbenchScreenPreload(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const connection = (
    'connection' in navigator
      ? (navigator as Navigator & { connection?: NetworkInformationLike }).connection
      : undefined
  );
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
    return () => undefined;
  }

  let cancelled = false;
  let timeoutId = 0;
  let idleCallbackId = 0;

  const runPreload = () => {
    if (cancelled || document.visibilityState !== 'visible') {
      return;
    }
    void preloadWorkbenchScreen();
  };

  const scheduleIdlePreload = () => {
    if (cancelled) {
      return;
    }

    if ('requestIdleCallback' in window) {
      idleCallbackId = window.requestIdleCallback(runPreload, { timeout: 2000 });
      return;
    }

    timeoutId = window.setTimeout(runPreload, 1500);
  };

  const handleLoad = () => {
    window.removeEventListener('load', handleLoad);
    scheduleIdlePreload();
  };

  if (document.readyState === 'complete') {
    scheduleIdlePreload();
  } else {
    window.addEventListener('load', handleLoad, { once: true });
  }

  return () => {
    cancelled = true;
    window.removeEventListener('load', handleLoad);
    if (idleCallbackId && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleCallbackId);
    }
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  };
}
