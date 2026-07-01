/**
 * Electron renderer preload bridge.
 *
 * Produces a classic `<script>` injected at the very start of the renderer's
 * `<head>` (before any module script). It installs the renderer-side `electron`
 * API — `ipcRenderer` (invoke/send/on backed by postMessage to the main
 * process), `contextBridge`, and a `webFrame` stub — then evaluates the app's
 * own preload source so its `contextBridge.exposeInMainWorld(...)` calls run
 * before the page loads.
 *
 * Fidelity gap (MVP): `contextBridge.exposeInMainWorld(key, api)` defines
 * `window[key]` on the page's own world rather than a separate isolated world.
 * The contract app code observes is the same; true world isolation is not.
 */
import { ELECTRON_IPC_KIND, ELECTRON_IPC_TAG } from './electron-host';

export interface ElectronPreloadOptions {
  /** The app's preload script, already transpiled to CommonJS (may be empty). */
  preloadSource?: string;
}

// Avoid prematurely closing the injected <script> tag.
function escapeForScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

/**
 * Build the `<head>` bootstrap string for a renderer window.
 */
export function buildElectronPreloadBootstrap(
  options: ElectronPreloadOptions = {},
): string {
  const preloadSource = escapeForScript(options.preloadSource ?? '');
  const tag = JSON.stringify(ELECTRON_IPC_TAG);
  const kind = JSON.stringify(ELECTRON_IPC_KIND);

  return `<script>
(function () {
  var TAG = ${tag};
  var KIND = ${kind};
  var invokeSeq = 0;
  var pendingInvokes = new Map();
  var channelListeners = new Map();

  function post(envelope) {
    envelope[TAG] = true;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(envelope, '*');
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data[TAG] !== true) return;
    if (data.kind === KIND.invokeReply) {
      var pending = pendingInvokes.get(data.id);
      if (!pending) return;
      pendingInvokes.delete(data.id);
      if (data.ok) {
        pending.resolve(data.args ? data.args[0] : undefined);
      } else {
        var err = new Error(data.error ? data.error.message : 'IPC error');
        if (data.error && data.error.name) err.name = data.error.name;
        pending.reject(err);
      }
    } else if (data.kind === KIND.event) {
      var set = channelListeners.get(data.channel);
      if (!set) return;
      var ipcEvent = { senderId: 0, ports: [] };
      set.forEach(function (fn) {
        try { fn.apply(null, [ipcEvent].concat(data.args || [])); }
        catch (e) { console.error(e); }
      });
    }
  });

  var ipcRenderer = {
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      var id = ++invokeSeq;
      return new Promise(function (resolve, reject) {
        pendingInvokes.set(id, { resolve: resolve, reject: reject });
        post({ kind: KIND.invoke, id: id, channel: channel, args: args });
      });
    },
    send: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      post({ kind: KIND.send, channel: channel, args: args });
    },
    sendSync: function () {
      console.warn('[electron] ipcRenderer.sendSync is not supported in almostnode');
      return undefined;
    },
    postMessage: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      post({ kind: KIND.send, channel: channel, args: args });
    },
    on: function (channel, listener) {
      var set = channelListeners.get(channel) || new Set();
      set.add(listener);
      channelListeners.set(channel, set);
      return ipcRenderer;
    },
    once: function (channel, listener) {
      var wrap = function () {
        ipcRenderer.removeListener(channel, wrap);
        return listener.apply(null, arguments);
      };
      return ipcRenderer.on(channel, wrap);
    },
    removeListener: function (channel, listener) {
      var set = channelListeners.get(channel);
      if (set) set.delete(listener);
      return ipcRenderer;
    },
    removeAllListeners: function (channel) {
      if (channel) channelListeners.delete(channel);
      else channelListeners.clear();
      return ipcRenderer;
    },
  };

  var contextBridge = {
    exposeInMainWorld: function (key, api) {
      try {
        Object.defineProperty(window, key, {
          value: api, enumerable: true, configurable: true, writable: false,
        });
      } catch (e) {
        window[key] = api;
      }
    },
    exposeInIsolatedWorld: function (_worldId, key, api) {
      contextBridge.exposeInMainWorld(key, api);
    },
  };

  var webFrame = {
    setZoomFactor: function () {}, getZoomFactor: function () { return 1; },
    setZoomLevel: function () {}, getZoomLevel: function () { return 0; },
    executeJavaScript: function () { return Promise.resolve(); },
  };

  var electronRenderer = { ipcRenderer: ipcRenderer, contextBridge: contextBridge, webFrame: webFrame };
  window.__almostElectronRenderer = electronRenderer;

  function preloadRequire(id) {
    if (id === 'electron') return electronRenderer;
    if (id === 'electron/renderer') return electronRenderer;
    throw new Error("[electron preload] Cannot require '" + id + "' in the renderer (contextIsolation MVP)");
  }

  try {
    (function (require, module, exports, process) {
${preloadSource}
    })(
      preloadRequire,
      { exports: {} },
      {},
      { platform: 'browser', env: {}, contextIsolated: true, versions: { electron: '31.0.0' } }
    );
  } catch (e) {
    console.error('[electron preload] preload script failed:', e);
  }

  post({ kind: KIND.rendererReady });
})();
</script>`;
}
