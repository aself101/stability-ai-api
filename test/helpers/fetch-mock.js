/**
 * Global fetch stub for API tests.
 *
 * Tests exercise the real request path (src/http.ts → fetch) with fetch
 * replaced by a handler that returns real `Response` objects, so status
 * handling, header reads and body parsing all run as in production. Every
 * call is recorded, including the multipart body, which `formFields` decodes
 * so tests can assert exactly which fields were sent.
 *
 * This is deliberately simpler than bfl-api's test/helpers/http-mock.ts, which
 * translates axios-shaped fixtures into Responses to keep its 1.x tests
 * running; stability-ai-api had no axios-shaped fixtures to preserve.
 */

import { vi } from 'vitest';

/** 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Replace global fetch. `handler(url, init, callIndex)` returns a Response
 * (or throws, to simulate a transport failure).
 *
 * @returns the array of recorded calls `{ url, init }`
 */
export function stubFetch(handler) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  }));
  return calls;
}

export function imageResponse(headers = {}, bytes = PNG_BYTES) {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', ...headers } });
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A transport failure shaped like undici's: TypeError('fetch failed') with cause.code. */
export function networkFailure(code) {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
}

/**
 * Decode a recorded multipart body into `{ field: value }`. Text fields map to
 * their string; file fields map to `{ filename, type, size }`.
 */
export function formFields(init) {
  const body = init.body;
  if (!(body instanceof FormData)) {
    throw new Error(`expected a FormData body, got ${Object.prototype.toString.call(body)}`);
  }
  const out = {};
  for (const [key, value] of body.entries()) {
    out[key] = typeof value === 'string'
      ? value
      : { filename: value.name, type: value.type, size: value.size };
  }
  return out;
}
