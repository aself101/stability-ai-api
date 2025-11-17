# Stability AI Image Generation Service

A Node.js wrapper for the [Stability AI API](https://platform.stability.ai/docs/api-reference) that provides easy access to Stable Diffusion 3.5 and image upscaling models. Generate stunning AI images and upscale existing ones with professional quality through a simple command-line interface.

This service follows the data-collection architecture pattern with organized data storage, automatic polling for async operations, retry logic, comprehensive logging, and CLI orchestration.

## Quick Start
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

## Table of Contents

- [Overview](#overview)
- [Models](#models)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Security Features](#security-features)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

The Stability AI API provides access to state-of-the-art image generation and upscaling models. This Node.js service implements:

- **6 Model Endpoints** - Stable Image Ultra, Core, SD3.5 + Fast/Conservative/Creative Upscale
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
- **Comprehensive Testing** - 122 tests with Vitest for reliability

## Models

### Stable Image Ultra
Photorealistic 1MP image generation with image-to-image support.

**Best for:** Photorealistic renders, product photos, portraits
**Parameters:** prompt, aspect_ratio, seed, image (optional), strength (0-1)

### Stable Image Core
Fast and affordable SDXL successor with style presets.

**Best for:** Fast generation, stylized images, production workflows
**Parameters:** prompt, aspect_ratio, seed, style_preset (photographic, anime, cinematic, etc.)

### Stable Diffusion 3.5
Latest SD3.5 models with three variants.

**Models:** sd3.5-large, sd3.5-medium, sd3.5-large-turbo
**Best for:** General-purpose generation, fast turbo mode
**Parameters:** prompt, model, aspect_ratio, seed

### Upscale Fast
4x upscaling in approximately 1 second (synchronous).

**Best for:** Quick upscales, batch processing
**Parameters:** image (required), output_format

### Upscale Conservative
20-40x upscaling to 4MP with minimal alteration (synchronous).

**Best for:** Preserving original details, minimal changes
**Parameters:** image (required), prompt (optional), seed

### Upscale Creative
20-40x upscaling with creative reimagining (asynchronous with polling).

**Best for:** Enhancing and reimagining images, artistic upscales
**Parameters:** image (required), prompt (optional), creativity (0.1-0.5), seed

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
npm test  # Run 122 tests
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
# Run all tests (122 tests)
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

## License

MIT

## Contributing

Contributions welcome! Please ensure all tests pass before submitting PRs:
```bash
npm test  # All 122 tests must pass
```
