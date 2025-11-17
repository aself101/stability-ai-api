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
import { logger, buildFormData, downloadImage, createSpinner } from './utils.js';
import { BASE_URL, MODEL_ENDPOINTS, DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT, MAX_RETRIES } from './config.js';

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

      const axiosConfig = {
        method,
        url,
        headers,
        timeout: 30000, // 30 second timeout for API requests
        maxRedirects: 5,
        ...options
      };

      // Add form data for POST requests
      if (formData && method === 'POST') {
        axiosConfig.data = formData;
      }

      // For image responses, we want binary data
      if (headers['accept'] === 'image/*') {
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
      } else {
        // Other responses
        return response.data;
      }
    } catch (error) {
      logger.error(`Request failed: ${error.message}`);

      // Handle specific error cases
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

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
          const errorMsg = data.errors ? JSON.stringify(data.errors) : JSON.stringify(data);
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
    return await this._makeFormDataRequest('GET', endpoint);
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
}

export default StabilityAPI;
