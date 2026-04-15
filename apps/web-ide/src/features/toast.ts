// @ts-expect-error — no @types/react; works at runtime via Vite bundling
import { createElement } from 'react';
// @ts-ignore — no @types/react-dom; works at runtime via Vite bundling
import { createRoot } from 'react-dom/client';
// @ts-ignore — sonner types may not resolve without @types/react
import { Toaster, toast } from 'sonner';
import { describeClaudeImagePasteBlocker } from './claude-image-paste';

let mounted = false;

export function initToasts(container: HTMLElement): void {
  if (mounted) return;
  mounted = true;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;z-index:100000;';
  container.appendChild(el);
  createRoot(el).render(
    createElement(Toaster, {
      theme: 'dark',
      position: 'bottom-right',
      toastOptions: {
        style: {
          background: '#1a2233',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#e6edf7',
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
        },
      },
    }),
  );
}

export function showTestDetectedToast(opts: {
  onSave: (name: string) => void;
  onDismiss: () => void;
}): void {
  toast('Test actions detected', {
    description: 'Agent-driven UI actions can be saved as a replayable test.',
    action: {
      label: 'Save Test',
      onClick: () => {
        const name = prompt('Test name:', `test-${Date.now()}`);
        if (name) opts.onSave(name);
        else opts.onDismiss();
      },
    },
    duration: 30000,
    onDismiss: opts.onDismiss,
  });
}

export function showTestSavedToast(name: string, path: string): void {
  toast.success(`Test "${name}" saved`, {
    description: path,
    duration: 4000,
  });
}

export function showTestResultToast(name: string, passed: boolean, message?: string): void {
  if (passed) {
    toast.success(`Test "${name}" passed`, { duration: 3000 });
  } else {
    toast.error(`Test "${name}" failed`, {
      description: message,
      duration: 5000,
    });
  }
}

export function showClaudeImagePasteUnsupportedToast(
  mimeTypes: readonly string[],
): void {
  toast.error("Image paste isn't supported here yet", {
    description: describeClaudeImagePasteBlocker(mimeTypes),
    duration: 6000,
  });
}

export function showWorkbenchSuccessToast(
  title: string,
  description?: string,
): void {
  toast.success(title, {
    description,
    duration: 4000,
  });
}

export function showWorkbenchErrorToast(
  title: string,
  description?: string,
): void {
  toast.error(title, {
    description,
    duration: 6000,
  });
}
