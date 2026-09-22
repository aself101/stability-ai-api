/**
 * StabilityAPI behaviour through its public interface.
 *
 * Rewritten for 1.0. The 0.4.0 file mocked the private `_makeFormDataRequest`
 * (22 tests asserting its call shape) and carried tests that only checked a
 * method existed; the ship pipeline's test-architect flagged both (AF-003).
 * Everything here drives the real request path — StabilityAPI → src/http.ts →
 * a stubbed global fetch returning real Responses — and asserts on what went
 * over the wire or came back. Field-level payload coverage for all 17
 * endpoints is in payloads.test.js; HTTP/error/retry behaviour in
 * api-http.test.js.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  StabilityAPI,
  StabilityResponseError,
  isImageResult,
  isTaskResult,
} from '../src/api.js';
import { BASE_URL } from '../src/config.js';
import { logger } from '../src/utils.js';
import { stubFetch, imageResponse, jsonResponse, formFields, PNG_BYTES } from './helpers/fetch-mock.js';

const KEY = 'sk-test-key-1234567890';

let api;
let dir;
let png;

beforeEach(() => {
  api = new StabilityAPI(KEY, BASE_URL, 'error');
  dir = mkdtempSync(join(tmpdir(), 'sai-api-'));
  png = join(dir, 'in.png');
  writeFileSync(png, PNG_BYTES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('constructor', () => {
  it('takes the key positionally and sends it as a bearer token', async () => {
    const calls = stubFetch(() => imageResponse());
    await new StabilityAPI('sk-positional-000000', undefined, 'error').generateCore({ prompt: 'p' });
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-positional-000000');
  });

  it('takes an options object (the README form, which 0.4.0 stored as "[object Object]")', async () => {
    const calls = stubFetch(() => imageResponse());
    await new StabilityAPI({ apiKey: 'sk-options-000000', logLevel: 'error' }).generateCore({ prompt: 'p' });
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-options-000000');
  });

  it('falls back to STABILITY_API_KEY with no arguments (0.4.0 failed on first request)', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'sk-from-env-000000');
    const calls = stubFetch(() => imageResponse());
    await new StabilityAPI().generateCore({ prompt: 'p' });
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-from-env-000000');
  });

  it('an explicit key wins over the environment', async () => {
    vi.stubEnv('STABILITY_API_KEY', 'sk-from-env-000000');
    const calls = stubFetch(() => imageResponse());
    await new StabilityAPI({ apiKey: 'sk-explicit-000000' }).generateCore({ prompt: 'p' });
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-explicit-000000');
  });

  it('with no key anywhere, the first request throws before touching the network', async () => {
    vi.stubEnv('STABILITY_API_KEY', '');
    const calls = stubFetch(() => imageResponse());
    await expect(new StabilityAPI(null, undefined, 'error').generateCore({ prompt: 'p' })).rejects.toThrow('API key is required');
    expect(calls).toHaveLength(0);
  });

  it('sends requests to a custom HTTPS base URL', async () => {
    const calls = stubFetch(() => imageResponse());
    await new StabilityAPI({ apiKey: KEY, baseUrl: 'https://proxy.example', logLevel: 'error' }).generateCore({ prompt: 'p' });
    expect(calls[0].url).toBe('https://proxy.example/v2beta/stable-image/generate/core');
  });

  it.each([
    ['positional', () => new StabilityAPI('k', 'http://insecure.example')],
    ['options', () => new StabilityAPI({ apiKey: 'k', baseUrl: 'http://insecure.example' })],
  ])('rejects a non-HTTPS base URL (%s form)', (_form, make) => {
    expect(make).toThrow('HTTPS');
  });
});

describe('constructor and the shared logger', () => {
  let saved;
  beforeEach(() => { saved = logger.level; });
  afterEach(() => { logger.level = saved; });

  it('normalises the level passed and refuses an unknown one (either used to silence all output)', () => {
    new StabilityAPI({ apiKey: KEY, logLevel: 'ERROR' });
    expect(logger.level).toBe('error');
    expect(() => new StabilityAPI({ apiKey: KEY, logLevel: 'LOUD' })).toThrow(/Unknown log level/);
  });

  it('leaves the logger level alone unless a level is passed (it is shared module state)', () => {
    logger.level = 'error';
    new StabilityAPI(KEY);
    new StabilityAPI({ apiKey: KEY });
    expect(logger.level).toBe('error');

    new StabilityAPI({ apiKey: KEY, logLevel: 'warn' });
    expect(logger.level).toBe('warn');
  });
});

describe('API key never reaches the logs', () => {
  it('logs only the last four characters', async () => {
    const debug = vi.spyOn(logger, 'debug');
    stubFetch(() => imageResponse());
    await api.generateCore({ prompt: 'p' });

    const logged = debug.mock.calls.map(([m]) => String(m)).join('\n');
    expect(logged).toContain('xxx...7890');
    expect(logged).not.toContain(KEY);
  });
});

describe('response shape is checked, not cast', () => {
  // Until 1.0 every synchronous method cast the response to ImageResult, so a
  // JSON body came back with `image: undefined` behind a Buffer type.
  it('a synchronous endpoint answering JSON throws StabilityResponseError with the body', async () => {
    stubFetch(() => jsonResponse(200, { unexpected: true }));
    const error = await api.generateCore({ prompt: 'p' }).catch(e => e);
    expect(error).toBeInstanceOf(StabilityResponseError);
    expect(error.message).toContain('/v2beta/stable-image/generate/core');
    expect(error.body).toEqual({ unexpected: true });
  });

  it('a 202 without a string task id throws StabilityResponseError', async () => {
    stubFetch(() => jsonResponse(202, { status: 'in-progress' }));
    const error = await api.getResult('t').catch(e => e);
    expect(error).toBeInstanceOf(StabilityResponseError);
    expect(error.body).toEqual({ status: 'in-progress' });
  });

  it('an async endpoint answering neither a task nor an image throws', async () => {
    stubFetch(() => jsonResponse(200, { id: 42 }));
    await expect(api.upscaleCreative(png, { prompt: 'p' })).rejects.toBeInstanceOf(StabilityResponseError);
  });

  it.each([
    [{ image: Buffer.from('x') }, true],
    [{ image: 'not-a-buffer' }, false],
    [{ id: 't' }, false],
    [null, false],
  ])('isImageResult(%o) → %s', (value, expected) => {
    expect(isImageResult(value)).toBe(expected);
  });

  it.each([
    [{ id: 't' }, true],
    [{ id: 42 }, false],
    [{}, false],
    ['t', false],
  ])('isTaskResult(%o) → %s', (value, expected) => {
    expect(isTaskResult(value)).toBe(expected);
  });
});

describe('async endpoints: submit, then poll', () => {
  // The submit answers with a task id; the first poll returns the image, so
  // waitForResult never sleeps.
  const flow = (submitPath) => (url, init) => {
    if (url.endsWith(submitPath)) return jsonResponse(200, { id: 'task-9' });
    if (url.endsWith('/v2beta/results/task-9')) return imageResponse({ seed: '7' });
    throw new Error(`unexpected ${init.method} ${url}`);
  };

  it.each([
    ['upscaleCreative', '/v2beta/stable-image/upscale/creative', (a) => a.upscaleCreative(png, { prompt: 'p' })],
    ['replaceBackgroundAndRelight', '/v2beta/stable-image/edit/replace-background-and-relight', (a) => a.replaceBackgroundAndRelight(png, { background_prompt: 'beach' })],
  ])('%s polls the task to an image by default', async (_name, path, call) => {
    const calls = stubFetch(flow(path));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true); // spinner
    const result = await call(api);
    expect(calls.map(c => `${c.init.method} ${c.url.replace(BASE_URL, '')}`)).toEqual([
      `POST ${path}`,
      'GET /v2beta/results/task-9',
    ]);
    expect(isImageResult(result)).toBe(true);
    expect(result.seed).toBe('7');
  });

  it.each([
    ['upscaleCreative', '/v2beta/stable-image/upscale/creative', (a) => a.upscaleCreative(png, { prompt: 'p', wait: false })],
    ['replaceBackgroundAndRelight', '/v2beta/stable-image/edit/replace-background-and-relight', (a) => a.replaceBackgroundAndRelight(png, { background_prompt: 'beach', wait: false })],
  ])('%s with wait: false returns the task handle after one request', async (_name, path, call) => {
    const calls = stubFetch(flow(path));
    const result = await call(api);
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ id: 'task-9' });
  });
});

describe('async methods pass poll options through', () => {
  it('upscaleCreative honours poll.timeout (the 300 s default could not be changed before 1.0)', async () => {
    stubFetch((url) => url.endsWith('/upscale/creative')
      ? jsonResponse(200, { id: 'task-5' })
      : jsonResponse(202, { id: 'task-5', status: 'in-progress' }));

    const started = Date.now();
    const error = await api.upscaleCreative(png, { prompt: 'p', poll: { timeout: 0.2, pollInterval: 0 } }).catch(e => e);

    expect(error.name).toBe('StabilityTaskTimeoutError');
    expect(error.taskId).toBe('task-5');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('synchronous endpoints return the image and its metadata', () => {
  it.each([
    ['generateUltra', (a) => a.generateUltra({ prompt: 'p' })],
    ['generateSD3', (a) => a.generateSD3({ prompt: 'p', model: 'sd3.5-flash' })],
    ['upscaleFast', (a) => a.upscaleFast(png)],
    ['erase', (a) => a.erase(png)],
    ['controlStyleTransfer (minimal options)', (a) => a.controlStyleTransfer(png, png)],
  ])('%s', async (_name, call) => {
    stubFetch(() => imageResponse({ 'finish-reason': 'SUCCESS', seed: '3' }));
    const result = await call(api);
    expect(result.image.equals(PNG_BYTES)).toBe(true);
    expect(result).toMatchObject({ finish_reason: 'SUCCESS', seed: '3' });
  });
});

describe('edit validation against the real request path', () => {
  let calls;

  beforeEach(() => {
    calls = stubFetch(() => imageResponse());
  });

  const sentTo = (endpoint) => {
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}${endpoint}`);
    return formFields(calls[0].init);
  };
  describe('removeBackground', () => {
    it('rejects jpeg output before any request', async () => {
      await expect(api.removeBackground(png, { output_format: 'jpeg' })).rejects.toThrow('jpeg');
      expect(calls).toHaveLength(0);
    });

    it.each(['png', 'webp'])('sends %s output', async (output_format) => {
      await api.removeBackground(png, { output_format });
      expect(sentTo('/v2beta/stable-image/edit/remove-background').output_format).toBe(output_format);
    });
  });

  describe('replaceBackgroundAndRelight', () => {
    const endpoint = '/v2beta/stable-image/edit/replace-background-and-relight';

    it('requires background_prompt or background_reference, before any request', async () => {
      await expect(api.replaceBackgroundAndRelight(png, {})).rejects.toThrow('background_prompt or background_reference');
      expect(calls).toHaveLength(0);
    });

    it('sends with background_prompt alone', async () => {
      await api.replaceBackgroundAndRelight(png, { background_prompt: 'sunset beach' });
      expect(sentTo(endpoint)).toMatchObject({ background_prompt: 'sunset beach' });
    });

    it('sends with background_reference alone', async () => {
      await api.replaceBackgroundAndRelight(png, { background_reference: png });
      expect(sentTo(endpoint).background_reference).toMatchObject({ type: 'image/png' });
    });

    it('requires light_reference or light_source_direction for light_source_strength', async () => {
      await expect(api.replaceBackgroundAndRelight(png, { background_prompt: 't', light_source_strength: 0.5 }))
        .rejects.toThrow('light_source_strength requires');
      expect(calls).toHaveLength(0);
    });

    it('sends light_source_strength with light_source_direction', async () => {
      await api.replaceBackgroundAndRelight(png, { background_prompt: 't', light_source_direction: 'right', light_source_strength: 0.5 });
      expect(sentTo(endpoint)).toMatchObject({ light_source_direction: 'right', light_source_strength: '0.5' });
    });

    it('sends light_source_strength with light_reference', async () => {
      await api.replaceBackgroundAndRelight(png, { background_prompt: 't', light_reference: png, light_source_strength: 0.5 });
      expect(sentTo(endpoint)).toMatchObject({ light_source_strength: '0.5', light_reference: { type: 'image/png' } });
    });
  });
});
