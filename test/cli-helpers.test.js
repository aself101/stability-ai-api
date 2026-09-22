/**
 * CLI option → SDK parameter mapping and result saving (src/cli-helpers.ts).
 *
 * Until 1.0 this logic lived inside cli.ts, which parses process.argv on
 * import, so none of it was testable or counted by coverage; the ship
 * pipeline's test-architect flagged it (STR-OMI/H). The helpers are pure
 * except saveImageResult, which writes into a temp directory here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildGenerateParams,
  buildUpscaleParams,
  buildEditParams,
  buildControlParams,
  requiredString,
  saveImageResult,
} from '../src/cli-helpers.js';
import { PNG_BYTES } from './helpers/fetch-mock.js';

describe('buildGenerateParams', () => {
  const opts = {
    prompt: ['ignored'], negativePrompt: 'blur', aspectRatio: '16:9', seed: 7, outputFormat: 'webp',
    image: 'in.png', strength: 0.6, stylePreset: 'anime', model: 'sd3.5-flash', cfgScale: 2,
  };

  it('sd3 carries every SD 3.5 field', () => {
    expect(buildGenerateParams('sd3', 'p', opts)).toEqual({
      prompt: 'p', negative_prompt: 'blur', aspect_ratio: '16:9', seed: 7, output_format: 'webp',
      style_preset: 'anime', image: 'in.png', strength: 0.6, model: 'sd3.5-flash', cfg_scale: 2,
    });
  });

  it('ultra carries image and strength but not the SD3-only model and cfg_scale', () => {
    const p = buildGenerateParams('stable-image-ultra', 'p', opts);
    expect(p).toMatchObject({ image: 'in.png', strength: 0.6, style_preset: 'anime' });
    expect(p).not.toHaveProperty('model');
    expect(p).not.toHaveProperty('cfg_scale');
  });

  it('core carries neither image nor strength', () => {
    const p = buildGenerateParams('stable-image-core', 'p', opts);
    expect(p).not.toHaveProperty('image');
    expect(p).not.toHaveProperty('strength');
    expect(p.style_preset).toBe('anime');
  });

  it('keeps --strength without --image so validation can reject it (0.4.0 dropped it silently)', () => {
    const p = buildGenerateParams('stable-image-ultra', 'p', { prompt: [], outputFormat: 'png', strength: 0.5 });
    expect(p.strength).toBe(0.5);
    expect(p.image).toBeUndefined();
  });
});

describe('buildUpscaleParams', () => {
  const opts = { image: 'x.png', prompt: 'sharp', negativePrompt: 'blur', seed: 1, outputFormat: 'webp', creativity: 0.3, stylePreset: 'photographic' };

  it('conservative carries creativity but not style_preset', () => {
    const p = buildUpscaleParams('upscale-conservative', opts);
    expect(p).toMatchObject({ prompt: 'sharp', creativity: 0.3, output_format: 'webp' });
    expect(p).not.toHaveProperty('style_preset');
  });

  it('creative carries creativity and style_preset', () => {
    expect(buildUpscaleParams('upscale-creative', opts)).toMatchObject({ creativity: 0.3, style_preset: 'photographic' });
  });

  it('fast carries neither, and defaults output_format to png', () => {
    const p = buildUpscaleParams('upscale-fast', { image: 'x.png', outputFormat: '' });
    expect(p).not.toHaveProperty('creativity');
    expect(p.output_format).toBe('png');
  });
});

describe('buildEditParams', () => {
  it('outpaint sends only positive directions, plus creativity and prompt', () => {
    expect(buildEditParams('outpaint', { image: 'x', outputFormat: 'png', left: 100, right: 0, up: undefined, down: 50, creativity: 0.4, prompt: 'more wall' })).toEqual({
      output_format: 'png', left: 100, down: 50, creativity: 0.4, prompt: 'more wall',
    });
  });

  it('inpaint always sends the prompt, plus mask and grow_mask when given', () => {
    expect(buildEditParams('inpaint', { image: 'x', outputFormat: 'png', prompt: 'a fern', mask: 'm.png', growMask: 10 })).toEqual({
      output_format: 'png', prompt: 'a fern', mask: 'm.png', grow_mask: 10,
    });
    expect(buildEditParams('inpaint', { image: 'x', outputFormat: 'png', prompt: 'a fern' })).toEqual({ output_format: 'png', prompt: 'a fern' });
  });

  it('search-and-replace maps --search to search_prompt', () => {
    expect(buildEditParams('search-and-replace', { image: 'x', outputFormat: 'png', prompt: 'dog', search: 'cat', growMask: 3 })).toEqual({
      output_format: 'png', prompt: 'dog', search_prompt: 'cat', grow_mask: 3,
    });
  });

  it('search-and-recolor maps --select to select_prompt', () => {
    expect(buildEditParams('search-and-recolor', { image: 'x', outputFormat: 'png', prompt: 'blue', select: 'car' })).toMatchObject({
      prompt: 'blue', select_prompt: 'car',
    });
  });

  it('replace-background maps every relight flag to its API name', () => {
    expect(buildEditParams('replace-background-and-relight', {
      image: 'x', outputFormat: 'png', backgroundPrompt: 'beach', backgroundReference: 'bg.png', foregroundPrompt: 'person',
      preserveSubject: 0.6, backgroundDepth: 0.5, keepOriginalBg: true, lightDirection: 'left', lightReference: 'l.png', lightStrength: 0.3,
    })).toEqual({
      output_format: 'png', background_prompt: 'beach', background_reference: 'bg.png', foreground_prompt: 'person',
      preserve_original_subject: 0.6, original_background_depth: 0.5, keep_original_background: true,
      light_source_direction: 'left', light_reference: 'l.png', light_source_strength: 0.3,
    });
  });

  it('remove-background with jpeg is left to the validator and the API (one copy of the rule)', () => {
    expect(buildEditParams('remove-background', { image: 'x', outputFormat: 'jpeg' })).toEqual({ output_format: 'jpeg' });
  });

  it('common options apply to every operation; zero seed is kept', () => {
    expect(buildEditParams('erase', { image: 'x', outputFormat: 'png', seed: 0, negativePrompt: 'n', stylePreset: 's', mask: 'm.png', growMask: 0 })).toEqual({
      output_format: 'png', seed: 0, negative_prompt: 'n', style_preset: 's', mask: 'm.png', grow_mask: 0,
    });
  });
});

describe('buildControlParams', () => {
  it.each(['sketch', 'structure'])('%s maps --control-strength', (op) => {
    expect(buildControlParams(op, { outputFormat: 'png', prompt: 'p', controlStrength: 0.7 })).toEqual({
      output_format: 'png', prompt: 'p', control_strength: 0.7,
    });
  });

  it('style maps fidelity and aspect ratio', () => {
    expect(buildControlParams('style', { outputFormat: 'png', prompt: 'p', fidelity: 0.5, aspectRatio: '16:9' })).toEqual({
      output_format: 'png', prompt: 'p', fidelity: 0.5, aspect_ratio: '16:9',
    });
  });

  it('style-transfer maps its three strengths and an optional prompt', () => {
    expect(buildControlParams('style-transfer', { outputFormat: 'png', styleStrength: 1, compositionFidelity: 0.9, changeStrength: 0.5 })).toEqual({
      output_format: 'png', style_strength: 1, composition_fidelity: 0.9, change_strength: 0.5,
    });
  });
});

describe('requiredString', () => {
  it('returns a present value', () => {
    expect(requiredString('x.png', '--image')).toBe('x.png');
  });

  it.each([undefined, ''])('throws naming the flag for %o', (value) => {
    expect(() => requiredString(value, '--image')).toThrow('--image is required');
  });
});

describe('saveImageResult', () => {
  let dir;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sai-save-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes the image and metadata under <dir>/<model>/, named from the prompt, with the requested extension', async () => {
    const { imagePath, metadataPath } = await saveImageResult(
      { image: PNG_BYTES, finish_reason: 'SUCCESS', seed: '42' },
      'A Red Bicycle!',
      'sd3',
      { prompt: 'A Red Bicycle!', output_format: 'webp', seed: 0 },
      dir
    );

    expect(imagePath.startsWith(join(dir, 'sd3'))).toBe(true);
    expect(imagePath).toMatch(/_a_red_bicycle\.webp$/);
    expect(readFileSync(imagePath).equals(PNG_BYTES)).toBe(true);
    expect(metadataPath).toBe(imagePath.replace(/\.webp$/, '_metadata.json'));

    const meta = JSON.parse(readFileSync(metadataPath, 'utf8'));
    expect(meta).toMatchObject({
      model: 'sd3',
      parameters: { prompt: 'A Red Bicycle!', output_format: 'webp', seed: 0 },
      result: { finish_reason: 'SUCCESS', seed: '42', image_path: imagePath },
    });
    expect(readdirSync(join(dir, 'sd3'))).toHaveLength(2);
  });

  it('uses .png when no output_format was requested (the server default)', async () => {
    const { imagePath } = await saveImageResult({ image: PNG_BYTES }, 'p', 'stable-image-core', { prompt: 'p' }, dir);
    expect(imagePath).toMatch(/\.png$/);
  });
});
