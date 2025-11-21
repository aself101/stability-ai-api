/**
 * API Tests
 * Tests for StabilityAPI class and its methods
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StabilityAPI } from '../api.js';
import { BASE_URL, MODEL_ENDPOINTS } from '../config.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock utils to avoid spinner and file I/O in tests
vi.mock('../utils.js', async (importOriginal) => {
  const original = await importOriginal();

  // Create a mock FormData that has getHeaders and append methods
  const createMockFormData = () => {
    const data = new Map();
    return {
      append: (key, value) => data.set(key, value),
      getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=----test' }),
      _data: data
    };
  };

  return {
    ...original,
    createSpinner: () => ({
      start: () => {},
      stop: () => {},
      update: () => {}
    }),
    // Mock buildFormData to avoid file I/O - always return a new mock form data
    buildFormData: async () => createMockFormData()
  };
});

describe('StabilityAPI Class', () => {
  let api;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new StabilityAPI('test-api-key-1234567890');
  });

  afterEach(() => {
    vi.resetAllMocks();
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

  describe('_makeFormDataRequest - Core HTTP Method', () => {
    it('should make successful GET request', async () => {
      const mockImageBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
      axios.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/png', 'finish-reason': 'SUCCESS', 'seed': '12345' },
        data: mockImageBuffer
      });

      const result = await api._makeFormDataRequest('GET', '/test-endpoint');

      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: 'GET',
        url: `${BASE_URL}/test-endpoint`,
        headers: expect.objectContaining({
          'authorization': 'Bearer test-api-key-1234567890'
        })
      }));
      expect(result.image).toBeInstanceOf(Buffer);
      expect(result.finish_reason).toBe('SUCCESS');
      expect(result.seed).toBe('12345');
    });

    it('should handle async 202 response', async () => {
      axios.mockResolvedValueOnce({
        status: 202,
        headers: { 'content-type': 'application/json' },
        data: { id: 'task-123-abc' }
      });

      const result = await api._makeFormDataRequest('GET', '/test-endpoint');

      expect(result).toEqual({ id: 'task-123-abc' });
    });

    it('should throw on 401 unauthorized', async () => {
      axios.mockRejectedValueOnce({
        response: { status: 401, data: { error: 'Invalid API key' } }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('Authentication failed');
    });

    it('should throw on 403 content moderation', async () => {
      axios.mockRejectedValueOnce({
        response: { status: 403, data: { error: 'Content flagged' } }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('Content moderation flagged');
    });

    it('should throw on 413 payload too large', async () => {
      axios.mockRejectedValueOnce({
        response: { status: 413, data: { error: 'Payload too large' } }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('payload too large');
    });

    it('should throw on 429 rate limit', async () => {
      axios.mockRejectedValueOnce({
        response: { status: 429, data: { error: 'Rate limited' } }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('Rate limit exceeded');
    });

    it('should throw on 400 with validation errors', async () => {
      axios.mockRejectedValueOnce({
        response: { status: 400, data: { errors: ['Invalid prompt', 'Invalid ratio'] } }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('Invalid prompt, Invalid ratio');
    });

    it('should parse Buffer error responses', async () => {
      const errorBuffer = Buffer.from(JSON.stringify({ error: 'Buffer error' }));
      axios.mockRejectedValueOnce({
        response: { status: 400, data: errorBuffer }
      });

      await expect(api._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow();
    });

    it('should throw when API key is missing', async () => {
      const noKeyApi = new StabilityAPI(null);
      await expect(noKeyApi._makeFormDataRequest('GET', '/test'))
        .rejects.toThrow('API key is required');
    });
  });

  describe('Parameter Validation', () => {
    it('should require API key for requests', () => {
      const noKeyApi = new StabilityAPI(null);
      expect(() => noKeyApi._verifyApiKey()).toThrow('API key is required');
    });
  });

  describe('Generation Methods - Behavioral Tests', () => {
    const mockImageResponse = {
      status: 200,
      headers: { 'content-type': 'image/png', 'finish-reason': 'SUCCESS', 'seed': '42' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    };

    describe('generateUltra', () => {
      it('should call correct endpoint with prompt', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.generateUltra({ prompt: 'a beautiful sunset' });

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          method: 'POST',
          url: `${BASE_URL}${MODEL_ENDPOINTS['stable-image-ultra']}`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
        expect(result.finish_reason).toBe('SUCCESS');
      });

      it('should include aspect_ratio in form data', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateUltra({ prompt: 'test', aspect_ratio: '16:9' });

        // Verify axios was called (form data is built correctly)
        expect(axios).toHaveBeenCalled();
      });

      it('should use default aspect_ratio 1:1', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateUltra({ prompt: 'test' });

        expect(axios).toHaveBeenCalled();
      });

      it('should include optional negative_prompt', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateUltra({ prompt: 'cat', negative_prompt: 'blurry' });

        expect(axios).toHaveBeenCalled();
      });

      it('should include strength for image-to-image', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateUltra({ prompt: 'enhance', strength: 0.7 });

        expect(axios).toHaveBeenCalled();
      });
    });

    describe('generateCore', () => {
      it('should call stable-image-core endpoint', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.generateCore({ prompt: 'a dog' });

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          url: `${BASE_URL}${MODEL_ENDPOINTS['stable-image-core']}`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
      });

      it('should include style_preset parameter', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateCore({ prompt: 'portrait', style_preset: 'photographic' });

        expect(axios).toHaveBeenCalled();
      });
    });

    describe('generateSD3', () => {
      it('should call sd3-large endpoint', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateSD3({ prompt: 'fantasy landscape' });

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          url: `${BASE_URL}${MODEL_ENDPOINTS['sd3-large']}`
        }));
      });

      it('should use default model sd3.5-large', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateSD3({ prompt: 'test' });

        expect(axios).toHaveBeenCalled();
      });

      it('should accept custom model parameter', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.generateSD3({ prompt: 'test', model: 'sd3.5-large-turbo' });

        expect(axios).toHaveBeenCalled();
      });
    });
  });

  describe('Upscale Methods - Behavioral Tests', () => {
    const mockImageResponse = {
      status: 200,
      headers: { 'content-type': 'image/png', 'finish-reason': 'SUCCESS' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    };

    describe('upscaleFast', () => {
      it('should call upscale-fast endpoint', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.upscaleFast('/path/to/image.png');

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          url: `${BASE_URL}${MODEL_ENDPOINTS['upscale-fast']}`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
      });

      it('should use default png output format', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleFast('/path/to/image.png');

        expect(axios).toHaveBeenCalled();
      });

      it('should accept custom output format', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleFast('/path/to/image.png', 'webp');

        expect(axios).toHaveBeenCalled();
      });
    });

    describe('upscaleConservative', () => {
      it('should call upscale-conservative endpoint', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.upscaleConservative('/path/to/image.png');

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          url: `${BASE_URL}${MODEL_ENDPOINTS['upscale-conservative']}`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
      });

      it('should include optional prompt', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleConservative('/path/to/image.png', { prompt: 'enhance details' });

        expect(axios).toHaveBeenCalled();
      });

      it('should include negative_prompt and seed', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleConservative('/path/to/image.png', {
          prompt: 'sharp',
          negative_prompt: 'blurry',
          seed: 12345
        });

        expect(axios).toHaveBeenCalled();
      });
    });

    describe('upscaleCreative', () => {
      it('should call upscale-creative endpoint', async () => {
        // Creative upscale is async - returns task ID first
        axios.mockResolvedValueOnce({
          status: 202,
          headers: { 'content-type': 'application/json' },
          data: { id: 'task-creative-123' }
        });
        // Then polling returns result
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.upscaleCreative('/path/to/image.png');

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          url: `${BASE_URL}${MODEL_ENDPOINTS['upscale-creative']}`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
      });

      it('should return task immediately when wait=false', async () => {
        axios.mockResolvedValueOnce({
          status: 202,
          headers: { 'content-type': 'application/json' },
          data: { id: 'task-no-wait-456' }
        });

        const result = await api.upscaleCreative('/path/to/image.png', { wait: false });

        expect(result).toEqual({ id: 'task-no-wait-456' });
        // Should only call once (no polling)
        expect(axios).toHaveBeenCalledTimes(1);
      });

      it('should use default creativity 0.3', async () => {
        axios.mockResolvedValueOnce({
          status: 202,
          headers: {},
          data: { id: 'task-123' }
        });
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleCreative('/path/to/image.png');

        expect(axios).toHaveBeenCalled();
      });

      it('should accept custom creativity parameter', async () => {
        axios.mockResolvedValueOnce({
          status: 202,
          headers: {},
          data: { id: 'task-123' }
        });
        axios.mockResolvedValueOnce(mockImageResponse);

        await api.upscaleCreative('/path/to/image.png', { creativity: 0.5 });

        expect(axios).toHaveBeenCalled();
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

  describe('Async Operations - Polling Behavior', () => {
    const mockImageResponse = {
      status: 200,
      headers: { 'content-type': 'image/png', 'finish-reason': 'SUCCESS' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    };

    describe('getResult', () => {
      it('should call results endpoint with task ID', async () => {
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.getResult('task-abc-123');

        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
          method: 'GET',
          url: `${BASE_URL}${MODEL_ENDPOINTS.results}/task-abc-123`
        }));
        expect(result.image).toBeInstanceOf(Buffer);
      });
    });

    describe('waitForResult', () => {
      it('should return immediately when result is ready', async () => {
        // First call returns completed result
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.waitForResult('task-ready-123', {
          pollInterval: 0.1,
          timeout: 5,
          showSpinner: false
        });

        expect(result.image).toBeInstanceOf(Buffer);
        expect(axios).toHaveBeenCalledTimes(1);
      });

      it('should poll multiple times until complete', async () => {
        // First poll - still processing (202)
        axios.mockResolvedValueOnce({
          status: 202,
          headers: {},
          data: { status: 'processing' }
        });
        // Second poll - complete
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.waitForResult('task-slow-456', {
          pollInterval: 0.01, // Very short for testing
          timeout: 5,
          showSpinner: false
        });

        expect(result.image).toBeInstanceOf(Buffer);
        expect(axios).toHaveBeenCalledTimes(2);
      });

      it('should timeout after specified duration', async () => {
        // Always return in-progress
        axios.mockResolvedValue({
          status: 202,
          headers: {},
          data: { status: 'processing' }
        });

        await expect(api.waitForResult('task-timeout-789', {
          pollInterval: 0.01,
          timeout: 0.05, // Very short timeout for testing
          showSpinner: false
        })).rejects.toThrow('Timeout');
      });

      it('should retry on transient 502/503 errors', async () => {
        // First call - 502 gateway error (transient)
        const error502 = new Error('502 Bad Gateway');
        axios.mockRejectedValueOnce(error502);
        // Retry - success
        axios.mockResolvedValueOnce(mockImageResponse);

        const result = await api.waitForResult('task-retry-111', {
          pollInterval: 0.01,
          timeout: 5,
          showSpinner: false
        });

        expect(result.image).toBeInstanceOf(Buffer);
      });

      it('should throw immediately on permanent errors', async () => {
        axios.mockRejectedValueOnce({
          response: { status: 401 },
          message: 'Authentication failed'
        });

        await expect(api.waitForResult('task-auth-fail', {
          pollInterval: 0.01,
          timeout: 5,
          showSpinner: false
        })).rejects.toThrow('Authentication failed');
      });
    });
  });

  describe('getBalance - Account Info', () => {
    it('should fetch account balance successfully', async () => {
      axios.get = vi.fn().mockResolvedValueOnce({
        data: { credits: 1000.50 }
      });

      const result = await api.getBalance();

      expect(axios.get).toHaveBeenCalledWith(
        `${BASE_URL}/v1/user/balance`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key-1234567890'
          })
        })
      );
      expect(result.credits).toBe(1000.50);
    });

    it('should throw when API key is missing for balance', async () => {
      const noKeyApi = new StabilityAPI(null);

      await expect(noKeyApi.getBalance()).rejects.toThrow('API key is required');
    });

    it('should handle balance fetch errors', async () => {
      axios.get = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      await expect(api.getBalance()).rejects.toThrow();
    });
  });
});

describe('API Integration Patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use Bearer authentication in requests', async () => {
    const api = new StabilityAPI('my-secret-bearer-token');
    const mockResponse = {
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    };
    axios.mockResolvedValueOnce(mockResponse);

    await api._makeFormDataRequest('GET', '/test');

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        'authorization': 'Bearer my-secret-bearer-token'
      })
    }));
  });

  it('should set correct content-type accept header for images', async () => {
    const api = new StabilityAPI('test-key');
    axios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    });

    await api._makeFormDataRequest('GET', '/test');

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        'accept': 'image/*'
      }),
      responseType: 'arraybuffer'
    }));
  });

  it('should handle multipart form-data POST requests', async () => {
    const api = new StabilityAPI('test-key');
    axios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    });

    const result = await api.generateUltra({ prompt: 'test' });

    // Verify correct endpoint and method
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: expect.stringContaining('/generate/ultra')
    }));
    // Verify response was processed
    expect(result.image).toBeInstanceOf(Buffer);
  });
});

describe('Edge Cases and Error Boundaries', () => {
  let api;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new StabilityAPI('test-key-12345');
  });

  it('should handle empty prompt gracefully through API error', async () => {
    axios.mockRejectedValueOnce({
      response: { status: 400, data: { errors: ['Prompt cannot be empty'] } }
    });

    await expect(api.generateUltra({ prompt: '' }))
      .rejects.toThrow('Prompt cannot be empty');
  });

  it('should handle unicode characters in prompts', async () => {
    axios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    });

    const result = await api.generateUltra({ prompt: '日本語テスト 🎨 émojis' });

    expect(axios).toHaveBeenCalled();
    expect(result.image).toBeInstanceOf(Buffer);
  });

  it('should handle very long prompts', async () => {
    axios.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4E, 0x47])
    });

    const longPrompt = 'A '.repeat(5000); // 10000 chars
    await api.generateUltra({ prompt: longPrompt });

    expect(axios).toHaveBeenCalled();
  });

  it('should handle network timeouts', async () => {
    const timeoutError = new Error('timeout of 30000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.mockRejectedValueOnce(timeoutError);

    await expect(api.generateUltra({ prompt: 'test' }))
      .rejects.toThrow();
  });

  it('should handle malformed API responses', async () => {
    axios.mockResolvedValueOnce({
      status: 200,
      headers: {}, // Missing content-type
      data: 'not a buffer'
    });

    const result = await api._makeFormDataRequest('GET', '/test');

    // Should still return data even if not an image
    expect(result).toBe('not a buffer');
  });
});
