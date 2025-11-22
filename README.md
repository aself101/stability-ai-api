# Stability AI Image Generation Service

[![npm version](https://img.shields.io/npm/v/stability-ai-api.svg)](https://www.npmjs.com/package/stability-ai-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/stability-ai-api)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-283%20passing-brightgreen)](test/)

A Node.js wrapper for the [Stability AI API](https://platform.stability.ai/docs/api-reference) that provides easy access to Stable Diffusion 3.5, image upscaling, editing, and control models. Generate stunning AI images, upscale, edit, and control them with professional quality through a simple command-line interface.

This service follows the data-collection architecture pattern with organized data storage, automatic polling for async operations, retry logic, comprehensive logging, and CLI orchestration.

## Quick Start

### CLI Usage
```bash
# Install globally
npm install -g stability-ai-api

# Set your API key
export STABILITY_API_KEY="your-api-key"

# Generate an image
sai generate ultra --prompt "a serene mountain landscape"

# Upscale an image
sai upscale fast --image ./photo.jpg
```

### Programmatic Usage
```javascript
import { StabilityAPI } from 'stability-ai-api';

const api = new StabilityAPI();

// Generate an image with Stable Image Ultra
const result = await api.generateUltra({
  prompt: 'a serene mountain landscape',
  aspect_ratio: '16:9'
});

console.log('Image saved to:', result.image_path);
```

## Table of Contents

- [Overview](#overview)
- [Models](#models)
- [Edit Operations](#edit-operations)
- [Control Operations](#control-operations)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [Programmatic Usage](#programmatic-usage)
- [CLI Usage](#cli-usage)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Security Features](#security-features)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

The Stability AI API provides access to state-of-the-art image generation and upscaling models. This Node.js service implements:

- **17 Endpoints** - 3 Generate + 3 Upscale + 7 Edit + 4 Control operations
- **Production Security** - API key redaction, error sanitization, HTTPS enforcement, comprehensive SSRF protection (including IPv4-mapped IPv6 bypass prevention)
- **DoS Prevention** - Request timeouts (30s API calls), file size limits (50MB), redirect limits
- **Parameter Validation** - Pre-flight validation catches invalid parameters before API calls
- **API Key Authentication** - Multiple configuration methods with secure handling
- **Auto-polling with Spinner** - Automatic result polling for async operations with progress indicator
- **Batch Processing** - Generate multiple images sequentially from multiple prompts
- **Retry Logic** - Transient error handling with smart retry
- **Image Input Support** - Convert local files to Buffers with validation
- **Organized Storage** - Structured directories with timestamped files and metadata
- **CLI Orchestration** - Command-line tool with subcommands for generation and upscaling
- **Comprehensive Testing** - 283 tests with Vitest for reliability

### Endpoint Summary

| Operation | CLI Command | API Method | Sync/Async | Notes |
|-----------|-------------|------------|------------|-------|
| **Generate** |
| Stable Image Ultra | `sai generate ultra` | `generateUltra(options)` | Sync | Photorealistic 1MP, optional image-to-image |
| Stable Image Core | `sai generate core` | `generateCore(options)` | Sync | Fast SDXL successor, style presets |
| Stable Diffusion 3.5 | `sai generate sd3` | `generateSD3(options)` | Sync | Three variants: large, medium, turbo |
| **Upscale** |
| Fast Upscale | `sai upscale fast` | `upscaleFast(image, options)` | Sync | 4x in ~1 second |
| Conservative Upscale | `sai upscale conservative` | `upscaleConservative(image, options)` | Sync | 20-40x to 4MP, minimal alteration |
| Creative Upscale | `sai upscale creative` | `upscaleCreative(image, options)` | Async | 20-40x with creative reimagining |
| **Edit** |
| Erase | `sai edit erase` | `erase(image, options)` | Sync | Remove objects using mask |
| Inpaint | `sai edit inpaint` | `inpaint(image, prompt, options)` | Sync | Fill masked area with prompt |
| Outpaint | `sai edit outpaint` | `outpaint(image, options)` | Sync | Extend image boundaries |
| Search & Replace | `sai edit search-replace` | `searchAndReplace(image, prompt, search, options)` | Sync | Replace objects by description |
| Search & Recolor | `sai edit search-recolor` | `searchAndRecolor(image, prompt, select, options)` | Sync | Recolor selected objects |
| Remove Background | `sai edit remove-bg` | `removeBackground(image, options)` | Sync | Extract subject from background |
| Replace Background | `sai edit replace-bg` | `replaceBackgroundAndRelight(image, options)` | Sync | New background with relighting |

**Note:** All API methods use `snake_case` parameters to match the Stability AI HTTP API (e.g., `aspect_ratio`, `output_format`, `style_preset`).

## Models

### Stable Image Ultra
Photorealistic 1MP image generation with image-to-image support.

**Best for:** Photorealistic renders, product photos, portraits

**Parameters:**
- `prompt` - Text description of desired image (required)
- `aspect_ratio` - Image proportions (1:1, 16:9, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21)
- `seed` - Random seed (0 to 4,294,967,294)
- `image` - Optional input image for image-to-image generation
- `strength` - Image influence strength (0.0-1.0, for image-to-image)

### Stable Image Core
Fast and affordable SDXL successor with style presets.

**Best for:** Fast generation, stylized images, production workflows

**Parameters:**
- `prompt` - Text description of desired image (required)
- `aspect_ratio` - Image proportions (1:1, 16:9, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21)
- `seed` - Random seed (0 to 4,294,967,294)
- `style_preset` - Style preset (photographic, anime, cinematic, digital-art, fantasy-art, etc.)

### Stable Diffusion 3.5
Latest SD3.5 models with three variants.

**Models:** sd3.5-large, sd3.5-medium, sd3.5-large-turbo
**Best for:** General-purpose generation, fast turbo mode

**Parameters:**
- `prompt` - Text description of desired image (required)
- `model` - Model variant (sd3.5-large, sd3.5-medium, sd3.5-large-turbo)
- `aspect_ratio` - Image proportions (1:1, 16:9, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21)
- `seed` - Random seed (0 to 4,294,967,294)

### Upscale Fast
4x upscaling in approximately 1 second (synchronous).

**Best for:** Quick upscales, batch processing

**Parameters:**
- `image` - Input image to upscale (required)
- `output_format` - Output format (jpeg, png, webp)

### Upscale Conservative
20-40x upscaling to 4MP with minimal alteration (synchronous).

**Best for:** Preserving original details, minimal changes

**Parameters:**
- `image` - Input image to upscale (required)
- `prompt` - Optional guidance for upscaling
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Upscale Creative
20-40x upscaling with creative reimagining (asynchronous with polling).

**Best for:** Enhancing and reimagining images, artistic upscales

**Parameters:**
- `image` - Input image to upscale (required)
- `prompt` - Optional guidance for creative upscaling
- `creativity` - Creative freedom level (0.1-0.5, higher = more creative)
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

## Edit Operations

7 powerful image editing operations for professional image manipulation.

### Erase
Remove unwanted objects from images using masks.

**Best for:** Removing blemishes, items, or unwanted elements

**Parameters:**
- `image` - Input image (required)
- `mask` - Mask image where white = erase (optional, uses alpha channel if omitted)
- `grow_mask` - Pixels to expand mask (0-20, default: 5)
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Inpaint
Fill or replace masked areas with prompt-guided content.

**Best for:** Replacing objects, filling gaps, adding elements

**Parameters:**
- `image` - Input image (required)
- `prompt` - What to generate in masked area (required)
- `mask` - Mask image where white = inpaint (optional)
- `negative_prompt` - What NOT to generate
- `grow_mask` - Pixels to expand mask (0-100, default: 5)
- `style_preset` - Style preset (photographic, anime, cinematic, etc.)
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Outpaint
Extend image boundaries in any direction.

**Best for:** Expanding compositions, adding context

**Parameters:**
- `image` - Input image (required)
- `left`, `right`, `up`, `down` - Pixels to extend (0-2000 each)
- `creativity` - How creative the outpainting (0-1, default: 0.5)
- `prompt` - What to generate in extended areas
- `style_preset` - Style preset
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Search and Replace
Automatically detect and replace objects using text prompts (no manual masking).

**Best for:** Object replacement without manual mask creation

**Parameters:**
- `image` - Input image (required)
- `prompt` - What to replace with (required)
- `search_prompt` - What to find/replace (required)
- `negative_prompt` - What NOT to generate
- `grow_mask` - Pixels to expand auto-detected mask (0-20, default: 3)
- `style_preset` - Style preset
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Search and Recolor
Automatically detect and recolor objects using text prompts (no manual masking).

**Best for:** Color changes without manual mask creation

**Parameters:**
- `image` - Input image (required)
- `prompt` - Desired color/appearance (required)
- `select_prompt` - What to find/recolor (required)
- `negative_prompt` - What NOT to generate
- `grow_mask` - Pixels to expand auto-detected mask (0-20, default: 3)
- `style_preset` - Style preset
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Remove Background
Automatically segment and remove background, returning transparent image.

**Best for:** Product photos, portraits, creating cutouts

**Parameters:**
- `image` - Input image (required)
- `output_format` - Output format (**png or webp only** - no jpeg due to transparency)

**Note:** Maximum 4,194,304 pixels (stricter than other operations)

### Replace Background and Relight
Replace background with AI-generated imagery and adjust lighting (asynchronous).

**Best for:** Studio-quality background replacement, lighting adjustments

**Parameters:**
- `subject_image` - Input image with subject to keep (required)
- `background_prompt` - Description of desired background (required if no reference)
- `background_reference` - Reference image for background style
- `foreground_prompt` - Description of subject (prevents background bleeding)
- `negative_prompt` - What NOT to generate
- `preserve_original_subject` - Subject overlay strength (0-1, default: 0.6)
- `original_background_depth` - Background depth matching (0-1, default: 0.5)
- `keep_original_background` - Keep original background, change lighting only
- `light_source_direction` - Light direction (left, right, above, below)
- `light_reference` - Reference image for lighting
- `light_source_strength` - Light intensity (0-1, requires direction or reference)
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

**Note:** This is the only edit operation that runs asynchronously with polling.

### Style Presets (for applicable operations)
Available presets: enhance, anime, photographic, digital-art, comic-book, fantasy-art, line-art, analog-film, neon-punk, isometric, low-poly, origami, modeling-compound, cinematic, 3d-model, pixel-art, tile-texture

### Edit Credits
- Erase: 5 credits
- Inpaint: 5 credits
- Outpaint: 4 credits
- Search & Replace: 5 credits
- Search & Recolor: 5 credits
- Remove Background: 5 credits
- Replace BG & Relight: 8 credits

## Control Operations

4 control operations for guided image generation with structure, style, and sketch inputs.

### Control: Sketch
Convert rough sketches into refined images with precise control over the generation process.

**Best for:** Creating detailed images from simple sketches or line art

**Parameters:**
- `image` - Input sketch image (required)
- `prompt` - What to generate from the sketch (required)
- `control_strength` - Influence of sketch on generation (0-1, default: 0.7)
- `negative_prompt` - What NOT to generate
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)
- `style_preset` - Style preset (photographic, anime, cinematic, etc.)

### Control: Structure
Generate images while preserving the structure and composition of an input image.

**Best for:** Transforming images while maintaining layout and composition

**Parameters:**
- `image` - Input structure reference image (required)
- `prompt` - What to generate (required)
- `control_strength` - Influence of structure on generation (0-1, default: 0.7)
- `negative_prompt` - What NOT to generate
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)
- `style_preset` - Style preset

### Control: Style
Generate content guided by the style of a reference image.

**Best for:** Creating images that match the artistic style of a reference

**Parameters:**
- `image` - Style reference image (required)
- `prompt` - What to generate with that style (required)
- `fidelity` - How closely output resembles input style (0-1, default: 0.5)
- `negative_prompt` - What NOT to generate
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)
- `aspect_ratio` - Image proportions (1:1, 16:9, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21)

### Control: Style Transfer
Transfer the artistic style from one image to another image.

**Best for:** Applying artistic styles to existing photos or images

**Parameters:**
- `init_image` - Image to apply style to (required)
- `style_image` - Style reference image (required)
- `prompt` - Optional guidance for the transfer
- `negative_prompt` - What NOT to generate
- `style_strength` - Intensity of style transfer (0-1)
- `composition_fidelity` - How much to preserve original composition (0-1)
- `change_strength` - How much to modify the original (0.1-1)
- `seed` - Random seed (0 to 4,294,967,294)
- `output_format` - Output format (jpeg, png, webp)

### Control Credits
- Sketch: 5 credits
- Structure: 5 credits
- Style: 5 credits
- Style Transfer: 8 credits

## Authentication Setup

### 1. Get Your API Key

1. Visit [https://platform.stability.ai/account/keys](https://platform.stability.ai/account/keys)
2. Create an account or sign in (if not already signed in)
3. Generate your API key
4. Copy your API key

### 2. Configure Your API Key

You can provide your API key in multiple ways (listed in priority order):

#### Option 1: CLI Flag (Highest Priority)
```bash
sai generate ultra --api-key "your-api-key" --prompt "test"
```

#### Option 2: Environment Variable
```bash
export STABILITY_API_KEY="your-api-key"
sai generate ultra --prompt "test"
```

#### Option 3: Local .env File
```bash
echo "STABILITY_API_KEY=your-api-key" > .env
sai generate ultra --prompt "test"
```

#### Option 4: Global Configuration
```bash
mkdir -p ~/.stability
echo "STABILITY_API_KEY=your-api-key" > ~/.stability/.env
sai generate ultra --prompt "test"
```

## Installation

### Global Installation (Recommended)
```bash
# Install globally from npm
npm install -g stability-ai-api

# Verify installation
sai --version
```

### Local Development
```bash
# Clone or navigate to the repository
cd stability-ai-api

# Install dependencies
npm install

# Run tests
npm test  # Run 283 tests
```

## Programmatic Usage

You can use the Stability AI API directly in your Node.js applications.

### Basic Setup

```javascript
// If installed via npm
import { StabilityAPI } from 'stability-ai-api';

// If running from source
import { StabilityAPI } from './api.js';

// Initialize with API key (reads from env vars by default)
const api = new StabilityAPI();

// Or explicitly provide API key
const api = new StabilityAPI('your-api-key-here');
```

### Generation Methods

#### Stable Image Ultra - Text-to-Image

```javascript
import { StabilityAPI } from 'stability-ai-api';

const api = new StabilityAPI();

const result = await api.generateUltra({
  prompt: 'a serene mountain landscape at sunset',
  aspect_ratio: '16:9',
  seed: 42,
  output_format: 'png'
});

// result.image is a Buffer containing the PNG data
console.log('Generated image, seed:', result.seed);
console.log('Finish reason:', result.finish_reason);
```

#### Stable Image Ultra - Image-to-Image

```javascript
const result = await api.generateUltra({
  prompt: 'transform into oil painting style',
  image: './photo.jpg',  // Local file path
  strength: 0.6,         // 0.0 = identical to input, 1.0 = completely new
  aspect_ratio: '1:1',
  output_format: 'png'
});
```

#### Stable Image Core with Style Presets

```javascript
const result = await api.generateCore({
  prompt: 'cyberpunk city at night',
  aspect_ratio: '21:9',
  style_preset: 'cinematic',  // photographic, anime, cinematic, etc.
  seed: 12345,
  output_format: 'png'
});
```

#### Stable Diffusion 3.5

```javascript
const result = await api.generateSD3({
  prompt: 'fantasy castle on a floating island',
  model: 'sd3.5-large-turbo',  // sd3.5-large, sd3.5-medium, sd3.5-large-turbo
  aspect_ratio: '16:9',
  negative_prompt: 'blurry, low quality',
  seed: 999,
  output_format: 'webp'
});
```

### Upscaling Methods

#### Fast Upscale (4x, ~1 second)

```javascript
const result = await api.upscaleFast(
  './low_res.jpg',  // Image path
  'png'             // Output format (optional)
);

// Synchronous - returns immediately with upscaled image
console.log('Upscaled image size:', result.image.length);
```

#### Conservative Upscale (20-40x to 4MP)

```javascript
const result = await api.upscaleConservative('./photo.jpg', {
  prompt: 'enhance details and sharpness',
  negative_prompt: 'blurry, artifacts',
  seed: 42,
  output_format: 'png'
});

// Synchronous - minimal alteration to original
```

#### Creative Upscale (20-40x with reimagining)

```javascript
const result = await api.upscaleCreative('./sketch.jpg', {
  prompt: 'photorealistic rendering with vibrant colors',
  creativity: 0.35,  // 0.1 = conservative, 0.5 = very creative
  seed: 777,
  output_format: 'png'
});

// Asynchronous - automatically polls for result
// The method waits until upscaling completes
console.log('Creative upscale finished:', result.finish_reason);
```

### Control Methods

#### Control: Sketch

```javascript
const result = await api.controlSketch('./sketch.png', 'castle on a hill', {
  control_strength: 0.7,
  negative_prompt: 'blurry, low quality',
  seed: 42,
  output_format: 'png'
});
```

#### Control: Structure

```javascript
const result = await api.controlStructure('./statue.jpg', 'garden shrub sculpture', {
  control_strength: 0.8,
  style_preset: 'photographic',
  output_format: 'png'
});
```

#### Control: Style

```javascript
const result = await api.controlStyle('./art-reference.png', 'portrait of a chicken', {
  fidelity: 0.5,
  aspect_ratio: '1:1',
  output_format: 'png'
});
```

#### Control: Style Transfer

```javascript
const result = await api.controlStyleTransfer('./photo.png', './artwork.jpg', {
  prompt: 'enhance the artistic style',
  style_strength: 0.7,
  composition_fidelity: 0.5,
  change_strength: 0.3,
  output_format: 'png'
});
```

### Utility Methods

#### Check Account Credits

```javascript
const balance = await api.getBalance();
console.log('Credits remaining:', balance.credits);
```

#### Get Result for Async Operations

```javascript
// For Creative Upscale or if you want to poll manually
const taskId = 'abc123-task-id';

// Poll once
const status = await api.getResult(taskId);

// Or wait for completion with auto-polling
const result = await api.waitForResult(taskId, {
  timeout: 300,      // Max 5 minutes
  pollInterval: 2,   // Check every 2 seconds
  maxRetries: 3,     // Retry on transient errors
  showSpinner: true  // Show animated progress spinner
});
```

### Complete Example: Batch Generation

```javascript
import { StabilityAPI } from 'stability-ai-api';
import { writeToFile } from 'stability-ai-api/utils';
import path from 'path';

const api = new StabilityAPI();

const prompts = [
  'a red sports car on a mountain road',
  'a blue vintage car in the city',
  'a green electric car at a charging station'
];

for (const prompt of prompts) {
  console.log(`Generating: ${prompt}`);

  const result = await api.generateCore({
    prompt,
    aspect_ratio: '16:9',
    style_preset: 'photographic',
    output_format: 'png'
  });

  // Save to file
  const filename = `${Date.now()}_${prompt.slice(0, 30)}.png`;
  await writeToFile(result.image, path.join('./outputs', filename));

  console.log(`✓ Saved: ${filename}`);
  console.log(`  Seed: ${result.seed}`);
}
```

### Complete Example: Image Processing Pipeline

```javascript
import { StabilityAPI } from 'stability-ai-api';
import { writeToFile } from 'stability-ai-api/utils';

const api = new StabilityAPI();

// Step 1: Generate base image
console.log('Generating base image...');
const generated = await api.generateUltra({
  prompt: 'a beautiful landscape painting',
  aspect_ratio: '16:9'
});

await writeToFile(generated.image, './step1_generated.png');

// Step 2: Transform with image-to-image
console.log('Transforming style...');
const transformed = await api.generateUltra({
  prompt: 'same scene but in watercolor style',
  image: './step1_generated.png',
  strength: 0.7
});

await writeToFile(transformed.image, './step2_transformed.png');

// Step 3: Upscale to high resolution
console.log('Upscaling to high resolution...');
const upscaled = await api.upscaleCreative('./step2_transformed.png', {
  prompt: 'enhance details, vibrant colors, high quality',
  creativity: 0.3
});

await writeToFile(upscaled.image, './step3_final_4k.png');
console.log('✓ Pipeline complete!');
```

### Complete Example: Edit Operations

```javascript
import { StabilityAPI } from 'stability-ai-api';
import { writeToFile } from 'stability-ai-api/utils';

const api = new StabilityAPI();

// Erase an object using a mask
const erased = await api.erase('./photo.jpg', {
  mask: './mask.png',      // White = areas to erase
  grow_mask: 5,            // Expand mask by 5 pixels
  output_format: 'png'
});
await writeToFile(erased.image, './erased.png');

// Inpaint: fill masked area with new content
const inpainted = await api.inpaint('./scene.jpg', 'a golden retriever', {
  mask: './dog_mask.png',  // White = area to fill
  negative_prompt: 'blurry, distorted',
  output_format: 'png'
});
await writeToFile(inpainted.image, './inpainted.png');

// Outpaint: extend image boundaries
const outpainted = await api.outpaint('./landscape.jpg', {
  left: 200,               // Extend 200px left
  right: 200,              // Extend 200px right
  creativity: 0.5,         // Balance between original and generated
  prompt: 'continue the mountain scenery'
});
await writeToFile(outpainted.image, './outpainted.png');

// Search and Replace: swap objects by description
const replaced = await api.searchAndReplace('./pet.jpg', 'a tabby cat', 'dog', {
  output_format: 'png'
});
await writeToFile(replaced.image, './cat_instead.png');

// Remove Background: extract subject
const noBg = await api.removeBackground('./portrait.jpg', {
  output_format: 'png'     // PNG preserves transparency
});
await writeToFile(noBg.image, './subject_only.png');
```

### Error Handling

```javascript
import { StabilityAPI } from 'stability-ai-api';

const api = new StabilityAPI();

try {
  const result = await api.generateUltra({
    prompt: 'test image',
    aspect_ratio: '16:9'
  });

  console.log('Success!');
} catch (error) {
  if (error.message.includes('API key')) {
    console.error('Authentication failed - check your API key');
  } else if (error.message.includes('credits')) {
    console.error('Insufficient credits');
  } else if (error.message.includes('moderation')) {
    console.error('Content rejected by moderation filters');
  } else {
    console.error('Generation failed:', error.message);
  }
}
```

### Retry Behavior

The API includes automatic retry logic for transient errors:

| Setting | Default | Description |
|---------|---------|-------------|
| Max Retries | 3 | Number of retry attempts before failing |
| Backoff | Exponential | 1s → 2s → 4s between retries |
| Retry On | `502`, `503`, `504`, network errors | Transient/temporary failures |
| No Retry | `400`, `401`, `402`, `422`, `429` | Permanent errors (bad request, auth, rate limit) |

```javascript
// Configure retry behavior for async operations
const result = await api.waitForResult(taskId, {
  maxRetries: 5,       // Override default retry count
  pollInterval: 3,     // Seconds between polls
  timeout: 600         // Max wait time in seconds
});

// Disable retries by catching and not retrying
try {
  const result = await api.generateUltra({ prompt: 'test' });
} catch (error) {
  // Handle without retry
  console.error('Failed:', error.message);
}
```

### TypeScript Support

The package includes TypeScript-style JSDoc comments for IntelliSense:

```javascript
/**
 * @param {Object} params
 * @param {string} params.prompt - Text description
 * @param {string} [params.aspect_ratio='1:1'] - Image aspect ratio
 * @param {number} [params.seed] - Random seed (0-4294967294)
 * @param {string} [params.output_format='png'] - Output format
 * @returns {Promise<{image: Buffer, seed: string, finish_reason: string}>}
 */
```

## CLI Usage

### Show Help
```bash
sai --help
```

### Show Examples
```bash
sai --examples
```

### Generation Commands

**Stable Image Ultra:**
```bash
sai generate ultra \
  --prompt "a serene mountain landscape at sunset" \
  --aspect-ratio "16:9" \
  --output-format png
```

**Stable Image Core with Style:**
```bash
sai generate core \
  --prompt "cyberpunk city at night" \
  --aspect-ratio "21:9" \
  --style-preset cinematic
```

**Stable Diffusion 3.5:**
```bash
sai generate sd3 \
  --prompt "fantasy castle on floating island" \
  --model sd3.5-large-turbo \
  --aspect-ratio "16:9"
```

### Upscale Commands

**Fast Upscale:**
```bash
sai upscale fast \
  --image ./photo.jpg \
  --output-format png
```

**Conservative Upscale:**
```bash
sai upscale conservative \
  --image ./photo.jpg \
  --prompt "enhance details and sharpness"
```

**Creative Upscale:**
```bash
sai upscale creative \
  --image ./sketch.jpg \
  --prompt "photorealistic rendering" \
  --creativity 0.35
```

### Batch Processing

Process multiple prompts in a single command:
```bash
sai generate core \
  --prompt "a red sports car" \
  --prompt "a blue vintage car" \
  --prompt "a green electric car" \
  --aspect-ratio "16:9"
```

### Edit Commands

**Erase Objects:**
```bash
sai edit erase \
  --image ./photo.jpg \
  --mask ./mask.png \
  --grow-mask 5
```

**Inpaint:**
```bash
sai edit inpaint \
  --image ./photo.jpg \
  --mask ./mask.png \
  --prompt "blue sky with clouds" \
  --style-preset photographic
```

**Outpaint:**
```bash
sai edit outpaint \
  --image ./landscape.jpg \
  --left 200 --right 200 \
  --prompt "continuation of landscape" \
  --creativity 0.5
```

**Search and Replace:**
```bash
sai edit search-replace \
  --image ./pet.jpg \
  --search "cat" \
  --prompt "golden retriever"
```

**Search and Recolor:**
```bash
sai edit search-recolor \
  --image ./car.jpg \
  --select "car" \
  --prompt "bright red metallic paint"
```

**Remove Background:**
```bash
sai edit remove-bg \
  --image ./portrait.jpg \
  --output-format png
```

**Replace Background and Relight:**
```bash
sai edit replace-bg \
  --image ./portrait.jpg \
  --background-prompt "sunset beach with palm trees" \
  --light-direction right
```

**Show Edit Examples:**
```bash
sai edit examples
```

### Control Commands

**Sketch to Image:**
```bash
sai control sketch \
  --image ./sketch.png \
  --prompt "castle on a hill, fantasy style" \
  --control-strength 0.7
```

**Structure Preservation:**
```bash
sai control structure \
  --image ./statue.jpg \
  --prompt "garden shrub sculpture" \
  --control-strength 0.8
```

**Style Reference:**
```bash
sai control style \
  --image ./art-reference.png \
  --prompt "portrait of a chicken" \
  --fidelity 0.5
```

**Style Transfer:**
```bash
sai control style-transfer \
  --init-image ./photo.png \
  --style-image ./artwork.jpg \
  --style-strength 0.7
```

**Show Control Examples:**
```bash
sai control examples
```

## Examples

### Basic Image Generation
```bash
# Simple generation with Ultra model
sai generate ultra --prompt "a cat wearing a wizard hat"

# With custom aspect ratio
sai generate ultra \
  --prompt "mountain landscape" \
  --aspect-ratio "21:9"

# With seed for reproducibility
sai generate core \
  --prompt "abstract art" \
  --seed 42
```

### Image-to-Image with Ultra
```bash
sai generate ultra \
  --prompt "transform into oil painting style" \
  --image ./photo.jpg \
  --strength 0.6
```

### Style Presets with Core
```bash
sai generate core \
  --prompt "portrait of a person" \
  --style-preset photographic
```

### Upscaling Workflow
```bash
# Fast 4x upscale
sai upscale fast --image ./low_res.jpg

# Conservative 40x upscale with prompt
sai upscale conservative \
  --image ./photo.jpg \
  --prompt "enhance facial details"

# Creative upscale with high creativity
sai upscale creative \
  --image ./sketch.jpg \
  --prompt "vibrant colors, enhanced details" \
  --creativity 0.5
```

### Advanced Options
```bash
# Custom output directory
sai generate ultra \
  --prompt "logo design" \
  --output-dir ./my-generations

# Debug logging
sai generate core \
  --prompt "test image" \
  --log-level debug

# Negative prompts
sai generate sd3 \
  --prompt "beautiful landscape" \
  --negative-prompt "people, cars, buildings"
```

## Data Organization

Generated images and metadata are saved in organized directories:

```
datasets/
└── stability/
    ├── stable-image-ultra/
    │   ├── 2025-11-17_01-20-50-180_mountain_landscape.png
    │   └── 2025-11-17_01-20-50-180_mountain_landscape_metadata.json
    ├── stable-image-core/
    ├── sd3-large/
    ├── upscale-fast/
    ├── upscale-conservative/
    └── upscale-creative/
```

**Metadata includes:**
- Model used
- Generation timestamp
- All parameters (prompt, aspect_ratio, seed, etc.)
- Result information (finish_reason, seed)
- File paths

## Security Features

### API Key Protection
- API keys are redacted in all logs (shows only last 4 characters: `xxx...abc1234`)
- Never logged in full, even in DEBUG mode
- Prevents accidental exposure in log aggregation systems

### Error Message Sanitization
- In production (`NODE_ENV=production`), returns generic error messages
- Prevents information disclosure about internal systems
- Development mode shows detailed errors for debugging

### HTTPS Enforcement
- Base URLs must use HTTPS protocol
- Constructor throws error if HTTP URL is provided
- Prevents man-in-the-middle attacks

### SSRF Protection
- All image URLs validated before processing
- Blocks localhost (`127.0.0.1`, `::1`, `localhost`)
- Blocks private IP ranges (`10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`)
- Blocks cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`)
- **IPv4-Mapped IPv6 Bypass Prevention**: Detects and blocks `[::ffff:127.0.0.1]`, etc.
- **DNS Rebinding Prevention**: Performs DNS resolution to block domains that resolve to internal/private IPs (prevents TOCTOU attacks via wildcard DNS services like nip.io)
- Only allows HTTPS URLs for remote images

### DoS Prevention
- Request timeout: 30 seconds for API calls
- File size limit: 50MB maximum for image processing
- Redirect limit: Maximum 5 redirects
- Prevents resource exhaustion attacks

### Parameter Validation
- Pre-flight validation using `validateModelParams()`
- Validates all parameters against model constraints
- Saves API credits by catching errors early

### Image File Validation
- Magic byte checking for PNG, JPEG, WebP formats
- File size validation
- Format/extension validation
- Prevents processing of malicious files

## Testing

The service includes comprehensive testing:

```bash
# Run all tests (283 tests)
npm test

# Watch mode for development
npm run test:watch

# Interactive UI
npm run test:ui

# Coverage report
npm run test:coverage
```

**Test Coverage:**
- API authentication and key validation
- All generation methods (ultra, core, sd3)
- All upscale methods (fast, conservative, creative)
- Synchronous and asynchronous response handling
- Parameter validation with model-specific constraints
- Security features (HTTPS enforcement, API key redaction, error sanitization, SSRF protection)
- Utility functions (Buffer handling, form data building, image validation)
- Error handling and production mode sanitization

## Troubleshooting

### Common Issues

**Authentication Failed:**
```bash
# Verify your API key is set
echo $STABILITY_API_KEY

# Or use CLI flag
sai generate ultra --api-key "your-key" --prompt "test"
```

**Invalid Parameters:**
- Check that aspect_ratio is from valid set (1:1, 16:9, 21:9, 2:3, 3:2, 4:5, 5:4, 9:16, 9:21)
- Ensure seed is between 0 and 4,294,967,294
- Verify strength (image-to-image) is between 0.0 and 1.0
- Check creativity (Creative Upscale) is between 0.1 and 0.5

**Rate Limit Exceeded:**
- The service automatically retries on transient errors
- Check your API usage limits at Stability AI dashboard
- Wait a few moments before retrying

**Image File Not Found:**
```bash
# Verify file exists
ls -lh ./photo.jpg

# Use absolute path if needed
sai upscale fast --image /full/path/to/photo.jpg
```

**Debug Mode:**
```bash
# Enable debug logging for detailed information
sai generate ultra --prompt "test" --log-level debug
```

### Response Types

**Synchronous (Ultra, Core, SD3, Fast/Conservative Upscale):**
- Returns HTTP 200 with image Buffer immediately
- No polling required
- CLI spinner shows during request

**Asynchronous (Creative Upscale only):**
- Returns HTTP 202 with task ID
- Automatically polls for result
- CLI spinner shows time elapsed and estimated remaining time

## API Response Patterns

The Stability AI API has unique response characteristics:

- **Synchronous responses**: Return HTTP 200 with raw image Buffer immediately
- **Asynchronous responses**: Return HTTP 202 with task ID, requires polling
- **Multipart/form-data**: All requests use form-data (not JSON)
- **Buffer handling**: Images returned as binary Buffers, not base64

## Related Packages

This package is part of the img-gen ecosystem. Check out these other AI generation services:

- [`bfl-api`](https://github.com/aself101/bfl-api) - Black Forest Labs API wrapper for FLUX and Kontext models
- [`ideogram-api`](https://github.com/aself101/ideogram-api) - Ideogram API wrapper for image generation, editing, remixing, and manipulation
- [`google-genai-api`](https://github.com/aself101/google-genai-api) - Google Generative AI (Imagen) wrapper
- [`openai-api`](https://github.com/aself101/openai-api) - OpenAI API wrapper for DALL-E and GPT Image generation

---

**Disclaimer:** This project is an independent community wrapper and is not affiliated with Stability AI.

## License

MIT

## Contributing

Contributions welcome! Please ensure all tests pass before submitting PRs:
```bash
npm test  # All 283 tests must pass
```

---

Thankee-sai.
