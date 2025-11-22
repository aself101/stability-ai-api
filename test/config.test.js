/**
 * Configuration Tests
 * Tests for API configuration, endpoints, and constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BASE_URL,
  MODEL_ENDPOINTS,
  EDIT_ENDPOINTS,
  EDIT_CONSTRAINTS,
  STYLE_PRESETS,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MAX_RETRIES,
  ASPECT_RATIOS,
  OUTPUT_FORMATS,
  getOutputDir,
  getPollInterval,
  getTimeout,
  getStabilityApiKey,
  validateModelParams,
  getModelConstraints,
  validateEditParams,
  getEditConstraints,
  validateApiKeyFormat
} from '../config.js';

describe('Configuration Constants', () => {
  describe('Base URL', () => {
    it('should have valid BASE_URL', () => {
      expect(BASE_URL).toBeDefined();
      expect(BASE_URL).toBe('https://api.stability.ai');
      expect(BASE_URL.startsWith('https://')).toBe(true);
    });
  });

  describe('Default Values', () => {
    it('should have DEFAULT_POLL_INTERVAL of 10 seconds', () => {
      expect(DEFAULT_POLL_INTERVAL).toBe(10);
    });

    it('should have DEFAULT_TIMEOUT of 300 seconds', () => {
      expect(DEFAULT_TIMEOUT).toBe(300);
    });

    it('should have MAX_RETRIES of 3', () => {
      expect(MAX_RETRIES).toBe(3);
    });
  });

  describe('Model Endpoints', () => {
    it('should have all endpoints defined', () => {
      expect(MODEL_ENDPOINTS).toBeDefined();
      expect(Object.keys(MODEL_ENDPOINTS).length).toBeGreaterThanOrEqual(9);
    });

    it('should have generate endpoints', () => {
      expect(MODEL_ENDPOINTS['stable-image-ultra']).toBe('/v2beta/stable-image/generate/ultra');
      expect(MODEL_ENDPOINTS['stable-image-core']).toBe('/v2beta/stable-image/generate/core');
      expect(MODEL_ENDPOINTS['sd3-large']).toBe('/v2beta/stable-image/generate/sd3');
    });

    it('should have upscale endpoints', () => {
      expect(MODEL_ENDPOINTS['upscale-fast']).toBe('/v2beta/stable-image/upscale/fast');
      expect(MODEL_ENDPOINTS['upscale-conservative']).toBe('/v2beta/stable-image/upscale/conservative');
      expect(MODEL_ENDPOINTS['upscale-creative']).toBe('/v2beta/stable-image/upscale/creative');
    });

    it('should have results endpoint', () => {
      expect(MODEL_ENDPOINTS.results).toBe('/v2beta/results');
    });

    it('should have valid endpoint paths', () => {
      Object.values(MODEL_ENDPOINTS).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/v2beta\//);
      });
    });
  });

  describe('Aspect Ratios', () => {
    it('should have valid aspect ratios', () => {
      expect(ASPECT_RATIOS).toBeDefined();
      expect(ASPECT_RATIOS).toContain('1:1');
      expect(ASPECT_RATIOS).toContain('16:9');
      expect(ASPECT_RATIOS).toContain('21:9');
      expect(ASPECT_RATIOS.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('Output Formats', () => {
    it('should have valid output formats', () => {
      expect(OUTPUT_FORMATS).toBeDefined();
      expect(OUTPUT_FORMATS).toContain('png');
      expect(OUTPUT_FORMATS).toContain('jpeg');
      expect(OUTPUT_FORMATS).toContain('webp');
    });
  });
});

describe('Configuration Functions', () => {
  describe('getOutputDir', () => {
    it('should return default output directory', () => {
      const dir = getOutputDir();
      expect(dir).toBeDefined();
      expect(dir).toBe('datasets/stability');
    });
  });

  describe('getPollInterval', () => {
    it('should return poll interval', () => {
      const interval = getPollInterval();
      expect(interval).toBeDefined();
      expect(typeof interval).toBe('number');
      expect(interval).toBeGreaterThan(0);
    });

    it('should return DEFAULT_POLL_INTERVAL when env not set', () => {
      const interval = getPollInterval();
      expect(interval).toBe(DEFAULT_POLL_INTERVAL);
    });
  });

  describe('getTimeout', () => {
    it('should return timeout value', () => {
      const timeout = getTimeout();
      expect(timeout).toBeDefined();
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThan(0);
    });

    it('should return DEFAULT_TIMEOUT when env not set', () => {
      const timeout = getTimeout();
      expect(timeout).toBe(DEFAULT_TIMEOUT);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });

    it('should reject null', () => {
      expect(validateApiKeyFormat(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(validateApiKeyFormat(undefined)).toBe(false);
    });

    it('should reject short keys', () => {
      expect(validateApiKeyFormat('short')).toBe(false);
      expect(validateApiKeyFormat('abc123')).toBe(false);
    });

    it('should accept valid-looking keys', () => {
      expect(validateApiKeyFormat('this-is-a-valid-looking-api-key')).toBe(true);
      expect(validateApiKeyFormat('sk_test_1234567890abcdef')).toBe(true);
    });

    it('should require minimum length of 10', () => {
      expect(validateApiKeyFormat('a'.repeat(9))).toBe(false);
      expect(validateApiKeyFormat('a'.repeat(10))).toBe(true);
      expect(validateApiKeyFormat('a'.repeat(11))).toBe(true);
    });
  });

  describe('validateModelParams', () => {
    describe('stable-image-ultra validation', () => {
      it('should accept valid parameters', () => {
        const result = validateModelParams('stable-image-ultra', {
          prompt: 'a cat',
          aspect_ratio: '1:1',
          seed: 42,
          output_format: 'png'
        });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject invalid aspect ratio', () => {
        const result = validateModelParams('stable-image-ultra', {
          aspect_ratio: '32:9'
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid aspect_ratio'))).toBe(true);
      });

      it('should validate seed range', () => {
        const result = validateModelParams('stable-image-ultra', {
          seed: 5000000000 // Too large
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Seed must be between'))).toBe(true);
      });

      it('should validate strength range', () => {
        const result = validateModelParams('stable-image-ultra', {
          strength: 2 // Out of range
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Strength must be between'))).toBe(true);
      });

      it('should reject prompt exceeding max length', () => {
        const longPrompt = 'a'.repeat(10001);
        const result = validateModelParams('stable-image-ultra', {
          prompt: longPrompt
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('exceeds maximum length'))).toBe(true);
      });
    });

    describe('stable-image-core validation', () => {
      it('should accept valid parameters', () => {
        const result = validateModelParams('stable-image-core', {
          prompt: 'a dog',
          aspect_ratio: '16:9',
          style_preset: 'photographic'
        });
        expect(result.valid).toBe(true);
      });

      it('should validate style preset', () => {
        const result = validateModelParams('stable-image-core', {
          style_preset: 'invalid-style'
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid style_preset'))).toBe(true);
      });
    });

    describe('sd3 validation', () => {
      it('should accept valid SD3 models', () => {
        const models = ['sd3.5-large', 'sd3.5-medium', 'sd3.5-large-turbo'];
        models.forEach(model => {
          const result = validateModelParams('sd3', { model });
          expect(result.valid).toBe(true);
        });
      });

      it('should reject invalid model', () => {
        const result = validateModelParams('sd3', { model: 'invalid-model' });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid model'))).toBe(true);
      });
    });

    describe('upscale validation', () => {
      it('should accept valid upscale-fast parameters', () => {
        const result = validateModelParams('upscale-fast', {
          output_format: 'png'
        });
        expect(result.valid).toBe(true);
      });

      it('should validate creativity range for creative upscale', () => {
        const validResult = validateModelParams('upscale-creative', {
          creativity: 0.3
        });
        expect(validResult.valid).toBe(true);

        const invalidResult = validateModelParams('upscale-creative', {
          creativity: 0.6 // Too high
        });
        expect(invalidResult.valid).toBe(false);
        expect(invalidResult.errors.some(e => e.includes('Creativity must be between'))).toBe(true);
      });
    });

    describe('unknown model', () => {
      it('should reject unknown model', () => {
        const result = validateModelParams('invalid-model', {});
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Unknown model'))).toBe(true);
      });
    });
  });

  describe('getModelConstraints', () => {
    it('should return constraints for valid model', () => {
      const constraints = getModelConstraints('stable-image-ultra');
      expect(constraints).toBeDefined();
      expect(constraints.aspectRatios).toBeDefined();
      expect(constraints.seed).toBeDefined();
    });

    it('should return null for invalid model', () => {
      const constraints = getModelConstraints('invalid-model');
      expect(constraints).toBeNull();
    });
  });
});

// ==================== Edit Features Tests ====================

describe('Edit Configuration', () => {
  describe('EDIT_ENDPOINTS', () => {
    it('should have all 7 edit endpoints defined', () => {
      expect(EDIT_ENDPOINTS).toBeDefined();
      expect(Object.keys(EDIT_ENDPOINTS).length).toBe(7);
    });

    it('should have correct endpoint paths', () => {
      expect(EDIT_ENDPOINTS['erase']).toBe('/v2beta/stable-image/edit/erase');
      expect(EDIT_ENDPOINTS['inpaint']).toBe('/v2beta/stable-image/edit/inpaint');
      expect(EDIT_ENDPOINTS['outpaint']).toBe('/v2beta/stable-image/edit/outpaint');
      expect(EDIT_ENDPOINTS['search-and-replace']).toBe('/v2beta/stable-image/edit/search-and-replace');
      expect(EDIT_ENDPOINTS['search-and-recolor']).toBe('/v2beta/stable-image/edit/search-and-recolor');
      expect(EDIT_ENDPOINTS['remove-background']).toBe('/v2beta/stable-image/edit/remove-background');
      expect(EDIT_ENDPOINTS['replace-background-and-relight']).toBe('/v2beta/stable-image/edit/replace-background-and-relight');
    });

    it('should have valid v2beta paths for all endpoints', () => {
      Object.values(EDIT_ENDPOINTS).forEach(endpoint => {
        expect(endpoint).toMatch(/^\/v2beta\/stable-image\/edit\//);
      });
    });
  });

  describe('EDIT_CONSTRAINTS', () => {
    it('should have constraints for all 7 edit operations', () => {
      expect(EDIT_CONSTRAINTS).toBeDefined();
      expect(Object.keys(EDIT_CONSTRAINTS).length).toBe(7);
    });

    it('should have correct erase constraints', () => {
      const erase = EDIT_CONSTRAINTS['erase'];
      expect(erase.grow_mask).toEqual({ min: 0, max: 20, default: 5 });
      expect(erase.seed).toBeDefined();
      expect(erase.outputFormats).toContain('png');
    });

    it('should have correct inpaint constraints', () => {
      const inpaint = EDIT_CONSTRAINTS['inpaint'];
      expect(inpaint.promptMaxLength).toBe(10000);
      expect(inpaint.grow_mask).toEqual({ min: 0, max: 100, default: 5 });
      expect(inpaint.stylePresets).toBeDefined();
    });

    it('should have correct outpaint constraints', () => {
      const outpaint = EDIT_CONSTRAINTS['outpaint'];
      expect(outpaint.direction).toEqual({ min: 0, max: 2000 });
      expect(outpaint.creativity).toEqual({ min: 0, max: 1, default: 0.5 });
      expect(outpaint.requiresAspectRatio).toBe(true);
    });

    it('should have stricter remove-background constraints', () => {
      const removeBg = EDIT_CONSTRAINTS['remove-background'];
      expect(removeBg.pixels.max).toBe(4194304); // 4MP max (stricter)
      expect(removeBg.outputFormats).not.toContain('jpeg'); // No JPEG
      expect(removeBg.outputFormats).toContain('png');
      expect(removeBg.outputFormats).toContain('webp');
    });

    it('should have async flag for replace-background-and-relight', () => {
      const replaceBg = EDIT_CONSTRAINTS['replace-background-and-relight'];
      expect(replaceBg.async).toBe(true);
      expect(replaceBg.light_source_directions).toContain('left');
      expect(replaceBg.light_source_directions).toContain('right');
      expect(replaceBg.light_source_directions).toContain('above');
      expect(replaceBg.light_source_directions).toContain('below');
    });
  });

  describe('STYLE_PRESETS', () => {
    it('should have all 17 style presets', () => {
      expect(STYLE_PRESETS).toBeDefined();
      expect(STYLE_PRESETS.length).toBe(17);
    });

    it('should include common style presets', () => {
      expect(STYLE_PRESETS).toContain('photographic');
      expect(STYLE_PRESETS).toContain('anime');
      expect(STYLE_PRESETS).toContain('cinematic');
      expect(STYLE_PRESETS).toContain('digital-art');
      expect(STYLE_PRESETS).toContain('pixel-art');
      expect(STYLE_PRESETS).toContain('tile-texture');
    });
  });
});

describe('validateEditParams', () => {
  describe('erase validation', () => {
    it('should accept valid erase parameters', () => {
      const result = validateEditParams('erase', {
        grow_mask: 5,
        output_format: 'png'
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid grow_mask for erase', () => {
      const result = validateEditParams('erase', { grow_mask: 25 }); // Max is 20
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('grow_mask'))).toBe(true);
    });
  });

  describe('inpaint validation', () => {
    it('should accept valid inpaint parameters', () => {
      const result = validateEditParams('inpaint', {
        prompt: 'blue sky',
        grow_mask: 50,
        style_preset: 'photographic'
      });
      expect(result.valid).toBe(true);
    });

    it('should reject prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(10001);
      const result = validateEditParams('inpaint', { prompt: longPrompt });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum length'))).toBe(true);
    });

    it('should reject invalid style preset', () => {
      const result = validateEditParams('inpaint', { style_preset: 'invalid-style' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid style_preset'))).toBe(true);
    });
  });

  describe('outpaint validation', () => {
    it('should accept valid outpaint parameters', () => {
      const result = validateEditParams('outpaint', {
        left: 200,
        right: 200,
        creativity: 0.5
      });
      expect(result.valid).toBe(true);
    });

    it('should require at least one direction', () => {
      const result = validateEditParams('outpaint', { creativity: 0.5 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('At least one direction'))).toBe(true);
    });

    it('should reject direction values exceeding 2000', () => {
      const result = validateEditParams('outpaint', { left: 2500 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('left must be between'))).toBe(true);
    });

    it('should reject creativity out of range', () => {
      const result = validateEditParams('outpaint', { left: 100, creativity: 1.5 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Creativity must be between'))).toBe(true);
    });
  });

  describe('search-and-replace validation', () => {
    it('should accept valid search-and-replace parameters', () => {
      const result = validateEditParams('search-and-replace', {
        prompt: 'golden retriever',
        search_prompt: 'cat',
        grow_mask: 3
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid grow_mask', () => {
      const result = validateEditParams('search-and-replace', { grow_mask: 25 });
      expect(result.valid).toBe(false);
    });
  });

  describe('search-and-recolor validation', () => {
    it('should accept valid search-and-recolor parameters', () => {
      const result = validateEditParams('search-and-recolor', {
        prompt: 'bright red',
        select_prompt: 'car',
        grow_mask: 3
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('remove-background validation', () => {
    it('should accept valid remove-background parameters', () => {
      const result = validateEditParams('remove-background', { output_format: 'png' });
      expect(result.valid).toBe(true);
    });

    it('should accept webp output format', () => {
      const result = validateEditParams('remove-background', { output_format: 'webp' });
      expect(result.valid).toBe(true);
    });

    it('should reject jpeg output format', () => {
      const result = validateEditParams('remove-background', { output_format: 'jpeg' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('output_format'))).toBe(true);
    });
  });

  describe('replace-background-and-relight validation', () => {
    it('should accept valid parameters with background_prompt', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'sunset beach',
        light_source_direction: 'right'
      });
      expect(result.valid).toBe(true);
    });

    it('should accept valid parameters with background_reference', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_reference: '/path/to/image.jpg'
      });
      expect(result.valid).toBe(true);
    });

    it('should require background_prompt or background_reference', () => {
      const result = validateEditParams('replace-background-and-relight', {
        light_source_direction: 'right'
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('background_prompt or background_reference'))).toBe(true);
    });

    it('should validate light_source_direction values', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        light_source_direction: 'invalid'
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('light_source_direction'))).toBe(true);
    });

    it('should require light_reference or light_source_direction for light_source_strength', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        light_source_strength: 0.5
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('light_source_strength requires'))).toBe(true);
    });

    it('should accept light_source_strength with light_source_direction', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        light_source_direction: 'above',
        light_source_strength: 0.5
      });
      expect(result.valid).toBe(true);
    });

    it('should accept light_source_strength with light_reference', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        light_reference: '/path/to/light.jpg',
        light_source_strength: 0.5
      });
      expect(result.valid).toBe(true);
    });

    it('should validate preserve_original_subject range', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        preserve_original_subject: 1.5
      });
      expect(result.valid).toBe(false);
    });

    it('should validate original_background_depth range', () => {
      const result = validateEditParams('replace-background-and-relight', {
        background_prompt: 'test',
        original_background_depth: -0.5
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('unknown operation', () => {
    it('should reject unknown edit operation', () => {
      const result = validateEditParams('invalid-operation', {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown edit operation'))).toBe(true);
    });
  });
});

describe('getEditConstraints', () => {
  it('should return constraints for valid edit operation', () => {
    const constraints = getEditConstraints('inpaint');
    expect(constraints).toBeDefined();
    expect(constraints.promptMaxLength).toBe(10000);
    expect(constraints.grow_mask).toBeDefined();
  });

  it('should return null for invalid edit operation', () => {
    const constraints = getEditConstraints('invalid-operation');
    expect(constraints).toBeNull();
  });
});

describe('getStabilityApiKey', () => {
  const originalEnv = process.env.STABILITY_API_KEY;

  beforeEach(() => {
    // Clear environment before each test
    delete process.env.STABILITY_API_KEY;
  });

  afterEach(() => {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.STABILITY_API_KEY = originalEnv;
    } else {
      delete process.env.STABILITY_API_KEY;
    }
  });

  describe('CLI flag priority', () => {
    it('should return CLI-provided key when passed', () => {
      const cliKey = 'cli-provided-api-key-12345';
      const result = getStabilityApiKey(cliKey);
      expect(result).toBe(cliKey);
    });

    it('should prioritize CLI key over environment variable', () => {
      process.env.STABILITY_API_KEY = 'env-api-key-12345';
      const cliKey = 'cli-api-key-overrides';
      const result = getStabilityApiKey(cliKey);
      expect(result).toBe(cliKey);
    });

    it('should use CLI key even when it is different format', () => {
      const cliKey = 'sk-custom-format-key';
      const result = getStabilityApiKey(cliKey);
      expect(result).toBe(cliKey);
    });
  });

  describe('Environment variable fallback', () => {
    it('should return env key when no CLI key provided', () => {
      const envKey = 'env-stability-api-key-98765';
      process.env.STABILITY_API_KEY = envKey;
      const result = getStabilityApiKey();
      expect(result).toBe(envKey);
    });

    it('should return env key when CLI key is null', () => {
      const envKey = 'fallback-env-key-54321';
      process.env.STABILITY_API_KEY = envKey;
      const result = getStabilityApiKey(null);
      expect(result).toBe(envKey);
    });

    it('should return env key when CLI key is undefined', () => {
      const envKey = 'undefined-fallback-key-11111';
      process.env.STABILITY_API_KEY = envKey;
      const result = getStabilityApiKey(undefined);
      expect(result).toBe(envKey);
    });
  });

  describe('Error handling', () => {
    it('should throw error when no API key available', () => {
      expect(() => getStabilityApiKey()).toThrow('STABILITY_API_KEY not found');
    });

    it('should throw error with instructions when key missing', () => {
      expect(() => getStabilityApiKey()).toThrow('CLI flag');
      expect(() => getStabilityApiKey()).toThrow('Environment var');
      expect(() => getStabilityApiKey()).toThrow('Local .env file');
      expect(() => getStabilityApiKey()).toThrow('Global config');
      expect(() => getStabilityApiKey()).toThrow('platform.stability.ai');
    });

    it('should throw error when CLI key is empty string', () => {
      expect(() => getStabilityApiKey('')).toThrow('STABILITY_API_KEY not found');
    });

    it('should throw error when env key is empty string', () => {
      process.env.STABILITY_API_KEY = '';
      expect(() => getStabilityApiKey()).toThrow('STABILITY_API_KEY not found');
    });
  });
});
