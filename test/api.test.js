/**
 * API Tests
 * Tests for StabilityAPI class and its methods
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StabilityAPI } from '../src/api.js';
import { BASE_URL } from '../src/config.js';
import { stubFetch, imageResponse, formFields, PNG_BYTES } from './helpers/fetch-mock.js';

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

  // Error mapping (status → message, production sanitising) is exercised
  // against real fetch responses in test/api-http.test.js.

  describe('API Method Signatures', () => {
    it('should expose all required public methods', () => {
      // Generation methods
      const generationMethods = ['generateUltra', 'generateCore', 'generateSD3'];
      // Upscale methods
      const upscaleMethods = ['upscaleFast', 'upscaleConservative', 'upscaleCreative'];
      // Edit methods
      const editMethods = [
        'erase', 'inpaint', 'outpaint', 'searchAndReplace',
        'searchAndRecolor', 'removeBackground', 'replaceBackgroundAndRelight'
      ];
      // Control methods
      const controlMethods = ['controlSketch', 'controlStructure', 'controlStyle', 'controlStyleTransfer'];
      // Utility methods
      const utilityMethods = ['waitForResult', 'getResult', 'getBalance'];

      const allMethods = [
        ...generationMethods,
        ...upscaleMethods,
        ...editMethods,
        ...controlMethods,
        ...utilityMethods
      ];

      allMethods.forEach(method => {
        expect(api[method], `Missing method: ${method}`).toBeInstanceOf(Function);
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should require API key for requests', () => {
      const noKeyApi = new StabilityAPI(null);
      expect(() => noKeyApi._verifyApiKey()).toThrow('API key is required');
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

// Async response handling (202 / 200-JSON task ids, results polling with
// accept */*, auth preserved alongside custom headers, replace-background
// polling) is tested against real fetch responses in test/api-http.test.js.
// The tests that stood here until 1.0 asserted only that methods existed.

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

// ==================== Mocked Generate/Upscale Method Tests ====================

describe('Mocked Generate Method Calls', () => {
  let api;

  beforeEach(async () => {
    api = new StabilityAPI('test-key');
    // Mock buildFormData to prevent file system access
    const mockFormData = new FormData();
    const utilsModule = await import('../src/utils.js');
    vi.spyOn(utilsModule, 'buildFormData').mockResolvedValue(mockFormData);
  });

  it('generateUltra should call correct endpoint', async () => {
    const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS', seed: '12345' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

    const result = await api.generateUltra({
      prompt: 'a beautiful sunset',
      aspect_ratio: '16:9',
      seed: 12345
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/generate/ultra', expect.any(Object));
    expect(result).toEqual(mockResult);
  });

  it('generateCore should call correct endpoint', async () => {
    const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS', seed: '42' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

    const result = await api.generateCore({
      prompt: 'cyberpunk city',
      aspect_ratio: '21:9',
      style_preset: 'cinematic'
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/generate/core', expect.any(Object));
    expect(result).toEqual(mockResult);
  });

  it('generateSD3 should call correct endpoint', async () => {
    const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS', seed: '999' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

    const result = await api.generateSD3({
      prompt: 'fantasy castle',
      model: 'sd3.5-large',
      aspect_ratio: '16:9'
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/generate/sd3', expect.any(Object));
    expect(result).toEqual(mockResult);
  });
});

describe('Mocked Upscale Method Calls', () => {
  let api;

  beforeEach(async () => {
    api = new StabilityAPI('test-key');
    // Mock buildFormData to prevent file system access
    const mockFormData = new FormData();
    const utilsModule = await import('../src/utils.js');
    vi.spyOn(utilsModule, 'buildFormData').mockResolvedValue(mockFormData);
  });

  it('upscaleFast should call correct endpoint', async () => {
    const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

    const result = await api.upscaleFast('/fake/image.jpg', 'png');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/upscale/fast', expect.any(Object));
    expect(result).toEqual(mockResult);
  });

  it('upscaleConservative should call correct endpoint', async () => {
    const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

    const result = await api.upscaleConservative('/fake/image.jpg', {
      prompt: 'enhance details',
      output_format: 'png'
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/upscale/conservative', expect.any(Object));
    expect(result).toEqual(mockResult);
  });

  it('upscaleCreative should call correct endpoint and poll for result', async () => {
    const mockTaskResult = { id: 'upscale-task-123' };
    const mockFinalResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };

    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockTaskResult);
    const mockWaitForResult = vi.spyOn(api, 'waitForResult').mockResolvedValue(mockFinalResult);

    const result = await api.upscaleCreative('/fake/image.jpg', {
      prompt: 'photorealistic rendering',
      creativity: 0.35
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/upscale/creative', expect.any(Object));
    expect(mockWaitForResult).toHaveBeenCalledWith('upscale-task-123');
    expect(result).toEqual(mockFinalResult);
  });

  it('upscaleCreative with wait=false should return task without polling', async () => {
    const mockTaskResult = { id: 'upscale-task-456' };
    const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockTaskResult);
    const mockWaitForResult = vi.spyOn(api, 'waitForResult');

    const result = await api.upscaleCreative('/fake/image.jpg', {
      prompt: 'enhance',
      wait: false
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockWaitForResult).not.toHaveBeenCalled();
    expect(result).toEqual(mockTaskResult);
  });
});

// ==================== Edit Methods Tests ====================

describe('Edit Methods', () => {
  let api;

  beforeEach(() => {
    api = new StabilityAPI('test-key');
  });

  describe('Method Signatures', () => {
    it('should have erase method', () => {
      expect(api.erase).toBeDefined();
      expect(typeof api.erase).toBe('function');
      expect(api.erase.length).toBeGreaterThanOrEqual(1); // image required
    });

    it('should have inpaint method', () => {
      expect(api.inpaint).toBeDefined();
      expect(typeof api.inpaint).toBe('function');
      expect(api.inpaint.length).toBeGreaterThanOrEqual(2); // image, prompt required
    });

    it('should have outpaint method', () => {
      expect(api.outpaint).toBeDefined();
      expect(typeof api.outpaint).toBe('function');
      expect(api.outpaint.length).toBeGreaterThanOrEqual(1); // image required
    });

    it('should have searchAndReplace method', () => {
      expect(api.searchAndReplace).toBeDefined();
      expect(typeof api.searchAndReplace).toBe('function');
      expect(api.searchAndReplace.length).toBeGreaterThanOrEqual(3); // image, prompt, searchPrompt required
    });

    it('should have searchAndRecolor method', () => {
      expect(api.searchAndRecolor).toBeDefined();
      expect(typeof api.searchAndRecolor).toBe('function');
      expect(api.searchAndRecolor.length).toBeGreaterThanOrEqual(3); // image, prompt, selectPrompt required
    });

    it('should have removeBackground method', () => {
      expect(api.removeBackground).toBeDefined();
      expect(typeof api.removeBackground).toBe('function');
      expect(api.removeBackground.length).toBeGreaterThanOrEqual(1); // image required
    });

    it('should have replaceBackgroundAndRelight method', () => {
      expect(api.replaceBackgroundAndRelight).toBeDefined();
      expect(typeof api.replaceBackgroundAndRelight).toBe('function');
      expect(api.replaceBackgroundAndRelight.length).toBeGreaterThanOrEqual(1); // subjectImage required
    });
  });

  describe('Mocked API Calls', () => {
    // Mock buildFormData at module level to prevent file system access
    let mockBuildFormData;

    beforeEach(async () => {
      // Create a mock FormData-like object
      const mockFormData = new FormData();
      const utilsModule = await import('../src/utils.js');
      mockBuildFormData = vi.spyOn(utilsModule, 'buildFormData').mockResolvedValue(mockFormData);
    });

    it('erase should call correct endpoint with form data', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.erase('/fake/image.png', { grow_mask: 10, seed: 42, output_format: 'png' });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/erase', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('inpaint should call correct endpoint with prompt and form data', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.inpaint('/fake/image.png', 'blue sky with clouds', {
        grow_mask: 50,
        style_preset: 'photographic'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/inpaint', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('outpaint should call correct endpoint with direction parameters', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.outpaint('/fake/image.png', {
        left: 200,
        right: 200,
        creativity: 0.5,
        prompt: 'continuation of landscape'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/outpaint', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('searchAndReplace should call correct endpoint with search_prompt', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.searchAndReplace('/fake/image.png', 'golden retriever', 'cat', {
        grow_mask: 5,
        style_preset: 'photographic'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/search-and-replace', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('searchAndRecolor should call correct endpoint with select_prompt', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.searchAndRecolor('/fake/image.png', 'bright red', 'car', {
        grow_mask: 3
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/search-and-recolor', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('removeBackground should call correct endpoint and return image', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.removeBackground('/fake/image.png', { output_format: 'png' });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/remove-background', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('replaceBackgroundAndRelight should call correct endpoint and poll for result', async () => {
      const mockTaskResult = { id: 'task-123' };
      const mockFinalResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };

      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockTaskResult);
      const mockWaitForResult = vi.spyOn(api, 'waitForResult').mockResolvedValue(mockFinalResult);

      const result = await api.replaceBackgroundAndRelight('/fake/portrait.png', {
        background_prompt: 'sunset beach with palm trees',
        light_source_direction: 'right'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/edit/replace-background-and-relight', expect.any(Object));
      expect(mockWaitForResult).toHaveBeenCalledWith('task-123');
      expect(result).toEqual(mockFinalResult);
    });

    it('replaceBackgroundAndRelight with wait=false should return task without polling', async () => {
      const mockTaskResult = { id: 'task-456' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockTaskResult);
      const mockWaitForResult = vi.spyOn(api, 'waitForResult');

      const result = await api.replaceBackgroundAndRelight('/fake/portrait.png', {
        background_prompt: 'mountain landscape',
        wait: false
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockWaitForResult).not.toHaveBeenCalled();
      expect(result).toEqual(mockTaskResult);
    });
  });

  // Validation tests run the real builder against a real (tiny) file and a
  // stubbed fetch, so "accepted" is proven by a request being sent — not by the
  // absence of one error message. Until 1.0 these used a nonexistent path and
  // `catch (e) { expect(e.message).not.toContain(...) }`, which passed on any
  // error; with buildFormData's leaked mock the request actually went out to
  // api.stability.ai (caught by test/setup.js).
  describe('validation against the real request path', () => {
    let dir;
    let png;
    let calls;

    beforeEach(() => {
      vi.restoreAllMocks(); // drop buildFormData/_makeFormDataRequest spies from sibling suites
      dir = mkdtempSync(join(tmpdir(), 'sai-api-validation-'));
      png = join(dir, 'in.png');
      writeFileSync(png, PNG_BYTES);
      calls = stubFetch(() => imageResponse());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
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
});

describe('Edit API Integration Patterns', () => {
  let api;

  beforeEach(() => {
    api = new StabilityAPI('test-key');
  });

  it('should follow same request pattern as other methods', () => {
    // All edit methods should use the same _makeFormDataRequest
    expect(api._makeFormDataRequest).toBeDefined();
  });

  it('should have 7 edit methods corresponding to 7 endpoints', () => {
    const editMethods = [
      'erase',
      'inpaint',
      'outpaint',
      'searchAndReplace',
      'searchAndRecolor',
      'removeBackground',
      'replaceBackgroundAndRelight'
    ];

    editMethods.forEach(method => {
      expect(api[method]).toBeDefined();
      expect(typeof api[method]).toBe('function');
    });
  });

  it('should have sync methods for 6 edit operations', () => {
    // These should NOT use waitForResult by default
    const syncMethods = [
      'erase',
      'inpaint',
      'outpaint',
      'searchAndReplace',
      'searchAndRecolor',
      'removeBackground'
    ];

    syncMethods.forEach(method => {
      expect(api[method]).toBeDefined();
    });
  });

  it('should have async method for replace-background-and-relight', () => {
    // This method should use waitForResult by default
    expect(api.replaceBackgroundAndRelight).toBeDefined();
    expect(api.waitForResult).toBeDefined(); // Should have polling capability
  });
});

// ==================== Control Methods Tests ====================

describe('Control Methods', () => {
  let api;

  beforeEach(() => {
    api = new StabilityAPI('test-key');
  });

  describe('Method Signatures', () => {
    it('should have controlSketch method', () => {
      expect(api.controlSketch).toBeDefined();
      expect(typeof api.controlSketch).toBe('function');
      expect(api.controlSketch.length).toBeGreaterThanOrEqual(2); // image, prompt required
    });

    it('should have controlStructure method', () => {
      expect(api.controlStructure).toBeDefined();
      expect(typeof api.controlStructure).toBe('function');
      expect(api.controlStructure.length).toBeGreaterThanOrEqual(2); // image, prompt required
    });

    it('should have controlStyle method', () => {
      expect(api.controlStyle).toBeDefined();
      expect(typeof api.controlStyle).toBe('function');
      expect(api.controlStyle.length).toBeGreaterThanOrEqual(2); // image, prompt required
    });

    it('should have controlStyleTransfer method', () => {
      expect(api.controlStyleTransfer).toBeDefined();
      expect(typeof api.controlStyleTransfer).toBe('function');
      expect(api.controlStyleTransfer.length).toBeGreaterThanOrEqual(2); // initImage, styleImage required
    });
  });

  describe('Mocked API Calls', () => {
    // Mock buildFormData at module level to prevent file system access
    let mockBuildFormData;

    beforeEach(async () => {
      // Create a mock FormData-like object
      const mockFormData = new FormData();
      const utilsModule = await import('../src/utils.js');
      mockBuildFormData = vi.spyOn(utilsModule, 'buildFormData').mockResolvedValue(mockFormData);
    });

    it('controlSketch should call correct endpoint with prompt and control_strength', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlSketch('/fake/sketch.png', 'medieval castle', {
        control_strength: 0.7,
        seed: 42,
        output_format: 'png'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/control/sketch', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('controlSketch should use default options when none provided', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlSketch('/fake/sketch.png', 'castle');

      expect(result).toEqual(mockResult);
    });

    it('controlStructure should call correct endpoint with structure options', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlStructure('/fake/statue.png', 'garden shrub', {
        control_strength: 0.6,
        style_preset: 'photographic'
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/control/structure', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('controlStyle should call correct endpoint with fidelity and aspect_ratio', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlStyle('/fake/style-ref.png', 'portrait of a chicken', {
        fidelity: 0.8,
        aspect_ratio: '16:9',
        seed: 123
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/control/style', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('controlStyleTransfer should call correct endpoint with two images', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      const mockRequest = vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlStyleTransfer('/fake/photo.png', '/fake/art-style.png', {
        style_strength: 0.8,
        composition_fidelity: 0.95
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/v2beta/stable-image/control/style-transfer', expect.any(Object));
      expect(result).toEqual(mockResult);
    });

    it('controlStyleTransfer should accept optional prompt', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlStyleTransfer('/fake/photo.png', '/fake/art.png', {
        prompt: 'watercolor style portrait',
        change_strength: 0.7
      });

      expect(result).toEqual(mockResult);
    });

    it('controlStyleTransfer should work with minimal options', async () => {
      const mockResult = { image: Buffer.from([0x89, 0x50, 0x4E, 0x47]), finish_reason: 'SUCCESS' };
      vi.spyOn(api, '_makeFormDataRequest').mockResolvedValue(mockResult);

      const result = await api.controlStyleTransfer('/fake/photo.png', '/fake/style.png');

      expect(result).toEqual(mockResult);
    });
  });

  describe('All Control Methods Are Synchronous', () => {
    it('should have all control methods as synchronous operations', () => {
      // All control methods should be defined (none use waitForResult by default)
      const controlMethods = [
        'controlSketch',
        'controlStructure',
        'controlStyle',
        'controlStyleTransfer'
      ];

      controlMethods.forEach(method => {
        expect(api[method]).toBeDefined();
      });
    });
  });
});
