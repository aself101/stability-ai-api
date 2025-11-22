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
import { getStabilityApiKey, validateModelParams, validateEditParams, validateControlParams, getOutputDir, STYLE_PRESETS, ASPECT_RATIOS } from './config.js';
import {
  writeToFile,
  ensureDirectory,
  promptToFilename,
  generateTimestampedFilename,
  createSpinner,
  setLogLevel,
  logger
} from './utils.js';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Dynamically read version from package.json to prevent drift
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

/**
 * Display usage examples.
 */
function showExamples() {
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
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (e.g., 16:9, 1:1)', '1:1')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('-i, --image <path>', 'Input image for image-to-image')
  .option('--strength <number>', 'Strength for image-to-image (0-1)', parseFloat)
  .action(async (options, command) => {
    await handleGenerateCommand('stable-image-ultra', options, command.optsWithGlobals());
  });

/**
 * Generate Core subcommand
 */
generateCmd
  .command('core')
  .description('Generate with Stable Image Core (fast, affordable)')
  .option('-p, --prompt <text...>', 'Text prompt(s) - can specify multiple', [])
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio', '1:1')
  .option('-s, --seed <number>', 'Random seed', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', 'Style preset (photographic, anime, etc.)')
  .action(async (options, command) => {
    await handleGenerateCommand('stable-image-core', options, command.optsWithGlobals());
  });

/**
 * Generate SD3 subcommand
 */
generateCmd
  .command('sd3')
  .description('Generate with Stable Diffusion 3.5')
  .option('-p, --prompt <text...>', 'Text prompt(s) - can specify multiple', [])
  .option('-m, --model <name>', 'SD3 model (sd3.5-large, sd3.5-medium, sd3.5-large-turbo)', 'sd3.5-large')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio', '1:1')
  .option('-s, --seed <number>', 'Random seed', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .action(async (options, command) => {
    await handleGenerateCommand('sd3', options, command.optsWithGlobals());
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
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .action(async (options, command) => {
    await handleUpscaleCommand('upscale-fast', options, command.optsWithGlobals());
  });

/**
 * Upscale Conservative subcommand
 */
upscaleCmd
  .command('conservative')
  .description('Conservative upscaler (20-40x, minimal alteration)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-p, --prompt <text>', 'Enhancement prompt')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-s, --seed <number>', 'Random seed', parseInt)
  .option('-f, --output-format <format>', 'Output format', 'png')
  .action(async (options, command) => {
    await handleUpscaleCommand('upscale-conservative', options, command.optsWithGlobals());
  });

/**
 * Upscale Creative subcommand
 */
upscaleCmd
  .command('creative')
  .description('Creative upscaler (20-40x, creative reimagining, async)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-p, --prompt <text>', 'Enhancement prompt')
  .option('-n, --negative-prompt <text>', 'Negative prompt')
  .option('-c, --creativity <number>', 'Creativity level (0.1-0.5)', parseFloat, 0.3)
  .option('-s, --seed <number>', 'Random seed', parseInt)
  .option('-f, --output-format <format>', 'Output format', 'png')
  .action(async (options, command) => {
    await handleUpscaleCommand('upscale-creative', options, command.optsWithGlobals());
  });

/**
 * Credits command - Check account credits
 */
program
  .command('credits')
  .description('Check account credits')
  .action(async (options, command) => {
    await handleCreditsCommand(command.optsWithGlobals());
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
  .option('--grow-mask <number>', 'Pixels to grow mask edges (0-20)', parseInt, 5)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .action(async (options, command) => {
    await handleEditCommand('erase', options, command.optsWithGlobals());
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
  .option('--grow-mask <number>', 'Pixels to grow mask edges (0-100)', parseInt, 5)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleEditCommand('inpaint', options, command.optsWithGlobals());
  });

/**
 * Edit Outpaint subcommand
 */
editCmd
  .command('outpaint')
  .description('Extend image boundaries in any direction')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('--left <pixels>', 'Pixels to extend left (0-2000)', parseInt, 0)
  .option('--right <pixels>', 'Pixels to extend right (0-2000)', parseInt, 0)
  .option('--up <pixels>', 'Pixels to extend up (0-2000)', parseInt, 0)
  .option('--down <pixels>', 'Pixels to extend down (0-2000)', parseInt, 0)
  .option('-c, --creativity <number>', 'How creative the outpainting should be (0-1)', parseFloat, 0.5)
  .option('-p, --prompt <text>', 'What to generate in extended areas')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleEditCommand('outpaint', options, command.optsWithGlobals());
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
  .option('--grow-mask <number>', 'Pixels to grow auto-detected mask (0-20)', parseInt, 3)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleEditCommand('search-and-replace', options, command.optsWithGlobals());
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
  .option('--grow-mask <number>', 'Pixels to grow auto-detected mask (0-20)', parseInt, 3)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleEditCommand('search-and-recolor', options, command.optsWithGlobals());
  });

/**
 * Edit Remove Background subcommand
 */
editCmd
  .command('remove-bg')
  .description('Automatically segment and remove background (returns transparent image)')
  .requiredOption('-i, --image <path>', 'Input image path')
  .option('-f, --output-format <format>', 'Output format (png or webp only, NO jpeg)', 'png')
  .action(async (options, command) => {
    await handleEditCommand('remove-background', options, command.optsWithGlobals());
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
  .option('--preserve-subject <number>', 'Subject overlay strength (0-1, 1.0=pixel perfect)', parseFloat, 0.6)
  .option('--background-depth <number>', 'Background depth matching (0-1)', parseFloat, 0.5)
  .option('--keep-original-bg', 'Keep original background with new lighting only')
  .option('--light-direction <dir>', 'Direction of light (left, right, above, below)')
  .option('--light-reference <path>', 'Reference image for lighting')
  .option('--light-strength <number>', 'Light intensity (0-1, requires light-reference or light-direction)', parseFloat)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .action(async (options, command) => {
    await handleEditCommand('replace-background-and-relight', options, command.optsWithGlobals());
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
  .option('--control-strength <number>', 'Influence of sketch on generation (0-1)', parseFloat, 0.7)
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleControlCommand('sketch', options, command.optsWithGlobals());
  });

/**
 * Control Structure subcommand
 */
controlCmd
  .command('structure')
  .description('Generate images while preserving input structure')
  .requiredOption('-i, --image <path>', 'Input image whose structure to preserve')
  .requiredOption('-p, --prompt <text>', 'What to generate with the structure')
  .option('--control-strength <number>', 'Influence of structure on generation (0-1)', parseFloat, 0.7)
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleControlCommand('structure', options, command.optsWithGlobals());
  });

/**
 * Control Style subcommand
 */
controlCmd
  .command('style')
  .description('Generate images guided by a style reference')
  .requiredOption('-i, --image <path>', 'Style reference image')
  .requiredOption('-p, --prompt <text>', 'What to generate with this style')
  .option('--fidelity <number>', 'How closely output resembles input style (0-1)', parseFloat, 0.5)
  .option('-a, --aspect-ratio <ratio>', `Output aspect ratio: ${ASPECT_RATIOS.join(', ')}`, '1:1')
  .option('-n, --negative-prompt <text>', 'What NOT to generate')
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .option('--style-preset <style>', `Style preset: ${STYLE_PRESETS.join(', ')}`)
  .action(async (options, command) => {
    await handleControlCommand('style', options, command.optsWithGlobals());
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
  .option('--style-strength <number>', 'Influence of style image (0-1, 0=identical to input)', parseFloat)
  .option('--composition-fidelity <number>', 'How closely to preserve composition (0-1)', parseFloat, 0.9)
  .option('--change-strength <number>', 'How much the original should change (0.1-1)', parseFloat, 0.9)
  .option('-s, --seed <number>', 'Random seed (0-4294967294)', parseInt)
  .option('-f, --output-format <format>', 'Output format (jpeg, png, webp)', 'png')
  .action(async (options, command) => {
    await handleControlCommand('style-transfer', options, command.optsWithGlobals());
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
async function handleGenerateCommand(model, options, globalOptions) {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    // Ensure prompts array is not empty
    let prompts = options.prompt;
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

      // Build parameters
      const params = {
        prompt,
        negative_prompt: options.negativePrompt,
        aspect_ratio: options.aspectRatio,
        seed: options.seed,
        output_format: options.outputFormat
      };

      // Add model-specific parameters
      if (model === 'stable-image-ultra' && options.image) {
        logger.info('Converting input image for image-to-image...');
        params.image = options.image;
        params.strength = options.strength;
      }
      if (model === 'stable-image-core' && options.stylePreset) {
        params.style_preset = options.stylePreset;
      }
      if (model === 'sd3') {
        params.model = options.model;
      }

      // Validate parameters
      const validation = validateModelParams(model, params);
      if (!validation.valid) {
        logger.error('Parameter validation failed:');
        validation.errors.forEach(err => logger.error(`  - ${err}`));
        process.exit(1);
      }

      logger.info('Submitting generation request...');

      try {
        let result;
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
        logger.error('='.repeat(60));
        logger.error(`${batchPrefix}✗ Generation failed: ${error.message}`);
        logger.error('='.repeat(60));
        throw error;
      }
    }

  } catch (error) {
    logger.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle upscale command execution
 */
async function handleUpscaleCommand(model, options, globalOptions) {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Validate input image exists
    if (!existsSync(options.image)) {
      logger.error(`Error: Image file not found: ${options.image}`);
      process.exit(1);
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey);

    // Initialize API client
    const api = new StabilityAPI(apiKey, undefined, globalOptions.logLevel);

    logger.info('='.repeat(60));
    logger.info('Starting image upscale');
    logger.info(`Model: ${model}`);
    logger.info(`Input: ${options.image}`);
    logger.info('='.repeat(60));

    // Build parameters
    const params = {
      prompt: options.prompt,
      negative_prompt: options.negativePrompt,
      seed: options.seed,
      output_format: options.outputFormat || 'png'
    };

    if (model === 'upscale-creative') {
      params.creativity = options.creativity;
    }

    // Validate parameters
    const validation = validateModelParams(model, params);
    if (!validation.valid) {
      logger.error('Parameter validation failed:');
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    logger.info('Submitting upscale request...');

    try {
      let result;

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
          result = await api.upscaleCreative(options.image, params);
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
      logger.error('='.repeat(60));
      logger.error(`✗ Upscale failed: ${error.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    logger.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Save image result to disk with metadata
 */
async function saveImageResult(result, prompt, model, params, outputDir) {
  // Determine output directory
  const baseDir = outputDir || getOutputDir();
  const modelDir = path.join(baseDir, model);

  // Ensure directory exists
  await ensureDirectory(modelDir);

  // Generate filename
  const baseName = promptToFilename(prompt);
  const extension = params.output_format || 'png';
  const filename = generateTimestampedFilename(baseName, extension);
  const imagePath = path.join(modelDir, filename);

  // Save image
  if (result.image) {
    await writeToFile(result.image, imagePath);
    logger.info(`✓ Image saved: ${imagePath}`);
  }

  // Save metadata
  const metadataFilename = filename.replace(`.${extension}`, '_metadata.json');
  const metadataPath = path.join(modelDir, metadataFilename);

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
}

/**
 * Handle credits command execution
 */
async function handleCreditsCommand(globalOptions) {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey);

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
    logger.error(`Failed to fetch credits: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle edit command execution
 */
async function handleEditCommand(operation, options, globalOptions) {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // Validate input image exists
    if (!existsSync(options.image)) {
      logger.error(`Error: Image file not found: ${options.image}`);
      process.exit(1);
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey);

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
      let result;

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
            result = await api.inpaint(options.image, params.prompt, params);
            break;
          case 'outpaint':
            result = await api.outpaint(options.image, params);
            break;
          case 'search-and-replace':
            result = await api.searchAndReplace(options.image, params.prompt, params.search_prompt, params);
            break;
          case 'search-and-recolor':
            result = await api.searchAndRecolor(options.image, params.prompt, params.select_prompt, params);
            break;
          case 'remove-background':
            result = await api.removeBackground(options.image, params);
            break;
          case 'replace-background-and-relight':
            result = await api.replaceBackgroundAndRelight(options.image, params);
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
      const promptText = params.prompt || path.basename(options.image, path.extname(options.image));
      const modelName = `edit-${operation.replace(/-and-/g, '-')}`;
      await saveImageResult(result, promptText, modelName, params, globalOptions.outputDir);

      logger.info('='.repeat(60));
      logger.info(`✓ Edit operation complete!`);
      logger.info('='.repeat(60));

    } catch (error) {
      logger.error('='.repeat(60));
      logger.error(`✗ Edit operation failed: ${error.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    logger.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Build edit parameters from CLI options
 */
function buildEditParams(operation, options) {
  const params = {
    output_format: options.outputFormat || 'png'
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
      // Validate output format for remove-background
      if (params.output_format === 'jpeg') {
        throw new Error('Remove background does not support jpeg output (requires transparency). Use png or webp.');
      }
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
 * Show edit operation examples
 */
function showEditExamples() {
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
async function handleControlCommand(operation, options, globalOptions) {
  try {
    // Set log level
    setLogLevel(globalOptions.logLevel);

    // For style-transfer, validate both images exist
    if (operation === 'style-transfer') {
      if (!existsSync(options.initImage)) {
        logger.error(`Error: Init image file not found: ${options.initImage}`);
        process.exit(1);
      }
      if (!existsSync(options.styleImage)) {
        logger.error(`Error: Style image file not found: ${options.styleImage}`);
        process.exit(1);
      }
    } else {
      // Validate input image exists for other operations
      if (!existsSync(options.image)) {
        logger.error(`Error: Image file not found: ${options.image}`);
        process.exit(1);
      }
    }

    // Get API key
    const apiKey = getStabilityApiKey(globalOptions.apiKey);

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
      let result;
      const spinner = createSpinner(`${operation}...`);
      spinner.start();

      try {
        // Call appropriate API method
        switch (operation) {
          case 'sketch':
            result = await api.controlSketch(options.image, params.prompt, params);
            break;
          case 'structure':
            result = await api.controlStructure(options.image, params.prompt, params);
            break;
          case 'style':
            result = await api.controlStyle(options.image, params.prompt, params);
            break;
          case 'style-transfer':
            result = await api.controlStyleTransfer(options.initImage, options.styleImage, params);
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
      const promptText = params.prompt || `control-${operation}`;
      const modelName = `control-${operation}`;
      await saveImageResult(result, promptText, modelName, params, globalOptions.outputDir);

      logger.info('='.repeat(60));
      logger.info(`✓ Control operation complete!`);
      logger.info('='.repeat(60));

    } catch (error) {
      logger.error('='.repeat(60));
      logger.error(`✗ Control operation failed: ${error.message}`);
      logger.error('='.repeat(60));
      throw error;
    }

  } catch (error) {
    logger.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Build control parameters from CLI options
 */
function buildControlParams(operation, options) {
  const params = {
    output_format: options.outputFormat || 'png'
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

/**
 * Show control operation examples
 */
function showControlExamples() {
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
