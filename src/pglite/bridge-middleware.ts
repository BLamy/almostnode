/**
 * PGlite Bridge Middleware
 * Intercepts /__db__/* requests and routes them to PGlite
 */

import type { RequestMiddleware } from '../server-bridge';
import { handleDatabaseRequest } from './pglite-database';
import { Buffer } from '../shims/stream';

const DB_PREFIX = '/__db__/';

export function createPGliteMiddleware(): RequestMiddleware {
  return async (_port, _method, url, _headers, body) => {
    // Parse URL to check path
    const questionMark = url.indexOf('?');
    const pathname = questionMark >= 0 ? url.slice(0, questionMark) : url;
    const search = questionMark >= 0 ? url.slice(questionMark) : '';

    if (!pathname.startsWith(DB_PREFIX)) {
      return null; // Not a DB request, pass through
    }

    // Extract operation from path: /__db__/{operation}
    const operation = pathname.slice(DB_PREFIX.length);

    // Extract database name from query param
    const params = new URLSearchParams(search);
    const dbName = params.get('__db') || undefined;

    // Parse JSON body
    let parsedBody: any = {};
    if (body) {
      try {
        const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
        parsedBody = JSON.parse(text);
      } catch {
        // Body is not JSON, use empty object
      }
    }

    const result = await handleDatabaseRequest(operation, parsedBody, dbName);

    return {
      statusCode: result.statusCode,
      statusMessage: result.statusCode === 200 ? 'OK' : 'Error',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.from(result.body),
    };
  };
}
