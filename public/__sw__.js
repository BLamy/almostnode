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
let basePath = '';

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

    // Inject COOP/COEP headers on navigation responses so cross-origin isolation
    // works on static hosts (e.g. GitHub Pages) that can't set custom headers
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request).then(response => {
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        }).catch(() => fetch(event.request))
      );
      return;
    }

    // Not a virtual request, let it pass through
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
  return `<script data-almostnode-devtools>
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

  // ── Eruda devtools ──
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.0/eruda.min.js';
  script.onload = function() {
    if (typeof eruda === 'undefined') return;
    eruda.init({ useShadowDom: true, defaults: { theme: 'Dark' } });
    eruda.hide();
  };
  script.onerror = function() { /* CDN unavailable — console bridge still works */ };
  document.head.appendChild(script);

  // ── DevTools toggle listener ──
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'almostnode-devtools') return;
    if (typeof eruda === 'undefined') return;
    var action = e.data.action;
    if (action === 'show') eruda.show();
    else if (action === 'hide') eruda.hide();
    else if (action === 'toggle') {
      var entry = eruda.get().entryBtn;
      if (entry && entry.isVisible && entry.isVisible()) eruda.hide();
      else eruda.show();
    }
  });
})();
</` + `script>`;
}

/**
 * Inject devtools script into an HTML response body if applicable
 */
function maybeInjectEruda(bytes, contentType) {
  if (!erudaEnabled) return bytes;
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
    return new Response(`Service Worker Error: ${error.message}`, {
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
