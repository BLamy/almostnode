const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function parseCsv(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function isAllowedOrigin(origin, allowedOrigins) {
  return allowedOrigins.size === 0 || allowedOrigins.has(origin);
}

function isAllowedTarget(hostname, allowedTargets) {
  if (allowedTargets.size === 0) {
    return true;
  }

  for (const rule of allowedTargets) {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      if (hostname.endsWith(suffix)) {
        return true;
      }
      continue;
    }

    if (hostname === rule) {
      return true;
    }
  }

  return false;
}

function buildCorsHeaders(origin, requestHeaders) {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  headers.set('Access-Control-Allow-Headers', requestHeaders || '*');
  headers.set('Access-Control-Expose-Headers', '*');
  headers.set('Access-Control-Max-Age', '86400');
  if (origin !== '*') {
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function copyRequestHeaders(headers) {
  const forwarded = new Headers();

  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower)
      || lower === 'accept-encoding'
      || lower === 'origin'
      || lower === 'referer'
      || lower === 'cookie'
      || lower.startsWith('cf-')
      || lower === 'x-forwarded-proto'
      || lower === 'x-real-ip'
      || lower.startsWith('sec-fetch-')
      || lower.startsWith('sec-ch-ua')
    ) {
      continue;
    }
    forwarded.set(key, value);
  }

  // Replace browser User-Agent with a Node.js-like one
  forwarded.set('User-Agent', 'node');

  return forwarded;
}

function copyResponseHeaders(headers) {
  const forwarded = new Headers();

  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower)
      || lower === 'content-length'
      || lower === 'content-encoding'
      || lower === 'set-cookie'
    ) {
      continue;
    }
    forwarded.set(key, value);
  }

  return forwarded;
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS);
    const allowedTargets = parseCsv(env.ALLOWED_TARGET_HOSTS);
    const corsOrigin = origin && isAllowedOrigin(origin, allowedOrigins)
      ? origin
      : allowedOrigins.size === 0
        ? '*'
        : null;

    if (request.method === 'OPTIONS') {
      if (!corsOrigin) {
        return new Response('Origin not allowed', { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(
          corsOrigin,
          request.headers.get('access-control-request-headers'),
        ),
      });
    }

    if (!corsOrigin) {
      return new Response('Origin not allowed', { status: 403 });
    }

    const rawTarget = requestUrl.searchParams.get('url');
    if (!rawTarget) {
      return new Response('Missing ?url= query parameter', {
        status: 400,
        headers: buildCorsHeaders(corsOrigin, request.headers.get('access-control-request-headers')),
      });
    }

    let target;
    try {
      target = new URL(rawTarget);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
    } catch {
      return new Response('Invalid target URL', {
        status: 400,
        headers: buildCorsHeaders(corsOrigin, request.headers.get('access-control-request-headers')),
      });
    }

    if (!isAllowedTarget(target.hostname, allowedTargets)) {
      return new Response('Target host not allowed', {
        status: 403,
        headers: buildCorsHeaders(corsOrigin, request.headers.get('access-control-request-headers')),
      });
    }

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: copyRequestHeaders(request.headers),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const responseHeaders = copyResponseHeaders(upstream.headers);
    const corsHeaders = buildCorsHeaders(
      corsOrigin,
      request.headers.get('access-control-request-headers'),
    );

    for (const [key, value] of corsHeaders.entries()) {
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
