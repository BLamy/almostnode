/**
 * Service Worker for Mini WebContainers
 * Intercepts fetch requests and routes them to virtual servers
 * Version: 15 - cleanup: extract helpers, gate debug logs, remove test endpoints
 */

const DEBUG = false;

// Communication port with main thread
let mainPort = null;

// Pending requests waiting for response
const pendingRequests = new Map();
let requestId = 0;

// Registered virtual server ports
const registeredPorts = new Set();

// Whether Eruda devtools injection is enabled
let erudaEnabled = true;

// Base path prefix (e.g. '/almostnode' when deployed to GitHub Pages subpath)
// Infer from registration scope so it's available immediately on SW restart,
// before the main thread sends the 'init' message.
let basePath = (() => {
  try {
    const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, '');
    return scopePath || '';
  } catch (e) {
    return '';
  }
})();

/**
 * Decode base64 string to Uint8Array
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Handle messages from main thread
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  DEBUG && console.log('[SW] Received message:', type, 'hasPort in event.ports:', event.ports?.length > 0);

  // When a MessagePort is transferred, it's in event.ports[0], not event.data.port
  if (type === 'init' && event.ports && event.ports[0]) {
    // Initialize communication channel
    mainPort = event.ports[0];
    mainPort.onmessage = handleMainMessage;
    if (data && data.basePath) {
      basePath = data.basePath.replace(/\/$/, ''); // strip trailing slash
    }
    DEBUG && console.log('[SW] Initialized communication channel with transferred port, basePath:', basePath);
    // Re-claim clients so that pages opened after SW activation get controlled.
    // Without this, controllerchange never fires for late-arriving pages.
    self.clients.claim();
  }

  if (type === 'server-registered' && data) {
    registeredPorts.add(data.port);
    DEBUG && console.log(`[SW] Server registered on port ${data.port}`);
  }

  if (type === 'server-unregistered' && data) {
    registeredPorts.delete(data.port);
    DEBUG && console.log(`[SW] Server unregistered from port ${data.port}`);
  }

  if (type === 'eruda-toggle') {
    erudaEnabled = !!data?.enabled;
    DEBUG && console.log(`[SW] Eruda injection ${erudaEnabled ? 'enabled' : 'disabled'}`);
  }
});

/**
 * Handle response messages from main thread
 */
function handleMainMessage(event) {
  const { type, id, data, error } = event.data;

  DEBUG && console.log('[SW] Received message from main:', type, 'id:', id);

  // server-registered/server-unregistered arrive via the MessageChannel (port1→port2),
  // NOT via the global 'message' event, so we must handle them here too.
  if (type === 'server-registered' && data) {
    registeredPorts.add(data.port);
    DEBUG && console.log('[SW] Server registered on port', data.port, '(via MessageChannel)');
    return;
  }
  if (type === 'server-unregistered' && data) {
    registeredPorts.delete(data.port);
    DEBUG && console.log('[SW] Server unregistered from port', data.port, '(via MessageChannel)');
    return;
  }

  if (type === 'response') {
    const pending = pendingRequests.get(id);
    DEBUG && console.log('[SW] Looking for pending request:', id, 'found:', !!pending);

    if (pending) {
      pendingRequests.delete(id);

      if (error) {
        DEBUG && console.log('[SW] Response error:', error);
        pending.reject(new Error(error));
      } else {
        DEBUG && console.log('[SW] Response data:', {
          statusCode: data?.statusCode,
          statusMessage: data?.statusMessage,
          headers: data?.headers,
          bodyType: data?.body?.constructor?.name,
          bodyLength: data?.body?.length || data?.body?.byteLength,
        });
        pending.resolve(data);
      }
    }
  }

  // Handle streaming responses
  if (type === 'stream-start') {
    DEBUG && console.log('[SW] stream-start received, id:', id);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      // Store headers/status for the streaming response
      pending.streamData = data;
      pending.resolveHeaders(data);
      DEBUG && console.log('[SW] headers resolved for stream', id);
    } else {
      DEBUG && console.log('[SW] No pending request or controller for stream-start', id, !!pending, pending?.streamController);
    }
  }

  if (type === 'stream-chunk') {
    DEBUG && console.log('[SW] stream-chunk received, id:', id, 'size:', data?.chunkBase64?.length);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      try {
        // Decode base64 chunk and enqueue
        if (data.chunkBase64) {
          const bytes = base64ToBytes(data.chunkBase64);
          pending.streamController.enqueue(bytes);
          DEBUG && console.log('[SW] chunk enqueued, bytes:', bytes.length);
        }
      } catch (e) {
        console.error('[SW] Error enqueueing chunk:', e);
      }
    } else {
      DEBUG && console.log('[SW] No pending request or controller for stream-chunk', id);
    }
  }

  if (type === 'stream-end') {
    DEBUG && console.log('[SW] stream-end received, id:', id);
    const pending = pendingRequests.get(id);
    if (pending && pending.streamController) {
      try {
        pending.streamController.close();
        DEBUG && console.log('[SW] stream closed');
      } catch (e) {
        DEBUG && console.log('[SW] stream already closed');
      }
      pendingRequests.delete(id);
    }
  }
}

/**
 * Send request to main thread and wait for response
 */
async function sendRequest(port, method, url, headers, body) {
  DEBUG && console.log('[SW] sendRequest called, mainPort:', !!mainPort, 'url:', url);

  if (!mainPort) {
    // Ask all clients to re-send the init message
    const allClients = await self.clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'sw-needs-init' });
    }
    // Wait up to 5s for a client to re-initialize the port
    // (main thread may be busy with heavy operations like CLI execution)
    await new Promise(resolve => {
      const check = setInterval(() => { if (mainPort) { clearInterval(check); resolve(); } }, 50);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
    if (!mainPort) {
      throw new Error('Service Worker not initialized - no connection to main thread');
    }
  }

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    // Set timeout for request
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);

    mainPort.postMessage({
      type: 'request',
      id,
      data: { port, method, url, headers, body },
    });
  });
}

async function sendModuleRequest(url) {
  if (!mainPort) {
    const allClients = await self.clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'sw-needs-init' });
    }
    await new Promise(resolve => {
      const check = setInterval(() => { if (mainPort) { clearInterval(check); resolve(); } }, 50);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
    if (!mainPort) {
      throw new Error('Service Worker not initialized - no connection to main thread');
    }
  }

  const id = ++requestId;

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);

    mainPort.postMessage({
      type: 'module-request',
      id,
      data: { url },
    });
  });
}

/**
 * Send streaming request to main thread
 * Returns a ReadableStream that receives chunks from main thread
 */
async function sendStreamingRequest(port, method, url, headers, body) {
  DEBUG && console.log('[SW] sendStreamingRequest called, url:', url);

  if (!mainPort) {
    // Ask all clients to re-send the init message
    const allClients = await self.clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({ type: 'sw-needs-init' });
    }
    await new Promise(resolve => {
      const check = setInterval(() => { if (mainPort) { clearInterval(check); resolve(); } }, 50);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
    if (!mainPort) {
      throw new Error('Service Worker not initialized');
    }
  }

  const id = ++requestId;

  let streamController;
  let resolveHeaders;
  const headersPromise = new Promise(resolve => { resolveHeaders = resolve; });

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;

      // Store in pending requests so handleMainMessage can find it
      pendingRequests.set(id, {
        resolve: () => {},
        reject: (err) => controller.error(err),
        streamController: controller,
        resolveHeaders,
      });

      // Send request to main thread with streaming flag
      mainPort.postMessage({
        type: 'request',
        id,
        data: { port, method, url, headers, body, streaming: true },
      });
    },
    cancel() {
      pendingRequests.delete(id);
    }
  });

  return { stream, headersPromise, id };
}

/**
 * Intercept fetch requests
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strip basePath prefix from pathname for matching
  const rawPathname = url.pathname;
  const pathname = basePath && rawPathname.startsWith(basePath) ? rawPathname.slice(basePath.length) || '/' : rawPathname;

  DEBUG && console.log('[SW] Fetch:', pathname, 'mainPort:', !!mainPort, 'basePath:', basePath);

  if (pathname.startsWith('/__modules__/r/')) {
    event.respondWith(handleModuleRequest(event.request, pathname + url.search));
    return;
  }

  // Check if this is a virtual server request
  const match = pathname.match(/^\/__virtual__\/(\d+)(\/.*)?$/);

  if (!match) {
    // /_npm/ requests are almostnode-specific and should always be routed to a
    // virtual server, even when the Referer chain has lost the /__virtual__/ context
    // (e.g. /_npm/foo imports /_npm/foo/constants — the Referer is /_npm/foo, not /__virtual__/).
    if (pathname.startsWith('/_npm/')) {
      var npmPath = pathname + url.search;
      event.respondWith((async function() {
        var virtualPort = null;
        var npmReferer = event.request.referrer;
        if (npmReferer) {
          try {
            var refererUrl = new URL(npmReferer);
            var refererPathname = basePath && refererUrl.pathname.startsWith(basePath)
              ? refererUrl.pathname.slice(basePath.length) || '/'
              : refererUrl.pathname;
            var refererMatch = refererPathname.match(/^\/__virtual__\/(\d+)/);
            if (refererMatch) {
              virtualPort = parseInt(refererMatch[1], 10);
            }
          } catch (e) {}
        }
        // Fall back to first registered port if Referer doesn't have virtual context
        if (!virtualPort && registeredPorts.size > 0) {
          virtualPort = registeredPorts.values().next().value;
        }
        // If no port yet, wait for one to be registered (startup race condition)
        if (!virtualPort) {
          await new Promise(function(resolve) {
            var check = setInterval(function() {
              if (registeredPorts.size > 0) { clearInterval(check); resolve(); }
            }, 50);
            setTimeout(function() { clearInterval(check); resolve(); }, 10000);
          });
          if (registeredPorts.size > 0) {
            virtualPort = registeredPorts.values().next().value;
          }
        }
        if (virtualPort) {
          DEBUG && console.log('[SW] Routing /_npm/ request to virtual server:', npmPath, 'port:', virtualPort);
          return handleVirtualRequest(event.request, virtualPort, npmPath);
        }
        // Still no virtual server — return a JS error module
        return new Response(
          'console.error("[almostnode] No virtual server available for ' + npmPath.replace(/'/g, "\\'") + '");\nexport default undefined;\n',
          { status: 503, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      })());
      return;
    }

    // Not a virtual request - but check if it's from a virtual context
    // This handles plain <a href="/about"> links and asset requests (images, scripts)
    // that should stay within the virtual server
    const referer = event.request.referrer;
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererPathname = basePath && refererUrl.pathname.startsWith(basePath) ? refererUrl.pathname.slice(basePath.length) || '/' : refererUrl.pathname;
        const refererMatch = refererPathname.match(/^\/__virtual__\/(\d+)/);
        if (refererMatch) {
          // Request from within a virtual server context
          const virtualPrefix = basePath + refererMatch[0];
          const virtualPort = parseInt(refererMatch[1], 10);
          const targetPath = pathname + url.search;

          if (event.request.mode === 'navigate') {
            // Navigation requests: redirect to include the virtual prefix
            const redirectUrl = url.origin + virtualPrefix + targetPath;
            DEBUG && console.log('[SW] Redirecting navigation from virtual context:', url.pathname, '->', redirectUrl);
            event.respondWith(Response.redirect(redirectUrl, 302));
            return;
          } else {
            // Non-navigation requests (images, scripts, etc.): forward to virtual server
            DEBUG && console.log('[SW] Forwarding resource from virtual context:', url.pathname);
            event.respondWith(handleVirtualRequest(event.request, virtualPort, targetPath));
            return;
          }
        }
      } catch (e) {
        // Invalid referer URL, ignore
      }
    }

    // Inject COOP/COEP/CORP headers on ALL pass-through responses so cross-origin
    // isolation works on static hosts (e.g. GitHub Pages) that can't set custom headers.
    // This is the "coi-serviceworker" pattern — without it, Worker scripts and other
    // subresources lack the headers needed for a cross-origin-isolated page.
    event.respondWith(
      fetch(event.request).then(response => {
        // Only modify same-origin responses (cross-origin opaque responses can't be read)
        if (response.type === 'opaque' || response.type === 'opaqueredirect') {
          return response;
        }
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
        newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
        newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }).catch(() => fetch(event.request))
    );
    return;
  }

  DEBUG && console.log('[SW] Virtual request:', url.pathname);

  const port = parseInt(match[1], 10);
  const path = match[2] || '/';

  event.respondWith(handleVirtualRequest(event.request, port, path + url.search));
});

async function handleModuleRequest(request, url) {
  try {
    const response = await sendModuleRequest(url);
    const headers = new Headers(response.headers || {});
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.delete('X-Frame-Options');

    if (response.bodyBase64 && response.bodyBase64.length > 0) {
      const bytes = base64ToBytes(response.bodyBase64);
      return new Response(new Blob([bytes], {
        type: headers.get('Content-Type') || 'application/javascript',
      }), {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers,
      });
    }

    return new Response(null, {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers,
    });
  } catch (error) {
    return new Response(`Module Worker Error: ${error.message}`, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Script injected into HTML responses for Eruda devtools + console bridge.
 * The console bridge always runs; Eruda init is guarded in case the CDN fails.
 */
function getErudaInjectionScript() {
  return String.raw`<script data-almostnode-devtools>
(function() {
  // ── Console bridge (always active) ──
  var origLog = console.log, origWarn = console.warn,
      origError = console.error, origInfo = console.info;

  function forward(level, args) {
    try {
      var serialized = Array.prototype.map.call(args, function(a) {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') {
          try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
        }
        return String(a);
      });
      window.parent.postMessage({
        type: 'almostnode-console',
        level: level,
        args: serialized,
        timestamp: Date.now()
      }, '*');
    } catch(e) { /* ignore bridge errors */ }
  }

  console.log = function() { forward('log', arguments); return origLog.apply(console, arguments); };
  console.warn = function() { forward('warn', arguments); return origWarn.apply(console, arguments); };
  console.error = function() { forward('error', arguments); return origError.apply(console, arguments); };
  console.info = function() { forward('info', arguments); return origInfo.apply(console, arguments); };

  window.addEventListener('error', function(e) {
    forward('error', [e.message + ' at ' + (e.filename || '') + ':' + (e.lineno || '')]);
  });
  window.addEventListener('unhandledrejection', function(e) {
    forward('error', ['Unhandled rejection: ' + (e.reason && e.reason.message || e.reason || '')]);
  });

  // ── Network bridge ──
  (function() {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var method = (init && init.method) || 'GET';
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      if (typeof input === 'object' && input instanceof Request && !init) {
        method = input.method || 'GET';
      }
      method = method.toUpperCase();
      var start = Date.now();
      var p = origFetch.apply(this, arguments);
      p.then(function(resp) {
        try {
          var cl = resp.headers.get('content-length');
          window.parent.postMessage({
            type: 'almostnode-network',
            method: method,
            url: url,
            status: resp.status,
            statusText: resp.statusText,
            duration: Date.now() - start,
            size: cl ? parseInt(cl, 10) : 0
          }, '*');
        } catch(e) { /* ignore */ }
      }).catch(function(err) {
        try {
          window.parent.postMessage({
            type: 'almostnode-network',
            method: method,
            url: url,
            status: 0,
            statusText: err.message || 'Failed',
            duration: Date.now() - start,
            size: 0
          }, '*');
        } catch(e) { /* ignore */ }
      });
      return p;
    };

    var xhrProto = XMLHttpRequest.prototype;
    var origOpen = xhrProto.open;
    var origSend = xhrProto.send;
    xhrProto.open = function(method, url) {
      this._anMethod = (method || 'GET').toUpperCase();
      this._anUrl = url;
      return origOpen.apply(this, arguments);
    };
    xhrProto.send = function() {
      var xhr = this;
      var start = Date.now();
      xhr.addEventListener('loadend', function() {
        try {
          var cl = xhr.getResponseHeader('content-length');
          window.parent.postMessage({
            type: 'almostnode-network',
            method: xhr._anMethod || 'GET',
            url: xhr._anUrl || '',
            status: xhr.status,
            statusText: xhr.statusText,
            duration: Date.now() - start,
            size: cl ? parseInt(cl, 10) : 0
          }, '*');
        } catch(e) { /* ignore */ }
      });
      return origSend.apply(this, arguments);
    };
  })();

  // ── React Grab source picker ──
  var reactGrabScriptUrl = 'https://unpkg.com/react-grab@0.1.29/dist/index.global.js';
  var elementSourceScriptUrl = 'https://unpkg.com/element-source@0.0.5/dist/index.global.js';
  var reactGrabScriptPromise = null;
  var elementSourceScriptPromise = null;
  var reactGrabApi = null;
  var reactGrabPluginRegistered = false;
  var reactGrabOpenMode = false;

  function postSourcePickerMessage(payload) {
    try {
      window.parent.postMessage(Object.assign({
        type: 'almostnode-preview-source-picker'
      }, payload), '*');
    } catch(e) { /* ignore bridge errors */ }
  }

  function getReactGrabApi() {
    return window.__REACT_GRAB__ || reactGrabApi || null;
  }

  function getElementSourceApi() {
    return window.ElementSource || null;
  }

  function waitForReactGrabApi() {
    var existing = getReactGrabApi();
    if (existing) return Promise.resolve(existing);

    return new Promise(function(resolve, reject) {
      var timeoutId = window.setTimeout(function() {
        cleanup();
        reject(new Error('Timed out loading react-grab.'));
      }, 15000);

      function cleanup() {
        window.clearTimeout(timeoutId);
        window.removeEventListener('react-grab:init', onInit);
      }

      function onInit(event) {
        var api = event && event.detail ? event.detail : getReactGrabApi();
        if (!api) return;
        reactGrabApi = api;
        cleanup();
        resolve(api);
      }

      window.addEventListener('react-grab:init', onInit);
    });
  }

  function ensureReactGrabLoaded() {
    var existing = getReactGrabApi();
    if (existing) {
      reactGrabApi = existing;
      return Promise.resolve(existing);
    }

    if (reactGrabScriptPromise) {
      return reactGrabScriptPromise;
    }

    reactGrabScriptPromise = new Promise(function(resolve, reject) {
      var existingScript = document.querySelector('script[data-almostnode-react-grab]');
      if (existingScript) {
        waitForReactGrabApi().then(resolve, reject);
        return;
      }

      var script = document.createElement('script');
      script.src = reactGrabScriptUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-almostnode-react-grab', 'true');
      script.onload = function() {
        waitForReactGrabApi().then(resolve, reject);
      };
      script.onerror = function() {
        reject(new Error('Failed to load react-grab.'));
      };
      document.head.appendChild(script);
    }).then(function(api) {
      reactGrabApi = api;
      return api;
    }).catch(function(error) {
      reactGrabScriptPromise = null;
      throw error;
    });

    return reactGrabScriptPromise;
  }

  function waitForElementSourceApi() {
    var existing = getElementSourceApi();
    if (existing) return Promise.resolve(existing);

    return new Promise(function(resolve, reject) {
      var timeoutId = window.setTimeout(function() {
        cleanup();
        reject(new Error('Timed out loading element-source.'));
      }, 15000);
      var intervalId = window.setInterval(function() {
        var api = getElementSourceApi();
        if (!api) return;
        cleanup();
        resolve(api);
      }, 50);

      function cleanup() {
        window.clearTimeout(timeoutId);
        window.clearInterval(intervalId);
      }
    });
  }

  function ensureElementSourceLoaded() {
    var existing = getElementSourceApi();
    if (existing) {
      return Promise.resolve(existing);
    }

    if (elementSourceScriptPromise) {
      return elementSourceScriptPromise;
    }

    elementSourceScriptPromise = new Promise(function(resolve, reject) {
      var existingScript = document.querySelector('script[data-almostnode-element-source]');
      if (existingScript) {
        waitForElementSourceApi().then(resolve, reject);
        return;
      }

      var script = document.createElement('script');
      script.src = elementSourceScriptUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-almostnode-element-source', 'true');
      script.onload = function() {
        waitForElementSourceApi().then(resolve, reject);
      };
      script.onerror = function() {
        reject(new Error('Failed to load element-source.'));
      };
      document.head.appendChild(script);
    }).catch(function(error) {
      elementSourceScriptPromise = null;
      throw error;
    });

    return elementSourceScriptPromise;
  }

  function normalizeSourcePickerComparisonKey(value) {
    if (typeof value !== 'string') {
      return '';
    }

    var normalized = value.trim();
    if (!normalized) {
      return '';
    }

    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
        normalized = new URL(normalized).pathname || normalized;
      }
    } catch(e) { /* ignore invalid URLs */ }

    normalized = normalized
      .replace(/\\/g, '/')
      .split(/[?#]/, 1)[0]
      .trim();

    normalized = normalized.replace(/^about:\/\/React\/[^/]+\//, '/');
    normalized = normalized.replace(/^rsc:\/\/React\/[^/]+\//, '/');
    normalized = normalized.replace(/^file:\/\/+/, '/');
    normalized = normalized.replace(/^webpack(?:-internal)?:\/\/+/, '/');
    normalized = normalized.replace(/^turbopack:\/\/+/, '/');
    normalized = normalized.replace(/^metro:\/\/+/, '/');
    normalized = normalized.replace(/^\/(?:\(app-pages-browser\)|app-pages-browser)\//, '/');

    if (normalized.indexOf('//') === 0) {
      var hostIndex = normalized.indexOf('/', 2);
      normalized = hostIndex === -1 ? '' : normalized.slice(hostIndex);
    }

    normalized = normalized.replace(/^\/?__virtual__\/\d+(?=\/)/, '');
    normalized = normalized.replace(/^[^/]+:\d+(?=\/)/, '');
    normalized = normalized.replace(/^\/?\d+(?=\/(src|app|pages|components|lib|routes|tests?|e2e|drizzle|public)\b)/, '');

    if (normalized && normalized.charAt(0) !== '/') {
      normalized = '/' + normalized;
    }

    return normalized.toLowerCase();
  }

  function isLikelySourcePickerPath(value) {
    return /(^|\/)(src|app|pages|components|lib|routes|tests?|e2e|drizzle|public)\//.test(value) || /\.(?:[cm]?[jt]sx?)$/i.test(value);
  }

  function pathsLikelyMatchForSourcePicker(left, right) {
    if (!left || !right) {
      return false;
    }

    return left === right || left.slice(-right.length) === right || right.slice(-left.length) === left;
  }

  function findBestReactStackFrame(stack, source) {
    if (!Array.isArray(stack) || stack.length === 0) {
      return null;
    }

    var sourcePath = normalizeSourcePickerComparisonKey(source && source.filePath);
    var sourceLineNumber = source && typeof source.lineNumber === 'number'
      ? source.lineNumber
      : null;
    var fallbackFrame = null;

    for (var index = 0; index < stack.length; index += 1) {
      var frame = stack[index];
      if (!frame || typeof frame.fileName !== 'string') {
        continue;
      }

      var framePath = normalizeSourcePickerComparisonKey(frame.fileName);
      if (!framePath || !isLikelySourcePickerPath(framePath)) {
        continue;
      }

      if (sourcePath && !pathsLikelyMatchForSourcePicker(framePath, sourcePath)) {
        continue;
      }

      if (!fallbackFrame) {
        fallbackFrame = frame;
      }

      if (
        sourceLineNumber !== null &&
        typeof frame.lineNumber === 'number' &&
        frame.lineNumber === sourceLineNumber
      ) {
        return frame;
      }
    }

    return fallbackFrame;
  }

  function normalizeSourcePickerInfo(source) {
    if (!source || typeof source !== 'object') {
      return null;
    }

    return {
      filePath: typeof source.filePath === 'string' ? source.filePath : null,
      lineNumber: typeof source.lineNumber === 'number' ? source.lineNumber : null,
      columnNumber: typeof source.columnNumber === 'number' ? source.columnNumber : null,
      componentName: typeof source.componentName === 'string' ? source.componentName : null
    };
  }

  function normalizeSourcePickerStack(stack) {
    if (!Array.isArray(stack)) {
      return [];
    }

    return stack.map(function(frame) {
      return normalizeSourcePickerInfo(frame);
    }).filter(function(frame) {
      return !!(frame && frame.filePath);
    });
  }

  function resolveSourcePickerSource(api, element) {
    return ensureElementSourceLoaded().then(function(elementSourceApi) {
      if (typeof elementSourceApi.resolveElementInfo === 'function') {
        return Promise.resolve(elementSourceApi.resolveElementInfo(element)).then(function(info) {
          var normalizedSource = normalizeSourcePickerInfo(info && info.source);
          var normalizedStack = normalizeSourcePickerStack(info && info.stack);
          return {
            tagName: info && typeof info.tagName === 'string'
              ? info.tagName
              : typeof element.tagName === 'string'
                ? element.tagName.toLowerCase()
                : '',
            componentName: info && typeof info.componentName === 'string'
              ? info.componentName
              : normalizedSource && normalizedSource.componentName || null,
            source: normalizedSource || normalizedStack[0] || null,
            stack: normalizedStack,
            formattedStack: typeof elementSourceApi.formatStack === 'function'
              ? elementSourceApi.formatStack(normalizedStack)
              : null
          };
        }).catch(function() {
          return null;
        });
      }

      return Promise.resolve(
        typeof elementSourceApi.resolveSource === 'function'
          ? elementSourceApi.resolveSource(element)
          : null
      ).catch(function() {
        return null;
      }).then(function(source) {
        var normalizedSource = normalizeSourcePickerInfo(source);
        if (normalizedSource && normalizedSource.filePath) {
          return {
            tagName: typeof element.tagName === 'string'
              ? element.tagName.toLowerCase()
              : '',
            componentName: normalizedSource.componentName || null,
            source: normalizedSource,
            stack: [normalizedSource],
            formattedStack: null
          };
        }

        return api.getSource(element).then(function(fallbackSource) {
          var normalizedFallbackSource = normalizeSourcePickerInfo(fallbackSource);
          return {
            tagName: typeof element.tagName === 'string'
              ? element.tagName.toLowerCase()
              : '',
            componentName: normalizedFallbackSource && normalizedFallbackSource.componentName || null,
            source: normalizedFallbackSource,
            stack: normalizedFallbackSource ? [normalizedFallbackSource] : [],
            formattedStack: null
          };
        });
      });
    }).catch(function() {
      return api.getSource(element).then(function(source) {
        var normalizedSource = normalizeSourcePickerInfo(source);
        return {
          tagName: typeof element.tagName === 'string'
            ? element.tagName.toLowerCase()
            : '',
          componentName: normalizedSource && normalizedSource.componentName || null,
          source: normalizedSource,
          stack: normalizedSource ? [normalizedSource] : [],
          formattedStack: null
        };
      });
    });
  }

  function registerReactGrabPlugin(api) {
    if (reactGrabPluginRegistered) return;

    api.registerPlugin({
      name: 'almostnode-preview-source-picker',
      theme: {
        toolbar: { enabled: false },
        grabbedBoxes: { enabled: false }
      },
      options: {
        activationKey: function() { return false; }
      },
      hooks: {
        onElementSelect: function(element) {
          if (!reactGrabOpenMode) return;

          return resolveSourcePickerSource(api, element).then(function(info) {
            reactGrabOpenMode = false;
            api.deactivate();

            console.log('[almostnode] preview element info', info || null);

            var source = info && (info.source || info.stack && info.stack[0]) || null;
            if (!source || !source.filePath) {
              postSourcePickerMessage({
                status: 'error',
                reason: 'no-source'
              });
              return true;
            }

            postSourcePickerMessage({
              status: 'selected',
              filePath: source.filePath,
              lineNumber: typeof source.lineNumber === 'number' ? source.lineNumber : null,
              columnNumber: typeof source.columnNumber === 'number' ? source.columnNumber : null
            });
            return true;
          }).catch(function(error) {
            reactGrabOpenMode = false;
            api.deactivate();
            postSourcePickerMessage({
              status: 'error',
              reason: error && error.message ? error.message : String(error)
            });
            return true;
          });
        }
      }
    });

    reactGrabPluginRegistered = true;
  }

  function activateSourcePicker() {
    ensureReactGrabLoaded().then(function(api) {
      return ensureElementSourceLoaded().catch(function() {
        return null;
      }).then(function() {
        registerReactGrabPlugin(api);
        reactGrabOpenMode = true;
        api.activate();
        postSourcePickerMessage({ status: 'armed' });
      });
    }).catch(function(error) {
      reactGrabOpenMode = false;
      postSourcePickerMessage({
        status: 'error',
        reason: error && error.message ? error.message : String(error)
      });
    });
  }

  function deactivateSourcePicker(notifyParent) {
    reactGrabOpenMode = false;
    var api = getReactGrabApi();
    if (api) {
      api.deactivate();
    }
    if (notifyParent) {
      postSourcePickerMessage({ status: 'cancelled' });
    }
  }

  window.addEventListener('keydown', function(e) {
    if (!reactGrabOpenMode || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    deactivateSourcePicker(true);
  }, true);

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'almostnode-preview-source-picker') return;
    if (e.data.action === 'activate-open') {
      activateSourcePicker();
      return;
    }
    if (e.data.action === 'deactivate') {
      deactivateSourcePicker(false);
    }
  });

  // ── Eruda devtools ──
  var shouldLoadEruda = ${erudaEnabled ? "true" : "false"};
  if (shouldLoadEruda) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.0/eruda.min.js';
    script.onload = function() {
      if (typeof eruda === 'undefined') return;
      eruda.init({ useShadowDom: true, defaults: { theme: 'Dark' } });
      eruda.hide();
      // Eruda overrides console but omits some methods React 19 needs
      if (typeof console.timeStamp !== 'function') {
        console.timeStamp = function() {};
      }
    };
    script.onerror = function() { /* CDN unavailable — console bridge still works */ };
    document.head.appendChild(script);
  }

  // ── DevTools toggle listener ──
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'almostnode-devtools') return;
    if (!shouldLoadEruda || typeof eruda === 'undefined') return;
    var action = e.data.action;
    if (action === 'show') eruda.show();
    else if (action === 'hide') eruda.hide();
    else if (action === 'toggle') {
      var entry = eruda.get().entryBtn;
      if (entry && entry.isVisible && entry.isVisible()) eruda.hide();
      else eruda.show();
    }
  });

  // ── Database fetch interceptor ──
  // Reads ?db= from the iframe URL and appends __db={name} to /__db__/ fetch calls
  (function() {
    var urlParams = new URLSearchParams(window.location.search);
    var dbName = urlParams.get('db');
    if (!dbName) return;

    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      if (url.indexOf('/__db__/') !== -1) {
        var separator = url.indexOf('?') !== -1 ? '&' : '?';
        var newUrl = url + separator + '__db=' + encodeURIComponent(dbName);
        if (typeof input === 'string') {
          return origFetch.call(this, newUrl, init);
        } else {
          return origFetch.call(this, new Request(newUrl, input), init);
        }
      }
      return origFetch.apply(this, arguments);
    };

    // Preserve ?db= across history.pushState/replaceState for SPA navigation
    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;
    function preserveDbParam(orig) {
      return function(state, title, url) {
        if (url && typeof url === 'string') {
          try {
            var u = new URL(url, window.location.href);
            if (!u.searchParams.has('db')) {
              u.searchParams.set('db', dbName);
              url = u.toString();
            }
          } catch(e) { /* invalid URL, pass through */ }
        }
        return orig.call(this, state, title, url);
      };
    }
    history.pushState = preserveDbParam(origPushState);
    history.replaceState = preserveDbParam(origReplaceState);
  })();
})();
</` + `script>`;
}

/**
 * Inject devtools script into an HTML response body if applicable
 */
function maybeInjectEruda(bytes, contentType) {
  if (!contentType || !contentType.includes('text/html')) return bytes;

  var html = new TextDecoder().decode(bytes);
  var injection = getErudaInjectionScript();

  // Inject before </body> if present, otherwise before </html>, otherwise append
  if (html.includes('</body>')) {
    html = html.replace('</body>', injection + '</body>');
  } else if (html.includes('</html>')) {
    html = html.replace('</html>', injection + '</html>');
  } else {
    html += injection;
  }

  return new TextEncoder().encode(html);
}

/**
 * Handle a request to a virtual server
 */
async function handleVirtualRequest(request, port, path) {
  try {
    // Build headers object
    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Get body if present
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    // Check if this is an API route that might stream (POST to /api/*)
    const isStreamingCandidate = request.method === 'POST' && path.startsWith('/api/');

    if (isStreamingCandidate) {
      DEBUG && console.log('[SW] Using streaming mode for:', path);
      return handleStreamingRequest(port, request.method, path, headers, body);
    }
    DEBUG && console.log('[SW] Using non-streaming mode for:', request.method, path);

    // Send to main thread
    const response = await sendRequest(port, request.method, path, headers, body);

    DEBUG && console.log('[SW] Got response from main thread:', {
      statusCode: response.statusCode,
      headersKeys: response.headers ? Object.keys(response.headers) : [],
      bodyBase64Length: response.bodyBase64?.length,
    });

    // Decode base64 body and create response
    let finalResponse;
    if (response.bodyBase64 && response.bodyBase64.length > 0) {
      try {
        let bytes = base64ToBytes(response.bodyBase64);
        DEBUG && console.log('[SW] Decoded body length:', bytes.length);

        // Inject Eruda devtools into HTML responses
        const ct = response.headers['Content-Type'] || response.headers['content-type'] || '';
        bytes = maybeInjectEruda(bytes, ct);

        // Use Blob to ensure proper body handling
        const blob = new Blob([bytes], { type: response.headers['Content-Type'] || 'application/octet-stream' });
        DEBUG && console.log('[SW] Created blob size:', blob.size);

        // Merge response headers with CORP/COEP headers to allow iframe embedding
        // The parent page has COEP: credentialless, so we need matching headers
        const respHeaders = new Headers(response.headers);
        respHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
        respHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
        respHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
        // Remove any headers that might block iframe loading
        respHeaders.delete('X-Frame-Options');

        finalResponse = new Response(blob, {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: respHeaders,
        });
      } catch (decodeError) {
        console.error('[SW] Failed to decode base64 body:', decodeError);
        finalResponse = new Response(`Decode error: ${decodeError.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    } else {
      finalResponse = new Response(null, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: response.headers,
      });
    }

    DEBUG && console.log('[SW] Final Response created, status:', finalResponse.status);

    return finalResponse;
  } catch (error) {
    console.error('[SW] Error handling virtual request:', error);
    // For module-like requests (/_npm/, .js, .ts, .tsx, .jsx, .mjs),
    // return a valid JS module so browsers don't reject due to MIME type
    if (path.startsWith('/_npm/') || /\.(js|ts|tsx|jsx|mjs)(\?|$)/.test(path)) {
      var errMsg = 'Service Worker Error: ' + error.message;
      var jsBody = 'console.error(' + JSON.stringify(errMsg) + ');\nexport default undefined;\n';
      return new Response(jsBody, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      });
    }
    return new Response('Service Worker Error: ' + error.message, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Handle a streaming request
 */
async function handleStreamingRequest(port, method, path, headers, body) {
  const { stream, headersPromise, id } = await sendStreamingRequest(port, method, path, headers, body);

  // Wait for headers to arrive
  const responseData = await headersPromise;

  DEBUG && console.log('[SW] Streaming response started:', responseData?.statusCode);

  // Build response headers
  const respHeaders = new Headers(responseData?.headers || {});
  respHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
  respHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  respHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
  respHeaders.delete('X-Frame-Options');

  return new Response(stream, {
    status: responseData?.statusCode || 200,
    statusText: responseData?.statusMessage || 'OK',
    headers: respHeaders,
  });
}

/**
 * Activate immediately
 */
self.addEventListener('install', (event) => {
  DEBUG && console.log('[SW] Installing...');
  event.waitUntil(self.skipWaiting());
});

/**
 * Claim all clients immediately
 */
self.addEventListener('activate', (event) => {
  DEBUG && console.log('[SW] Activated');
  event.waitUntil(self.clients.claim());
});
