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

import axios, { type AxiosError } from 'axios';
import { logger, buildFormData, createSpinner } from './utils.js';
import { BASE_URL, MODEL_ENDPOINTS, EDIT_ENDPOINTS, CONTROL_ENDPOINTS, DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT } from './config.js';
import type {
  ImageResult,
  TaskResult,
  CreditsResult,
  WaitResultOptions,
  UltraParams,
  CoreParams,
  SD3Params,
  UpscaleParams,
  EraseParams,
  InpaintParams,
  OutpaintParams,
  SearchAndReplaceParams,
  SearchAndRecolorParams,
  RemoveBackgroundParams,
  ReplaceBackgroundParams,
  ControlSketchParams,
  ControlStructureParams,
  ControlStyleParams,
  ControlStyleTransferParams,
  ErrorResponseData,
} from './types/index.js';
import type FormDataNode from 'form-data';

/**
 * Stability AI API Client
 */
export class StabilityAPI {
  private apiKey: string;
  private baseUrl: string;
  public logger = logger;

  /**
   * Create a new Stability AI API client.
   *
   * @param apiKey - Stability AI API key
   * @param baseUrl - API base URL
   * @param logLevel - Logging level (debug, info, warn, error)
   *
   * @example
   * const api = new StabilityAPI('sk-xxxxx');
   */
  constructor(apiKey: string, baseUrl = BASE_URL, logLevel = 'info') {
    // Validate base URL uses HTTPS
    if (!baseUrl.startsWith('https://')) {
      throw new Error('Base URL must use HTTPS protocol for security');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;

    // Set log level
    if (logLevel) {
      logger.level = logLevel;
    }

    logger.info(`Initialized Stability AI API client with base URL: ${baseUrl}`);
  }

  /**
   * Verify that API key is set.
   *
   * @throws Error if API key is not set
   */
  private _verifyApiKey(): void {
    if (!this.apiKey) {
      throw new Error('API key is required. Please provide STABILITY_API_KEY.');
    }
  }

  /**
   * Redact API key for logging (shows only last 4 characters).
   *
   * @param apiKey - API key to redact
   * @returns Redacted API key
   */
  private _redactApiKey(apiKey: string): string {
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
   * @param error - Original error
   * @returns Sanitized error message
   */
  private _sanitizeErrorMessage(error: AxiosError): string {
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
   * @param method - HTTP method (GET, POST)
   * @param endpoint - API endpoint path
   * @param formData - Form data for POST requests
   * @param options - Additional axios options
   * @returns API response data or image buffer
   */
  private async _makeFormDataRequest(
    method: string,
    endpoint: string,
    formData: FormDataNode | null = null,
    options: { headers?: Record<string, string> } = {}
  ): Promise<ImageResult | TaskResult | Record<string, unknown>> {
    this._verifyApiKey();

    const url = `${this.baseUrl}${endpoint}`;

    // Redact API key for logging
    const redactedKey = this._redactApiKey(this.apiKey);
    logger.debug(`Making ${method} request to ${url} (API key: ${redactedKey})`);

    try {
      const headers: Record<string, string> = {
        'authorization': `Bearer ${this.apiKey}`,
        'accept': 'image/*', // Request image bytes directly
        ...options.headers
      };

      // If formData provided, let it set its own content-type with boundary
      if (formData && typeof formData.getHeaders === 'function') {
        Object.assign(headers, formData.getHeaders());
      }

      const axiosConfig: {
        method: string;
        url: string;
        headers: Record<string, string>;
        timeout: number;
        maxRedirects: number;
        data?: unknown;
        responseType?: 'arraybuffer';
      } = {
        method,
        url,
        headers,
        timeout: 30000, // 30 second timeout for API requests
        maxRedirects: 5,
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
      const contentType = response.headers['content-type'] as string | undefined;
      if (response.status === 200 && contentType?.startsWith('image/')) {
        // Synchronous response with image
        logger.info(`Received image response (${(response.data as ArrayBuffer).byteLength} bytes)`);
        return {
          image: Buffer.from(response.data as ArrayBuffer),
          finish_reason: response.headers['finish-reason'] as string | undefined,
          seed: response.headers['seed'] as string | undefined
        };
      } else if (response.status === 202) {
        // Async response with task ID
        logger.info('Received async task ID');
        return response.data as TaskResult;
      } else if (response.status === 200 && contentType?.includes('application/json')) {
        // Async endpoint returning task ID with HTTP 200 (e.g., replace-background-and-relight)
        // Parse JSON from arraybuffer if needed
        let data = response.data;
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          data = JSON.parse(Buffer.from(data as ArrayBuffer).toString('utf8'));
        }
        const dataObj = data as { id?: string };
        if (dataObj.id) {
          logger.info(`Received async task ID: ${dataObj.id}`);
        }
        return data as Record<string, unknown>;
      } else {
        // Other responses
        return response.data as Record<string, unknown>;
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Request failed: ${axiosError.message}`);

      // Handle specific error cases
      if (axiosError.response) {
        const status = axiosError.response.status;
        let data = axiosError.response.data as Buffer | ErrorResponseData;

        // Parse Buffer responses to JSON
        if (Buffer.isBuffer(data)) {
          try {
            data = JSON.parse(data.toString('utf8')) as ErrorResponseData;
          } catch (parseError) {
            const parseErr = parseError as Error;
            logger.error(`Failed to parse error response buffer: ${parseErr.message}`);
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
          const errorData = data as ErrorResponseData;
          const errorMsg = errorData.errors ? errorData.errors.join(', ') : JSON.stringify(data);
          throw new Error(`Invalid parameters: ${errorMsg}`);
        }
      }

      // Throw sanitized error
      throw new Error(this._sanitizeErrorMessage(axiosError));
    }
  }

  /**
   * Poll for async task result.
   *
   * @param taskId - Task ID from async operation
   * @param options - Polling options
   * @returns Task result with image
   */
  async waitForResult(taskId: string, {
    pollInterval = DEFAULT_POLL_INTERVAL,
    timeout = DEFAULT_TIMEOUT,
    showSpinner = true
  }: WaitResultOptions = {}): Promise<ImageResult> {
    logger.info(`Polling for task ${taskId} (interval: ${pollInterval}s, timeout: ${timeout}s)`);

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let attempt = 0;
    let spinner: ReturnType<typeof createSpinner> | null = null;

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
          if ('image' in result && result.image) {
            if (spinner) {
              spinner.stop(`✓ Upscale complete! (${elapsed.toFixed(1)}s)`);
            }
            logger.info(`Task ${taskId} completed after ${elapsed.toFixed(1)}s`);
            return result as ImageResult;
          }

          // If still in progress (HTTP 202), continue polling
          logger.debug(`Task ${taskId} still in progress...`);
          if (spinner) {
            const timeLeft = Math.max(0, timeout - elapsed).toFixed(0);
            spinner.update(`Processing... (${elapsed.toFixed(0)}s elapsed, ~${timeLeft}s remaining)`);
          }
        } catch (error) {
          const err = error as Error;
          // Retry on transient errors
          if (err.message.includes('rate limit') || err.message.includes('503') || err.message.includes('502')) {
            logger.warn(`Transient error, will retry: ${err.message}`);
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
   * @param taskId - Task ID
   * @returns Task result
   */
  async getResult(taskId: string): Promise<ImageResult | TaskResult | Record<string, unknown>> {
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
   * @param params - Generation parameters
   * @returns Generated image result
   *
   * @example
   * const result = await api.generateUltra({ prompt: 'a cat', aspect_ratio: '16:9' });
   */
  async generateUltra(params: UltraParams): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['stable-image-ultra'], formData) as ImageResult;
  }

  /**
   * Generate image using Stable Image Core.
   * Fast and affordable SDXL successor.
   *
   * @param params - Generation parameters
   * @returns Generated image result
   *
   * @example
   * const result = await api.generateCore({ prompt: 'a dog', style_preset: 'photographic' });
   */
  async generateCore(params: CoreParams): Promise<ImageResult> {
    logger.info('Generating image with Stable Image Core');

    const formData = await buildFormData({
      prompt: params.prompt,
      negative_prompt: params.negative_prompt,
      aspect_ratio: params.aspect_ratio || '1:1',
      seed: params.seed,
      output_format: params.output_format || 'png',
      style_preset: params.style_preset
    });

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['stable-image-core'], formData) as ImageResult;
  }

  /**
   * Generate image using Stable Diffusion 3.5.
   *
   * @param params - Generation parameters
   * @returns Generated image result
   *
   * @example
   * const result = await api.generateSD3({ prompt: 'a bird', model: 'sd3.5-large-turbo' });
   */
  async generateSD3(params: SD3Params): Promise<ImageResult> {
    logger.info(`Generating image with SD 3.5 (${params.model || 'sd3.5-large'})`);

    const formData = await buildFormData({
      prompt: params.prompt,
      model: params.model || 'sd3.5-large',
      negative_prompt: params.negative_prompt,
      aspect_ratio: params.aspect_ratio || '1:1',
      seed: params.seed,
      output_format: params.output_format || 'png'
    });

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['sd3-large'], formData) as ImageResult;
  }

  /**
   * Upscale image 4x using fast upscaler (~1 second).
   *
   * @param imagePath - Path to input image or URL
   * @param outputFormat - Output format
   * @returns Upscaled image result
   *
   * @example
   * const result = await api.upscaleFast('/path/to/image.png');
   */
  async upscaleFast(imagePath: string, outputFormat = 'png'): Promise<ImageResult> {
    logger.info('Upscaling image with Fast Upscaler');

    const formData = await buildFormData(
      { output_format: outputFormat },
      { image: imagePath }
    );

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['upscale-fast'], formData) as ImageResult;
  }

  /**
   * Upscale image 20-40x to 4MP using conservative upscaler (minimal alteration).
   *
   * @param imagePath - Path to input image or URL
   * @param params - Additional parameters
   * @returns Upscaled image result
   *
   * @example
   * const result = await api.upscaleConservative('/path/to/image.png', { prompt: 'enhance details' });
   */
  async upscaleConservative(imagePath: string, params: UpscaleParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', MODEL_ENDPOINTS['upscale-conservative'], formData) as ImageResult;
  }

  /**
   * Upscale image 20-40x with creative reimagining (asynchronous).
   *
   * @param imagePath - Path to input image or URL
   * @param params - Additional parameters
   * @returns Task object or final result if wait=true
   *
   * @example
   * const result = await api.upscaleCreative('/path/to/image.png', { creativity: 0.4 });
   */
  async upscaleCreative(imagePath: string, params: UpscaleParams = {}): Promise<ImageResult | TaskResult> {
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
    const taskWithId = task as { id?: string };
    if (params.wait !== false && taskWithId.id) {
      logger.info(`Got task ID: ${taskWithId.id}, waiting for result...`);
      return await this.waitForResult(taskWithId.id);
    }

    return task as TaskResult;
  }

  /**
   * Get user account credits balance.
   *
   * @returns Balance information with credits property
   *
   * @example
   * const balance = await api.getBalance();
   * console.log('Credits remaining:', balance.credits);
   */
  async getBalance(): Promise<CreditsResult> {
    this._verifyApiKey();

    try {
      const response = await axios.get<CreditsResult>(`${this.baseUrl}/v1/user/balance`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 30000
      });

      logger.info(`Account balance: ${response.data.credits} credits`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Error fetching balance: ${this._sanitizeErrorMessage(axiosError)}`);
      throw new Error(this._sanitizeErrorMessage(axiosError));
    }
  }

  // ==================== Edit Methods ====================

  /**
   * Erase objects from an image using a mask.
   * Removes unwanted objects like blemishes, items on desks, etc.
   *
   * @param image - Path to input image or URL
   * @param options - Erase options
   * @returns Erased image result with image buffer
   *
   * @example
   * const result = await api.erase('/path/to/photo.png', { mask: '/path/to/mask.png' });
   * const result = await api.erase('/path/to/photo-with-alpha.png'); // uses alpha channel
   */
  async erase(image: string, options: EraseParams = {}): Promise<ImageResult> {
    logger.info('Erasing objects from image');

    const fileInputs: Record<string, string | undefined> = { image };
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['erase'], formData) as ImageResult;
  }

  /**
   * Inpaint (fill or replace) masked areas with prompt-guided content.
   *
   * @param image - Path to input image or URL
   * @param prompt - What to generate in masked area (1-10000 chars)
   * @param options - Inpaint options
   * @returns Inpainted image result with image buffer
   *
   * @example
   * const result = await api.inpaint('/path/to/photo.png', 'blue sky with clouds', { mask: '/path/to/mask.png' });
   */
  async inpaint(image: string, prompt: string, options: InpaintParams = {}): Promise<ImageResult> {
    logger.info('Inpainting image with prompt');

    const fileInputs: Record<string, string | undefined> = { image };
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['inpaint'], formData) as ImageResult;
  }

  /**
   * Outpaint (extend) image boundaries in any direction.
   *
   * @param image - Path to input image or URL
   * @param options - Outpaint options
   * @returns Outpainted image result with image buffer
   *
   * @example
   * const result = await api.outpaint('/path/to/photo.png', { left: 200, right: 200 });
   * const result = await api.outpaint('/path/to/photo.png', { up: 500, prompt: 'blue sky' });
   */
  async outpaint(image: string, options: OutpaintParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['outpaint'], formData) as ImageResult;
  }

  /**
   * Search and replace objects using text prompts (no manual masking needed).
   *
   * @param image - Path to input image or URL
   * @param prompt - What to replace with (1-10000 chars)
   * @param searchPrompt - Short description of what to find
   * @param options - Search and replace options
   * @returns Modified image result with image buffer
   *
   * @example
   * const result = await api.searchAndReplace('/path/to/photo.png', 'golden retriever', 'cat');
   */
  async searchAndReplace(image: string, prompt: string, searchPrompt: string, options: SearchAndReplaceParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['search-and-replace'], formData) as ImageResult;
  }

  /**
   * Search and recolor objects using text prompts (no manual masking needed).
   *
   * @param image - Path to input image or URL
   * @param prompt - Desired color/appearance (1-10000 chars)
   * @param selectPrompt - Short description of what to find
   * @param options - Search and recolor options
   * @returns Recolored image result with image buffer
   *
   * @example
   * const result = await api.searchAndRecolor('/path/to/photo.png', 'bright red', 'car');
   */
  async searchAndRecolor(image: string, prompt: string, selectPrompt: string, options: SearchAndRecolorParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['search-and-recolor'], formData) as ImageResult;
  }

  /**
   * Remove background from image (automatic segmentation).
   * Returns image with transparent background.
   *
   * @param image - Path to input image or URL
   * @param options - Remove background options
   * @returns Image with transparent background
   *
   * @example
   * const result = await api.removeBackground('/path/to/photo.png');
   * const result = await api.removeBackground('/path/to/photo.jpg', { output_format: 'webp' });
   */
  async removeBackground(image: string, options: RemoveBackgroundParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', EDIT_ENDPOINTS['remove-background'], formData) as ImageResult;
  }

  /**
   * Replace background and relight subject with AI-generated or reference imagery.
   * This is an ASYNCHRONOUS operation that returns a task ID.
   *
   * @param subjectImage - Path to image with subject to keep
   * @param options - Replace background options
   * @returns Task object or final result if wait=true
   *
   * @example
   * const result = await api.replaceBackgroundAndRelight('/path/to/portrait.png', {
   *   background_prompt: 'sunset beach with palm trees',
   *   light_source_direction: 'right'
   * });
   */
  async replaceBackgroundAndRelight(subjectImage: string, options: ReplaceBackgroundParams = {}): Promise<ImageResult | TaskResult> {
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

    const fileInputs: Record<string, string | undefined> = { subject_image: subjectImage };
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
    const taskWithId = task as { id?: string };
    if (options.wait !== false && taskWithId.id) {
      logger.info(`Got task ID: ${taskWithId.id}, waiting for result...`);
      return await this.waitForResult(taskWithId.id);
    }

    return task as TaskResult;
  }

  // ==================== Control Methods ====================

  /**
   * Control: Sketch - Convert sketches to refined images.
   * Upgrades rough hand-drawn sketches to refined outputs with precise control.
   * For non-sketch images, it leverages contour lines and edges within the image.
   *
   * @param image - Path to input sketch image or URL
   * @param prompt - What to generate from the sketch (1-10000 chars)
   * @param options - Control options
   * @returns Generated image result with image buffer
   *
   * @example
   * const result = await api.controlSketch('/path/to/sketch.png', 'a medieval castle on a hill');
   * const result = await api.controlSketch('/path/to/sketch.png', 'castle', { control_strength: 0.8 });
   */
  async controlSketch(image: string, prompt: string, options: ControlSketchParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['sketch'], formData) as ImageResult;
  }

  /**
   * Control: Structure - Generate images while preserving input structure.
   * Maintains the structural elements of an input image while generating new content.
   * Ideal for recreating scenes or rendering characters from models.
   *
   * @param image - Path to input image or URL (structure reference)
   * @param prompt - What to generate with the structure (1-10000 chars)
   * @param options - Control options
   * @returns Generated image result with image buffer
   *
   * @example
   * const result = await api.controlStructure('/path/to/statue.png', 'a shrub in an english garden');
   * const result = await api.controlStructure('/path/to/photo.jpg', 'oil painting style', { control_strength: 0.6 });
   */
  async controlStructure(image: string, prompt: string, options: ControlStructureParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['structure'], formData) as ImageResult;
  }

  /**
   * Control: Style - Generate images guided by a style reference.
   * Extracts stylistic elements from an input image and uses them to guide generation.
   * Creates a new image in the same style as the control image.
   *
   * @param image - Path to style reference image or URL
   * @param prompt - What to generate with the style (1-10000 chars)
   * @param options - Control options
   * @returns Generated image result with image buffer
   *
   * @example
   * const result = await api.controlStyle('/path/to/style-ref.png', 'a majestic portrait of a chicken');
   * const result = await api.controlStyle('/path/to/art.jpg', 'landscape', { fidelity: 0.8, aspect_ratio: '16:9' });
   */
  async controlStyle(image: string, prompt: string, options: ControlStyleParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['style'], formData) as ImageResult;
  }

  /**
   * Control: Style Transfer - Apply style from one image to another.
   * Transfers visual characteristics from a style image to a content image
   * while preserving the original composition.
   *
   * @param initImage - Path to content image or URL (what to restyle)
   * @param styleImage - Path to style reference image or URL
   * @param options - Style transfer options
   * @returns Style transferred image result with image buffer
   *
   * @example
   * const result = await api.controlStyleTransfer('/path/to/photo.png', '/path/to/art-style.png');
   * const result = await api.controlStyleTransfer('/path/to/portrait.png', '/path/to/oil-painting.jpg', {
   *   style_strength: 0.8,
   *   composition_fidelity: 0.95
   * });
   */
  async controlStyleTransfer(initImage: string, styleImage: string, options: ControlStyleTransferParams = {}): Promise<ImageResult> {
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

    return await this._makeFormDataRequest('POST', CONTROL_ENDPOINTS['style-transfer'], formData) as ImageResult;
  }
}

export default StabilityAPI;

// Re-export types for consumer convenience
export type {
  StabilityApiOptions,
  ImageResult,
  TaskResult,
  CreditsResult,
  WaitResultOptions,
  UltraParams,
  CoreParams,
  SD3Params,
  UpscaleParams,
  EraseParams,
  InpaintParams,
  OutpaintParams,
  SearchAndReplaceParams,
  SearchAndRecolorParams,
  RemoveBackgroundParams,
  ReplaceBackgroundParams,
  ControlSketchParams,
  ControlStructureParams,
  ControlStyleParams,
  ControlStyleTransferParams,
  ValidationResult,
} from './types/index.js';
