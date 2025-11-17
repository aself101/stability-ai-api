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
import { getStabilityApiKey, validateModelParams, getOutputDir } from './config.js';
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
import { existsSync } from 'fs';

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

ADVANCED OPTIONS

11. Custom output directory
    $ sai generate ultra \\
        --prompt "logo design" \\
        --output-dir ./my-generations \\
        --aspect-ratio "1:1"

12. Debug logging
    $ sai generate core \\
        --prompt "test image" \\
        --log-level debug

13. Negative prompts
    $ sai generate sd3 \\
        --prompt "beautiful landscape" \\
        --negative-prompt "people, cars, buildings" \\
        --aspect-ratio "21:9"

UTILITY COMMANDS

14. Check account credits
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
  .version('0.1.4')
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
