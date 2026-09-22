/**
 * CLI helpers: option types, CLI-options → SDK-parameter mapping, and result
 * saving.
 *
 * Split out of cli.ts in 1.0 so they can be unit-tested — cli.ts parses
 * process.argv when imported. The generate and upscale builders return the
 * SDK's own parameter types, so the CLI calls StabilityAPI without the
 * `params as unknown as Parameters<...>` double assertions 0.4.0 used.
 */

import path from 'path';
import { InvalidArgumentError } from 'commander';
import { getOutputDir } from './config.js';
import { writeToFile, ensureDirectory, promptToFilename, generateTimestampedFilename, detectImageMime, logger } from './utils.js';
import type { ImageResult, SD3Params, UpscaleParams } from './types/index.js';

export interface GenerateOptions {
  prompt: string[];
  negativePrompt?: string;
  aspectRatio?: string;
  cfgScale?: number;
  seed?: number;
  outputFormat?: string;
  image?: string;
  strength?: number;
  stylePreset?: string;
  model?: string;
}

export interface UpscaleOptions {
  image: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  outputFormat?: string;
  creativity?: number;
  stylePreset?: string;
}

export interface EditOptions {
  image: string;
  mask?: string;
  prompt?: string;
  negativePrompt?: string;
  growMask?: number;
  seed?: number;
  outputFormat?: string;
  stylePreset?: string;
  search?: string;
  select?: string;
  left?: number;
  right?: number;
  up?: number;
  down?: number;
  creativity?: number;
  backgroundPrompt?: string;
  backgroundReference?: string;
  foregroundPrompt?: string;
  preserveSubject?: number;
  backgroundDepth?: number;
  keepOriginalBg?: boolean;
  lightDirection?: string;
  lightReference?: string;
  lightStrength?: number;
}

export interface ControlOptions {
  image?: string;
  initImage?: string;
  styleImage?: string;
  prompt?: string;
  negativePrompt?: string;
  controlStrength?: number;
  fidelity?: number;
  aspectRatio?: string;
  styleStrength?: number;
  compositionFidelity?: number;
  changeStrength?: number;
  seed?: number;
  outputFormat?: string;
  stylePreset?: string;
}

/**
 * Commander option parser for integers. Commander calls a parser as
 * `parser(value, previousOrDefault)`, so passing bare `parseInt` (as 0.4.0 did)
 * made the option's default the radix: `--grow-mask 10` with default 5 parsed
 * as 5, `--grow-mask 7` as NaN — sent on paid requests. This takes one
 * argument, parses base 10 and rejects anything that is not a whole number.
 */
export function parseIntOption(value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isInteger(n)) {
    throw new InvalidArgumentError(`"${value}" is not an integer.`);
  }
  return n;
}

/** Levels the CLI documents for --log-level; winston's http/verbose/silly are not offered. */
export const CLI_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/**
 * Commander parser for --log-level: case-insensitive, and one of the four
 * documented levels. An unknown or uppercase level used to reach winston as
 * given and silence every line, errors included. The set is the documented
 * one rather than all of winston's, so help, README and this error agree.
 */
export function parseLogLevel(value: string): string {
  const level = value.toLowerCase();
  if (!(CLI_LOG_LEVELS as readonly string[]).includes(level)) {
    throw new InvalidArgumentError(`use one of: ${CLI_LOG_LEVELS.join(', ')}.`);
  }
  return level;
}

/** Commander option parser for numbers: rejects NaN, Infinity and trailing junk ("0.5x"). */
export function parseFloatOption(value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) {
    throw new InvalidArgumentError(`"${value}" is not a number.`);
  }
  return n;
}

/**
 * Return a CLI value commander guarantees (a `requiredOption`), or throw.
 * Replaces the non-null assertions (`options.image!`) 0.4.0 used: the option
 * types are optional because one interface serves several subcommands.
 */
export function requiredString(value: string | undefined, flag: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${flag} is required`);
  }
  return value;
}

/**
 * Map `sai generate <model>` options to SDK parameters. SD3Params is the
 * superset of the three generate parameter types, and each endpoint's
 * ENDPOINT_FIELDS entry drops what it does not accept, so one builder serves
 * ultra, core and sd3.
 *
 * `image` and `strength` are set together or not at all for the models that
 * take an input image; validation rejects either one alone. (0.4.0 dropped
 * --strength silently when --image was missing.)
 */
export function buildGenerateParams(model: string, prompt: string, options: GenerateOptions): SD3Params {
  const params: SD3Params = {
    prompt,
    negative_prompt: options.negativePrompt,
    aspect_ratio: options.aspectRatio,
    seed: options.seed,
    output_format: options.outputFormat,
    style_preset: options.stylePreset,
  };
  if (model === 'stable-image-ultra' || model === 'sd3') {
    params.image = options.image;
    params.strength = options.strength;
  }
  if (model === 'sd3') {
    params.model = options.model;
    params.cfg_scale = options.cfgScale;
  }
  return params;
}

/**
 * Map `sai upscale <model>` options to SDK parameters. Conservative and
 * creative require a prompt (commander enforces --prompt); fast ignores it.
 */
export function buildUpscaleParams(model: string, options: UpscaleOptions): UpscaleParams {
  const params: UpscaleParams = {
    prompt: options.prompt ?? '',
    negative_prompt: options.negativePrompt,
    seed: options.seed,
    output_format: options.outputFormat,
  };
  if (model === 'upscale-conservative' || model === 'upscale-creative') {
    params.creativity = options.creativity;
  }
  if (model === 'upscale-creative') {
    params.style_preset = options.stylePreset;
  }
  return params;
}

/**
 * Map `sai edit <operation>` options to SDK parameters (API field names).
 */
export function buildEditParams(operation: string, options: EditOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    output_format: options.outputFormat
  };

  // Common options
  if (options.seed !== undefined) params.seed = options.seed;
  if (options.negativePrompt) params.negative_prompt = options.negativePrompt;
  if (options.stylePreset) params.style_preset = options.stylePreset;

  // Operation-specific options
  switch (operation) {
    case 'erase':
      if (options.mask) params.mask = options.mask;
      if (options.growMask !== undefined) params.grow_mask = options.growMask;
      break;

    case 'inpaint':
      params.prompt = options.prompt;
      if (options.mask) params.mask = options.mask;
      if (options.growMask !== undefined) params.grow_mask = options.growMask;
      break;

    case 'outpaint':
      if (options.left !== undefined && options.left > 0) params.left = options.left;
      if (options.right !== undefined && options.right > 0) params.right = options.right;
      if (options.up !== undefined && options.up > 0) params.up = options.up;
      if (options.down !== undefined && options.down > 0) params.down = options.down;
      if (options.creativity !== undefined) params.creativity = options.creativity;
      if (options.prompt) params.prompt = options.prompt;
      break;

    case 'search-and-replace':
      params.prompt = options.prompt;
      params.search_prompt = options.search;
      if (options.growMask !== undefined) params.grow_mask = options.growMask;
      break;

    case 'search-and-recolor':
      params.prompt = options.prompt;
      params.select_prompt = options.select;
      if (options.growMask !== undefined) params.grow_mask = options.growMask;
      break;

    case 'remove-background':
      // jpeg is rejected by StabilityAPI.removeBackground (and validateEditParams),
      // before any request. 0.4.0 also re-checked it here, a second copy of the
      // rule that could drift from the first.
      break;

    case 'replace-background-and-relight':
      if (options.backgroundPrompt) params.background_prompt = options.backgroundPrompt;
      if (options.backgroundReference) params.background_reference = options.backgroundReference;
      if (options.foregroundPrompt) params.foreground_prompt = options.foregroundPrompt;
      if (options.preserveSubject !== undefined) params.preserve_original_subject = options.preserveSubject;
      if (options.backgroundDepth !== undefined) params.original_background_depth = options.backgroundDepth;
      if (options.keepOriginalBg) params.keep_original_background = true;
      if (options.lightDirection) params.light_source_direction = options.lightDirection;
      if (options.lightReference) params.light_reference = options.lightReference;
      if (options.lightStrength !== undefined) params.light_source_strength = options.lightStrength;
      break;
  }

  return params;
}

/**
 * Map `sai control <operation>` options to SDK parameters (API field names).
 */
export function buildControlParams(operation: string, options: ControlOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {
    output_format: options.outputFormat
  };

  // Common options
  if (options.seed !== undefined) params.seed = options.seed;
  if (options.negativePrompt) params.negative_prompt = options.negativePrompt;
  if (options.stylePreset) params.style_preset = options.stylePreset;

  // Operation-specific options
  switch (operation) {
    case 'sketch':
    case 'structure':
      params.prompt = options.prompt;
      if (options.controlStrength !== undefined) params.control_strength = options.controlStrength;
      break;

    case 'style':
      params.prompt = options.prompt;
      if (options.fidelity !== undefined) params.fidelity = options.fidelity;
      if (options.aspectRatio) params.aspect_ratio = options.aspectRatio;
      break;

    case 'style-transfer':
      if (options.prompt) params.prompt = options.prompt;
      if (options.styleStrength !== undefined) params.style_strength = options.styleStrength;
      if (options.compositionFidelity !== undefined) params.composition_fidelity = options.compositionFidelity;
      if (options.changeStrength !== undefined) params.change_strength = options.changeStrength;
      break;
  }

  return params;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The `output_format` a parameter object asked for, if it names one. */
function outputFormatOf(params: object): string | undefined {
  return 'output_format' in params && typeof params.output_format === 'string' ? params.output_format : undefined;
}

/**
 * Save an image result and a metadata JSON beside it, under
 * `<outputDir or default>/<model>/`. The file extension follows the requested
 * output_format (png when none was set, which is also the server default).
 *
 * A result whose `finish_reason` is CONTENT_FILTERED is still saved (it was
 * billed), but warned about and flagged with `process.exitCode = 3`, so a
 * batch script can tell "done" from "done, but blurred". Until 1.0 the CLI
 * printed ✓ and exited 0; only the metadata JSON recorded it.
 *
 * @returns the paths written, and whether the output was content-filtered
 */
export async function saveImageResult(
  result: ImageResult,
  prompt: string,
  model: string,
  params: object,
  outputDir?: string
): Promise<{ imagePath: string; metadataPath: string; contentFiltered: boolean }> {
  const modelDir = path.join(outputDir || getOutputDir(), model);
  await ensureDirectory(modelDir);

  // The requested format, else what the bytes are (a resumed task has no
  // params; `sai result` used to save WEBP/JPEG bytes as .png), else png.
  const extension = outputFormatOf(params) || EXTENSION_BY_MIME[detectImageMime(result.image)] || 'png';
  const filename = generateTimestampedFilename(promptToFilename(prompt), extension);
  const imagePath = path.join(modelDir, filename);

  await writeToFile(result.image, imagePath);
  logger.info(`✓ Image saved: ${imagePath}`);

  const metadataPath = path.join(modelDir, filename.replace(`.${extension}`, '_metadata.json'));
  const metadata = {
    model,
    timestamp: new Date().toISOString(),
    parameters: params,
    result: {
      finish_reason: result.finish_reason,
      seed: result.seed,
      image_path: imagePath
    }
  };
  await writeToFile(metadata, metadataPath);
  logger.info(`✓ Metadata saved: ${metadataPath}`);

  const contentFiltered = result.finish_reason === 'CONTENT_FILTERED';
  if (contentFiltered) {
    logger.warn(`⚠ Output was blurred by Stability's content filter (finish-reason CONTENT_FILTERED; the request was still billed): ${imagePath}`);
    process.exitCode = 3;
  }

  return { imagePath, metadataPath, contentFiltered };
}
