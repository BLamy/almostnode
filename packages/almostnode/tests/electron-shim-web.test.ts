// @vitest-environment jsdom
// DOM-dependent shim upgrades: globalShortcut (document keydown) and
// Notification (Web Notification API). These are inert in a plain node env, so
// they get their own jsdom-backed file.
import { describe, it, expect, vi } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { createElectronShim } from '../src/shims/electron';

function setup() {
  const vfs = new VirtualFS();
  const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createElectronShim({ vfs, process }) as any;
}

describe('electron shim — globalShortcut (jsdom)', () => {
  it('register wires a document keydown that fires the callback on a matching accelerator', () => {
    const electron = setup();
    const fired = vi.fn();
    expect(electron.globalShortcut.register('CmdOrCtrl+Shift+K', fired)).toBe(true);
    expect(electron.globalShortcut.isRegistered('CmdOrCtrl+Shift+K')).toBe(true);

    // Non-matching (no modifier) does nothing.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(fired).not.toHaveBeenCalled();

    // Matching combo fires.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }),
    );
    expect(fired).toHaveBeenCalledTimes(1);

    electron.globalShortcut.unregister('CmdOrCtrl+Shift+K');
    expect(electron.globalShortcut.isRegistered('CmdOrCtrl+Shift+K')).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }),
    );
    expect(fired).toHaveBeenCalledTimes(1); // no further calls after unregister
  });

  it('unregisterAll removes every shortcut', () => {
    const electron = setup();
    const a = vi.fn();
    electron.globalShortcut.register('CmdOrCtrl+1', a);
    electron.globalShortcut.registerAll(['CmdOrCtrl+2', 'CmdOrCtrl+3'], a);
    electron.globalShortcut.unregisterAll();
    expect(electron.globalShortcut.isRegistered('CmdOrCtrl+1')).toBe(false);
    expect(electron.globalShortcut.isRegistered('CmdOrCtrl+2')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
    expect(a).not.toHaveBeenCalled();
  });
});

describe('electron shim — Notification (jsdom)', () => {
  it('reports supported when the Web Notification API is present', () => {
    // jsdom may not implement Notification; assert the shim mirrors availability.
    const electron = setup();
    const expected = typeof (globalThis as { Notification?: unknown }).Notification !== 'undefined';
    expect(electron.Notification.isSupported()).toBe(expected);
  });
});
