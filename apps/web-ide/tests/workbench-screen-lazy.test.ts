import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const mockState = vi.hoisted(() => ({
  importSpy: vi.fn(),
}));

vi.mock('../src/desktop/workbench-screen', () => {
  mockState.importSpy();
  return {
    WorkbenchScreen: () => null,
  };
});

describe('workbench screen lazy loader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost:5173/',
    });

    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: dom.window.navigator,
    });
  });

  it('warms the workbench bundle during idle time after page load', async () => {
    let idleCallback: IdleRequestCallback | null = null;
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 1;
      }),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    });

    const { scheduleWorkbenchScreenPreload } = await import(
      '../src/desktop/workbench-screen-lazy'
    );

    const cancel = scheduleWorkbenchScreenPreload();
    expect(mockState.importSpy).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();

    window.dispatchEvent(new window.Event('load'));
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);

    idleCallback?.({
      didTimeout: false,
      timeRemaining: () => 50,
    } as IdleDeadline);
    await vi.dynamicImportSettled();

    expect(mockState.importSpy).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('skips automatic warmup on constrained connections', async () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: {
        saveData: true,
        effectiveType: '4g',
      },
    });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn(() => 1),
    });

    const { scheduleWorkbenchScreenPreload } = await import(
      '../src/desktop/workbench-screen-lazy'
    );

    scheduleWorkbenchScreenPreload();
    await vi.dynamicImportSettled();

    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(mockState.importSpy).not.toHaveBeenCalled();
  });
});
