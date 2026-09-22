/**
 * Payload contract: what each public method actually puts on the wire.
 *
 * Until 1.0 no test inspected a request body — the generate/edit/control tests
 * mocked buildFormData and asserted only the endpoint string — so a builder
 * could silently drop a field. That is how `style_preset` on Ultra/SD3.5,
 * `creativity` on conservative upscale and `style_preset` on creative upscale
 * went unsent while the API accepted them.
 *
 * For every endpoint in ENDPOINT_FIELDS this sends every declared field through
 * the public method and requires the multipart body to carry exactly that set.
 * scripts/check-spec-drift.ts closes the other half: ENDPOINT_FIELDS equals
 * the live API schema.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StabilityAPI } from '../src/api.js';
import { ENDPOINT_FIELDS, BASE_URL } from '../src/config.js';
import { stubFetch, imageResponse, formFields, PNG_BYTES } from './helpers/fetch-mock.js';

let dir;
let png;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sai-payloads-'));
  png = join(dir, 'in.png');
  writeFileSync(png, PNG_BYTES);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A distinct value per field, so a crossed wire (a → b) is visible. */
function valuesFor(path) {
  return Object.fromEntries(ENDPOINT_FIELDS[path].text.map(f => [f, `${f}-value`]));
}

/** A distinct file per file field (named after it), so crossed file wires show. */
function filesFor(path) {
  return Object.fromEntries(ENDPOINT_FIELDS[path].files.map(f => {
    const file = join(dir, `${f}.png`);
    writeFileSync(file, PNG_BYTES);
    return [f, file];
  }));
}

/**
 * How each endpoint is reached through the public API. `v` holds every text
 * field, `f` every file field; positional arguments are taken from them so the
 * body can be checked against the same values.
 */
const CALLS = {
  '/v2beta/stable-image/generate/ultra': (api, v, f) => api.generateUltra({ ...v, ...f }),
  '/v2beta/stable-image/generate/core': (api, v) => api.generateCore(v),
  '/v2beta/stable-image/generate/sd3': (api, v, f) => api.generateSD3({ ...v, ...f }),
  '/v2beta/stable-image/upscale/fast': (api, v, f) => api.upscaleFast(f.image, v.output_format),
  '/v2beta/stable-image/upscale/conservative': (api, v, f) => api.upscaleConservative(f.image, v),
  '/v2beta/stable-image/upscale/creative': (api, v, f) => api.upscaleCreative(f.image, v),
  '/v2beta/stable-image/edit/erase': (api, v, f) => api.erase(f.image, { ...v, mask: f.mask }),
  '/v2beta/stable-image/edit/inpaint': (api, v, f) => api.inpaint(f.image, v.prompt, { ...v, mask: f.mask }),
  '/v2beta/stable-image/edit/outpaint': (api, v, f) => api.outpaint(f.image, v),
  '/v2beta/stable-image/edit/search-and-replace': (api, v, f) => api.searchAndReplace(f.image, v.prompt, v.search_prompt, v),
  '/v2beta/stable-image/edit/search-and-recolor': (api, v, f) => api.searchAndRecolor(f.image, v.prompt, v.select_prompt, v),
  '/v2beta/stable-image/edit/remove-background': (api, v, f) => api.removeBackground(f.image, v),
  '/v2beta/stable-image/edit/replace-background-and-relight': (api, v, f) =>
    api.replaceBackgroundAndRelight(f.subject_image, { ...v, background_reference: f.background_reference, light_reference: f.light_reference }),
  '/v2beta/stable-image/control/sketch': (api, v, f) => api.controlSketch(f.image, v.prompt, v),
  '/v2beta/stable-image/control/structure': (api, v, f) => api.controlStructure(f.image, v.prompt, v),
  '/v2beta/stable-image/control/style': (api, v, f) => api.controlStyle(f.image, v.prompt, v),
  '/v2beta/stable-image/control/style-transfer': (api, v, f) => api.controlStyleTransfer(f.init_image, f.style_image, v),
};

describe('every declared field reaches the wire', () => {
  it('covers every ENDPOINT_FIELDS entry', () => {
    expect(Object.keys(CALLS).sort()).toEqual(Object.keys(ENDPOINT_FIELDS).sort());
  });

  it.each(Object.keys(ENDPOINT_FIELDS))('%s', async (path) => {
    const calls = stubFetch(() => imageResponse());
    const api = new StabilityAPI('sk-test-key-1234567890', BASE_URL, 'error');
    const v = valuesFor(path);
    const f = filesFor(path);

    await CALLS[path](api, v, f);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}${path}`);
    const sent = formFields(calls[0].init);
    const { text, files } = ENDPOINT_FIELDS[path];
    expect(Object.keys(sent).sort()).toEqual([...text, ...files].sort());
    for (const field of text) {
      expect(sent[field], field).toBe(`${field}-value`);
    }
    for (const field of files) {
      expect(sent[field], field).toEqual({ filename: `${field}.png`, type: 'image/png', size: PNG_BYTES.length });
    }
  });
});

describe('unset fields are not sent (server defaults apply)', () => {
  // 0.4.0 forced aspect_ratio '1:1', output_format 'png', model 'sd3.5-large'
  // and creativity 0.3 client-side. Each equals the server default, so dropping
  // them changes nothing — except SD3 image-to-image, which rejects aspect_ratio.
  it.each([
    ['generateUltra', (api) => api.generateUltra({ prompt: 'p' }), { prompt: 'p' }],
    ['generateCore', (api) => api.generateCore({ prompt: 'p' }), { prompt: 'p' }],
    ['generateSD3', (api) => api.generateSD3({ prompt: 'p' }), { prompt: 'p' }],
    ['upscaleCreative', (api) => api.upscaleCreative(png, { prompt: 'p' }), { prompt: 'p', image: expect.any(Object) }],
    ['removeBackground', (api) => api.removeBackground(png), { image: expect.any(Object) }],
  ])('%s', async (_name, call, expected) => {
    const calls = stubFetch(() => imageResponse());
    const api = new StabilityAPI('sk-test-key-1234567890', BASE_URL, 'error');

    await call(api);

    expect(formFields(calls[0].init)).toEqual(expected);
  });

  it('sends falsy values that were set', async () => {
    const calls = stubFetch(() => imageResponse());
    const api = new StabilityAPI('sk-test-key-1234567890', BASE_URL, 'error');

    await api.generateCore({ prompt: 'p', seed: 0 });

    expect(formFields(calls[0].init).seed).toBe('0');
  });
});

describe('required prompts on the upscalers', () => {
  it.each([
    ['upscaleConservative', (api) => api.upscaleConservative(png, {}), 'Conservative upscale requires a prompt'],
    ['upscaleCreative', (api) => api.upscaleCreative(png, { prompt: '  ' }), 'Creative upscale requires a prompt'],
    ['upscaleConservative (no params)', (api) => api.upscaleConservative(png), 'Conservative upscale requires a prompt'],
  ])('%s fails before any request', async (_name, call, message) => {
    const calls = stubFetch(() => imageResponse());
    const api = new StabilityAPI('sk-test-key-1234567890', BASE_URL, 'error');

    await expect(call(api)).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });
});
