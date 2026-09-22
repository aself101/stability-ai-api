/**
 * HTTP layer — native fetch.
 *
 * Ported from bfl-api 2.0.1 (`src/http.ts`), which made the same axios → fetch
 * move first; the two files should stay recognisably the same so a fix in one
 * can be carried to the other. The one Stability-specific addition is `body`:
 * every Stability generation endpoint takes multipart/form-data, which BFL's
 * JSON-only API never needed.
 *
 * Everything axios used to do implicitly is explicit here, because each piece
 * is load-bearing and fetch provides none of it:
 *
 * - **Non-2xx throws.** fetch resolves on 4xx/5xx. Without this, an error page
 *   is a successful response: `downloadImage` would write it to disk as the
 *   image file and `imageToBuffer` would upload it to the API as the input.
 * - **Streaming size cap.** fetch has no `maxContentLength`; `arrayBuffer()`
 *   buffers the whole body first, so a post-hoc length check is not a cap at
 *   all. The body is read chunk-by-chunk and aborted the moment it exceeds.
 * - **Redirect budget with per-hop validation.** fetch offers `follow` (cap 20,
 *   unobservable) or `manual`. We follow manually so each hop can be
 *   re-validated — axios followed redirects blind, so a URL that passed the
 *   SSRF check could 302 to an internal address (or downgrade to http) and the
 *   body came back anyway. See docs/DECISIONS.md.
 * - **Typed errors.** Transport failures surface as `TypeError: fetch failed`
 *   with the real code on `.cause.code`, and undici's names differ from Node's
 *   (`UND_ERR_SOCKET`, not `ECONNRESET`). Callers classify on fields, never on
 *   message text.
 *
 * Timeouts are *idle* timeouts, matching what Node's socket timeout gave us
 * before: the clock resets on each chunk, so a large but progressing download
 * is not killed mid-flight.
 */

/** Statuses that may carry a `Location` we should follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Transport-level failure codes worth retrying. Undici's vocabulary, not Node's. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * An HTTP response the API returned that was not a success.
 *
 * `body` is the parsed response body when it was JSON, the raw text otherwise —
 * some endpoints answer a *poll* with 422 whose body is still a task result, and
 * that body has to survive to the caller.
 */
export class StabilityHttpError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  readonly body?: unknown;

  constructor(message: string, status: number, retryAfter?: number, body?: unknown) {
    super(message);
    this.name = 'StabilityHttpError';
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    if (body !== undefined) this.body = body;
  }
}

/**
 * A request that never produced a response: DNS failure, refused connection,
 * reset socket, TLS failure. `code` is the underlying cause's code where one
 * was available.
 */
export class StabilityNetworkError extends Error {
  readonly code?: string;
  /** Whether retrying could plausibly succeed. */
  readonly retryable: boolean;

  constructor(message: string, code?: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StabilityNetworkError';
    if (code !== undefined) this.code = code;
    this.retryable = code !== undefined && RETRYABLE_NETWORK_CODES.has(code);
  }
}

/** The request exceeded its idle timeout. Always worth retrying. */
export class StabilityTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms without data`);
    this.name = 'StabilityTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Body to send as JSON. */
  json?: Record<string, unknown> | null;
  /**
   * Multipart body. fetch sets `content-type` with the boundary itself, so the
   * caller must NOT set one. Mutually exclusive with `json`. A native FormData
   * can be re-sent, so 307/308 redirects that preserve the body are safe.
   */
  form?: FormData;
  /** Idle timeout in ms — reset whenever data arrives. */
  timeoutMs: number;
  /** Maximum redirects to follow (default 5). */
  maxRedirects?: number;
  /**
   * Called with each redirect target before it is followed. Throw to refuse.
   * This is where SSRF re-validation belongs — without it, following a redirect
   * discards whatever validation the original URL passed.
   */
  validateHop?: (url: string) => Promise<unknown> | unknown;
  /** Byte ceiling for the response body; exceeded => abort mid-stream. */
  maxBytes?: number;
}

/** Parse a `Retry-After` header in delta-seconds form. */
function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Dig the underlying error code out of a fetch failure. undici nests the real
 * cause one level down, and when several addresses were tried it is an
 * AggregateError whose `errors` hold the individual codes.
 */
function causeCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const c = cause as { code?: string; errors?: unknown[]; cause?: unknown };
  if (typeof c.code === 'string') return c.code;
  if (Array.isArray(c.errors)) {
    for (const nested of c.errors) {
      const code = causeCode(nested);
      if (code) return code;
    }
  }
  if (c.cause) return causeCode(c.cause);
  return undefined;
}

/** Turn a thrown fetch/abort failure into one of our typed errors. */
function asTypedError(error: unknown, timeoutMs: number, timedOut: boolean): Error {
  if (timedOut) return new StabilityTimeoutError(timeoutMs);
  if (error instanceof StabilityHttpError || error instanceof StabilityNetworkError) return error;

  const err = error as { name?: string; message?: string; cause?: unknown };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new StabilityTimeoutError(timeoutMs);
  }
  // undici surfaces transport failures as TypeError('fetch failed') with the
  // real cause attached; the message itself carries nothing usable.
  const code = causeCode(err?.cause);
  return new StabilityNetworkError(
    code ? `Network request failed (${code})` : `Network request failed: ${err?.message ?? 'unknown'}`,
    code,
    error
  );
}

/**
 * Read a body with a hard byte ceiling, aborting as soon as it is exceeded
 * rather than after the fact. Resets the idle timer on every chunk.
 */
async function readCapped(
  response: Response,
  maxBytes: number | undefined,
  resetIdle: () => void
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      total += value.byteLength;
      if (maxBytes !== undefined && total > maxBytes) {
        // cancel() through the reader — the stream is locked while we hold it.
        await reader.cancel();
        throw new Error(`Response exceeds maximum size of ${maxBytes / (1024 * 1024)}MB`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

/**
 * Perform one request, following redirects manually so each hop can be
 * validated, and return the final response plus its body as bytes.
 *
 * @throws StabilityHttpError on a non-2xx response
 * @throws StabilityNetworkError when no response was produced
 * @throws StabilityTimeoutError when the idle timeout elapsed
 */
export async function request(
  url: string,
  options: RequestOptions
): Promise<{ status: number; headers: Headers; bytes: Buffer; url: string }> {
  const { method = 'GET', headers = {}, json, form, timeoutMs, maxRedirects = 5, validateHop, maxBytes } =
    options;
  if (form !== undefined && json !== undefined && json !== null) {
    throw new TypeError('request(): pass either json or form, not both');
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const resetIdle = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };

  try {
    resetIdle();

    let currentUrl = url;
    let currentMethod = method;
    let body: string | FormData | undefined =
      form ?? (json !== undefined && json !== null ? JSON.stringify(json) : undefined);
    let hops = 0;

    for (;;) {
      const response = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      resetIdle();

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) break; // a redirect status with no target: treat as final
        if (hops >= maxRedirects) {
          throw new StabilityHttpError(
            `Too many redirects (limit ${maxRedirects}) starting from ${url}`,
            response.status
          );
        }
        hops += 1;
        const next = new URL(location, currentUrl).toString();
        // Re-validate before following. Skipping this is the SSRF hole axios had.
        if (validateHop) await validateHop(next);
        // 303, and 301/302 on POST, become GET without a body — matching
        // long-standing agent behaviour. 307/308 preserve method and body.
        if (response.status === 303 || (currentMethod === 'POST' && response.status !== 307 && response.status !== 308)) {
          currentMethod = 'GET';
          body = undefined;
        }
        currentUrl = next;
        // Drain so the socket can be reused.
        await response.body?.cancel();
        continue;
      }

      const bytes = await readCapped(response, maxBytes, resetIdle);

      if (!response.ok) {
        const text = bytes.toString('utf8');
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          /* not JSON — keep the raw text */
        }
        throw new StabilityHttpError(
          `Request failed with status code ${response.status}`,
          response.status,
          parseRetryAfter(response.headers),
          parsed
        );
      }

      return { status: response.status, headers: response.headers, bytes, url: currentUrl };
    }

    throw new StabilityNetworkError('Redirect response carried no Location header');
  } catch (error) {
    throw asTypedError(error, timeoutMs, timedOut);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Request a JSON endpoint. Returns the parsed body as `unknown`: the caller
 * checks its shape. (bfl-api's version is generic, `requestJson<T>`, and
 * asserts the parse result to T; the ship pipeline flagged that as an
 * unvalidated cast at a trust boundary, so this port returns unknown.)
 *
 * @throws StabilityHttpError / StabilityNetworkError / StabilityTimeoutError as `request`
 */
export async function requestJson(url: string, options: RequestOptions): Promise<unknown> {
  const { bytes } = await request(url, options);
  const text = bytes.toString('utf8');
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StabilityNetworkError(`Expected JSON from ${url} but received ${text.slice(0, 120)}`);
  }
}

/**
 * Request binary content (images, video) with a hard size ceiling.
 */
export async function requestBytes(url: string, options: RequestOptions): Promise<Buffer> {
  const { bytes } = await request(url, options);
  return bytes;
}
