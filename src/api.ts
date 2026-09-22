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

import { logger, buildFormData, createSpinner } from './utils.js';
import { request, requestJson, StabilityHttpError, StabilityNetworkError, StabilityTimeoutError } from './http.js';
import { BASE_URL, MODEL_ENDPOINTS, EDIT_ENDPOINTS, CONTROL_ENDPOINTS, ENDPOINT_FIELDS, DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT, MAX_RETRIES } from './config.js';
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

export { StabilityHttpError, StabilityNetworkError, StabilityTimeoutError } from './http.js';

/** Idle timeout for API requests (resets on each chunk; see src/http.ts). */
const API_TIMEOUT_MS = 30000;

/** Statuses a poll may retry: throttling and gateway trouble, never client errors. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Whether an error from a request is worth retrying. Classified on type and
 * fields only — never message text. Until 1.0 this matched
 * `err.message.includes('rate limit')` against a message that read
 * 'Rate limit exceeded…' (never matched), and '502'/'503' against axios's dev
 * message, which production sanitising replaced (never matched there either).
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof StabilityHttpError) return TRANSIENT_STATUSES.has(error.status);
  if (error instanceof StabilityNetworkError) return error.retryable;
  return error instanceof StabilityTimeoutError;
}

/**
 * Fail before any network call when an endpoint's required prompt is missing.
 * The server answers `400 prompt: required` anyway (confirmed 2026-09-22 for
 * both upscalers); this makes the message say which method needed it.
 */
function requirePrompt(prompt: string | undefined, operation: string): void {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error(`${operation} requires a prompt`);
  }
}

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
   * Map a failed API response to the error the caller sees: a
   * `StabilityHttpError` carrying the original status, Retry-After and parsed
   * body, with a readable message. Under axios this threw a bare `Error`, so
   * status and body were lost and callers could only match on message text.
   *
   * In production (`NODE_ENV=production`) unmapped statuses get a generic
   * message to avoid disclosing upstream detail; the body stays on `.body`.
   * Network and timeout errors pass through unchanged.
   */
  private _toApiError(error: unknown): Error {
    if (!(error instanceof StabilityHttpError)) return error as Error;

    const { status, retryAfter, body } = error;
    const errors = (body as ErrorResponseData | undefined)?.errors;
    let message: string;
    if (status === 401) {
      message = 'Authentication failed. Check your API key.';
    } else if (status === 403) {
      message = 'Content moderation flagged your request.';
    } else if (status === 413) {
      message = 'Request payload too large (max 10MB).';
    } else if (status === 429) {
      message = 'Rate limit exceeded. Please wait before retrying.';
    } else if (status === 400) {
      message = `Invalid parameters: ${Array.isArray(errors) ? errors.join(', ') : JSON.stringify(body)}`;
    } else if (process.env.NODE_ENV === 'production') {
      message = 'An error occurred while processing your request';
    } else {
      message = `Request failed with status code ${status}${Array.isArray(errors) ? `: ${errors.join(', ')}` : ''}`;
    }
    logger.error(`HTTP ${status}: ${JSON.stringify(body)}`);
    return new StabilityHttpError(message, status, retryAfter, body);
  }

  /**
   * Make a request to the Stability AI API.
   *
   * Response shapes, by status and content-type:
   * - 200 `image/*` — synchronous result: image bytes, with `finish-reason`
   *   and `seed` carried in response headers.
   * - 202 — async task still running: JSON body (`{ id, status }`). Under
   *   axios this arrived as a raw ArrayBuffer and was returned unparsed.
   * - 200 JSON — async submission answered with 200 (`{ id }`, e.g.
   *   replace-background-and-relight) or any other JSON result.
   *
   * @param method - HTTP method (GET, POST)
   * @param endpoint - API endpoint path
   * @param formData - Multipart body for POST requests
   * @param options - Extra headers (e.g. `accept`)
   * @returns Image result, task result, or parsed JSON
   * @throws StabilityHttpError on a non-2xx response (see `_toApiError`)
   * @throws StabilityNetworkError / StabilityTimeoutError on transport failure
   */
  private async _makeFormDataRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    formData: FormData | null = null,
    options: { headers?: Record<string, string> } = {}
  ): Promise<ImageResult | TaskResult | Record<string, unknown>> {
    this._verifyApiKey();

    const url = `${this.baseUrl}${endpoint}`;
    const redactedKey = this._redactApiKey(this.apiKey);
    logger.debug(`Making ${method} request to ${url} (API key: ${redactedKey})`);

    // No content-type here: fetch writes the multipart boundary itself.
    const headers: Record<string, string> = {
      'authorization': `Bearer ${this.apiKey}`,
      'accept': 'image/*', // Request image bytes directly
      ...options.headers
    };

    let response: Awaited<ReturnType<typeof request>>;
    try {
      response = await request(url, {
        method,
        headers,
        ...(formData && method === 'POST' ? { form: formData } : {}),
        timeoutMs: API_TIMEOUT_MS,
        // The API does not redirect; refusing keeps the API key on api.stability.ai.
        maxRedirects: 0,
      });
    } catch (error) {
      logger.error(`Request failed: ${(error as Error).message}`);
      throw this._toApiError(error);
    }

    const { status, headers: resHeaders, bytes } = response;
    const contentType = resHeaders.get('content-type') ?? '';
    logger.debug(`Response status: ${status}, content-type: ${contentType}`);

    if (status === 200 && contentType.startsWith('image/')) {
      logger.info(`Received image response (${bytes.length} bytes)`);
      return {
        image: bytes,
        finish_reason: resHeaders.get('finish-reason') ?? undefined,
        seed: resHeaders.get('seed') ?? undefined
      };
    }

    const text = bytes.toString('utf8');
    let data: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new StabilityNetworkError(`Expected an image or JSON from ${endpoint} but received ${contentType || 'no content-type'}: ${text.slice(0, 120)}`);
      }
    }
    if (status === 202) {
      logger.info('Received async task ID');
      return data as unknown as TaskResult;
    }
    if (typeof data.id === 'string') {
      logger.info(`Received async task ID: ${data.id}`);
    }
    return data;
  }

  /**
   * Build and send one generation request from the endpoint's field registry.
   *
   * Only fields listed in `ENDPOINT_FIELDS[path]` are read from `values` /
   * `files`; everything else is ignored, and `undefined`/`null` values are
   * skipped so the server's own default applies. Falsy values that were set
   * (`0`, `false`, `''`) are sent. The registry is what the spec-drift check
   * compares against the live API, so it is the single definition of what
   * this wrapper can send (bfl-api DECISIONS #2).
   *
   * @throws Error if `path` has no registry entry (a wiring bug, not a caller error)
   */
  private async _submit(
    path: string,
    values: object,
    files: Record<string, string | Buffer | undefined> = {}
  ): Promise<ImageResult | TaskResult | Record<string, unknown>> {
    const fields = ENDPOINT_FIELDS[path];
    if (!fields) {
      throw new Error(`No ENDPOINT_FIELDS entry for ${path}`);
    }
    const source = values as Record<string, unknown>;
    const text = Object.fromEntries(fields.text.map(f => [f, source[f]]));
    const fileParts = Object.fromEntries(fields.files.map(f => [f, files[f]]));
    const formData = await buildFormData(text, fileParts);
    return await this._makeFormDataRequest('POST', path, formData);
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
    showSpinner = true,
    maxRetries = MAX_RETRIES
  }: WaitResultOptions = {}): Promise<ImageResult> {
    logger.info(`Polling for task ${taskId} (interval: ${pollInterval}s, timeout: ${timeout}s)`);

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let attempt = 0;
    let consecutiveFailures = 0;
    let waitSeconds = pollInterval;
    let spinner: ReturnType<typeof createSpinner> | null = null;

    if (showSpinner) {
      spinner = createSpinner(`Waiting for upscale to complete (task: ${taskId})`);
      spinner.start();
    }

    try {
      while (true) {
        attempt++;
        waitSeconds = pollInterval;
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
          consecutiveFailures = 0;
        } catch (error) {
          // Permanent errors throw immediately; transient ones retry up to
          // maxRetries in a row, waiting at least as long as Retry-After asks.
          if (!isTransientError(error) || ++consecutiveFailures > maxRetries) {
            throw error;
          }
          const retryAfter = error instanceof StabilityHttpError ? error.retryAfter : undefined;
          waitSeconds = Math.max(pollInterval, retryAfter ?? 0);
          logger.warn(`Transient error (${consecutiveFailures}/${maxRetries}), retrying in ${waitSeconds}s: ${(error as Error).message}`);
          if (spinner) {
            spinner.update(`Retrying after error...`);
          }
        }

        // Check timeout
        if ((Date.now() - startTime) >= timeoutMs) {
          throw new Error(`Timeout waiting for task ${taskId} after ${timeout} seconds`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
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

    return await this._submit(MODEL_ENDPOINTS['stable-image-ultra'], params, { image: params.image }) as ImageResult;
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

    return await this._submit(MODEL_ENDPOINTS['stable-image-core'], params) as ImageResult;
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
    logger.info(`Generating image with SD 3.5 (${params.model ?? 'server default: sd3.5-large'})`);

    return await this._submit(MODEL_ENDPOINTS['sd3'], params) as ImageResult;
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

    return await this._submit(MODEL_ENDPOINTS['upscale-fast'], { output_format: outputFormat }, { image: imagePath }) as ImageResult;
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
  async upscaleConservative(imagePath: string, params: UpscaleParams): Promise<ImageResult> {
    logger.info('Upscaling image with Conservative Upscaler');

    requirePrompt(params?.prompt, 'Conservative upscale');
    return await this._submit(MODEL_ENDPOINTS['upscale-conservative'], params, { image: imagePath }) as ImageResult;
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
  async upscaleCreative(imagePath: string, params: UpscaleParams): Promise<ImageResult | TaskResult> {
    logger.info('Upscaling image with Creative Upscaler (async)');

    requirePrompt(params?.prompt, 'Creative upscale');
    const task = await this._submit(MODEL_ENDPOINTS['upscale-creative'], params, { image: imagePath });

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
      const data = await requestJson<CreditsResult>(`${this.baseUrl}/v1/user/balance`, {
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
          'accept': 'application/json'
        },
        timeoutMs: API_TIMEOUT_MS,
        maxRedirects: 0,
      });

      logger.info(`Account balance: ${data.credits} credits`);
      return data;
    } catch (error) {
      const apiError = this._toApiError(error);
      logger.error(`Error fetching balance: ${apiError.message}`);
      throw apiError;
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

    return await this._submit(EDIT_ENDPOINTS['erase'], options, { image, mask: options.mask }) as ImageResult;
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

    return await this._submit(EDIT_ENDPOINTS['inpaint'], { ...options, prompt }, { image, mask: options.mask }) as ImageResult;
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

    return await this._submit(EDIT_ENDPOINTS['outpaint'], options, { image }) as ImageResult;
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

    return await this._submit(EDIT_ENDPOINTS['search-and-replace'], { ...options, prompt, search_prompt: searchPrompt }, { image }) as ImageResult;
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

    return await this._submit(EDIT_ENDPOINTS['search-and-recolor'], { ...options, prompt, select_prompt: selectPrompt }, { image }) as ImageResult;
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
    if (options.output_format === 'jpeg') {
      throw new Error('Remove background does not support jpeg output format (requires transparency). Use png or webp.');
    }

    return await this._submit(EDIT_ENDPOINTS['remove-background'], options, { image }) as ImageResult;
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

    const task = await this._submit(EDIT_ENDPOINTS['replace-background-and-relight'], options, {
      subject_image: subjectImage,
      background_reference: options.background_reference,
      light_reference: options.light_reference,
    });

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

    return await this._submit(CONTROL_ENDPOINTS['sketch'], { ...options, prompt }, { image }) as ImageResult;
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

    return await this._submit(CONTROL_ENDPOINTS['structure'], { ...options, prompt }, { image }) as ImageResult;
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

    return await this._submit(CONTROL_ENDPOINTS['style'], { ...options, prompt }, { image }) as ImageResult;
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

    return await this._submit(CONTROL_ENDPOINTS['style-transfer'], options, { init_image: initImage, style_image: styleImage }) as ImageResult;
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
