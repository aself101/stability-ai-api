/**
 * Stability AI Service Utility Functions
 *
 * Utility functions for Stability AI image generation, including file I/O,
 * image handling, polling, and data transformations.
 */

import fs from 'fs/promises';
import { statSync } from 'fs';
import path from 'path';
import winston from 'winston';
import { lookup } from 'dns/promises';
import { isIPv4, isIPv6 } from 'net';
import { requestBytes } from './http.js';
import type {
  SpinnerObject,
  ImageValidationConstraints,
  ImageFileValidationResult,
  FileFormat,
} from './types/index.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size for image downloads (50MB) */
export const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024;

/**
 * Idle timeout for downloading images from URLs (60 seconds). Under axios this
 * was a total-request timeout; since 1.0 it resets on every chunk received
 * (see src/http.ts), so a slow but progressing download is not killed.
 */
export const DOWNLOAD_TIMEOUT_MS = 60000;

/** Deadline for the DNS lookup in validateImageUrl. */
const DNS_TIMEOUT_MS = 10_000;

/** Reject if `promise` has not settled within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Extensions `writeToFile`/`readFromFile` treat as binary in auto mode. */
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Maximum number of redirects allowed when fetching URLs */
export const MAX_REDIRECTS = 5;

// Configure module logger
// Library default is 'warn': a server importing the SDK should not get info
// lines (which include prompts) on stdout. The CLI sets 'info' (--log-level).
const logger = winston.createLogger({
  level: 'warn',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [
    // Errors and warnings go to stderr, so they survive `sai … > out.log`
    // and stay out of anything that parses stdout.
    new winston.transports.Console({ stderrLevels: ['error', 'warn'] })
  ]
});

/**
 * Narrow a caught value to an Error. Strict mode types `catch (error)` as
 * `unknown` because JavaScript can throw anything; asserting `error as Error`
 * (the pre-1.0 convention, at ~22 sites) turns a thrown string into an object
 * whose `.message` is undefined.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value) ?? String(value));
  } catch {
    return new Error(String(value));
  }
}

/** The `code` of a Node system error (ENOENT, ENOTFOUND, …), if the value has one. */
export function errorCode(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string') {
    return value.code;
  }
  return undefined;
}

/**
 * Check if an IP address is blocked (private, localhost, or cloud metadata).
 * Used for DNS rebinding prevention.
 *
 * @param ip - IP address to check
 * @returns True if IP is blocked
 */
/**
 * Expand an IPv6 address to its 8 hextets (numbers), accepting a trailing
 * dotted-quad. Returns null if it is not a well-formed IPv6 literal.
 */
function expandIPv6(ip: string): number[] | null {
  if (!isIPv6(ip)) return null;
  let text = ip;
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = text.split('::');
  const parse = (part: string | undefined) => (part ? part.split(':').map(h => parseInt(h, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const fill = tail === undefined ? [] : new Array(8 - left.length - right.length).fill(0);
  const hextets = [...left, ...fill, ...right];
  return hextets.length === 8 ? hextets : null;
}

/**
 * The IPv4 address an IPv6 address embeds and routes to, if any: IPv4-mapped
 * (::ffff:0:0/96), IPv4-translated (::ffff:0:0:0/96), NAT64 (64:ff9b::/96) and
 * the deprecated IPv4-compatible form (::/96, excluding :: and ::1).
 *
 * Until 1.0 only the *dotted* mapped form was recognised. Node's URL parser
 * normalises https://[::ffff:127.0.0.1] to [::ffff:7f00:1], so the hex form —
 * the one validateImageUrl actually sees after parsing — bypassed the check.
 */
function embeddedIPv4(ip: string): string | null {
  const h = expandIPv6(ip);
  if (!h) return null;
  const zero = (from: number, to: number) => h.slice(from, to).every(x => x === 0);
  const isMapped = zero(0, 5) && h[5] === 0xffff;
  const isTranslated = zero(0, 4) && h[4] === 0xffff && h[5] === 0;
  const isNat64 = h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6);
  const isCompatible = zero(0, 6) && (h[6] !== 0 || h[7] > 1);
  if (!(isMapped || isTranslated || isNat64 || isCompatible)) return null;
  return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.');
}

function isBlockedIP(ip: string): boolean {
  const cleanIP = ip.replace(/^\[|\]$/g, '').toLowerCase(); // Remove IPv6 brackets

  // An IPv6 address that embeds an IPv4 one is judged by that IPv4 — in any
  // spelling (dotted or hex), and whether it came from a URL or from DNS.
  const v4 = embeddedIPv4(cleanIP);
  if (v4) {
    return isBlockedIP(v4);
  }

  // Block localhost variations
  if (cleanIP === 'localhost' || cleanIP === '127.0.0.1' || cleanIP === '::1') {
    return true;
  }

  // Block cloud metadata endpoints
  const blockedHosts = [
    'metadata.google.internal',
    'metadata',
    '169.254.169.254',
  ];
  if (blockedHosts.includes(cleanIP)) {
    return true;
  }

  // Block private IP ranges and special addresses
  const blockedPatterns = [
    /^127\./,                    // Loopback
    /^10\./,                     // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
    /^192\.168\./,               // Private Class C
    /^169\.254\./,               // Link-local (AWS metadata)
    /^0\./,                      // "This network" (0.0.0.0/8)
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // Carrier-grade NAT (100.64.0.0/10)
    /^192\.0\.0\./,              // IETF protocol assignments (192.0.0.0/24)
    /^198\.1[89]\./,             // Benchmarking (198.18.0.0/15)
    /^(22[4-9]|2[3-5]\d)\./,      // Multicast and reserved (224.0.0.0/3)
    /^ff[0-9a-f]{2}:/,           // IPv6 multicast (ff00::/8)
    /^::1?$/,                    // IPv6 loopback / unspecified
    // fe80::/10 and fc00::/7 are prefix *ranges*, not literals. Until 1.0 these
    // were /^fe80:/, /^fc00:/, /^fd00:/, which passed fd12:3456::1 and every
    // other ULA address. A first hextet with fewer than four digits has
    // implied leading zeros (fd1:: is 0x0fd1), so exactly four are required.
    /^fe[89ab][0-9a-f]:/,        // IPv6 link-local (fe80::/10)
    /^f[cd][0-9a-f]{2}:/,        // IPv6 unique local (fc00::/7)
  ];

  return blockedPatterns.some(pattern => pattern.test(cleanIP));
}

/**
 * Validate image URL for security.
 * Enforces HTTPS and blocks private IPs, localhost, and cloud metadata endpoints.
 * Performs DNS resolution to prevent DNS rebinding attacks.
 *
 * @param url - URL to validate
 * @returns Validated URL
 * @throws Error if URL is invalid or insecure
 */
export async function validateImageUrl(url: string): Promise<string> {
  // First check for IPv4-mapped IPv6 in the original URL string (before URL parsing normalizes it)
  // This prevents SSRF bypass via https://[::ffff:127.0.0.1] or https://[::ffff:169.254.169.254]
  const ipv6MappedMatch = url.match(/\[::ffff:(\d+\.\d+\.\d+\.\d+)\]/i);
  if (ipv6MappedMatch) {
    const extractedIPv4 = ipv6MappedMatch[1];
    logger.warn(`SECURITY: Detected IPv4-mapped IPv6 address in URL: ${url} → ${extractedIPv4}`);

    // Validate the extracted IPv4 directly
    if (extractedIPv4 === '127.0.0.1' || extractedIPv4.startsWith('127.')) {
      logger.warn(`SECURITY: Blocked IPv4-mapped IPv6 localhost: ${url}`);
      throw new Error('Access to localhost is not allowed');
    }

    // Check against private IP patterns
    const privatePatterns = [
      /^10\./,                     // Private Class A
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
      /^192\.168\./,               // Private Class C
      /^169\.254\./,               // Link-local (AWS metadata)
      /^0\./,                      // Invalid range
    ];

    if (privatePatterns.some(pattern => pattern.test(extractedIPv4))) {
      logger.warn(`SECURITY: Blocked IPv4-mapped IPv6 private IP: ${url}`);
      throw new Error('Access to internal/private IP addresses is not allowed');
    }
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`, { cause: error });
  }

  // Only allow HTTPS (not HTTP)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed for security reasons');
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHostname = hostname.replace(/^\[|\]$/g, ''); // Remove IPv6 brackets

  // First check if hostname itself is blocked (before DNS resolution)
  const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
  if (blockedHosts.includes(cleanHostname)) {
    logger.warn(`SECURITY: Blocked access to prohibited hostname: ${hostname}`);
    throw new Error('Access to cloud metadata endpoints is not allowed');
  }

  // Check if hostname is already an IP address (not a domain name)
  if (isIPv4(cleanHostname) || isIPv6(cleanHostname)) {
    // Direct IP address - validate it using our blocklist
    if (isBlockedIP(cleanHostname)) {
      logger.warn(`SECURITY: Blocked access to private/internal IP: ${hostname}`);
      throw new Error('Access to internal/private IP addresses is not allowed');
    }
  } else {
    // Hostname is a domain name - perform DNS resolution to prevent DNS rebinding.
    // Only the lookup sits inside the try: until 1.0 the blocked-address check
    // did too, and the catch told its own error apart from a DNS failure by
    // matching the message text 'resolves to internal'.
    logger.debug(`Resolving DNS for hostname: ${hostname}`);
    let addresses: { address: string }[];
    try {
      // Every address, not the first: a name with one public and one private
      // record passed a first-address check, and the client may connect to
      // either.
      // Bounded: the OS resolver has no deadline of its own, and this runs
      // before request()'s idle timer starts.
      addresses = await withTimeout(lookup(hostname, { all: true }), DNS_TIMEOUT_MS, `DNS lookup for ${hostname}`);
    } catch (error) {
      if (errorCode(error) === 'ENOTFOUND') {
        logger.warn(`SECURITY: Domain ${hostname} could not be resolved`);
        throw new Error(`Domain ${hostname} could not be resolved`, { cause: error });
      }
      const err = toError(error);
      logger.warn(`SECURITY: DNS lookup failed for ${hostname}: ${err.message}`);
      throw new Error(`Failed to validate domain ${hostname}: ${err.message}`, { cause: error });
    }
    logger.debug(`DNS resolved ${hostname} → ${addresses.map(a => a.address).join(', ')}`);

    const blocked = addresses.find(a => isBlockedIP(a.address));
    if (blocked) {
      logger.warn(`SECURITY: DNS resolution of ${hostname} points to blocked IP: ${blocked.address}`);
      throw new Error(`Domain ${hostname} resolves to internal/private IP address`);
    }

    logger.debug(`DNS validation passed for ${hostname}`);
  }

  return url;
}

/**
 * Validate image file path.
 * Checks file exists, is readable, and has valid image magic bytes.
 *
 * @param filepath - Path to image file
 * @returns Validated filepath
 * @throws Error if file doesn't exist, isn't readable, or isn't a valid image
 */
export async function validateImagePath(filepath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filepath);

    // Check file size (must be > 0)
    if (buffer.length === 0) {
      throw new Error(`Image file is empty: ${filepath}`);
    }

    // Check magic bytes for common image formats
    const magicBytes = buffer.subarray(0, 4);
    const isPNG = magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47;
    const isJPEG = magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF;
    const isWebP = buffer.subarray(8, 12).toString() === 'WEBP';
    const isGIF = magicBytes.subarray(0, 3).toString() === 'GIF';

    if (!isPNG && !isJPEG && !isWebP && !isGIF) {
      throw new Error(`File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${filepath}`);
    }

    return filepath;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`, { cause: error });
    } else if (code === 'EACCES') {
      throw new Error(`Permission denied reading image file: ${filepath}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Validate image file against constraints.
 * Checks file size and format.
 *
 * @param filepath - Path to image file
 * @param constraints - Validation constraints
 * @returns Validation result { valid: boolean, errors: string[] }
 */
export function validateImageFile(filepath: string, constraints: ImageValidationConstraints = {}): ImageFileValidationResult {
  const errors: string[] = [];

  try {
    // Check if file exists
    const stats = statSync(filepath);

    // Check file size
    if (constraints.maxSize && stats.size > constraints.maxSize) {
      const maxMB = (constraints.maxSize / (1024 * 1024)).toFixed(1);
      const actualMB = (stats.size / (1024 * 1024)).toFixed(1);
      errors.push(
        `Image file size (${actualMB}MB) exceeds maximum (${maxMB}MB)`
      );
    }

    // Check file extension
    const ext = path.extname(filepath).toLowerCase().substring(1);
    if (constraints.formats && !constraints.formats.includes(ext)) {
      errors.push(
        `Image format "${ext}" not supported. Valid formats: ${constraints.formats.join(', ')}`
      );
    }

  } catch (error) {
    const err = toError(error);
    const code = errorCode(error);
    if (code === 'ENOENT') {
      errors.push(`Image file not found: ${filepath}`);
    } else {
      errors.push(`Error validating image file: ${err.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    const err = toError(error);
    logger.error(`Error creating directory ${dirPath}: ${err.message}`);
    throw error;
  }
}

/**
 * Write data to file.
 *
 * @param data - Data to write (Object, Array, Buffer, string, etc.)
 * @param filepath - Path where file should be written
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 *
 * @throws Error if filepath not provided
 */
export async function writeToFile(data: unknown, filepath: string, fileFormat: FileFormat = 'auto'): Promise<void> {
  if (!filepath) {
    throw new Error('writeToFile: filepath is required');
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    // Auto-detect format from extension
    let format = fileFormat;
    if (format === 'auto') {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.json') {
        format = 'json';
      } else if (Buffer.isBuffer(data) || BINARY_EXTENSIONS.has(ext)) {
        // A Buffer is binary whatever the extension. Until 1.0 only .png/.jpg/
        // .jpeg were, so a .webp image fell through to the text branch and was
        // UTF-8 decoded — every `--output-format webp` save wrote a corrupt file.
        format = 'binary';
      } else {
        format = 'txt';
      }
    }

    // Write based on format
    if (format === 'json') {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    } else if (format === 'binary') {
      // Binary is chosen by extension as well as by type, so check the data
      // itself rather than asserting `data as Buffer`: an object bound for a
      // .png is a caller mistake, and fs.writeFile would reject it with a less
      // useful message.
      if (!(data instanceof Uint8Array)) {
        throw new TypeError(`writeToFile: ${path.extname(filepath) || 'binary'} output needs a Buffer, got ${typeof data}`);
      }
      await fs.writeFile(filepath, data);
    } else {
      // Text format
      await fs.writeFile(filepath, String(data));
    }

    logger.debug(`Successfully wrote data to ${filepath}`);
  } catch (error) {
    const err = toError(error);
    logger.error(`Error writing to file ${filepath}: ${err.message}`);
    throw error;
  }
}

/**
 * Read data from file.
 *
 * @param filepath - Path to file to read
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 * @returns Data from file
 *
 * @throws Error if filepath not provided or file doesn't exist
 */
export async function readFromFile(filepath: string, fileFormat: FileFormat = 'auto'): Promise<unknown> {
  if (!filepath) {
    throw new Error('readFromFile: filepath is required');
  }

  try {
    // Check if file exists
    await fs.access(filepath);

    // Auto-detect format from extension
    let format = fileFormat;
    if (format === 'auto') {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.json') {
        format = 'json';
      } else if (BINARY_EXTENSIONS.has(ext)) {
        format = 'binary';
      } else {
        format = 'txt';
      }
    }

    let result: unknown;

    // Read based on format
    if (format === 'json') {
      const content = await fs.readFile(filepath, 'utf-8');
      if (content.trim() === '') {
        throw new Error(`readFromFile: ${filepath} is empty`);
      }
      try {
        result = JSON.parse(content);
      } catch (error) {
        throw new Error(`readFromFile: ${filepath} is not valid JSON: ${toError(error).message}`, { cause: error });
      }
    } else if (format === 'binary') {
      result = await fs.readFile(filepath);
    } else {
      result = await fs.readFile(filepath, 'utf-8');
    }

    logger.debug(`Successfully read data from ${filepath}`);
    return result;
  } catch (error) {
    const err = toError(error);
    logger.error(`Error reading from file ${filepath}: ${err.message}`);
    throw error;
  }
}

/**
 * Convert a local image file to base64 string.
 *
 * @param filepath - Path to local image file
 * @returns Base64-encoded image string
 *
 * @throws Error if file doesn't exist or can't be read
 */
export async function fileToBase64(filepath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filepath);
    const base64 = buffer.toString('base64');
    logger.debug(`Converted ${filepath} to base64 (${base64.length} chars)`);
    return base64;
  } catch (error) {
    const err = toError(error);
    logger.error(`Error converting file to base64: ${err.message}`);
    throw new Error(`Failed to read image file '${filepath}': ${err.message}`, { cause: error });
  }
}

/**
 * Fetch image bytes from a URL: validated, redirect hops re-validated,
 * size-capped while streaming. The single download path for every URL helper
 * below — under axios, `urlToBase64` skipped validation entirely when called
 * directly and none of the three re-checked redirect targets.
 *
 * @param url - Image URL (HTTPS only)
 * @returns Image bytes
 */
async function fetchImageBytes(url: string): Promise<Buffer> {
  await validateImageUrl(url);
  return await requestBytes(url, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxBytes: MAX_DOWNLOAD_SIZE,
    validateHop: validateImageUrl,
  });
}

/**
 * Download image from URL to base64 string.
 *
 * @param url - Image URL
 * @returns Base64-encoded image string
 *
 * @throws Error if URL can't be fetched or exceeds size limit
 */
export async function urlToBase64(url: string): Promise<string> {
  try {
    const bytes = await fetchImageBytes(url);
    const base64 = bytes.toString('base64');
    logger.debug(`Downloaded and converted ${url} to base64 (${base64.length} chars, ${bytes.length} bytes)`);
    return base64;
  } catch (error) {
    const err = toError(error);
    logger.error(`Error downloading image from URL: ${err.message}`);
    throw new Error(`Failed to download image from '${url}': ${err.message}`, { cause: error });
  }
}

/**
 * Convert image input (file path or URL) to base64 string.
 * Validates URL/file path before conversion for security.
 *
 * @param input - Local file path or URL
 * @returns Base64-encoded image string
 * @throws Error if validation fails or conversion fails
 */
export async function imageToBase64(input: string): Promise<string> {
  // Check if input is a URL
  if (input.startsWith('http://') || input.startsWith('https://')) {
    // urlToBase64 validates (SSRF protection)
    return await urlToBase64(input);
  } else {
    // Validate file path (existence and format)
    await validateImagePath(input);
    return await fileToBase64(input);
  }
}

/**
 * Download image from URL and save to file.
 *
 * @param url - Image URL
 * @param filepath - Destination file path
 */
export async function downloadImage(url: string, filepath: string): Promise<void> {
  try {
    const bytes = await fetchImageBytes(url);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    await fs.writeFile(filepath, bytes);
    logger.info(`Downloaded image to ${filepath} (${bytes.length} bytes)`);
  } catch (error) {
    const err = toError(error);
    logger.error(`Error downloading image: ${err.message}`);
    throw error;
  }
}

/**
 * Pause execution for specified duration.
 *
 * @param seconds - Number of seconds to pause (can be float for sub-second delays)
 *
 * @throws Error if seconds is negative
 */
export function pause(seconds: number): Promise<void> {
  if (seconds < 0) {
    throw new Error('Seconds cannot be negative');
  }

  logger.debug(`Pausing for ${seconds} seconds...`);
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Generate random integer between min and max (inclusive).
 *
 * @param minVal - Minimum value
 * @param maxVal - Maximum value
 * @returns Random integer between minVal and maxVal
 *
 * @throws Error if minVal > maxVal
 */
export function randomNumber(minVal: number, maxVal: number): number {
  if (minVal > maxVal) {
    throw new Error(`minVal (${minVal}) cannot be greater than maxVal (${maxVal})`);
  }

  const result = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
  logger.debug(`Generated random number: ${result} (range: ${minVal}-${maxVal})`);
  return result;
}

/**
 * Generate a safe filename from a prompt string.
 *
 * @param prompt - Prompt text
 * @param maxLength - Maximum filename length (default: 50)
 * @returns Safe filename string
 */
export function promptToFilename(prompt: string, maxLength = 50): string {
  // Remove special characters and replace spaces with underscores
  let filename = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Truncate if too long
  if (filename.length > maxLength) {
    filename = filename.substring(0, maxLength);
  }

  // If empty after sanitization, use default
  if (!filename) {
    filename = 'image';
  }

  return filename;
}

/**
 * Generate a timestamped filename.
 *
 * @param prefix - Filename prefix (e.g., prompt-based name)
 * @param extension - File extension (e.g., 'png', 'jpg')
 * @returns Timestamped filename
 */
export function generateTimestampedFilename(prefix: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  return `${timestamp}_${prefix}.${extension}`;
}

/**
 * Create a spinner for long-running operations.
 * Returns an object with start() and stop() methods.
 *
 * @param message - Message to display with spinner
 * @returns Spinner object with start() and stop() methods
 */
export function createSpinner(message: string): SpinnerObject {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;
  let currentMessage = message;

  return {
    start() {
      process.stdout.write('\n');
      interval = setInterval(() => {
        const frame = frames[frameIndex];
        process.stdout.write(`\r${frame} ${currentMessage}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 80);
    },

    stop(finalMessage: string | null = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r');
      if (finalMessage) {
        process.stdout.write(`${finalMessage}\n`);
      } else {
        process.stdout.write('\r\x1b[K'); // Clear line
      }
    },

    update(newMessage: string) {
      currentMessage = newMessage;
    }
  };
}

/**
 * Convert image (file path or URL) to Buffer for multipart/form-data upload.
 * Used by Stability AI API which expects binary uploads.
 *
 * @param imagePath - Local file path or URL
 * @returns Image data as Buffer
 *
 * @example
 * const buffer = await imageToBuffer('/path/to/image.png');
 * const buffer = await imageToBuffer('https://example.com/image.jpg');
 */
export async function imageToBuffer(imagePath: string): Promise<Buffer> {
  // Check if it's a URL
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    logger.debug(`Converting image URL to buffer: ${imagePath}`);
    return await urlToBuffer(imagePath);
  } else {
    logger.debug(`Converting local file to buffer: ${imagePath}`);
    return await fileToBuffer(imagePath);
  }
}

/**
 * Read local file to Buffer.
 *
 * @param filePath - Path to local file
 * @returns File data as Buffer
 */
export async function fileToBuffer(filePath: string): Promise<Buffer> {
  try {
    // Validate that the file exists and is a valid image
    await validateImagePath(filePath);

    // Read file as buffer
    const buffer = await fs.readFile(filePath);
    logger.debug(`Read ${buffer.length} bytes from ${filePath}`);
    return buffer;
  } catch (error) {
    const err = toError(error);
    logger.error(`Failed to read file ${filePath}: ${err.message}`);
    throw error;
  }
}

/**
 * Download image from URL to Buffer.
 *
 * @param url - Image URL
 * @returns Downloaded image data as Buffer
 */
export async function urlToBuffer(url: string): Promise<Buffer> {
  try {
    logger.debug(`Downloading image from URL: ${url}`);
    const buffer = await fetchImageBytes(url);
    logger.debug(`Downloaded ${buffer.length} bytes from ${url}`);
    return buffer;
  } catch (error) {
    const err = toError(error);
    logger.error(`Failed to download image from ${url}: ${err.message}`);
    throw new Error(`Failed to download image from URL: ${err.message}`, { cause: error });
  }
}

/**
 * Sniff an image MIME type from magic bytes, for the multipart part's
 * content-type. A native Blob without a type goes out as
 * application/octet-stream; the `form-data` package used to infer one from the
 * filename. Returns '' when unrecognised (the server then sniffs the bytes).
 */
export function detectImageMime(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return '';
}

/**
 * Build FormData object for multipart/form-data requests.
 * Helper for Stability AI API which uses multipart instead of JSON.
 *
 * @param params - Parameters to include in form data
 * @param imageParams - Image parameters { fieldName: imagePath/Buffer }
 * @returns Native FormData, ready to pass to `request({ form })`
 *
 * @example
 * const formData = await buildFormData(
 *   { prompt: 'a cat', seed: 42 },
 *   { image: '/path/to/image.png' }
 * );
 */
export async function buildFormData(
  params: Record<string, unknown>,
  imageParams: Record<string, string | Buffer | undefined> = {}
): Promise<FormData> {
  const formData = new FormData();

  // Add text parameters
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  }

  // Add image parameters
  for (const [fieldName, imageSource] of Object.entries(imageParams)) {
    if (imageSource) {
      let buffer: Buffer;
      let filename = 'image.png';

      // If it's already a buffer
      if (Buffer.isBuffer(imageSource)) {
        buffer = imageSource;
      } else {
        // Convert path/URL to buffer
        buffer = await imageToBuffer(imageSource);

        // Extract filename if it's a local path
        if (!imageSource.startsWith('http')) {
          filename = path.basename(imageSource);
        }
      }

      // Append as a typed Blob with filename. Copy into a fresh Uint8Array so the
      // Blob never aliases a pooled Buffer's backing ArrayBuffer.
      formData.append(fieldName, new Blob([new Uint8Array(buffer)], { type: detectImageMime(buffer) }), filename);
      logger.debug(`Added image to form data: ${fieldName} (${buffer.length} bytes)`);
    }
  }

  return formData;
}

/**
 * Set logger level.
 *
 * @param level - Log level (debug, info, warn, error)
 */
export function setLogLevel(level: string): void {
  const normalized = level.toLowerCase();
  // winston silently drops every line under an unknown level; refuse it instead.
  if (!(normalized in logger.levels)) {
    throw new RangeError(`Unknown log level "${level}" (use one of: ${Object.keys(logger.levels).join(', ')})`);
  }
  logger.level = normalized;
}

/**
 * The shared winston logger (timestamped, level-prefixed, console transport).
 * StabilityAPI, the CLI and these helpers all log through it; change its level
 * with `setLogLevel` or the StabilityAPI `logLevel` option.
 */
export { logger };
