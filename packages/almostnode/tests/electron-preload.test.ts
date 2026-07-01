import { describe, it, expect } from 'vitest';
import { buildElectronPreloadBootstrap } from '../src/frameworks/electron-preload';
import { ELECTRON_IPC_KIND, ELECTRON_IPC_TAG } from '../src/frameworks/electron-host';

/**
 * Evaluate the injected preload bootstrap in a fake window so we can exercise
 * the renderer <-> main IPC contract without a real browser. `mainInbox`
 * collects envelopes the renderer posts to the main process; `deliver()`
 * simulates the main process posting back into the renderer.
 */
function runBootstrap(preloadSource: string) {
  const messageListeners: Array<(event: { data: unknown; source?: unknown }) => void> = [];
  const mainInbox: Array<Record<string, unknown>> = [];

  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: { data: unknown }) => void) => {
      if (type === 'message') messageListeners.push(fn);
    },
    removeEventListener: () => {},
    postMessage: () => {},
  };
  fakeWindow.parent = {
    postMessage: (data: Record<string, unknown>) => mainInbox.push(data),
  };

  const script = buildElectronPreloadBootstrap({ preloadSource })
    .replace(/^<script>/, '')
    .replace(/<\/script>$/, '');

  // eslint-disable-next-line no-new-func
  new Function('window', 'console', script)(fakeWindow, console);

  const deliver = (envelope: Record<string, unknown>) => {
    for (const fn of messageListeners) fn({ data: envelope });
  };
  return { fakeWindow, mainInbox, deliver };
}

const PRELOAD = `
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('api', {
    ping: (msg) => ipcRenderer.invoke('ping', msg),
    fireAndForget: (msg) => ipcRenderer.send('log', msg),
    onTick: (cb) => ipcRenderer.on('tick', (_event, n) => cb(n)),
  });
`;

describe('electron preload bridge', () => {
  it('runs the preload and exposes contextBridge APIs on window', () => {
    const { fakeWindow, mainInbox } = runBootstrap(PRELOAD);
    expect(fakeWindow.__almostElectronRenderer).toBeDefined();
    expect(fakeWindow.api).toBeDefined();
    expect(typeof (fakeWindow.api as { ping: unknown }).ping).toBe('function');
    // Bridge announces itself to main.
    const ready = mainInbox.find((m) => m.kind === ELECTRON_IPC_KIND.rendererReady);
    expect(ready).toBeDefined();
    expect(ready?.[ELECTRON_IPC_TAG]).toBe(true);
  });

  it('ipcRenderer.invoke posts an invoke and resolves on reply', async () => {
    const { fakeWindow, mainInbox, deliver } = runBootstrap(PRELOAD);
    const api = fakeWindow.api as { ping: (msg: string) => Promise<string> };
    const promise = api.ping('hi');

    const invoke = mainInbox.find((m) => m.kind === ELECTRON_IPC_KIND.invoke);
    expect(invoke).toBeDefined();
    expect(invoke?.channel).toBe('ping');
    expect((invoke?.args as unknown[])[0]).toBe('hi');

    deliver({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.invokeReply,
      id: invoke?.id,
      ok: true,
      args: ['pong:hi'],
    });
    await expect(promise).resolves.toBe('pong:hi');
  });

  it('ipcRenderer.invoke rejects when main replies with an error', async () => {
    const { fakeWindow, mainInbox, deliver } = runBootstrap(PRELOAD);
    const api = fakeWindow.api as { ping: (msg: string) => Promise<string> };
    const promise = api.ping('boom');
    const invoke = mainInbox.find((m) => m.kind === ELECTRON_IPC_KIND.invoke);
    deliver({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.invokeReply,
      id: invoke?.id,
      ok: false,
      error: { message: 'nope', name: 'Error' },
    });
    await expect(promise).rejects.toThrow('nope');
  });

  it('ipcRenderer.send posts a fire-and-forget message', () => {
    const { fakeWindow, mainInbox } = runBootstrap(PRELOAD);
    const api = fakeWindow.api as { fireAndForget: (msg: string) => void };
    api.fireAndForget('hello');
    const sent = mainInbox.find((m) => m.kind === ELECTRON_IPC_KIND.send);
    expect(sent?.channel).toBe('log');
    expect((sent?.args as unknown[])[0]).toBe('hello');
  });

  it('main -> renderer events reach ipcRenderer.on listeners', () => {
    const { fakeWindow, deliver } = runBootstrap(PRELOAD);
    const api = fakeWindow.api as { onTick: (cb: (n: number) => void) => void };
    const ticks: number[] = [];
    api.onTick((n) => ticks.push(n));
    deliver({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.event,
      channel: 'tick',
      args: [42],
    });
    expect(ticks).toEqual([42]);
  });
});
