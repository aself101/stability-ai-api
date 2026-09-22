/**
 * API request/response behaviour against real fetch Responses.
 *
 * These replace the axios-era tests that called `_sanitizeErrorMessage`
 * directly or asserted only that methods existed. Everything here runs the
 * production path: StabilityAPI → src/http.ts request() → (stubbed) fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  StabilityAPI,
  StabilityResponseError,
  StabilityTaskTimeoutError,
  StabilityHttpError,
  StabilityNetworkError,
  StabilityTimeoutError,
  isTransientError,
} from '../src/api.js';
import { BASE_URL, MAX_RETRIES } from '../src/config.js';
import { stubFetch, imageResponse, jsonResponse, networkFailure, formFields, PNG_BYTES } from './helpers/fetch-mock.js';

let api;

beforeEach(() => {
  api = new StabilityAPI('sk-test-key-1234567890', BASE_URL, 'error');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('synchronous image responses', () => {
  it('returns image bytes with finish_reason and seed read from headers', async () => {
    stubFetch(() => imageResponse({ 'finish-reason': 'SUCCESS', seed: '42' }));

    const result = await api.generateCore({ prompt: 'a lighthouse' });

    expect(Buffer.isBuffer(result.image)).toBe(true);
    expect(result.image.equals(PNG_BYTES)).toBe(true);
    expect(result.finish_reason).toBe('SUCCESS');
    expect(result.seed).toBe('42');
  });

  it('sends POST with bearer auth, accept image/*, a FormData body and no hand-set content-type', async () => {
    const calls = stubFetch(() => imageResponse());

    await api.generateCore({ prompt: 'a lighthouse' });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`${BASE_URL}/v2beta/stable-image/generate/core`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sk-test-key-1234567890');
    expect(init.headers.accept).toBe('image/*');
    // fetch must write the multipart boundary itself; a caller-set
    // content-type would omit it and the server could not parse the body.
    expect(Object.keys(init.headers).map(k => k.toLowerCase())).not.toContain('content-type');
    expect(formFields(init).prompt).toBe('a lighthouse');
  });
});

describe('async task responses', () => {
  it('parses a 202 body as JSON (axios returned it as a raw ArrayBuffer)', async () => {
    stubFetch(() => jsonResponse(202, { id: 'task-1', status: 'in-progress' }));

    const result = await api.getResult('task-1');

    expect(result).toEqual({ id: 'task-1', status: 'in-progress' });
  });

  it('parses a 200 JSON task id', async () => {
    stubFetch(() => jsonResponse(200, { id: 'task-2' }));

    const result = await api.getResult('task-2');

    expect(result).toEqual({ id: 'task-2' });
  });

  it('polls results with accept */* and keeps authorization alongside the custom header', async () => {
    const calls = stubFetch(() => jsonResponse(202, { id: 't', status: 'in-progress' }));

    await api.getResult('t');

    expect(calls[0].url).toBe(`${BASE_URL}/v2beta/results/t`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.accept).toBe('*/*');
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-test-key-1234567890');
    expect(calls[0].init.body).toBeUndefined();
  });

  it.each([['null'], ['42'], ['[1,2]']])('rejects a JSON %s body with StabilityResponseError (null used to crash on data.id)', async (body) => {
    stubFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(api.getResult('t')).rejects.toBeInstanceOf(StabilityResponseError);
  });

  it('rejects a 200 that is neither an image nor JSON instead of returning garbage', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    // A response arrived: StabilityResponseError, not StabilityNetworkError ("no response")
    await expect(api.getResult('t')).rejects.toBeInstanceOf(StabilityResponseError);
  });

  it('accepts image bytes served under a non-image content type (the result was billed)', async () => {
    stubFetch(() => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    const result = await api.generateCore({ prompt: 'p' });
    expect(result.image.equals(PNG_BYTES)).toBe(true);
  });
});

describe('error mapping', () => {
  const cases = [
    [401, 'Authentication failed. Check your API key (keys: https://platform.stability.ai/account/keys).'],
    [402, 'Payment required: check your Stability credit balance.'],
    [403, 'Forbidden: flagged by content moderation, or not permitted for this key.'],
    [413, 'Request payload too large (max 10MB).'],
    [429, 'Rate limit exceeded. Please wait before retrying.'],
  ];

  it.each(cases)('maps %i to a typed error with a readable message', async (status, message) => {
    stubFetch(() => jsonResponse(status, { name: 'x', errors: ['detail'] }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error).toBeInstanceOf(StabilityHttpError);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
    expect(error.body).toEqual({ name: 'x', errors: ['detail'] });
  });

  it('joins the server validation errors on 400', async () => {
    stubFetch(() => jsonResponse(400, { name: 'bad_request', errors: ['model: invalid enum value', 'seed: too big'] }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error.status).toBe(400);
    expect(error.message).toBe('Invalid parameters: model: invalid enum value, seed: too big');
  });

  it('keeps the transport-level error as cause', async () => {
    stubFetch(() => jsonResponse(500, { errors: ['x'] }));
    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);
    expect(error.cause).toBeInstanceOf(StabilityHttpError);
    expect(error.cause.status).toBe(500);
  });

  it('carries Retry-After on 429', async () => {
    stubFetch(() => jsonResponse(429, { errors: ['slow down'] }, { 'retry-after': '7' }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error.retryAfter).toBe(7);
  });

  it('shows server detail for unmapped statuses in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    stubFetch(() => jsonResponse(500, { errors: ['upstream exploded at node-7'] }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error.message).toBe('Request failed with status code 500: upstream exploded at node-7');
  });

  it('hides server detail for unmapped statuses in production, but keeps it on .body', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubFetch(() => jsonResponse(500, { errors: ['upstream exploded at node-7'] }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error.message).toBe('An error occurred while processing your request');
    expect(error.message).not.toContain('node-7');
    expect(error.status).toBe(500);
    expect(error.body).toEqual({ errors: ['upstream exploded at node-7'] });
  });

  it('refuses to follow a redirect from the API (the key stays on api.stability.ai)', async () => {
    const calls = stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/steal' } }));

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error).toBeInstanceOf(StabilityHttpError);
    expect(calls).toHaveLength(1);
  });

  it('surfaces transport failures as StabilityNetworkError with the undici code', async () => {
    stubFetch(() => { throw networkFailure('UND_ERR_SOCKET'); });

    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);

    expect(error).toBeInstanceOf(StabilityNetworkError);
    expect(error.code).toBe('UND_ERR_SOCKET');
    expect(error.retryable).toBe(true);
  });
});

describe('isTransientError', () => {
  it.each([
    [new StabilityHttpError('m', 429), true],
    [new StabilityHttpError('m', 502), true],
    [new StabilityHttpError('m', 503), true],
    [new StabilityHttpError('m', 504), true],
    [new StabilityHttpError('m', 400), false],
    [new StabilityHttpError('m', 401), false],
    [new StabilityHttpError('m', 500), false],
    [new StabilityNetworkError('m', 'ECONNRESET'), true],
    [new StabilityNetworkError('m', 'ENOTFOUND'), false],
    [new StabilityTimeoutError(1000), true],
    // Message text carries no control flow: the 1.x matcher would have retried this.
    [new Error('rate limit 503 502'), false],
  ])('%o → %s', (error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});

describe('waitForResult', () => {
  const opts = { pollInterval: 0, timeout: 5, showSpinner: false };

  it('polls through 202s until the image arrives', async () => {
    const calls = stubFetch((_url, _init, i) =>
      i < 2 ? jsonResponse(202, { id: 't', status: 'in-progress' }) : imageResponse({ seed: '9' })
    );

    const result = await api.waitForResult('t', opts);

    expect(calls).toHaveLength(3);
    expect(result.seed).toBe('9');
  });

  it('retries a transient 503 and then succeeds', async () => {
    const calls = stubFetch((_url, _init, i) => (i === 0 ? jsonResponse(503, {}) : imageResponse()));

    const result = await api.waitForResult('t', opts);

    expect(calls).toHaveLength(2);
    expect(Buffer.isBuffer(result.image)).toBe(true);
  });

  it('retries a transport failure the network error marks retryable', async () => {
    const calls = stubFetch((_url, _init, i) => {
      if (i === 0) throw networkFailure('ECONNRESET');
      return imageResponse();
    });

    await api.waitForResult('t', opts);

    expect(calls).toHaveLength(2);
  });

  it(`gives up after MAX_RETRIES (${MAX_RETRIES}) consecutive transient failures`, async () => {
    const calls = stubFetch(() => jsonResponse(503, {}));

    const error = await api.waitForResult('t', opts).catch(e => e);

    expect(error).toBeInstanceOf(StabilityHttpError);
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(MAX_RETRIES + 1);
  });

  it('honours a maxRetries override, including 0 to disable retrying', async () => {
    let calls = stubFetch(() => jsonResponse(503, {}));
    await api.waitForResult('t', { ...opts, maxRetries: 5 }).catch(() => {});
    expect(calls).toHaveLength(6);

    calls = stubFetch(() => jsonResponse(503, {}));
    await api.waitForResult('t', { ...opts, maxRetries: 0 }).catch(() => {});
    expect(calls).toHaveLength(1);
  });

  it('resets the failure budget after a successful poll', async () => {
    // 503 ×MAX_RETRIES, one 202, 503 ×MAX_RETRIES, image: never MAX_RETRIES+1 in a row.
    const script = [
      ...Array(MAX_RETRIES).fill(503), 202, ...Array(MAX_RETRIES).fill(503), 200,
    ];
    const calls = stubFetch((_url, _init, i) => {
      const status = script[i];
      if (status === 200) return imageResponse();
      return jsonResponse(status, { id: 't', status: 'in-progress' });
    });

    await api.waitForResult('t', opts);

    expect(calls).toHaveLength(script.length);
  });

  it('a final 2xx that is neither an image nor a task handle throws at once (0.4.0 re-polled it to the timeout)', async () => {
    const calls = stubFetch(() => jsonResponse(200, { finish_reason: 'CONTENT_FILTERED' }));

    const error = await api.waitForResult('t', opts).catch(e => e);

    expect(error).toBeInstanceOf(StabilityResponseError);
    expect(error.body).toEqual({ finish_reason: 'CONTENT_FILTERED' });
    expect(calls).toHaveLength(1);
  });

  it('never sleeps past the overall timeout, whatever Retry-After says', async () => {
    stubFetch(() => jsonResponse(429, {}, { 'retry-after': '3600' }));

    const started = Date.now();
    const error = await api.waitForResult('t', { ...opts, timeout: 0.3 }).catch(e => e);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(error.message).toMatch(/Timeout waiting for task t/);
  });

  it('times out with StabilityTaskTimeoutError carrying the task id (the paid task may still finish)', async () => {
    stubFetch(() => jsonResponse(202, { id: 'task-7', status: 'in-progress' }));

    const error = await api.waitForResult('task-7', { ...opts, timeout: 0.2 }).catch(e => e);

    expect(error).toBeInstanceOf(StabilityTaskTimeoutError);
    expect(error.taskId).toBe('task-7');
    expect(error.message).toContain('sai result task-7');
  });

  it.each([
    [{ timeout: NaN }, 'timeout'],
    [{ timeout: 0 }, 'timeout'],
    [{ pollInterval: -1 }, 'pollInterval'],
  ])('rejects %o before polling (NaN timeout used to poll forever)', async (bad, name) => {
    const calls = stubFetch(() => imageResponse());
    await expect(api.waitForResult('t', { ...opts, ...bad })).rejects.toThrow(new RegExp(name));
    expect(calls).toHaveLength(0);
  });

  it('shows no spinner by default (library stdout is not ours); showSpinner turns it on', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stubFetch(() => imageResponse());

    await api.waitForResult('t', { pollInterval: 0, timeout: 5 });
    expect(write).not.toHaveBeenCalled();

    await api.waitForResult('t', { pollInterval: 0, timeout: 5, showSpinner: true });
    expect(write).toHaveBeenCalled();
  });

  it('a 200 JSON body with an id is final, not "in progress" (only a 202 keeps polling, per the spec)', async () => {
    const calls = stubFetch(() => jsonResponse(200, { id: 't', errors: ['generation failed'] }));
    const error = await api.waitForResult('t', opts).catch(e => e);
    expect(error).toBeInstanceOf(StabilityResponseError);
    expect(calls).toHaveLength(1);
  });

  it('backs off exponentially between consecutive transient failures', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    stubFetch((_url, _init, i) => (i < 3 ? jsonResponse(503, {}) : imageResponse()));
    await api.waitForResult('t', { ...opts, pollInterval: 0.01 });
    const sleeps = setTimeoutSpy.mock.calls.map(([, ms]) => ms).filter(ms => ms >= 10 && ms <= 40);
    expect(sleeps).toEqual([10, 20, 40]);
    setTimeoutSpy.mockRestore();
  });

  it.each(['../../v1/user/balance', '..', 'a/b', 'a%2Fb', ''])('refuses task id %o before any request (path traversal)', async (id) => {
    const calls = stubFetch(() => imageResponse());
    await expect(api.waitForResult(id, opts)).rejects.toThrow('Invalid task id');
    await expect(api.getResult(id)).rejects.toThrow('Invalid task id');
    expect(calls).toHaveLength(0);
  });

  it('throws a permanent error immediately', async () => {
    const calls = stubFetch(() => jsonResponse(400, { errors: ['bad id'] }));

    const error = await api.waitForResult('t', opts).catch(e => e);

    expect(error.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('waits at least Retry-After before retrying a 429 (within the timeout)', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    stubFetch((_url, _init, i) =>
      i === 0 ? jsonResponse(429, {}, { 'retry-after': '0.01' }) : imageResponse()
    );

    await api.waitForResult('t', opts);

    // pollInterval is 0; the only way to wait 10ms is honouring Retry-After.
    expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === 10)).toBe(true);
    setTimeoutSpy.mockRestore();
  });
});

describe('getBalance', () => {
  it('returns the parsed balance', async () => {
    const calls = stubFetch(() => jsonResponse(200, { credits: 123.5 }));

    const balance = await api.getBalance();

    expect(balance).toEqual({ credits: 123.5 });
    expect(calls[0].url).toBe(`${BASE_URL}/v1/user/balance`);
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-test-key-1234567890');
  });

  it('maps a rejected key to the typed 401', async () => {
    stubFetch(() => jsonResponse(401, { name: 'unauthorized' }));

    const error = await api.getBalance().catch(e => e);

    expect(error).toBeInstanceOf(StabilityHttpError);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Authentication failed. Check your API key (keys: https://platform.stability.ai/account/keys).');
  });
});
