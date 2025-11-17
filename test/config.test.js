/**
 * Configuration Tests
 * Tests for API configuration, endpoints, and constants
 */

import { describe, it, expect } from 'vitest';
import {
  BASE_URL,
  MODEL_ENDPOINTS,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_TIMEOUT,
  MAX_RETRIES,
  ASPECT_RATIOS,
  OUTPUT_FORMATS,
  getOutputDir,
  getPollInterval,
  getTimeout,
  validateModelParams,
  getModelConstraints,
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
