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

import { logger, buildFormData, createSpinner, toError } from './utils.js';
import { request, requestJson, StabilityHttpError, StabilityNetworkError, StabilityTimeoutError } from './http.js';
import { BASE_URL, MODEL_ENDPOINTS, EDIT_ENDPOINTS, CONTROL_ENDPOINTS, ENDPOINT_FIELDS, DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT, MAX_RETRIES, imageToImageErrors } from './config.js';
import type {
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
  ErrorResponseData,
} from './types/index.js';

export { StabilityHttpError, StabilityNetworkError, StabilityTimeoutError } from './http.js';

/**
 * Idle timeout for API requests (resets on each chunk; see src/http.ts).
 *
 * Stability's synchronous endpoints send no bytes until the image is ready, so
 * for them this is a time-to-first-byte budget. 0.4.0 used 30 s (a total
 * timeout under axios), and Ultra image-to-image exceeded it in the 1.0 live
 * battery (2026-09-22) — the client gave up on a request the server may still
 * have completed. (That one timed-out run turned out not to be billed —
 * LIVE-BATTERY finding 3 — but one observation does not establish the server
 * never bills a request the client abandoned.) 180 s covers the slowest synchronous endpoints
 * with margin; async endpoints (creative upscale, replace-background) return a
 * task id immediately and are unaffected.
 */
const API_TIMEOUT_MS = 180_000;

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

/** Throw the collected validation errors, if any, before a request is made. */
function throwIfInvalid(errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

/**
 * A 2xx response whose body is not the shape the operation promises — an
 * "image" endpoint answering with JSON, or a task response without a string
 * `id`. Carries the parsed `body` for diagnosis. Until 1.0 such bodies were
 * cast to the promised type and returned, so `result.image` was `undefined`
 * behind a `Buffer` type.
 */
export class StabilityResponseError extends Error {
  readonly body: unknown;

  constructor(message: string, body: unknown) {
    super(message);
    this.name = 'StabilityResponseError';
    this.body = body;
  }
}

/**
 * `waitForResult` ran out of time. The task may still finish — and be billed —
 * on the server; `taskId` is here so it can be resumed with
 * `api.waitForResult(taskId)` or `sai result <taskId>`. Until 1.0 this was a
 * plain Error with the id only in its message.
 */
export class StabilityTaskTimeoutError extends Error {
  readonly taskId: string;
  readonly timeoutSeconds: number;

  constructor(taskId: string, timeoutSeconds: number) {
    super(`Timeout waiting for task ${taskId} after ${timeoutSeconds} seconds (resume with waitForResult('${taskId}') or \`sai result ${taskId}\`)`);
    this.name = 'StabilityTaskTimeoutError';
    this.taskId = taskId;
    this.timeoutSeconds = timeoutSeconds;
  }
}

/** Runtime check for a synchronous image result (bytes plus header metadata). */
export function isImageResult(value: unknown): value is ImageResult {
  return typeof value === 'object' && value !== null && 'image' in value && Buffer.isBuffer(value.image);
}

/** Runtime check for a balance response. */
function isCreditsResult(value: unknown): value is CreditsResult {
  return typeof value === 'object' && value !== null && 'credits' in value && typeof value.credits === 'number';
}

/** Runtime check for an async task handle. */
export function isTaskResult(value: unknown): value is TaskResult {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
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
   * Takes the key positionally or an options object. With no key, falls back
   * to `STABILITY_API_KEY` (the environment, or a `.env` loaded by the config
   * module). A missing key is reported on the first request, not here.
   *
   * Until 1.0 the key was a required positional string, while the README showed
   * `new StabilityAPI()` and `new StabilityAPI({ apiKey })` — the first failed
   * on the first request, the second stored "[object Object]" as the key.
   *
   * @param apiKeyOrOptions - API key, or `{ apiKey, baseUrl, logLevel }`
   * @param baseUrl - API base URL (positional form only)
   * @param logLevel - Logging level: debug, info, warn, error (positional form only)
   *
   * @example
   * const api = new StabilityAPI();                    // STABILITY_API_KEY
   * const api = new StabilityAPI('sk-xxxxx');
   * const api = new StabilityAPI({ apiKey: 'sk-xxxxx', logLevel: 'warn' });
   */
  constructor(apiKeyOrOptions?: string | StabilityApiOptions | null, baseUrl?: string, logLevel?: string) {
    const options: StabilityApiOptions =
      typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null
        ? apiKeyOrOptions
        : { apiKey: apiKeyOrOptions ?? undefined, baseUrl, logLevel };
    const apiKey = options.apiKey ?? process.env.STABILITY_API_KEY ?? '';
    baseUrl = options.baseUrl ?? BASE_URL;
    // Only touch the shared logger when a level was asked for: it is module
    // state, and a default here reset any earlier setLogLevel() for everyone.
    logLevel = options.logLevel;

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
    if (!(error instanceof StabilityHttpError)) return toError(error);

    const { status, retryAfter, body } = error;
    const errors = (body as ErrorResponseData | undefined)?.errors;
    let message: string;
    if (status === 401) {
      message = 'Authentication failed. Check your API key.';
    } else if (status === 402) {
      // HTTP 402 Payment Required. [VERIFY] that Stability uses it for an empty
      // balance; mapped so an out-of-credits account is not reported as a
      // generic failure under NODE_ENV=production.
      message = 'Payment required: check your Stability credit balance.';
    } else if (status === 403) {
      // Usually content moderation, but a 403 can also be an access/permission
      // refusal; the server's own reason is on error.body.
      message = 'Forbidden: flagged by content moderation, or not permitted for this key.';
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
    options: { headers?: Record<string, string>; timeoutMs?: number } = {}
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
        timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
        // The API does not redirect; refusing keeps the API key on api.stability.ai.
        maxRedirects: 0,
      });
    } catch (error) {
      logger.error(`Request failed: ${toError(error).message}`);
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
      } catch (error) {
        throw new StabilityNetworkError(`Expected an image or JSON from ${endpoint} but received ${contentType || 'no content-type'}: ${text.slice(0, 120)}`, undefined, error);
      }
    }
    if (status === 202) {
      if (!isTaskResult(data)) {
        throw new StabilityResponseError(`202 from ${endpoint} without a task id`, data);
      }
      logger.info('Received async task ID');
      return data;
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
   * `_submit` for a synchronous endpoint: the response must be an image.
   *
   * @throws StabilityResponseError if the server answered 2xx with anything else
   */
  private async _submitImage(
    path: string,
    values: object,
    files: Record<string, string | Buffer | undefined> = {}
  ): Promise<ImageResult> {
    const result = await this._submit(path, values, files);
    if (isImageResult(result)) return result;
    throw new StabilityResponseError(`Expected an image from ${path}`, result);
  }

  /**
   * `_submit` for an async endpoint: the response is a task id, polled to an
   * image when `wait` is not false. An image returned directly is passed
   * through.
   *
   * @throws StabilityResponseError if the response is neither a task nor an image
   */
  private async _submitTask(
    path: string,
    values: object,
    files: Record<string, string | Buffer | undefined>,
    wait: boolean | undefined,
    poll?: WaitResultOptions
  ): Promise<ImageResult | TaskResult> {
    const result = await this._submit(path, values, files);
    if (isImageResult(result)) return result;
    if (!isTaskResult(result)) {
      throw new StabilityResponseError(`Expected a task id or an image from ${path}`, result);
    }
    if (wait === false) return result;
    logger.info(`Got task ID: ${result.id}, waiting for result...`);
    return await this.waitForResult(result.id, poll);
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
    // Off by default: a library caller's stdout is not ours. The CLI turns it on.
    showSpinner = false,
    maxRetries = MAX_RETRIES
  }: WaitResultOptions = {}): Promise<ImageResult> {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError(`waitForResult: timeout must be a positive number of seconds, got ${timeout}`);
    }
    if (!Number.isFinite(pollInterval) || pollInterval < 0) {
      throw new RangeError(`waitForResult: pollInterval must be a non-negative number of seconds, got ${pollInterval}`);
    }
    logger.info(`Polling for task ${taskId} (interval: ${pollInterval}s, timeout: ${timeout}s)`);

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let attempt = 0;
    let consecutiveFailures = 0;
    let waitSeconds = pollInterval;
    let spinner: ReturnType<typeof createSpinner> | null = null;

    if (showSpinner) {
      spinner = createSpinner(`Waiting for task ${taskId}`);
      spinner.start();
    }

    try {
      while (true) {
        attempt++;
        waitSeconds = pollInterval;
        const elapsed = (Date.now() - startTime) / 1000;

        logger.debug(`Polling attempt ${attempt} (elapsed: ${elapsed.toFixed(1)}s)`);

        try {
          // Bound each poll by the time left, not the 180 s submit budget:
          // one stalled poll could otherwise overrun `timeout` by minutes.
          const remainingForPoll = Math.max(1, timeoutMs - (Date.now() - startTime));
          const result = await this._fetchResult(taskId, Math.min(API_TIMEOUT_MS, remainingForPoll));

          // Check if task is complete (HTTP 200 with image)
          if (isImageResult(result)) {
            if (spinner) {
              spinner.stop(`✓ Task complete (${elapsed.toFixed(1)}s)`);
            }
            logger.info(`Task ${taskId} completed after ${elapsed.toFixed(1)}s`);
            return result;
          }

          // Still in progress: a 202 carries the task handle. Any other 2xx
          // body is final and not an image; until 1.0 it was re-polled until
          // the timeout and then discarded.
          if (!isTaskResult(result)) {
            throw new StabilityResponseError(`Task ${taskId} finished without an image`, result);
          }
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
            // The paid task may still complete server-side; say how to get it back.
            logger.warn(`Stopped polling task ${taskId}; it may still complete. Resume with waitForResult('${taskId}') or \`sai result ${taskId}\`.`);
            throw error;
          }
          const retryAfter = error instanceof StabilityHttpError ? error.retryAfter : undefined;
          waitSeconds = Math.max(pollInterval, retryAfter ?? 0);
          logger.warn(`Transient error (${consecutiveFailures}/${maxRetries}), retrying in ${waitSeconds}s: ${toError(error).message}`);
          if (spinner) {
            spinner.update(`Retrying after error...`);
          }
        }

        // Check timeout
        if ((Date.now() - startTime) >= timeoutMs) {
          throw new StabilityTaskTimeoutError(taskId, timeout);
        }

        // Wait before next poll — never past the overall timeout. A large
        // Retry-After used to be slept in full (an hour for 3600), and a value
        // past setTimeout's 2^31-1 ms ceiling fired immediately instead.
        const remainingMs = timeoutMs - (Date.now() - startTime);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(waitSeconds * 1000, remainingMs))));
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
    return await this._fetchResult(taskId, API_TIMEOUT_MS);
  }

  /** One results poll with an explicit idle timeout (see waitForResult). */
  private async _fetchResult(taskId: string, timeoutMs: number): Promise<ImageResult | TaskResult | Record<string, unknown>> {
    const endpoint = `${MODEL_ENDPOINTS.results}/${taskId}`;
    // Results endpoint requires accept: */* for binary response
    return await this._makeFormDataRequest('GET', endpoint, null, {
      headers: { 'accept': '*/*' },
      timeoutMs,
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

    throwIfInvalid(imageToImageErrors('stable-image-ultra', params));
    return await this._submitImage(MODEL_ENDPOINTS['stable-image-ultra'], params, { image: params.image });
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

    return await this._submitImage(MODEL_ENDPOINTS['stable-image-core'], params);
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

    throwIfInvalid(imageToImageErrors('sd3', params));
    // mode is derived, never taken from the caller: with an image it must be
    // image-to-image; without one the server default (text-to-image) applies.
    const values = { ...params, mode: params.image ? 'image-to-image' : undefined };
    return await this._submitImage(MODEL_ENDPOINTS['sd3'], values, { image: params.image });
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

    return await this._submitImage(MODEL_ENDPOINTS['upscale-fast'], { output_format: outputFormat }, { image: imagePath });
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
    return await this._submitImage(MODEL_ENDPOINTS['upscale-conservative'], params, { image: imagePath });
  }

  /**
   * Upscale image 20-40x with creative reimagining (asynchronous).
   *
   * @param imagePath - Path to input image or URL
   * @param params - Additional parameters
   * @returns The final image by default (the task is polled to completion); the task handle `{ id }` when `wait: false`
   *
   * @example
   * const result = await api.upscaleCreative('/path/to/image.png', { creativity: 0.4 });
   */
  async upscaleCreative(imagePath: string, params: UpscaleParams): Promise<ImageResult | TaskResult> {
    logger.info('Upscaling image with Creative Upscaler (async)');

    requirePrompt(params?.prompt, 'Creative upscale');
    return await this._submitTask(MODEL_ENDPOINTS['upscale-creative'], params, { image: imagePath }, params.wait, params.poll);
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
      const data = await requestJson(`${this.baseUrl}/v1/user/balance`, {
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
          'accept': 'application/json'
        },
        timeoutMs: API_TIMEOUT_MS,
        maxRedirects: 0,
      });

      if (!isCreditsResult(data)) {
        throw new StabilityResponseError('Balance response has no numeric credits', data);
      }
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

    return await this._submitImage(EDIT_ENDPOINTS['erase'], options, { image, mask: options.mask });
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

    return await this._submitImage(EDIT_ENDPOINTS['inpaint'], { ...options, prompt }, { image, mask: options.mask });
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

    return await this._submitImage(EDIT_ENDPOINTS['outpaint'], options, { image });
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

    return await this._submitImage(EDIT_ENDPOINTS['search-and-replace'], { ...options, prompt, search_prompt: searchPrompt }, { image });
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

    return await this._submitImage(EDIT_ENDPOINTS['search-and-recolor'], { ...options, prompt, select_prompt: selectPrompt }, { image });
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

    return await this._submitImage(EDIT_ENDPOINTS['remove-background'], options, { image });
  }

  /**
   * Replace background and relight subject with AI-generated or reference imagery.
   * This is an ASYNCHRONOUS operation that returns a task ID.
   *
   * @param subjectImage - Path to image with subject to keep
   * @param options - Replace background options
   * @returns The final image by default (the task is polled to completion); the task handle `{ id }` when `wait: false`
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

    return await this._submitTask(EDIT_ENDPOINTS['replace-background-and-relight'], options, {
      subject_image: subjectImage,
      background_reference: options.background_reference,
      light_reference: options.light_reference,
    }, options.wait, options.poll);
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

    return await this._submitImage(CONTROL_ENDPOINTS['sketch'], { ...options, prompt }, { image });
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

    return await this._submitImage(CONTROL_ENDPOINTS['structure'], { ...options, prompt }, { image });
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

    return await this._submitImage(CONTROL_ENDPOINTS['style'], { ...options, prompt }, { image });
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

    return await this._submitImage(CONTROL_ENDPOINTS['style-transfer'], options, { init_image: initImage, style_image: styleImage });
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
