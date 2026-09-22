#!/usr/bin/env node

/**
 * Stability AI CLI
 *
 * Command-line tool for generating and upscaling images using Stability AI API.
 * Supports Stable Diffusion 3.5, Stable Image Ultra/Core, and upscaling models.
 *
 * Usage:
 *   sai generate ultra --prompt "a cat"
 *   sai generate core --prompt "landscape" --style-preset photographic
 *   sai upscale fast --image ./photo.jpg
 *
 * Models:
 *   Generate:
 *     ultra        Stable Image Ultra - Photorealistic, 1MP output
 *     core         Stable Image Core - Fast, affordable, SDXL successor
 *     sd3          Stable Diffusion 3.5 - Large, Medium, or Turbo variants
 *
 *   Upscale:
 *     fast         Fast 4x upscaler (~1 second)
 *     conservative Conservative 20-40x upscaler (minimal alteration)
 *     creative     Creative 20-40x upscaler (reimagining, async)
 */

import { Command } from 'commander';
import { StabilityAPI } from './api.js';
import { getStabilityApiKey, loadEnvFiles, validateModelParams, validateEditParams, validateControlParams, STYLE_PRESETS, ASPECT_RATIOS } from './config.js';
import {
  createSpinner,
  setLogLevel,
  toError,
  logger
} from './utils.js';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isImageResult } from './api.js';
import {
  buildGenerateParams,
  buildUpscaleParams,
  buildEditParams,
  buildControlParams,
  requiredString,
  parseIntOption,
  parseFloatOption,
  saveImageResult,
  type GenerateOptions,
  type UpscaleOptions,
  type EditOptions,
  type ControlOptions,
} from './cli-helpers.js';
import type { ImageResult } from './types/index.js';

// Dynamically read version from package.json to prevent drift
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dev (src/), package.json is one level up; in dist/, it's also one level up
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

interface GlobalOptions {
  apiKey?: string;
  outputDir?: string;
  logLevel: string;
}

/**
 * Display usage examples.
 */
function showExamples(): void {
  console.log(`
${'='.repeat(60)}
STABILITY AI - USAGE EXAMPLES
${'='.repeat(60)}

GENERATE COMMANDS

1. Stable Image Ultra - Photorealistic generation
   $ sai generate ultra \\
       --prompt "a serene mountain landscape at sunset" \\
       --aspect-ratio "16:9" \\
       --output-format png

2. Stable Image Ultra - Image-to-image with strength
   $ sai generate ultra \\
       --prompt "transform into oil painting style" \\
       --image ./photo.jpg \\
       --strength 0.6 \\
       --aspect-ratio "1:1"

3. Stable Image Core - Fast generation with style preset
   $ sai generate core \\
       --prompt "cyberpunk city at night" \\
       --aspect-ratio "21:9" \\
       --style-preset cinematic

4. Stable Diffusion 3.5 - Large model
   $ sai generate sd3 \\
       --prompt "fantasy castle on a floating island" \\
       --model sd3.5-large \\
       --aspect-ratio "16:9" \\
       --seed 42

5. Stable Diffusion 3.5 - Turbo for speed
   $ sai generate sd3 \\
       --prompt "modern minimalist logo design" \\
       --model sd3.5-large-turbo \\
       --aspect-ratio "1:1"

   SD 3.5 Flash - cheapest and fastest (4 steps, cfg-scale 1)
   $ sai generate sd3 \\
       --prompt "watercolor fox in the snow" \\
       --model sd3.5-flash

   SD 3.5 - Image-to-image (no --aspect-ratio: output keeps the input's shape)
   $ sai generate sd3 \\
       --prompt "the same scene at golden hour" \\
       --image ./photo.jpg \\
       --strength 0.7 \\
       --cfg-scale 5 \\
       --style-preset photographic

6. Batch generation - Multiple prompts
   $ sai generate core \\
       --prompt "a red sports car" \\
       --prompt "a blue vintage car" \\
       --prompt "a green electric car" \\
       --aspect-ratio "16:9"

UPSCALE COMMANDS

7. Fast Upscale - Quick 4x upscaling
   $ sai upscale fast \\
       --image ./low_res.jpg \\
       --output-format png

8. Conservative Upscale - Minimal alteration, high quality
   $ sai upscale conservative \\
       --image ./photo.jpg \\
       --prompt "enhance details and sharpness" \\
       --output-format png

9. Creative Upscale - Reimagining with creativity control
   $ sai upscale creative \\
       --image ./sketch.jpg \\
       --prompt "photorealistic rendering" \\
       --creativity 0.35 \\
       --output-format png

10. Creative Upscale - Maximum creativity
    $ sai upscale creative \\
        --image ./lowres_art.jpg \\
        --prompt "vibrant colors, enhanced details" \\
        --creativity 0.5 \\
        --seed 12345

CONTROL COMMANDS

11. Control Sketch - Convert sketch to image
    $ sai control sketch \\
        --image ./sketch.png \\
        --prompt "medieval castle on a hill"

12. Control Structure - Preserve structure, change content
    $ sai control structure \\
        --image ./statue.jpg \\
        --prompt "garden shrub in english garden"

13. Control Style - Apply style to new content
    $ sai control style \\
        --image ./art-reference.png \\
        --prompt "portrait of a chicken" \\
        --fidelity 0.7

14. Control Style Transfer - Apply style between images
    $ sai control style-transfer \\
        --init-image ./photo.png \\
        --style-image ./painting.jpg

ADVANCED OPTIONS

15. Custom output directory
    $ sai generate ultra \\
        --prompt "logo design" \\
        --output-dir ./my-generations \\
        --aspect-ratio "1:1"

16. Debug logging
    $ sai generate core \\
        --prompt "test image" \\
        --log-level debug

17. Negative prompts
    $ sai generate sd3 \\
        --prompt "beautiful landscape" \\
        --negative-prompt "people, cars, buildings" \\
        --aspect-ratio "21:9"

UTILITY COMMANDS

18. Check account credits
    $ sai credits

AUTHENTICATION OPTIONS:

A. CLI flag (highest priority)
   $ sai generate ultra --api-key YOUR_KEY --prompt "test"

B. Environment variable
   $ export STABILITY_API_KEY=YOUR_KEY
   $ sai generate ultra --prompt "test"

C. Local .env file (current directory)
   $ echo "STABILITY_API_KEY=YOUR_KEY" > .env
   $ sai generate ultra --prompt "test"

D. Global config (for global installs)
   $ mkdir -p ~/.stability && echo "STABILITY_API_KEY=YOUR_KEY" > ~/.stability/.env
   $ sai generate ultra --prompt "test"

${'='.repeat(60)}
`);
}

// The CLI reads ./.env and ~/.stability/.env; the library does not (config.ts).
loadEnvFiles();

const program = new Command();

program
  .name('sai')
  .description('Stability AI image generation and upscaling CLI')
  .version(pkg.version)
  .option('--api-key <key>', 'Stability AI API key (overrides env var)')
  .option('--output-dir <dir>', 'Output directory for generated images')
  .option('--log-level <level>', 'Log level (debug, info, warn, error)', 'info')
  .option('--examples', 'Show usage examples and exit');

/**
 * Generate command with subcommands
 */
const generateCmd = program
  .command('generate')
  .description('Generate images using various models');

/**
 * Generate Ultra subcommand
 */
generateCmd
  .command('ultra')
  .description('Generate with Stable Image Ultra (photorealistic, 1MP)')
  .option('-p, --prompt <text...>', 'Text prompt(s) - can specify multiple', [])
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (e.g., 16:9, 1:1; server default 1:1)')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('-i, --image <path>', 'Input image for image-to-image (requires --strength)')
  .option('--strength <number>', 'Image-to-image strength (0-1; 0 keeps the input, 1 ignores it)', parseFloatOption)
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: GenerateOptions, command: Command) => {
    await handleGenerateCommand('stable-image-ultra', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Generate Core subcommand
 */
generateCmd
  .command('core')
  .description('Generate with Stable Image Core (fast, affordable)')
  .option('-p, --prompt <text...>', 'Text prompt(s) - can specify multiple', [])
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (server default 1:1)')
  .option('-s, --seed <number>', 'Random seed', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', 'Style preset (photographic, anime, etc.)')
  .action(async (options: GenerateOptions, command: Command) => {
    await handleGenerateCommand('stable-image-core', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Generate SD3 subcommand
 */
generateCmd
  .command('sd3')
  .description('Generate with Stable Diffusion 3.5')
  .option('-p, --prompt <text...>', 'Text prompt(s) - can specify multiple', [])
  .option('-m, --model <name>', 'SD3.5 model: sd3.5-large (server default), sd3.5-large-turbo, sd3.5-medium, sd3.5-flash')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  // No default: aspect ratio is text-to-image only on SD3.5, and the server
  // default is already 1:1.
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio, text-to-image only (server default 1:1)')
  .option('-s, --seed <number>', 'Random seed', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('-i, --image <path>', 'Input image: makes this image-to-image (requires --strength)')
  .option('--strength <number>', 'Image-to-image strength (0-1; 0 keeps the input, 1 ignores it)', parseFloatOption)
  .option('--cfg-scale <number>', 'Prompt adherence 1-10 (server default 4 Large/Medium, 1 Turbo/Flash)', parseFloatOption)
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: GenerateOptions, command: Command) => {
    await handleGenerateCommand('sd3', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Upscale command with subcommands
 */
const upscaleCmd = program
  .command('upscale')
  .description('Upscale images using various upscalers');

/**
 * Upscale Fast subcommand
 */
upscaleCmd
  .command('fast')
  .description('Fast 4x upscaler (~1 second)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .action(async (options: UpscaleOptions, command: Command) => {
    await handleUpscaleCommand('upscale-fast', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Upscale Conservative subcommand
 */
upscaleCmd
  .command('conservative')
  .description('Conservative upscaler (20-40x, minimal alteration)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .requiredOption('-p, --prompt <text>', 'Enhancement prompt (required by the API)')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-c, --creativity <number>', 'Creativity level (0.2-0.5, server default 0.35)', parseFloatOption)
  .option('-s, --seed <number>', 'Random seed', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (server default png)')
  .action(async (options: UpscaleOptions, command: Command) => {
    await handleUpscaleCommand('upscale-conservative', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Upscale Creative subcommand
 */
upscaleCmd
  .command('creative')
  .description('Creative upscaler (20-40x, creative reimagining, async)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .requiredOption('-p, --prompt <text>', 'Enhancement prompt (required by the API)')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-c, --creativity <number>', 'Creativity level (0.1-0.5, server default 0.3)', parseFloatOption)
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .option('-s, --seed <number>', 'Random seed', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (server default png)')
  .action(async (options: UpscaleOptions, command: Command) => {
    await handleUpscaleCommand('upscale-creative', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Credits command - Check account credits
 */
program
  .command('credits')
  .description('Check account credits')
  .action(async (_options: unknown, command: Command) => {
    await handleCreditsCommand(command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Result command - resume an async task whose polling stopped
 */
program
  .command('result <taskId>')
  .description('Resume polling an async task (creative upscale, replace-background) and save its image')
  .option('--timeout <seconds>', 'How long to keep polling (default 300)', parseFloatOption)
  .action(async (taskId: string, options: { timeout?: number }, command: Command) => {
    await handleResultCommand(taskId, options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit command with subcommands
 */
const editCmd = program
  .command('edit')
  .description('Edit images using various operations');

/**
 * Edit Erase subcommand
 */
editCmd
  .command('erase')
  .description('Remove unwanted objects from images using masks')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-m, --mask <path>', 'Mask image path (white=erase). If omitted, uses image alpha channel')
  .option('--grow-mask <number>', 'Pixels to grow mask edges (0-20; server default 5)', parseIntOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('erase', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Inpaint subcommand
 */
editCmd
  .command('inpaint')
  .description('Fill or replace masked areas with prompt-guided content')
  .requiredOption('-i, --image <path>', 'Input image path')
  .requiredOption('-p, --prompt <text>', 'What to generate in masked area')
  .option('-m, --mask <path>', 'Mask image path (white=inpaint). If omitted, uses image alpha channel')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('--grow-mask <number>', 'Pixels to grow mask edges (0-100; server default 5)', parseIntOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('inpaint', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Outpaint subcommand
 */
editCmd
  .command('outpaint')
  .description('Extend image boundaries in any direction')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('--left <pixels>', 'Pixels to extend left (0-2000; server default 0)', parseIntOption)
  .option('--right <pixels>', 'Pixels to extend right (0-2000; server default 0)', parseIntOption)
  .option('--up <pixels>', 'Pixels to extend up (0-2000; server default 0)', parseIntOption)
  .option('--down <pixels>', 'Pixels to extend down (0-2000; server default 0)', parseIntOption)
  .option('-c, --creativity <number>', 'How creative the outpainting should be (0-1; server decides)', parseFloatOption)
  .option('-p, --prompt <text>', 'What to generate in extended areas')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('outpaint', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Search and Replace subcommand
 */
editCmd
  .command('search-replace')
  .description('Automatically detect and replace objects (no manual masking)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .requiredOption('-p, --prompt <text>', 'What to replace with')
  .requiredOption('--search <text>', 'Short description of what to find')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('--grow-mask <number>', 'Pixels to grow auto-detected mask (0-20; server default 3)', parseIntOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('search-and-replace', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Search and Recolor subcommand
 */
editCmd
  .command('search-recolor')
  .description('Automatically detect and recolor objects (no manual masking)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .requiredOption('-p, --prompt <text>', 'Desired color/appearance')
  .requiredOption('--select <text>', 'Short description of what to find')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('--grow-mask <number>', 'Pixels to grow auto-detected mask (0-20; server default 3)', parseIntOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('search-and-recolor', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Remove Background subcommand
 */
editCmd
  .command('remove-bg')
  .description('Automatically segment and remove background (returns transparent image)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-f, --output-format <format>', 'Output format (png or webp only, NO jpeg; server default png)')
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('remove-background', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Replace Background and Relight subcommand (async)
 */
editCmd
  .command('replace-bg')
  .description('Replace background with AI-generated imagery and adjust lighting (async)')
  .requiredOption('-i, --image <path>', 'Input image with subject to keep')
  .option('--background-prompt <text>', 'Description of desired background')
  .option('--background-reference <path>', 'Reference image for background style')
  .option('--foreground-prompt <text>', 'Description of subject (prevents background bleeding)')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('--preserve-subject <number>', 'Subject overlay strength (0-1, 1.0=pixel perfect; server default 0.6)', parseFloatOption)
  .option('--background-depth <number>', 'Background depth matching (0-1; server default 0.5)', parseFloatOption)
  .option('--keep-original-bg', 'Keep original background with new lighting only')
  .option('--light-direction <dir>', 'Direction of light (left, right, above, below)')
  .option('--light-reference <path>', 'Reference image for lighting')
  .option('--light-strength <number>', 'Light intensity (0-1, requires light-reference or light-direction)', parseFloatOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .action(async (options: EditOptions, command: Command) => {
    await handleEditCommand('replace-background-and-relight', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Edit Examples subcommand
 */
editCmd
  .command('examples')
  .description('Show edit operation examples')
  .action(() => {
    showEditExamples();
  });

// ==================== Control Commands ====================

/**
 * Control command with subcommands
 */
const controlCmd = program
  .command('control')
  .description('Control image generation with structure, style, and sketch inputs');

/**
 * Control Sketch subcommand
 */
controlCmd
  .command('sketch')
  .description('Convert sketches to refined images with precise control')
  .requiredOption('-i, --image <path>', 'Input sketch image path')
  .requiredOption('-p, --prompt <text>', 'What to generate from the sketch')
  .option('--control-strength <number>', 'Influence of sketch on generation (0-1; server default 0.7)', parseFloatOption)
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: ControlOptions, command: Command) => {
    await handleControlCommand('sketch', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Control Structure subcommand
 */
controlCmd
  .command('structure')
  .description('Generate images while preserving input structure')
  .requiredOption('-i, --image <path>', 'Input image whose structure to preserve')
  .requiredOption('-p, --prompt <text>', 'What to generate with the structure')
  .option('--control-strength <number>', 'Influence of structure on generation (0-1; server default 0.7)', parseFloatOption)
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: ControlOptions, command: Command) => {
    await handleControlCommand('structure', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Control Style subcommand
 */
controlCmd
  .command('style')
  .description('Generate images guided by a style reference')
  .requiredOption('-i, --image <path>', 'Style reference image')
  .requiredOption('-p, --prompt <text>', 'What to generate with this style')
  .option('--fidelity <number>', 'How closely output resembles input style (0-1; server default 0.5)', parseFloatOption)
  .option('-a, --aspect-ratio <ratio>', `Output aspect ratio: ${ASPECT_RATIOS.join(', ')} (server default 1:1)`)
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options: ControlOptions, command: Command) => {
    await handleControlCommand('style', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Control Style Transfer subcommand
 */
controlCmd
  .command('style-transfer')
  .description('Apply style from one image to another')
  .requiredOption('--init-image <path>', 'Content image to restyle')
  .requiredOption('--style-image <path>', 'Style reference image')
  .option('-p, --prompt <text>', 'Optional prompt to guide transfer')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('--style-strength <number>', 'Influence of style image (0-1, 0=identical to input)', parseFloatOption)
  .option('--composition-fidelity <number>', 'How closely to preserve composition (0-1; server default 0.9)', parseFloatOption)
  .option('--change-strength <number>', 'How much the original should change (0.1-1; server default 0.9)', parseFloatOption)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseIntOption)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp; server default png)')
  .action(async (options: ControlOptions, command: Command) => {
    await handleControlCommand('style-transfer', options, command.optsWithGlobals() as GlobalOptions);
  });

/**
 * Control Examples subcommand
 */
controlCmd
  .command('examples')
  .description('Show control operation examples')
  .action(() => {
    showControlExamples();
  });

/**
 * Handle generate command execution
 */
async function handleGenerateCommand(model: string, options: GenerateOptions, globalOptions: GlobalOptions): Promise<void> {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey || null);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    // Ensure prompts array is not empty
    const prompts = options.prompt;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      logger.error('Error: At least one prompt is required. Use -p or --prompt');
      process.exit(1);
    }

    // Process each prompt
    const total = prompts.length;
    for (let index = 0; index < prompts.length; index++) {
      const prompt = prompts[index];
      const batchPrefix = total > 1 ? `[${index + 1}/${total}] ` : '';

      logger.info('='.repeat(60));
      logger.info(`${batchPrefix}Starting image generation`);
      logger.info(`Model: ${model}`);
      logger.info(`Prompt: "${prompt}"`);
      logger.info('='.repeat(60));

      const params = buildGenerateParams(model, prompt, options);
      if (params.image) {
        logger.info('Image-to-image: using input image ' + params.image);
      }

      // Validate parameters. The spread gives the typed params an anonymous
      // object type, which (unlike the SD3Params interface) is assignable to
      // the validator's index-signature parameter — no cast needed.
      const validation = validateModelParams(model, { ...params });
      if (!validation.valid) {
        logger.error('Parameter validation failed:');
        validation.errors.forEach(err => logger.error(`  - ${err}`));
        process.exit(1);
      }

      logger.info('Submitting generation request...');

      try {
        let result: ImageResult;
        const spinner = createSpinner('Generating image...');
        spinner.start();

        try {
          // Call appropriate API method
          if (model === 'stable-image-ultra') {
            result = await api.generateUltra(params);
          } else if (model === 'stable-image-core') {
            result = await api.generateCore(params);
          } else if (model === 'sd3') {
            result = await api.generateSD3(params);
          } else {
            throw new Error(`Unknown model: ${model}`);
          }

          spinner.stop('✓ Image generated successfully');
        } catch (error) {
          spinner.stop();
          throw error;
        }

        // Save image
        await saveImageResult(result, prompt, model, params, globalOptions.outputDir);

        logger.info('='.repeat(60));
        logger.info(`${batchPrefix}✓ Generation complete!`);
        logger.info('='.repeat(60));

      } catch (error) {
        const err = toError(error);
        logger.error('='.repeat(60));
        logger.error(`${batchPrefix}✗ Generation failed: ${err.message}`);
        logger.error('='.repeat(60));
        throw error;
      }
    }

  } catch (error) {
    const err = toError(error);
    logger.error(`\n✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle upscale command execution
 */
async function handleUpscaleCommand(model: string, options: UpscaleOptions, globalOptions: GlobalOptions): Promise<void> {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Validate input image exists
    if (!existsSync(options.image)) {
      logger.error(`Error: Image file not found: ${options.image}`);
      process.exit(1);
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey || null);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    logger.info('='.repeat(60));
    logger.info('Starting image upscale');
    logger.info(`Model: ${model}`);
    logger.info(`Input: ${options.image}`);
    logger.info('='.repeat(60));

    const params = buildUpscaleParams(model, options);

    // Validate parameters (spread: see handleGenerateCommand)
    const validation = validateModelParams(model, { ...params });
    if (!validation.valid) {
      logger.error('Parameter validation failed:');
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    logger.info('Submitting upscale request...');

    try {
      let result: ImageResult;

      // Creative upscale has its own spinner in waitForResult, others need CLI spinner
      const isCreative = model === 'upscale-creative';
      const spinner = !isCreative ? createSpinner('Upscaling image...') : null;

      if (spinner) {
        spinner.start();
      }

      try {
        // Call appropriate API method
        if (model === 'upscale-fast') {
          result = await api.upscaleFast(options.image, params.output_format);
        } else if (model === 'upscale-conservative') {
          result = await api.upscaleConservative(options.image, params);
        } else if (model === 'upscale-creative') {
          const upscaled = await api.upscaleCreative(options.image, { ...params, poll: { showSpinner: true } });
          if (!isImageResult(upscaled)) {
            throw new Error(`Creative upscale returned task ${upscaled.id} without an image`);
          }
          result = upscaled;
        } else {
          throw new Error(`Unknown model: ${model}`);
        }

        if (spinner) {
          spinner.stop('✓ Image upscaled successfully');
        } else {
          logger.info('✓ Image upscaled successfully');
        }
      } catch (error) {
        if (spinner) {
          spinner.stop();
        }
        throw error;
      }

      // Save image
      const promptText = options.prompt || path.basename(options.image, path.extname(options.image));
      await saveImageResult(result, promptText, model, params, globalOptions.outputDir);

      logger.info('='.repeat(60));
      logger.info('✓ Upscale complete!');
      logger.info('='.repeat(60));

    } catch (error) {
      const err = toError(error);
      logger.error('='.repeat(60));
      logger.error(`✗ Upscale failed: ${err.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    const err = toError(error);
    logger.error(`\n✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle credits command execution
 */
async function handleCreditsCommand(globalOptions: GlobalOptions): Promise<void> {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey || null);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    logger.info('Fetching account credits...');

    // Get balance
    const balance = await api.getBalance();

    logger.info('='.repeat(60));
    logger.info('Account Credits:');
    logger.info(`  Credits: ${balance.credits.toFixed(4)}`);
    logger.info('='.repeat(60));

  } catch (error) {
    const err = toError(error);
    logger.error(`Failed to fetch credits: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handle `sai result <taskId>`: poll a task the server may still hold (a paid
 * creative upscale or replace-background whose polling timed out or failed)
 * and save its image under <output-dir>/results/.
 */
async function handleResultCommand(taskId: string, options: { timeout?: number }, globalOptions: GlobalOptions): Promise<void> {
  try {
    setLogLevel(globalOptions.logLevel);
    const api = new StabilityAPI(getStabilityApiKey(globalOptions.apiKey || null), undefined, globalOptions.logLevel);
    const result = await api.waitForResult(taskId, { showSpinner: true, timeout: options.timeout });
    await saveImageResult(result, `task-${taskId}`, 'results', { task_id: taskId }, globalOptions.outputDir);
    logger.info(`✓ Task ${taskId} complete`);
  } catch (error) {
    logger.error(`✗ Could not retrieve task ${taskId}: ${toError(error).message}`);
    process.exit(1);
  }
}

/**
 * Handle edit command execution
 */
async function handleEditCommand(operation: string, options: EditOptions, globalOptions: GlobalOptions): Promise<void> {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Validate input image exists
    if (!existsSync(options.image)) {
      logger.error(`Error: Image file not found: ${options.image}`);
      process.exit(1);
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey || null);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    logger.info('='.repeat(60));
    logger.info(`Starting edit operation: ${operation}`);
    logger.info(`Input: ${options.image}`);
    logger.info('='.repeat(60));

    // Build parameters based on operation
    const params = buildEditParams(operation, options);

    // Validate parameters
    const validation = validateEditParams(operation, params);
    if (!validation.valid) {
      logger.error('Parameter validation failed:');
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    logger.info('Submitting edit request...');

    try {
      let result: ImageResult;

      // Replace-bg is async with its own spinner, others need CLI spinner
      const isAsync = operation === 'replace-background-and-relight';
      const spinner = !isAsync ? createSpinner(`${operation}...`) : null;

      if (spinner) {
        spinner.start();
      }

      try {
        // Call appropriate API method
        switch (operation) {
          case 'erase':
            result = await api.erase(options.image, params);
            break;
          case 'inpaint':
            result = await api.inpaint(options.image, requiredString(options.prompt, '--prompt'), params);
            break;
          case 'outpaint':
            result = await api.outpaint(options.image, params);
            break;
          case 'search-and-replace':
            result = await api.searchAndReplace(options.image, requiredString(options.prompt, '--prompt'), requiredString(options.search, '--search'), params);
            break;
          case 'search-and-recolor':
            result = await api.searchAndRecolor(options.image, requiredString(options.prompt, '--prompt'), requiredString(options.select, '--select'), params);
            break;
          case 'remove-background':
            result = await api.removeBackground(options.image, params);
            break;
          case 'replace-background-and-relight':
            const relit = await api.replaceBackgroundAndRelight(options.image, { ...params, poll: { showSpinner: true } });
            if (!isImageResult(relit)) {
              throw new Error(`Replace background returned task ${relit.id} without an image`);
            }
            result = relit;
            break;
          default:
            throw new Error(`Unknown edit operation: ${operation}`);
        }

        if (spinner) {
          spinner.stop(`✓ ${operation} completed successfully`);
        } else {
          logger.info(`✓ ${operation} completed successfully`);
        }
      } catch (error) {
        if (spinner) {
          spinner.stop();
        }
        throw error;
      }

      // Save image
      const promptText = options.prompt || path.basename(options.image, path.extname(options.image));
      const modelName = `edit-${operation.replace(/-and-/g, '-')}`;
      await saveImageResult(result, promptText, modelName, params, globalOptions.outputDir);

      logger.info('='.repeat(60));
      logger.info(`✓ Edit operation complete!`);
      logger.info('='.repeat(60));

    } catch (error) {
      const err = toError(error);
      logger.error('='.repeat(60));
      logger.error(`✗ Edit operation failed: ${err.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    const err = toError(error);
    logger.error(`\n✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Show edit operation examples
 */
function showEditExamples(): void {
  console.log(`
${'='.repeat(60)}
STABILITY AI - EDIT OPERATION EXAMPLES
${'='.repeat(60)}

ERASE - Remove unwanted objects
  $ sai edit erase \\
      --image ./photo.jpg \\
      --mask ./mask.png \\
      --grow-mask 5

  # Using alpha channel (no mask file needed)
  $ sai edit erase --image ./photo-with-alpha.png

INPAINT - Fill masked areas with prompt
  $ sai edit inpaint \\
      --image ./photo.jpg \\
      --mask ./mask.png \\
      --prompt "blue sky with clouds" \\
      --style-preset photographic

OUTPAINT - Extend image boundaries
  $ sai edit outpaint \\
      --image ./landscape.jpg \\
      --left 200 --right 200 \\
      --prompt "continuation of landscape" \\
      --creativity 0.5

  # Extend upward for more sky
  $ sai edit outpaint \\
      --image ./photo.jpg \\
      --up 500 \\
      --prompt "dramatic cloudy sky"

SEARCH & REPLACE - Auto-detect and replace (no masking)
  $ sai edit search-replace \\
      --image ./pet.jpg \\
      --search "cat" \\
      --prompt "golden retriever" \\
      --style-preset photographic

SEARCH & RECOLOR - Auto-detect and recolor
  $ sai edit search-recolor \\
      --image ./car.jpg \\
      --select "car" \\
      --prompt "bright red metallic paint"

REMOVE BACKGROUND - Transparent background
  $ sai edit remove-bg \\
      --image ./portrait.jpg \\
      --output-format png

  # WebP output (also supports transparency)
  $ sai edit remove-bg --image ./object.jpg -f webp

REPLACE BACKGROUND & RELIGHT (async)
  $ sai edit replace-bg \\
      --image ./portrait.jpg \\
      --background-prompt "sunset beach with palm trees" \\
      --light-direction right

  # Using reference images
  $ sai edit replace-bg \\
      --image ./portrait.jpg \\
      --background-reference ./beach-scene.jpg \\
      --light-reference ./sunset-light.jpg

  # Keep original background, just change lighting
  $ sai edit replace-bg \\
      --image ./portrait.jpg \\
      --keep-original-bg \\
      --light-direction above \\
      --light-strength 0.8

CREDITS:
  - Erase: 5 credits
  - Inpaint: 5 credits
  - Outpaint: 4 credits
  - Search & Replace: 5 credits
  - Search & Recolor: 5 credits
  - Remove Background: 5 credits
  - Replace BG & Relight: 8 credits

${'='.repeat(60)}
`);
}

/**
 * Handle control command execution
 */
async function handleControlCommand(operation: string, options: ControlOptions, globalOptions: GlobalOptions): Promise<void> {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // For style-transfer, validate both images exist
    if (operation === 'style-transfer') {
      if (!options.initImage || !existsSync(options.initImage)) {
        logger.error(`Error: Init image file not found: ${options.initImage}`);
        process.exit(1);
      }
      if (!options.styleImage || !existsSync(options.styleImage)) {
        logger.error(`Error: Style image file not found: ${options.styleImage}`);
        process.exit(1);
      }
    } else {
      // Validate input image exists for other operations
      if (!options.image || !existsSync(options.image)) {
        logger.error(`Error: Image file not found: ${options.image}`);
        process.exit(1);
      }
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey || null);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    logger.info('='.repeat(60));
    logger.info(`Starting control operation: ${operation}`);
    if (operation === 'style-transfer') {
      logger.info(`Init image: ${options.initImage}`);
      logger.info(`Style image: ${options.styleImage}`);
    } else {
      logger.info(`Input: ${options.image}`);
    }
    if (options.prompt) {
      logger.info(`Prompt: "${options.prompt}"`);
    }
    logger.info('='.repeat(60));

    // Build parameters based on operation
    const params = buildControlParams(operation, options);

    // Validate parameters
    const validation = validateControlParams(operation, params);
    if (!validation.valid) {
      logger.error('Parameter validation failed:');
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    logger.info('Submitting control request...');

    try {
      let result: ImageResult;
      const spinner = createSpinner(`${operation}...`);
      spinner.start();

      try {
        // Call appropriate API method
        switch (operation) {
          case 'sketch':
            result = await api.controlSketch(requiredString(options.image, '--image'), requiredString(options.prompt, '--prompt'), params);
            break;
          case 'structure':
            result = await api.controlStructure(requiredString(options.image, '--image'), requiredString(options.prompt, '--prompt'), params);
            break;
          case 'style':
            result = await api.controlStyle(requiredString(options.image, '--image'), requiredString(options.prompt, '--prompt'), params);
            break;
          case 'style-transfer':
            result = await api.controlStyleTransfer(requiredString(options.initImage, '--init-image'), requiredString(options.styleImage, '--style-image'), params);
            break;
          default:
            throw new Error(`Unknown control operation: ${operation}`);
        }

        spinner.stop(`✓ ${operation} completed successfully`);
      } catch (error) {
        spinner.stop();
        throw error;
      }

      // Save image
      const promptText = options.prompt || `control-${operation}`;
      const modelName = `control-${operation}`;
      await saveImageResult(result, promptText, modelName, params, globalOptions.outputDir);

      logger.info('='.repeat(60));
      logger.info(`✓ Control operation complete!`);
      logger.info('='.repeat(60));

    } catch (error) {
      const err = toError(error);
      logger.error('='.repeat(60));
      logger.error(`✗ Control operation failed: ${err.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    const err = toError(error);
    logger.error(`\n✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Show control operation examples
 */
function showControlExamples(): void {
  console.log(`
${'='.repeat(60)}
STABILITY AI - CONTROL OPERATION EXAMPLES
${'='.repeat(60)}

SKETCH - Convert sketches to refined images
  $ sai control sketch \\
      --image ./sketch.png \\
      --prompt "a medieval castle on a hill" \\
      --control-strength 0.7

  # With style preset
  $ sai control sketch \\
      --image ./sketch.png \\
      --prompt "fantasy castle" \\
      --style-preset fantasy-art

STRUCTURE - Preserve structure while transforming content
  $ sai control structure \\
      --image ./statue.png \\
      --prompt "a well manicured shrub in an english garden" \\
      --control-strength 0.6

  # Transform a photo to different style
  $ sai control structure \\
      --image ./portrait.jpg \\
      --prompt "oil painting portrait" \\
      --control-strength 0.8

STYLE - Generate new content with extracted style
  $ sai control style \\
      --image ./art-reference.png \\
      --prompt "a majestic portrait of a chicken" \\
      --fidelity 0.5

  # With aspect ratio
  $ sai control style \\
      --image ./cinematic-style.jpg \\
      --prompt "futuristic cityscape" \\
      --aspect-ratio 16:9 \\
      --fidelity 0.8

STYLE-TRANSFER - Apply style from one image to another
  $ sai control style-transfer \\
      --init-image ./photo.png \\
      --style-image ./art-style.png

  # With fine control
  $ sai control style-transfer \\
      --init-image ./portrait.png \\
      --style-image ./oil-painting.jpg \\
      --style-strength 0.8 \\
      --composition-fidelity 0.95 \\
      --change-strength 0.7

  # With prompt guidance
  $ sai control style-transfer \\
      --init-image ./photo.png \\
      --style-image ./watercolor.jpg \\
      --prompt "soft watercolor portrait"

CREDITS:
  - Sketch: 5 credits
  - Structure: 5 credits
  - Style: 5 credits
  - Style Transfer: 8 credits

${'='.repeat(60)}
`);
}

// Handle examples flag before parsing (to avoid help display)
if (process.argv.includes('--examples')) {
  showExamples();
  process.exit(0);
}

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
