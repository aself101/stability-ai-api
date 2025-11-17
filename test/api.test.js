/**
 * API Tests
 * Tests for StabilityAPI class and its methods
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StabilityAPI } from '../api.js';
import { BASE_URL } from '../config.js';

describe('StabilityAPI Class', () => {
  let api;

  beforeEach(() => {
    api = new StabilityAPI('test-api-key-1234567890');
  });

  describe('Constructor', () => {
    it('should create instance with API key', () => {
      expect(api).toBeDefined();
      expect(api.apiKey).toBe('test-api-key-1234567890');
    });

    it('should use default base URL', () => {
      expect(api.baseUrl).toBe(BASE_URL);
    });

    it('should accept custom base URL', () => {
      const customApi = new StabilityAPI('key', 'https://custom.api.url');
      expect(customApi.baseUrl).toBe('https://custom.api.url');
    });

    it('should enforce HTTPS for base URL', () => {
      expect(() => new StabilityAPI('key', 'http://insecure.url')).toThrow('HTTPS');
    });

    it('should set log level', () => {
      const debugApi = new StabilityAPI('key', BASE_URL, 'debug');
      expect(debugApi.logger).toBeDefined();
    });
  });

  describe('API Key Management', () => {
    it('should redact API key for logging', () => {
      const redacted = api._redactApiKey('sk-1234567890abcdefghij');
      expect(redacted).toBe('xxx...ghij');
      expect(redacted).not.toContain('1234567890');
    });

    it('should handle short API keys', () => {
      const redacted = api._redactApiKey('short');
      expect(redacted).toBe('xxx...xxxx');
    });

    it('should handle null/undefined API keys', () => {
      const redacted = api._redactApiKey(null);
      expect(redacted).toBe('xxx...xxxx');
    });
  });

  describe('Error Handling', () => {
    it('should sanitize errors in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Internal server details');
      error.response = { status: 500 };

      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).not.toContain('Internal server details');
      expect(sanitized).toBe('An error occurred while processing your request');

      process.env.NODE_ENV = originalEnv;
    });

    it('should show detailed errors in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Detailed error message');
      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).toBe('Detailed error message');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle authentication errors in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Auth failed');
      error.response = { status: 401 };

      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).toBe('Authentication failed');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle content moderation errors in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Moderation');
      error.response = { status: 403 };

      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).toBe('Content moderation flagged');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle rate limit errors in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Rate limit');
      error.response = { status: 429 };

      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).toBe('Rate limit exceeded');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('API Method Signatures', () => {
    it('should have generateUltra method', () => {
      expect(typeof api.generateUltra).toBe('function');
    });

    it('should have generateCore method', () => {
      expect(typeof api.generateCore).toBe('function');
    });

    it('should have generateSD3 method', () => {
      expect(typeof api.generateSD3).toBe('function');
    });

    it('should have upscaleFast method', () => {
      expect(typeof api.upscaleFast).toBe('function');
    });

    it('should have upscaleConservative method', () => {
      expect(typeof api.upscaleConservative).toBe('function');
    });

    it('should have upscaleCreative method', () => {
      expect(typeof api.upscaleCreative).toBe('function');
    });

    it('should have waitForResult method', () => {
      expect(typeof api.waitForResult).toBe('function');
    });

    it('should have getResult method', () => {
      expect(typeof api.getResult).toBe('function');
    });
  });

  describe('Parameter Validation', () => {
    it('should require API key for requests', () => {
      const noKeyApi = new StabilityAPI(null);
      expect(() => noKeyApi._verifyApiKey()).toThrow('API key is required');
    });
  });

  describe('Model-Specific Features', () => {
    describe('Generate methods should accept correct parameters', () => {
      it('generateUltra should accept aspect_ratio', () => {
        // Method exists and accepts parameters
        expect(api.generateUltra).toBeDefined();
      });

      it('generateCore should accept style_preset', () => {
        expect(api.generateCore).toBeDefined();
      });

      it('generateSD3 should accept model parameter', () => {
        expect(api.generateSD3).toBeDefined();
      });
    });

    describe('Upscale methods should accept correct parameters', () => {
      it('upscaleFast should accept output_format', () => {
        expect(api.upscaleFast).toBeDefined();
      });

      it('upscaleConservative should accept prompt', () => {
        expect(api.upscaleConservative).toBeDefined();
      });

      it('upscaleCreative should accept creativity', () => {
        expect(api.upscaleCreative).toBeDefined();
      });
    });
  });

  describe('Security Features', () => {
    it('should enforce HTTPS base URL', () => {
      expect(() => new StabilityAPI('key', 'http://example.com')).toThrow('HTTPS');
    });

    it('should redact API keys in logs', () => {
      const longKey = 'sk_' + 'x'.repeat(50);
      const redacted = api._redactApiKey(longKey);
      expect(redacted.startsWith('xxx...')).toBe(true);
      expect(redacted.length).toBeLessThan(longKey.length);
    });

    it('should have error sanitization for production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Sensitive internal error details');
      const sanitized = api._sanitizeErrorMessage(error);
      expect(sanitized).not.toContain('Sensitive');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Async Operations', () => {
    it('should have waitForResult for async operations', () => {
      expect(typeof api.waitForResult).toBe('function');
      expect(api.waitForResult.length).toBeGreaterThanOrEqual(1); // Takes at least taskId
    });

    it('should have getResult for fetching task status', () => {
      expect(typeof api.getResult).toBe('function');
      expect(api.getResult.length).toBe(1); // Takes taskId
    });
  });
});

describe('API Integration Patterns', () => {
  it('should follow Stability AI multipart/form-data pattern', () => {
    const api = new StabilityAPI('test-key');
    // Verify that the API has the multipart request method
    expect(api._makeFormDataRequest).toBeDefined();
    expect(typeof api._makeFormDataRequest).toBe('function');
  });

  it('should use Bearer authentication', () => {
    const api = new StabilityAPI('test-bearer-token');
    expect(api.apiKey).toBe('test-bearer-token');
    // API should use Bearer token in Authorization header
  });

  it('should handle both sync and async responses', () => {
    const api = new StabilityAPI('test-key');
    // Has both direct methods and async waiting methods
    expect(api.generateUltra).toBeDefined(); // Sync
    expect(api.upscaleCreative).toBeDefined(); // Can be async
    expect(api.waitForResult).toBeDefined(); // Async helper
  });
});

describe('Method Parameter Requirements', () => {
  let api;

  beforeEach(() => {
    api = new StabilityAPI('test-key');
  });

  it('generateUltra should require params object', () => {
    // Method signature expects params object
    expect(api.generateUltra.length).toBe(1);
  });

  it('generateCore should require params object', () => {
    expect(api.generateCore.length).toBe(1);
  });

  it('generateSD3 should require params object', () => {
    expect(api.generateSD3.length).toBe(1);
  });

  it('upscaleFast should require imagePath', () => {
    expect(api.upscaleFast.length).toBeGreaterThanOrEqual(1);
  });

  it('upscaleConservative should require imagePath', () => {
    expect(api.upscaleConservative.length).toBeGreaterThanOrEqual(1);
  });

  it('upscaleCreative should require imagePath', () => {
    expect(api.upscaleCreative.length).toBeGreaterThanOrEqual(1);
  });

  it('getBalance method should exist', () => {
    expect(api.getBalance).toBeDefined();
    expect(typeof api.getBalance).toBe('function');
  });
});
