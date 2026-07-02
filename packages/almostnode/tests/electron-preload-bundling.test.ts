import { describe, it, expect } from 'vitest';
import { preloadImportsBareModule } from '../src/frameworks/electron-app';

// Decides whether `electron <dir>` bundles a preload (to inline npm helpers)
// vs. uses the single-file transform. A wrong verdict silently breaks the
// renderer bridge, so this is checked against the real electron-vite preload.
describe('preloadImportsBareModule', () => {
  it('is true for the electron-vite template preload (@electron-toolkit/preload)', () => {
    const source = [
      "import { contextBridge } from 'electron'",
      "import { electronAPI } from '@electron-toolkit/preload'",
      'const api = {}',
      'if (process.contextIsolated) {',
      "  contextBridge.exposeInMainWorld('electron', electronAPI)",
      '}',
    ].join('\n');
    expect(preloadImportsBareModule(source)).toBe(true);
  });

  it('is false for a preload that only imports electron + relative modules', () => {
    const source = [
      "const { contextBridge, ipcRenderer } = require('electron')",
      "const helpers = require('./helpers')",
      "import util from '../util'",
      "contextBridge.exposeInMainWorld('api', {})",
    ].join('\n');
    expect(preloadImportsBareModule(source)).toBe(false);
  });

  it('is false for a preload with no imports (catalog-style)', () => {
    const source = "window.api = { ping: () => 'pong' };";
    expect(preloadImportsBareModule(source)).toBe(false);
  });

  it('does not count `electron/renderer` as a bare npm import', () => {
    const source = "import { ipcRenderer } from 'electron/renderer'";
    expect(preloadImportsBareModule(source)).toBe(false);
  });

  it('detects a scoped npm import via require', () => {
    const source = "const store = require('@electron-toolkit/store')";
    expect(preloadImportsBareModule(source)).toBe(true);
  });
});
