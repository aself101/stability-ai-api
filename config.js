/**
 * Stability AI API Configuration
 *
 * Handles authentication and API configuration settings.
 *
 * API key can be provided via (in priority order):
 * 1. Command line flag: --api-key
 * 2. Environment variable: STABILITY_API_KEY
 * 3. Local .env file in current directory
 * 4. Global config: ~/.stability/.env (for global npm installs)
 *
 * To obtain an API key:
 * 1. Visit https://platform.stability.ai/
 * 2. Create an account or sign in
 * 3. Generate your API key from the dashboard
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load environment variables in priority order:
// 1. First try local .env in current directory
dotenv.config();

// 2. Then try global config in home directory (if local .env doesn't exist)
const globalConfigPath = join(homedir(), '.stability', '.env');
if (existsSync(globalConfigPath)) {
  dotenv.config({ path: globalConfigPath });
}

// Stability AI API Base URL
export const BASE_URL = 'https://api.stability.ai';

// Default polling configuration (for async operations like Creative Upscale)
export const DEFAULT_POLL_INTERVAL = 10; // seconds (Stability AI recommends 10s)
export const DEFAULT_TIMEOUT = 300; // seconds (5 minutes)
export const MAX_RETRIES = 3;

// Model endpoints
export const MODEL_ENDPOINTS = {
  // Generate endpoints (all synchronous)
  'stable-image-ultra': '/v2beta/stable-image/generate/ultra',
  'stable-image-core': '/v2beta/stable-image/generate/core',
  'sd3-large': '/v2beta/stable-image/generate/sd3',
  'sd3-medium': '/v2beta/stable-image/generate/sd3',
  'sd3-large-turbo': '/v2beta/stable-image/generate/sd3',

  // Upscale endpoints
  'upscale-fast': '/v2beta/stable-image/upscale/fast', // synchronous
  'upscale-conservative': '/v2beta/stable-image/upscale/conservative', // synchronous
  'upscale-creative': '/v2beta/stable-image/upscale/creative', // asynchronous!

  // Results endpoint for async operations
  'results': '/v2beta/results'
};

// Valid aspect ratios for generate endpoints
export const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '5:4', '1:1', '4:5', '2:3', '9:16', '9:21'];

// Valid output formats
export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

// Valid style presets (subset - more available in API)
export const STYLE_PRESETS = [
  'enhance', 'anime', 'photographic', 'digital-art', 'comic-book',
  'fantasy-art', 'line-art', 'analog-film', 'neon-punk', 'isometric',
  'low-poly', 'origami', 'modeling-compound', 'cinematic', '3d-model'
];

// Model parameter constraints
export const MODEL_CONSTRAINTS = {
  'stable-image-ultra': {
    promptMaxLength: 10000,
    aspectRatios: ASPECT_RATIOS,
    outputFormats: OUTPUT_FORMATS,
    seed: { min: 0, max: 4294967294 },
    strength: { min: 0, max: 1 }, // for image-to-image
    stylePresets: STYLE_PRESETS
  },
  'stable-image-core': {
    promptMaxLength: 10000,
    aspectRatios: ASPECT_RATIOS,
    outputFormats: OUTPUT_FORMATS,
    seed: { min: 0, max: 4294967294 },
    stylePresets: STYLE_PRESETS
  },
  'sd3': {
    promptMaxLength: 10000,
    aspectRatios: ASPECT_RATIOS,
    outputFormats: OUTPUT_FORMATS,
    seed: { min: 0, max: 4294967294 },
    models: ['sd3.5-large', 'sd3.5-medium', 'sd3.5-large-turbo'],
    stylePresets: STYLE_PRESETS
  },
  'upscale-fast': {
    outputFormats: OUTPUT_FORMATS
  },
  'upscale-conservative': {
    promptMaxLength: 10000,
    outputFormats: OUTPUT_FORMATS,
    seed: { min: 0, max: 4294967294 }
  },
  'upscale-creative': {
    promptMaxLength: 10000,
    outputFormats: OUTPUT_FORMATS,
    seed: { min: 0, max: 4294967294 },
    creativity: { min: 0.1, max: 0.5 },
    stylePresets: STYLE_PRESETS
  }
};

/**
 * Retrieve Stability AI API key from environment variables or CLI flag.
 *
 * @param {string} [cliApiKey] - Optional API key passed via CLI flag (highest priority)
 * @returns {string} The Stability AI API key
 * @throws {Error} If STABILITY_API_KEY is not found in any location
 *
 * @example
 * const apiKey = getStabilityApiKey();
 * const apiKey = getStabilityApiKey('sk-xxxxx'); // From CLI flag
 */
export function getStabilityApiKey(cliApiKey = null) {
  // Priority order:
  // 1. CLI flag (if provided)
  // 2. Environment variable
  const apiKey = cliApiKey || process.env.STABILITY_API_KEY;

  if (!apiKey) {
    const errorMessage = [
      'STABILITY_API_KEY not found. Please provide your API key via one of these methods:',
      '',
      '  1. CLI flag:           stability --api-key YOUR_KEY generate --ultra --prompt "..."',
      '  2. Environment var:    export STABILITY_API_KEY=YOUR_KEY',
      '  3. Local .env file:    Create .env in current directory with STABILITY_API_KEY=YOUR_KEY',
      '  4. Global config:      Create ~/.stability/.env with STABILITY_API_KEY=YOUR_KEY',
      '',
      'Get your API key at https://platform.stability.ai/'
    ].join('\n');

    throw new Error(errorMessage);
  }

  return apiKey;
}

/**
 * Validate that the API key appears to be in correct format.
 *
 * @param {string} apiKey - The API key string to validate
 * @returns {boolean} True if API key format appears valid, false otherwise
 */
export function validateApiKeyFormat(apiKey) {
  if (!apiKey) {
    return false;
  }

  // Basic validation - API key should be non-empty string
  if (apiKey.length < 10) {
    return false;
  }

  return true;
}

/**
 * Get the output directory for generated images.
 *
 * @returns {string} Output directory path
 */
export function getOutputDir() {
  return process.env.STABILITY_OUTPUT_DIR || 'datasets/stability';
}

/**
 * Get the polling interval from environment or default.
 *
 * @returns {number} Polling interval in seconds
 */
export function getPollInterval() {
  const interval = parseInt(process.env.STABILITY_POLL_INTERVAL);
  return isNaN(interval) ? DEFAULT_POLL_INTERVAL : interval;
}

/**
 * Get the timeout from environment or default.
 *
 * @returns {number} Timeout in seconds
 */
export function getTimeout() {
  const timeout = parseInt(process.env.STABILITY_TIMEOUT);
  return isNaN(timeout) ? DEFAULT_TIMEOUT : timeout;
}

/**
 * Validate model parameters against constraints.
 * Pre-flight validation to catch errors before making API calls and wasting credits.
 *
 * @param {string} model - Model name (stable-image-ultra, stable-image-core, sd3, upscale-fast, etc.)
 * @param {Object} params - Parameters to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 *
 * @example
 * const validation = validateModelParams('stable-image-ultra', { prompt: 'a cat', aspect_ratio: '1:1' });
 * if (!validation.valid) {
 *   console.error('Validation errors:', validation.errors);
 * }
 */
export function validateModelParams(model, params) {
  const errors = [];
  const constraints = MODEL_CONSTRAINTS[model];

  if (!constraints) {
    errors.push(`Unknown model: ${model}`);
    return { valid: false, errors };
  }

  // Validate prompt length
  if (params.prompt && constraints.promptMaxLength) {
    if (params.prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${model}`
      );
    }
  }

  // Validate negative_prompt length
  if (params.negative_prompt && constraints.promptMaxLength) {
    if (params.negative_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Negative prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${model}`
      );
    }
  }

  // Validate aspect_ratio
  if (params.aspect_ratio && constraints.aspectRatios) {
    if (!constraints.aspectRatios.includes(params.aspect_ratio)) {
      errors.push(
        `Invalid aspect_ratio "${params.aspect_ratio}" for ${model}. Valid ratios: ${constraints.aspectRatios.join(', ')}`
      );
    }
  }

  // Validate output_format
  if (params.output_format && constraints.outputFormats) {
    if (!constraints.outputFormats.includes(params.output_format)) {
      errors.push(
        `Invalid output_format "${params.output_format}" for ${model}. Valid formats: ${constraints.outputFormats.join(', ')}`
      );
    }
  }

  // Validate seed
  if (params.seed !== undefined && constraints.seed) {
    const { min, max } = constraints.seed;
    if (params.seed < min || params.seed > max) {
      errors.push(`Seed must be between ${min} and ${max} for ${model}`);
    }
  }

  // Validate strength (for image-to-image)
  if (params.strength !== undefined && constraints.strength) {
    const { min, max } = constraints.strength;
    if (params.strength < min || params.strength > max) {
      errors.push(`Strength must be between ${min} and ${max} for ${model}`);
    }
  }

  // Validate creativity (for creative upscale)
  if (params.creativity !== undefined && constraints.creativity) {
    const { min, max } = constraints.creativity;
    if (params.creativity < min || params.creativity > max) {
      errors.push(`Creativity must be between ${min} and ${max} for ${model}`);
    }
  }

  // Validate model (for SD3)
  if (params.model && constraints.models) {
    if (!constraints.models.includes(params.model)) {
      errors.push(
        `Invalid model "${params.model}" for ${model}. Valid models: ${constraints.models.join(', ')}`
      );
    }
  }

  // Validate style_preset
  if (params.style_preset && constraints.stylePresets) {
    if (!constraints.stylePresets.includes(params.style_preset)) {
      errors.push(
        `Invalid style_preset "${params.style_preset}" for ${model}. Valid presets: ${constraints.stylePresets.join(', ')}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get model constraints for a specific model.
 *
 * @param {string} model - Model name
 * @returns {Object|null} Model constraints or null if model not found
 */
export function getModelConstraints(model) {
  return MODEL_CONSTRAINTS[model] || null;
}
