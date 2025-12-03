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
import type {
  ModelEndpoints,
  EditEndpoints,
  ControlEndpoints,
  ModelConstraints,
  EditConstraints,
  ControlConstraints,
  ValidationResult,
} from './types/index.js';

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
export const MODEL_ENDPOINTS: ModelEndpoints = {
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

// Valid style presets (all 17 available in API)
export const STYLE_PRESETS = [
  'enhance', 'anime', 'photographic', 'digital-art', 'comic-book',
  'fantasy-art', 'line-art', 'analog-film', 'neon-punk', 'isometric',
  'low-poly', 'origami', 'modeling-compound', 'cinematic', '3d-model',
  'pixel-art', 'tile-texture'
];

// Edit endpoints (6 synchronous, 1 asynchronous)
export const EDIT_ENDPOINTS: EditEndpoints = {
  'erase': '/v2beta/stable-image/edit/erase',
  'inpaint': '/v2beta/stable-image/edit/inpaint',
  'outpaint': '/v2beta/stable-image/edit/outpaint',
  'search-and-replace': '/v2beta/stable-image/edit/search-and-replace',
  'search-and-recolor': '/v2beta/stable-image/edit/search-and-recolor',
  'remove-background': '/v2beta/stable-image/edit/remove-background',
  'replace-background-and-relight': '/v2beta/stable-image/edit/replace-background-and-relight' // async!
};

// Edit operation constraints
export const EDIT_CONSTRAINTS: EditConstraints = {
  'erase': {
    grow_mask: { min: 0, max: 20, default: 5 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    pixels: { min: 4096, max: 9437184 }
  },
  'inpaint': {
    promptMaxLength: 10000,
    grow_mask: { min: 0, max: 100, default: 5 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 }
  },
  'outpaint': {
    promptMaxLength: 10000,
    direction: { min: 0, max: 2000 }, // left, right, up, down
    creativity: { min: 0, max: 1, default: 0.5 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true // 1:2.5 to 2.5:1
  },
  'search-and-replace': {
    promptMaxLength: 10000,
    grow_mask: { min: 0, max: 20, default: 3 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true
  },
  'search-and-recolor': {
    promptMaxLength: 10000,
    grow_mask: { min: 0, max: 20, default: 3 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true
  },
  'remove-background': {
    outputFormats: ['png', 'webp'], // NO jpeg - transparency required
    pixels: { min: 4096, max: 4194304 } // stricter limit than other edit endpoints
  },
  'replace-background-and-relight': {
    promptMaxLength: 10000,
    preserve_original_subject: { min: 0, max: 1, default: 0.6 },
    original_background_depth: { min: 0, max: 1, default: 0.5 },
    light_source_strength: { min: 0, max: 1, default: 0.3 },
    light_source_directions: ['left', 'right', 'above', 'below'],
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true,
    async: true // returns task ID, requires polling
  }
};

// Control endpoints (all synchronous)
export const CONTROL_ENDPOINTS: ControlEndpoints = {
  'sketch': '/v2beta/stable-image/control/sketch',
  'structure': '/v2beta/stable-image/control/structure',
  'style': '/v2beta/stable-image/control/style',
  'style-transfer': '/v2beta/stable-image/control/style-transfer'
};

// Control operation constraints
export const CONTROL_CONSTRAINTS: ControlConstraints = {
  'sketch': {
    promptMaxLength: 10000,
    control_strength: { min: 0, max: 1, default: 0.7 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true // 1:2.5 to 2.5:1
  },
  'structure': {
    promptMaxLength: 10000,
    control_strength: { min: 0, max: 1, default: 0.7 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true // 1:2.5 to 2.5:1
  },
  'style': {
    promptMaxLength: 10000,
    fidelity: { min: 0, max: 1, default: 0.5 },
    aspectRatios: ASPECT_RATIOS,
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    stylePresets: STYLE_PRESETS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true // 1:2.5 to 2.5:1
  },
  'style-transfer': {
    promptMaxLength: 10000,
    style_strength: { min: 0, max: 1, default: 1 },
    composition_fidelity: { min: 0, max: 1, default: 0.9 },
    change_strength: { min: 0.1, max: 1, default: 0.9 },
    seed: { min: 0, max: 4294967294 },
    outputFormats: OUTPUT_FORMATS,
    pixels: { min: 4096, max: 9437184 },
    requiresAspectRatio: true // 1:2.5 to 2.5:1
  }
};

// Model parameter constraints
export const MODEL_CONSTRAINTS: ModelConstraints = {
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
 * @param cliApiKey - Optional API key passed via CLI flag (highest priority)
 * @returns The Stability AI API key
 * @throws Error if STABILITY_API_KEY is not found in any location
 *
 * @example
 * const apiKey = getStabilityApiKey();
 * const apiKey = getStabilityApiKey('sk-xxxxx'); // From CLI flag
 */
export function getStabilityApiKey(cliApiKey: string | null = null): string {
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
 * @param apiKey - The API key string to validate
 * @returns True if API key format appears valid, false otherwise
 */
export function validateApiKeyFormat(apiKey: string): boolean {
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
 * @returns Output directory path
 */
export function getOutputDir(): string {
  return process.env.STABILITY_OUTPUT_DIR || 'datasets/stability';
}

/**
 * Get the polling interval from environment or default.
 *
 * @returns Polling interval in seconds
 */
export function getPollInterval(): number {
  const interval = parseInt(process.env.STABILITY_POLL_INTERVAL || '');
  return isNaN(interval) ? DEFAULT_POLL_INTERVAL : interval;
}

/**
 * Get the timeout from environment or default.
 *
 * @returns Timeout in seconds
 */
export function getTimeout(): number {
  const timeout = parseInt(process.env.STABILITY_TIMEOUT || '');
  return isNaN(timeout) ? DEFAULT_TIMEOUT : timeout;
}

// ============================================================================
// Validation Helper Functions (Internal)
// These reduce duplication across validateModelParams, validateEditParams,
// and validateControlParams functions.
// ============================================================================

interface ValidationParams {
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  output_format?: string;
  seed?: number;
  strength?: number;
  creativity?: number;
  model?: string;
  style_preset?: string;
  grow_mask?: number;
  left?: number;
  right?: number;
  up?: number;
  down?: number;
  search_prompt?: string;
  select_prompt?: string;
  background_prompt?: string;
  foreground_prompt?: string;
  preserve_original_subject?: number;
  original_background_depth?: number;
  light_source_strength?: number;
  light_source_direction?: string;
  light_reference?: string;
  background_reference?: string;
  control_strength?: number;
  fidelity?: number;
  style_strength?: number;
  composition_fidelity?: number;
  change_strength?: number;
  [key: string]: unknown;
}

/**
 * Validate model parameters against constraints.
 * Pre-flight validation to catch errors before making API calls and wasting credits.
 *
 * @param model - Model name (stable-image-ultra, stable-image-core, sd3, upscale-fast, etc.)
 * @param params - Parameters to validate
 * @returns Validation result { valid: boolean, errors: string[] }
 *
 * @example
 * const validation = validateModelParams('stable-image-ultra', { prompt: 'a cat', aspect_ratio: '1:1' });
 * if (!validation.valid) {
 *   console.error('Validation errors:', validation.errors);
 * }
 */
export function validateModelParams(model: string, params: ValidationParams): ValidationResult {
  const errors: string[] = [];
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
 * @param model - Model name
 * @returns Model constraints or null if model not found
 */
export function getModelConstraints(model: string): ModelConstraints[string] | null {
  return MODEL_CONSTRAINTS[model] || null;
}

/**
 * Get edit constraints for a specific operation.
 *
 * @param operation - Edit operation name
 * @returns Edit constraints or null if operation not found
 */
export function getEditConstraints(operation: string): EditConstraints[string] | null {
  return EDIT_CONSTRAINTS[operation] || null;
}

/**
 * Validate edit operation parameters against constraints.
 * Pre-flight validation to catch errors before making API calls and wasting credits.
 *
 * @param operation - Edit operation (erase, inpaint, outpaint, etc.)
 * @param params - Parameters to validate
 * @returns Validation result { valid: boolean, errors: string[] }
 *
 * @example
 * const validation = validateEditParams('inpaint', { prompt: 'blue sky', grow_mask: 10 });
 * if (!validation.valid) {
 *   console.error('Validation errors:', validation.errors);
 * }
 */
export function validateEditParams(operation: string, params: ValidationParams): ValidationResult {
  const errors: string[] = [];
  const constraints = EDIT_CONSTRAINTS[operation];

  if (!constraints) {
    errors.push(`Unknown edit operation: ${operation}`);
    return { valid: false, errors };
  }

  // Validate prompt length
  if (params.prompt && constraints.promptMaxLength) {
    if (params.prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate negative_prompt length
  if (params.negative_prompt && constraints.promptMaxLength) {
    if (params.negative_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Negative prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate search_prompt length (for search-and-replace)
  if (params.search_prompt && constraints.promptMaxLength) {
    if (params.search_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Search prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate select_prompt length (for search-and-recolor)
  if (params.select_prompt && constraints.promptMaxLength) {
    if (params.select_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Select prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate background_prompt length (for replace-background-and-relight)
  if (params.background_prompt && constraints.promptMaxLength) {
    if (params.background_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Background prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate foreground_prompt length (for replace-background-and-relight)
  if (params.foreground_prompt && constraints.promptMaxLength) {
    if (params.foreground_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Foreground prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate output_format
  if (params.output_format && constraints.outputFormats) {
    if (!constraints.outputFormats.includes(params.output_format)) {
      errors.push(
        `Invalid output_format "${params.output_format}" for ${operation}. Valid formats: ${constraints.outputFormats.join(', ')}`
      );
    }
  }

  // Validate seed
  if (params.seed !== undefined && constraints.seed) {
    const { min, max } = constraints.seed;
    if (params.seed < min || params.seed > max) {
      errors.push(`Seed must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate grow_mask
  if (params.grow_mask !== undefined && constraints.grow_mask) {
    const { min, max } = constraints.grow_mask;
    if (params.grow_mask < min || params.grow_mask > max) {
      errors.push(`grow_mask must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate creativity (for outpaint)
  if (params.creativity !== undefined && constraints.creativity) {
    const { min, max } = constraints.creativity;
    if (params.creativity < min || params.creativity > max) {
      errors.push(`Creativity must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate direction values (for outpaint)
  if (constraints.direction) {
    const { min, max } = constraints.direction;
    const directions = ['left', 'right', 'up', 'down'] as const;
    for (const dir of directions) {
      const value = params[dir];
      if (value !== undefined && typeof value === 'number') {
        if (value < min || value > max) {
          errors.push(`${dir} must be between ${min} and ${max} for ${operation}`);
        }
      }
    }
  }

  // Validate at least one direction for outpaint
  if (operation === 'outpaint') {
    const hasDirection = (['left', 'right', 'up', 'down'] as const).some(
      dir => {
        const value = params[dir];
        return value !== undefined && typeof value === 'number' && value > 0;
      }
    );
    if (!hasDirection) {
      errors.push('At least one direction (left, right, up, down) must be greater than 0 for outpaint');
    }
  }

  // Validate style_preset
  if (params.style_preset && constraints.stylePresets) {
    if (!constraints.stylePresets.includes(params.style_preset)) {
      errors.push(
        `Invalid style_preset "${params.style_preset}" for ${operation}. Valid presets: ${constraints.stylePresets.join(', ')}`
      );
    }
  }

  // Validate preserve_original_subject (for replace-background-and-relight)
  if (params.preserve_original_subject !== undefined && constraints.preserve_original_subject) {
    const { min, max } = constraints.preserve_original_subject;
    if (params.preserve_original_subject < min || params.preserve_original_subject > max) {
      errors.push(`preserve_original_subject must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate original_background_depth (for replace-background-and-relight)
  if (params.original_background_depth !== undefined && constraints.original_background_depth) {
    const { min, max } = constraints.original_background_depth;
    if (params.original_background_depth < min || params.original_background_depth > max) {
      errors.push(`original_background_depth must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate light_source_strength (for replace-background-and-relight)
  if (params.light_source_strength !== undefined && constraints.light_source_strength) {
    const { min, max } = constraints.light_source_strength;
    if (params.light_source_strength < min || params.light_source_strength > max) {
      errors.push(`light_source_strength must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate light_source_direction (for replace-background-and-relight)
  if (params.light_source_direction && constraints.light_source_directions) {
    if (!constraints.light_source_directions.includes(params.light_source_direction)) {
      errors.push(
        `Invalid light_source_direction "${params.light_source_direction}" for ${operation}. Valid directions: ${constraints.light_source_directions.join(', ')}`
      );
    }
  }

  // Validate light_source_strength requires light_reference or light_source_direction
  if (params.light_source_strength !== undefined && operation === 'replace-background-and-relight') {
    if (!params.light_reference && !params.light_source_direction) {
      errors.push('light_source_strength requires either light_reference or light_source_direction');
    }
  }

  // Validate replace-background-and-relight requires background_prompt or background_reference
  if (operation === 'replace-background-and-relight') {
    if (!params.background_prompt && !params.background_reference) {
      errors.push('Either background_prompt or background_reference is required for replace-background-and-relight');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get control constraints for a specific operation.
 *
 * @param operation - Control operation name
 * @returns Control constraints or null if operation not found
 */
export function getControlConstraints(operation: string): ControlConstraints[string] | null {
  return CONTROL_CONSTRAINTS[operation] || null;
}

/**
 * Validate control operation parameters against constraints.
 * Pre-flight validation to catch errors before making API calls and wasting credits.
 *
 * @param operation - Control operation (sketch, structure, style, style-transfer)
 * @param params - Parameters to validate
 * @returns Validation result { valid: boolean, errors: string[] }
 *
 * @example
 * const validation = validateControlParams('sketch', { prompt: 'castle', control_strength: 0.7 });
 * if (!validation.valid) {
 *   console.error('Validation errors:', validation.errors);
 * }
 */
export function validateControlParams(operation: string, params: ValidationParams): ValidationResult {
  const errors: string[] = [];
  const constraints = CONTROL_CONSTRAINTS[operation];

  if (!constraints) {
    errors.push(`Unknown control operation: ${operation}`);
    return { valid: false, errors };
  }

  // Validate prompt length
  if (params.prompt && constraints.promptMaxLength) {
    if (params.prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate negative_prompt length
  if (params.negative_prompt && constraints.promptMaxLength) {
    if (params.negative_prompt.length > constraints.promptMaxLength) {
      errors.push(
        `Negative prompt exceeds maximum length of ${constraints.promptMaxLength} characters for ${operation}`
      );
    }
  }

  // Validate output_format
  if (params.output_format && constraints.outputFormats) {
    if (!constraints.outputFormats.includes(params.output_format)) {
      errors.push(
        `Invalid output_format "${params.output_format}" for ${operation}. Valid formats: ${constraints.outputFormats.join(', ')}`
      );
    }
  }

  // Validate seed
  if (params.seed !== undefined && constraints.seed) {
    const { min, max } = constraints.seed;
    if (params.seed < min || params.seed > max) {
      errors.push(`Seed must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate control_strength (for sketch and structure)
  if (params.control_strength !== undefined && constraints.control_strength) {
    const { min, max } = constraints.control_strength;
    if (params.control_strength < min || params.control_strength > max) {
      errors.push(`control_strength must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate fidelity (for style)
  if (params.fidelity !== undefined && constraints.fidelity) {
    const { min, max } = constraints.fidelity;
    if (params.fidelity < min || params.fidelity > max) {
      errors.push(`fidelity must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate aspect_ratio (for style)
  if (params.aspect_ratio && constraints.aspectRatios) {
    if (!constraints.aspectRatios.includes(params.aspect_ratio)) {
      errors.push(
        `Invalid aspect_ratio "${params.aspect_ratio}" for ${operation}. Valid ratios: ${constraints.aspectRatios.join(', ')}`
      );
    }
  }

  // Validate style_strength (for style-transfer)
  if (params.style_strength !== undefined && constraints.style_strength) {
    const { min, max } = constraints.style_strength;
    if (params.style_strength < min || params.style_strength > max) {
      errors.push(`style_strength must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate composition_fidelity (for style-transfer)
  if (params.composition_fidelity !== undefined && constraints.composition_fidelity) {
    const { min, max } = constraints.composition_fidelity;
    if (params.composition_fidelity < min || params.composition_fidelity > max) {
      errors.push(`composition_fidelity must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate change_strength (for style-transfer)
  if (params.change_strength !== undefined && constraints.change_strength) {
    const { min, max } = constraints.change_strength;
    if (params.change_strength < min || params.change_strength > max) {
      errors.push(`change_strength must be between ${min} and ${max} for ${operation}`);
    }
  }

  // Validate style_preset
  if (params.style_preset && constraints.stylePresets) {
    if (!constraints.stylePresets.includes(params.style_preset)) {
      errors.push(
        `Invalid style_preset "${params.style_preset}" for ${operation}. Valid presets: ${constraints.stylePresets.join(', ')}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
