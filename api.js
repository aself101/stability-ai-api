#!/usr/bin/env node

/**
 * Stability AI API Wrapper
 *
 * Comprehensive Node.js wrapper for the Stability AI REST API.
 * Supports Stable Diffusion image generation and upscaling.
 *
 * @example
 * import { StabilityAPI } from './api.js';
 *
 * const api = new StabilityAPI();
 *
 * // Generate image
 * const result = await api.generateUltra({ prompt: 'a beautiful landscape' });
 * console.log('Image URL:', result.image_url);
 */

import axios from 'axios';
import { logger, buildFormData, createSpinner } from './utils.js';
import { BASE_URL, MODEL_ENDPOINTS, EDIT_ENDPOINTS, CONTROL_ENDPOINTS, DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT } from './config.js';

/**
 * Stability AI API Client
 */
export class StabilityAPI {
  /**
   * Create a new Stability AI API client.
   *
   * @param {string} apiKey - Stability AI API key
   * @param {string} [baseUrl=BASE_URL] - API base URL
   * @param {string} [logLevel='info'] - Logging level (debug, info, warn, error)
   *
   * @example
   * const api = new StabilityAPI('sk-xxxxx');
   */
  constructor(apiKey, baseUrl = BASE_URL, logLevel = 'info') {
    // Validate base URL uses HTTPS
    if (!baseUrl.startsWith('https://')) {
      throw new Error('Base URL must use HTTPS protocol for security');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.logger = logger;

    // Set log level
    if (logLevel) {
      logger.level = logLevel;
    }

    logger.info(`Initialized Stability AI API client with base URL: ${baseUrl}`);
  }

  /**
   * Verify that API key is set.
   *
   * @private
   * @throws {Error} If API key is not set
   */
  _verifyApiKey() {
    if (!this.apiKey) {
      throw new Error('API key is required. Please provide STABILITY_API_KEY.');
    }
  }

  /**
   * Redact API key for logging (shows only last 4 characters).
   *
   * @private
   * @param {string} apiKey - API key to redact
   * @returns {string} Redacted API key
   */
  _redactApiKey(apiKey) {
    if (!apiKey || apiKey.length < 8) {
      return 'xxx...xxxx';
    }
    const last4 = apiKey.slice(-4);
    return `xxx...${last4}`;
  }

  /**
   * Sanitize error messages for production.
   * Prevents information disclosure in production environments.
   *
   * @private
   * @param {Error} error - Original error
   * @returns {string} Sanitized error message
   */
  _sanitizeErrorMessage(error) {
    // In production, return generic error message
    if (process.env.NODE_ENV === 'production') {
      // Only expose safe error types
      if (error.response?.status === 401) {
        return 'Authentication failed';
      } else if (error.response?.status === 403) {
        return 'Content moderation flagged';
      } else if (error.response?.status === 429) {
        return 'Rate limit exceeded';
      }
      return 'An error occurred while processing your request';
    }

    // In development, return detailed error
    return error.message;
  }

  /**
   * Make a multipart/form-data request to the Stability AI API.
   *
   * @private
   * @param {string} method - HTTP method (GET, POST)
   * @param {string} endpoint - API endpoint path
   * @param {FormData} [formData=null] - Form data for POST requests
   * @param {Object} [options={}] - Additional axios options
   * @returns {Promise<Object|Buffer>} API response data or image buffer
   */
  async _makeFormDataRequest(method, endpoint, formData = null, options = {}) {
    this._verifyApiKey();

    const url = `${this.baseUrl}${endpoint}`;

    // Redact API key for logging
    const redactedKey = this._redactApiKey(this.apiKey);
    logger.debug(`Making ${method} request to ${url} (API key: ${redactedKey})`);

    try {
      const headers = {
        'authorization': `Bearer ${this.apiKey}`,
        'accept': 'image/*', // Request image bytes directly
        ...options.headers
      };

      // If formData provided, let it set its own content-type with boundary
      if (formData) {
        Object.assign(headers, formData.getHeaders());
      }

      // Extract headers from options to avoid overwriting merged headers
      const { headers: _, ...restOptions } = options;
      const axiosConfig = {
        method,
        url,
        headers,
        timeout: 30000, // 30 second timeout for API requests
        maxRedirects: 5,
        ...restOptions
      };

      // Add form data for POST requests
      if (formData && method === 'POST') {
        axiosConfig.data = formData;
      }

      // For binary responses, we want arraybuffer
      // Both 'image/*' and '*/*' expect binary data
      if (headers['accept'] === 'image/*' || headers['accept'] === '*/*') {
        axiosConfig.responseType = 'arraybuffer';
      }

      logger.debug(`Request config: ${JSON.stringify({ method, url, headers: { ...headers, authorization: `Bearer ${redactedKey}` } })}`);

      const response = await axios(axiosConfig);

      logger.debug(`Response status: ${response.status}`);
      logger.debug(`Response headers: ${JSON.stringify(response.headers)}`);

      // Return the response based on type
      if (response.status === 200 && response.headers['content-type']?.startsWith('image/')) {
        // Synchronous response with image
        logger.info(`Received image response (${response.data.length} bytes)`);
        return {
          image: Buffer.from(response.data),
          finish_reason: response.headers['finish-reason'],
          seed: response.headers['seed']
        };
      } else if (response.status === 202) {
        // Async response with task ID
        logger.info('Received async task ID');
        return response.data;
      } else if (response.status === 200 && response.headers['content-type']?.includes('application/json')) {
        // Async endpoint returning task ID with HTTP 200 (e.g., replace-background-and-relight)
        // Parse JSON from arraybuffer if needed
        let data = response.data;
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          data = JSON.parse(Buffer.from(data).toString('utf8'));
        }
        if (data.id) {
          logger.info(`Received async task ID: ${data.id}`);
        }
        return data;
      } else {
        // Other responses
        return response.data;
      }
    } catch (error) {
      logger.error(`Request failed: ${error.message}`);

      // Handle specific error cases
      if (error.response) {
        const status = error.response.status;
        let data = error.response.data;

        // Parse Buffer responses to JSON
        if (Buffer.isBuffer(data)) {
          try {
            data = JSON.parse(data.toString('utf8'));
          } catch (parseError) {
            logger.error(`Failed to parse error response buffer: ${parseError.message}`);
          }
        }

        logger.error(`HTTP ${status}: ${JSON.stringify(data)}`);

        if (status === 401) {
          throw new Error('Authentication failed. Check your API key.');
        } else if (status === 403) {
          throw new Error('Content moderation flagged your request.');
        } else if (status === 413) {
          throw new Error('Request payload too large (max 10MB).');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Please wait before retrying.');
        } else if (status === 400) {
          // Extract validation errors if available
          const errorMsg = data.errors ? data.errors.join(', ') : JSON.stringify(data);
          throw new Error(`Invalid parameters: ${errorMsg}`);
        }
      }

      // Throw sanitized error
      throw new Error(this._sanitizeErrorMessage(error));
    }
  }

  /**
   * Poll for async task result.
   *
   * @param {string} taskId - Task ID from async operation
   * @param {Object} [options={}] - Polling options
   * @param {number} [options.pollInterval=DEFAULT_POLL_INTERVAL] - Polling interval in seconds
   * @param {number} [options.timeout=DEFAULT_TIMEOUT] - Timeout in seconds
   * @param {boolean} [options.showSpinner=true] - Show animated spinner
   * @returns {Promise<Object>} Task result with image
   */
  async waitForResult(taskId, {
    pollInterval = DEFAULT_POLL_INTERVAL,
    timeout = DEFAULT_TIMEOUT,
    showSpinner = true
  } = {}) {
    logger.info(`Polling for task ${taskId} (interval: ${pollInterval}s, timeout: ${timeout}s)`);

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let attempt = 0;
    let spinner = null;

    if (showSpinner) {
      spinner = createSpinner(`Waiting for upscale to complete (task: ${taskId})`);
      spinner.start();
    }

    try {
      while (true) {
        attempt++;
        const elapsed = (Date.now() - startTime) / 1000;

        logger.debug(`Polling attempt ${attempt} (elapsed: ${elapsed.toFixed(1)}s)`);

        try {
          const result = await this.getResult(taskId);

          // Check if task is complete (HTTP 200 with image)
          if (result.image) {
            if (spinner) {
              spinner.stop(`✓ Upscale complete! (${elapsed.toFixed(1)}s)`);
            }
            logger.info(`Task ${taskId} completed after ${elapsed.toFixed(1)}s`);
            return result;
          }

          // If still in progress (HTTP 202), continue polling
          logger.debug(`Task ${taskId} still in progress...`);
          if (spinner) {
            const timeLeft = Math.max(0, timeout - elapsed).toFixed(0);
            spinner.update(`Processing... (${elapsed.toFixed(0)}s elapsed, ~${timeLeft}s remaining)`);
          }
        } catch (error) {
          // Retry on transient errors
          if (error.message.includes('rate limit') || error.message.includes('503') || error.message.includes('502')) {
            logger.warn(`Transient error, will retry: ${error.message}`);
            if (spinner) {
              spinner.update(`Retrying after error...`);
            }
          } else {
            // Permanent error, throw immediately
            throw error;
          }
        }

        // Check timeout
        if ((Date.now() - startTime) >= timeoutMs) {
          throw new Error(`Timeout waiting for task ${taskId} after ${timeout} seconds`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
      }
    } finally {
      if (spinner) {
        spinner.stop();
      }
    }
  }

  /**
   * Get result for a specific task ID.
   *
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Task result
   */
  async getResult(taskId) {
    const endpoint = `${MODEL_ENDPOINTS.results}/${taskId}`;
    // Results endpoint requires accept: */* for binary response
    return await this._makeFormDataRequest('GET', endpoint, null, {
      headers: { 'accept': '*/*' }
    });
  }

  /**
   * Generate image using Stable Image Ultra.
   * Photorealistic model with 1 megapixel output.
   *
   * @param {Object} params - Generation parameters
   * @param {string} params.prompt - Text prompt (1-10000 characters)
   * @param {string} [params.negative_prompt] - Negative prompt
   * @param {string} [params.aspect_ratio='1:1'] - Aspect ratio (e.g., '16:9', '1:1')
   * @param {number} [params.seed] - Random seed (0-4294967294)
   * @param {string} [params.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [params.image] - Optional input image for image-to-image
   * @param {number} [params.strength] - Strength for image-to-image (0-1)
   * @returns {Promise<Object>} Generated image result
   *
   * @example
   * const result = await api.generateUltra({ prompt: 'a cat', aspect_ratio: '16:9' });
   */
  async generateUltra(params) {
    logger.info('Generating image with Stable Image Ultra');

    const formData = await buildFormData(
      {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        aspect_ratio: params.aspect_ratio || '1:1',
        seed: params.seed,
        output_format: params.output_format || 'png'
      },
      params.image ? { image: params.image } : {}
    );

    if (params.strength !== undefined) {
      formData.append('strength', String(params.strength));
    }

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['stable-image-ultra'], formData);
  }

  /**
   * Generate image using Stable Image Core.
   * Fast and affordable SDXL successor.
   *
   * @param {Object} params - Generation parameters
   * @param {string} params.prompt - Text prompt (1-10000 characters)
   * @param {string} [params.negative_prompt] - Negative prompt
   * @param {string} [params.aspect_ratio='1:1'] - Aspect ratio
   * @param {number} [params.seed] - Random seed
   * @param {string} [params.output_format='png'] - Output format
   * @param {string} [params.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Generated image result
   *
   * @example
   * const result = await api.generateCore({ prompt: 'a dog', style_preset: 'photographic' });
   */
  async generateCore(params) {
    logger.info('Generating image with Stable Image Core');

    const formData = await buildFormData({
      prompt: params.prompt,
      negative_prompt: params.negative_prompt,
      aspect_ratio: params.aspect_ratio || '1:1',
      seed: params.seed,
      output_format: params.output_format || 'png',
      style_preset: params.style_preset
    });

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['stable-image-core'], formData);
  }

  /**
   * Generate image using Stable Diffusion 3.5.
   *
   * @param {Object} params - Generation parameters
   * @param {string} params.prompt - Text prompt (1-10000 characters)
   * @param {string} [params.model='sd3.5-large'] - Model (sd3.5-large, sd3.5-medium, sd3.5-large-turbo)
   * @param {string} [params.negative_prompt] - Negative prompt
   * @param {string} [params.aspect_ratio='1:1'] - Aspect ratio
   * @param {number} [params.seed] - Random seed
   * @param {string} [params.output_format='png'] - Output format
   * @returns {Promise<Object>} Generated image result
   *
   * @example
   * const result = await api.generateSD3({ prompt: 'a bird', model: 'sd3.5-large-turbo' });
   */
  async generateSD3(params) {
    logger.info(`Generating image with SD 3.5 (${params.model || 'sd3.5-large'})`);

    const formData = await buildFormData({
      prompt: params.prompt,
      model: params.model || 'sd3.5-large',
      negative_prompt: params.negative_prompt,
      aspect_ratio: params.aspect_ratio || '1:1',
      seed: params.seed,
      output_format: params.output_format || 'png'
    });

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['sd3-large'], formData);
  }

  /**
   * Upscale image 4x using fast upscaler (~1 second).
   *
   * @param {string} imagePath - Path to input image or URL
   * @param {string} [outputFormat='png'] - Output format
   * @returns {Promise<Object>} Upscaled image result
   *
   * @example
   * const result = await api.upscaleFast('/path/to/image.png');
   */
  async upscaleFast(imagePath, outputFormat = 'png') {
    logger.info('Upscaling image with Fast Upscaler');

    const formData = await buildFormData(
      { output_format: outputFormat },
      { image: imagePath }
    );

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['upscale-fast'], formData);
  }

  /**
   * Upscale image 20-40x to 4MP using conservative upscaler (minimal alteration).
   *
   * @param {string} imagePath - Path to input image or URL
   * @param {Object} [params={}] - Additional parameters
   * @param {string} [params.prompt] - Optional prompt
   * @param {string} [params.negative_prompt] - Negative prompt
   * @param {number} [params.seed] - Random seed
   * @param {string} [params.output_format='png'] - Output format
   * @returns {Promise<Object>} Upscaled image result
   *
   * @example
   * const result = await api.upscaleConservative('/path/to/image.png', { prompt: 'enhance details' });
   */
  async upscaleConservative(imagePath, params = {}) {
    logger.info('Upscaling image with Conservative Upscaler');

    const formData = await buildFormData(
      {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        seed: params.seed,
        output_format: params.output_format || 'png'
      },
      { image: imagePath }
    );

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['upscale-conservative'], formData);
  }

  /**
   * Upscale image 20-40x with creative reimagining (asynchronous).
   *
   * @param {string} imagePath - Path to input image or URL
   * @param {Object} [params={}] - Additional parameters
   * @param {string} [params.prompt] - Optional prompt
   * @param {string} [params.negative_prompt] - Negative prompt
   * @param {number} [params.creativity=0.3] - Creativity level (0.1-0.5)
   * @param {number} [params.seed] - Random seed
   * @param {string} [params.output_format='png'] - Output format
   * @param {boolean} [params.wait=true] - Wait for result with auto-polling
   * @returns {Promise<Object>} Task object or final result if wait=true
   *
   * @example
   * const result = await api.upscaleCreative('/path/to/image.png', { creativity: 0.4 });
   */
  async upscaleCreative(imagePath, params = {}) {
    logger.info('Upscaling image with Creative Upscaler (async)');

    const formData = await buildFormData(
      {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        creativity: params.creativity || 0.3,
        seed: params.seed,
        output_format: params.output_format || 'png'
      },
      { image: imagePath }
    );

    const task = await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['upscale-creative'], formData);

    // If wait is enabled (default), poll for result
    if (params.wait !== false && task.id) {
      logger.info(`Got task ID: ${task.id}, waiting for result...`);
      return await this.waitForResult(task.id);
    }

    return task;
  }

  /**
   * Get user account credits balance.
   *
   * @returns {Promise<Object>} Balance information with credits property
   *
   * @example
   * const balance = await api.getBalance();
   * console.log('Credits remaining:', balance.credits);
   */
  async getBalance() {
    this._verifyApiKey();

    try {
      const response = await axios.get(`${this.baseUrl}/v1/user/balance`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 30000
      });

      logger.info(`Account balance: ${response.data.credits} credits`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching balance: ${this._sanitizeErrorMessage(error)}`);
      throw new Error(this._sanitizeErrorMessage(error));
    }
  }

  // ==================== Edit Methods ====================

  /**
   * Erase objects from an image using a mask.
   * Removes unwanted objects like blemishes, items on desks, etc.
   *
   * @param {string} image - Path to input image or URL
   * @param {Object} [options={}] - Erase options
   * @param {string} [options.mask] - Path to mask image (white=erase). If omitted, uses image alpha channel
   * @param {number} [options.grow_mask=5] - Pixels to grow mask edges (0-20)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @returns {Promise<Object>} Erased image result with image buffer
   *
   * @example
   * const result = await api.erase('/path/to/photo.png', { mask: '/path/to/mask.png' });
   * const result = await api.erase('/path/to/photo-with-alpha.png'); // uses alpha channel
   */
  async erase(image, options = {}) {
    logger.info('Erasing objects from image');

    const fileInputs = { image };
    if (options.mask) {
      fileInputs.mask = options.mask;
    }

    const formData = await buildFormData(
      {
        grow_mask: options.grow_mask,
        seed: options.seed,
        output_format: options.output_format || 'png'
      },
      fileInputs
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['erase'], formData);
  }

  /**
   * Inpaint (fill or replace) masked areas with prompt-guided content.
   *
   * @param {string} image - Path to input image or URL
   * @param {string} prompt - What to generate in masked area (1-10000 chars)
   * @param {Object} [options={}] - Inpaint options
   * @param {string} [options.mask] - Path to mask image (white=inpaint). If omitted, uses alpha channel
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.grow_mask=5] - Pixels to grow mask edges (0-100)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Inpainted image result with image buffer
   *
   * @example
   * const result = await api.inpaint('/path/to/photo.png', 'blue sky with clouds', { mask: '/path/to/mask.png' });
   */
  async inpaint(image, prompt, options = {}) {
    logger.info('Inpainting image with prompt');

    const fileInputs = { image };
    if (options.mask) {
      fileInputs.mask = options.mask;
    }

    const formData = await buildFormData(
      {
        prompt,
        negative_prompt: options.negative_prompt,
        grow_mask: options.grow_mask,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      fileInputs
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['inpaint'], formData);
  }

  /**
   * Outpaint (extend) image boundaries in any direction.
   *
   * @param {string} image - Path to input image or URL
   * @param {Object} [options={}] - Outpaint options
   * @param {number} [options.left=0] - Pixels to extend left (0-2000)
   * @param {number} [options.right=0] - Pixels to extend right (0-2000)
   * @param {number} [options.up=0] - Pixels to extend up (0-2000)
   * @param {number} [options.down=0] - Pixels to extend down (0-2000)
   * @param {number} [options.creativity=0.5] - How creative the outpainting should be (0-1)
   * @param {string} [options.prompt] - What to generate in extended areas
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Outpainted image result with image buffer
   *
   * @example
   * const result = await api.outpaint('/path/to/photo.png', { left: 200, right: 200 });
   * const result = await api.outpaint('/path/to/photo.png', { up: 500, prompt: 'blue sky' });
   */
  async outpaint(image, options = {}) {
    logger.info('Outpainting image');

    const formData = await buildFormData(
      {
        left: options.left,
        right: options.right,
        up: options.up,
        down: options.down,
        creativity: options.creativity,
        prompt: options.prompt,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['outpaint'], formData);
  }

  /**
   * Search and replace objects using text prompts (no manual masking needed).
   *
   * @param {string} image - Path to input image or URL
   * @param {string} prompt - What to replace with (1-10000 chars)
   * @param {string} searchPrompt - Short description of what to find
   * @param {Object} [options={}] - Search and replace options
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.grow_mask=3] - Pixels to grow auto-detected mask (0-20)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Modified image result with image buffer
   *
   * @example
   * const result = await api.searchAndReplace('/path/to/photo.png', 'golden retriever', 'cat');
   */
  async searchAndReplace(image, prompt, searchPrompt, options = {}) {
    logger.info(`Searching for "${searchPrompt}" and replacing with "${prompt}"`);

    const formData = await buildFormData(
      {
        prompt,
        search_prompt: searchPrompt,
        negative_prompt: options.negative_prompt,
        grow_mask: options.grow_mask,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['search-and-replace'], formData);
  }

  /**
   * Search and recolor objects using text prompts (no manual masking needed).
   *
   * @param {string} image - Path to input image or URL
   * @param {string} prompt - Desired color/appearance (1-10000 chars)
   * @param {string} selectPrompt - Short description of what to find
   * @param {Object} [options={}] - Search and recolor options
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.grow_mask=3] - Pixels to grow auto-detected mask (0-20)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Recolored image result with image buffer
   *
   * @example
   * const result = await api.searchAndRecolor('/path/to/photo.png', 'bright red', 'car');
   */
  async searchAndRecolor(image, prompt, selectPrompt, options = {}) {
    logger.info(`Searching for "${selectPrompt}" and recoloring to "${prompt}"`);

    const formData = await buildFormData(
      {
        prompt,
        select_prompt: selectPrompt,
        negative_prompt: options.negative_prompt,
        grow_mask: options.grow_mask,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['search-and-recolor'], formData);
  }

  /**
   * Remove background from image (automatic segmentation).
   * Returns image with transparent background.
   *
   * @param {string} image - Path to input image or URL
   * @param {Object} [options={}] - Remove background options
   * @param {string} [options.output_format='png'] - Output format (png or webp only, NO jpeg)
   * @returns {Promise<Object>} Image with transparent background
   *
   * @example
   * const result = await api.removeBackground('/path/to/photo.png');
   * const result = await api.removeBackground('/path/to/photo.jpg', { output_format: 'webp' });
   */
  async removeBackground(image, options = {}) {
    logger.info('Removing background from image');

    // Remove background doesn't support jpeg (needs transparency)
    const outputFormat = options.output_format || 'png';
    if (outputFormat === 'jpeg') {
      throw new Error('Remove background does not support jpeg output format (requires transparency). Use png or webp.');
    }

    const formData = await buildFormData(
      { output_format: outputFormat },
      { image }
    );

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['remove-background'], formData);
  }

  /**
   * Replace background and relight subject with AI-generated or reference imagery.
   * This is an ASYNCHRONOUS operation that returns a task ID.
   *
   * @param {string} subjectImage - Path to image with subject to keep
   * @param {Object} [options={}] - Replace background options
   * @param {string} [options.background_prompt] - Description of desired background (required if no background_reference)
   * @param {string} [options.background_reference] - Path to reference image for background style
   * @param {string} [options.foreground_prompt] - Description of subject (prevents background bleeding)
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.preserve_original_subject=0.6] - Subject overlay strength (0-1, 1.0=pixel perfect)
   * @param {number} [options.original_background_depth=0.5] - Background depth matching (0-1)
   * @param {boolean} [options.keep_original_background=false] - Keep original BG with new lighting only
   * @param {string} [options.light_source_direction] - Direction of light ('left', 'right', 'above', 'below')
   * @param {string} [options.light_reference] - Path to reference image for lighting
   * @param {number} [options.light_source_strength=0.3] - Light intensity (0-1, requires light_reference or light_source_direction)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {boolean} [options.wait=true] - Wait for result with auto-polling
   * @returns {Promise<Object>} Task object or final result if wait=true
   *
   * @example
   * const result = await api.replaceBackgroundAndRelight('/path/to/portrait.png', {
   *   background_prompt: 'sunset beach with palm trees',
   *   light_source_direction: 'right'
   * });
   */
  async replaceBackgroundAndRelight(subjectImage, options = {}) {
    logger.info('Replacing background and relighting subject (async)');

    // Validate either background_prompt or background_reference is provided
    if (!options.background_prompt && !options.background_reference) {
      throw new Error('Either background_prompt or background_reference is required for replace background and relight');
    }

    // Validate light_source_strength dependency
    if (options.light_source_strength !== undefined &&
        !options.light_reference && !options.light_source_direction) {
      throw new Error('light_source_strength requires either light_reference or light_source_direction');
    }

    const fileInputs = { subject_image: subjectImage };
    if (options.background_reference) {
      fileInputs.background_reference = options.background_reference;
    }
    if (options.light_reference) {
      fileInputs.light_reference = options.light_reference;
    }

    const formData = await buildFormData(
      {
        background_prompt: options.background_prompt,
        foreground_prompt: options.foreground_prompt,
        negative_prompt: options.negative_prompt,
        preserve_original_subject: options.preserve_original_subject,
        original_background_depth: options.original_background_depth,
        keep_original_background: options.keep_original_background !== undefined
          ? String(options.keep_original_background)
          : undefined,
        light_source_direction: options.light_source_direction,
        light_source_strength: options.light_source_strength,
        seed: options.seed,
        output_format: options.output_format || 'png'
      },
      fileInputs
    );

    const task = await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['replace-background-and-relight'], formData);

    // If wait is enabled (default), poll for result
    if (options.wait !== false && task.id) {
      logger.info(`Got task ID: ${task.id}, waiting for result...`);
      return await this.waitForResult(task.id);
    }

    return task;
  }

  // ==================== Control Methods ====================

  /**
   * Control: Sketch - Convert sketches to refined images.
   * Upgrades rough hand-drawn sketches to refined outputs with precise control.
   * For non-sketch images, it leverages contour lines and edges within the image.
   *
   * @param {string} image - Path to input sketch image or URL
   * @param {string} prompt - What to generate from the sketch (1-10000 chars)
   * @param {Object} [options={}] - Control options
   * @param {number} [options.control_strength=0.7] - How much influence the image has (0-1)
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Generated image result with image buffer
   *
   * @example
   * const result = await api.controlSketch('/path/to/sketch.png', 'a medieval castle on a hill');
   * const result = await api.controlSketch('/path/to/sketch.png', 'castle', { control_strength: 0.8 });
   */
  async controlSketch(image, prompt, options = {}) {
    logger.info('Generating from sketch with Control: Sketch');

    const formData = await buildFormData(
      {
        prompt,
        control_strength: options.control_strength,
        negative_prompt: options.negative_prompt,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['sketch'], formData);
  }

  /**
   * Control: Structure - Generate images while preserving input structure.
   * Maintains the structural elements of an input image while generating new content.
   * Ideal for recreating scenes or rendering characters from models.
   *
   * @param {string} image - Path to input image or URL (structure reference)
   * @param {string} prompt - What to generate with the structure (1-10000 chars)
   * @param {Object} [options={}] - Control options
   * @param {number} [options.control_strength=0.7] - How much influence the image has (0-1)
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Generated image result with image buffer
   *
   * @example
   * const result = await api.controlStructure('/path/to/statue.png', 'a shrub in an english garden');
   * const result = await api.controlStructure('/path/to/photo.jpg', 'oil painting style', { control_strength: 0.6 });
   */
  async controlStructure(image, prompt, options = {}) {
    logger.info('Generating with structure preservation with Control: Structure');

    const formData = await buildFormData(
      {
        prompt,
        control_strength: options.control_strength,
        negative_prompt: options.negative_prompt,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['structure'], formData);
  }

  /**
   * Control: Style - Generate images guided by a style reference.
   * Extracts stylistic elements from an input image and uses them to guide generation.
   * Creates a new image in the same style as the control image.
   *
   * @param {string} image - Path to style reference image or URL
   * @param {string} prompt - What to generate with the style (1-10000 chars)
   * @param {Object} [options={}] - Control options
   * @param {number} [options.fidelity=0.5] - How closely output resembles input style (0-1)
   * @param {string} [options.aspect_ratio='1:1'] - Output aspect ratio
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @param {string} [options.style_preset] - Style preset (e.g., 'photographic', 'anime')
   * @returns {Promise<Object>} Generated image result with image buffer
   *
   * @example
   * const result = await api.controlStyle('/path/to/style-ref.png', 'a majestic portrait of a chicken');
   * const result = await api.controlStyle('/path/to/art.jpg', 'landscape', { fidelity: 0.8, aspect_ratio: '16:9' });
   */
  async controlStyle(image, prompt, options = {}) {
    logger.info('Generating with style guidance with Control: Style');

    const formData = await buildFormData(
      {
        prompt,
        fidelity: options.fidelity,
        aspect_ratio: options.aspect_ratio,
        negative_prompt: options.negative_prompt,
        seed: options.seed,
        output_format: options.output_format || 'png',
        style_preset: options.style_preset
      },
      { image }
    );

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['style'], formData);
  }

  /**
   * Control: Style Transfer - Apply style from one image to another.
   * Transfers visual characteristics from a style image to a content image
   * while preserving the original composition.
   *
   * @param {string} initImage - Path to content image or URL (what to restyle)
   * @param {string} styleImage - Path to style reference image or URL
   * @param {Object} [options={}] - Style transfer options
   * @param {string} [options.prompt] - Optional prompt to guide transfer (0-10000 chars)
   * @param {string} [options.negative_prompt] - What NOT to generate
   * @param {number} [options.style_strength=1] - Influence of style image (0-1, 0=identical to input)
   * @param {number} [options.composition_fidelity=0.9] - How closely to preserve composition (0-1)
   * @param {number} [options.change_strength=0.9] - How much the original should change (0.1-1)
   * @param {number} [options.seed] - Random seed (0-4294967294)
   * @param {string} [options.output_format='png'] - Output format (jpeg, png, webp)
   * @returns {Promise<Object>} Style transferred image result with image buffer
   *
   * @example
   * const result = await api.controlStyleTransfer('/path/to/photo.png', '/path/to/art-style.png');
   * const result = await api.controlStyleTransfer('/path/to/portrait.png', '/path/to/oil-painting.jpg', {
   *   style_strength: 0.8,
   *   composition_fidelity: 0.95
   * });
   */
  async controlStyleTransfer(initImage, styleImage, options = {}) {
    logger.info('Transferring style between images with Control: Style Transfer');

    const formData = await buildFormData(
      {
        prompt: options.prompt,
        negative_prompt: options.negative_prompt,
        style_strength: options.style_strength,
        composition_fidelity: options.composition_fidelity,
        change_strength: options.change_strength,
        seed: options.seed,
        output_format: options.output_format || 'png'
      },
      { init_image: initImage, style_image: styleImage }
    );

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['style-transfer'], formData);
  }
}

export default StabilityAPI;
