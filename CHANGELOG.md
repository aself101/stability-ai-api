# [0.4.0](https://github.com/aself101/stability-ai-api/compare/v0.3.1...v0.4.0) (2025-12-03)


### Features

* **typescript:** add full TypeScript support with exported type definitions ([5a14f52](https://github.com/aself101/stability-ai-api/commit/5a14f521993bbe227acb4b1c3548ca9db686eb7a))

## [0.3.1](https://github.com/aself101/stability-ai-api/compare/v0.3.0...v0.3.1) (2025-11-22)


### Bug Fixes

* **asciidemo:** add asciinema demo to README ([ccc9b4b](https://github.com/aself101/stability-ai-api/commit/ccc9b4bb2019f99e7e5b22962e6471697cc4e89a))

# [0.3.0](https://github.com/aself101/stability-ai-api/compare/v0.2.1...v0.3.0) (2025-11-22)


### Features

* **control:** add 4 control operations for image manipulation ([babd213](https://github.com/aself101/stability-ai-api/commit/babd21375858cb8b936f997be7044457ce965cd5))

## [0.2.1](https://github.com/aself101/stability-ai-api/compare/v0.2.0...v0.2.1) (2025-11-22)


### Bug Fixes

* **docs:** add endpoint table, edit examples, and retry docs ([f2df10b](https://github.com/aself101/stability-ai-api/commit/f2df10b480bfe779f98ae7ca7bb52e8428d85203))

# [0.2.0](https://github.com/aself101/stability-ai-api/compare/v0.1.6...v0.2.0) (2025-11-22)


### Features

* **edit:** add 7 edit operations with async response handling ([3560255](https://github.com/aself101/stability-ai-api/commit/35602555eca49cb8ad98dde4f0d73d4983cc6747))

## [0.1.6](https://github.com/aself101/stability-ai-api/compare/v0.1.5...v0.1.6) (2025-11-20)


### Bug Fixes

* **security:** add DNS rebinding prevention to SSRF protection ([01aa86d](https://github.com/aself101/stability-ai-api/commit/01aa86dc79006dbb4694ac23cc983a22f7f151b6))

## [0.1.5](https://github.com/aself101/stability-ai-api/compare/v0.1.4...v0.1.5) (2025-11-20)


### Bug Fixes

* upgrade vitest (security) ([594b724](https://github.com/aself101/stability-ai-api/commit/594b724b40d6c2aec99000388ee2a2f54cac9eab))
* upgrade vitest (security); patch bump ([21ea1b7](https://github.com/aself101/stability-ai-api/commit/21ea1b7b1a97894f8581125cdb948dffc9042a7c))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2024-11-17

### Added
- Comprehensive README with quick start, programmatic usage examples, and CLI documentation
- Detailed programmatic API examples for all generation and upscaling methods
- Complete example pipelines (batch generation, image processing pipeline)
- Error handling examples with specific error type detection
- TypeScript JSDoc comments for IntelliSense support
- Badges for npm version, license, Node.js version, and test status (122 passing)
- Related packages section linking to bfl-api and openai-image-api
- Disclaimer about independent community wrapper status
- Troubleshooting section with common issues and debug mode instructions
- API response patterns documentation

### Changed
- Updated README structure with comprehensive table of contents
- Enhanced model documentation with detailed parameter descriptions
- Improved data organization section with example directory structure
- Expanded security features documentation with detailed explanations
- Better formatted model parameter tables with best use cases

## [0.1.3] - 2024-11-17

### Fixed
- Metadata now outputs as parsed JSON instead of stringified object
- Improved metadata file readability and parsing

## [0.1.2] - 2024-11-16

### Fixed
- Error messages now properly parsed as JSON instead of returned as Buffer objects
- Improved error handling and message display in CLI

### Changed
- Updated version references in CLI and package.json
- CLI command renamed from `stability` to `sai` for shorter usage

## [0.1.1] - 2024-11-16

### Changed
- CLI binary renamed from `stability` to `sai` (Stability AI) for improved user experience
- Updated all CLI examples and documentation to use `sai` command

## [0.1.0] - 2024-11-16

### Added
- Initial release of Stability AI API wrapper
- Support for 6 model endpoints:
  - Stable Image Ultra (text-to-image and image-to-image)
  - Stable Image Core (with style presets)
  - Stable Diffusion 3.5 (three variants: large, medium, large-turbo)
  - Upscale Fast (4x, ~1 second)
  - Upscale Conservative (20-40x to 4MP)
  - Upscale Creative (20-40x with creative reimagining)
- Comprehensive CLI with Commander.js
  - `generate` subcommand for image generation (ultra, core, sd3)
  - `upscale` subcommand for image upscaling (fast, conservative, creative)
  - `credits` command to check account balance
  - `--examples` flag for usage examples
  - Batch processing support (multiple prompts)
- Full programmatic API with StabilityAPI class
  - `generateUltra()` - Stable Image Ultra generation
  - `generateCore()` - Stable Image Core generation
  - `generateSD3()` - Stable Diffusion 3.5 generation
  - `upscaleFast()` - Fast 4x upscaling
  - `upscaleConservative()` - Conservative 40x upscaling
  - `upscaleCreative()` - Creative 40x upscaling with auto-polling
  - `getBalance()` - Check API credits
  - `getResult()` - Get async operation result
  - `waitForResult()` - Auto-poll with retry logic
- API key management with priority chain:
  - CLI flag > Environment variable > Local .env > Global ~/.stability/.env
- Production-grade security features:
  - API key redaction in all logs (shows last 4 chars only)
  - Error message sanitization in production mode
  - HTTPS enforcement on base URLs
  - SSRF protection (blocks localhost, private IPs, cloud metadata endpoints)
  - IPv4-mapped IPv6 bypass prevention
  - DoS prevention (request timeouts, file size limits, redirect limits)
  - Parameter pre-flight validation
  - Image file validation with magic byte checking
- Comprehensive testing suite:
  - 122 tests with Vitest
  - API authentication and key validation tests
  - All generation and upscaling method tests
  - Synchronous and asynchronous response handling tests
  - Parameter validation tests
  - Security feature tests (HTTPS, SSRF, key redaction, error sanitization)
  - Utility function tests (Buffer handling, form data, image validation)
- Data organization:
  - Structured output directories: `datasets/stability/{model}/`
  - Timestamped filenames with sanitized prompts
  - JSON metadata files alongside images
  - Automatic directory creation
- Utility functions:
  - `imageToBuffer()` - Convert file path to Buffer for API
  - `buildFormData()` - Construct multipart/form-data payloads
  - `validateImageFile()` - Image file validation with magic bytes
  - `writeToFile()` - Save Buffer to file
  - `generateTimestampedFilename()` - Create unique filenames
  - `ensureDirectory()` - Create directories recursively
- Polling system for async operations:
  - Exponential backoff retry logic
  - Configurable timeout and interval
  - Animated CLI spinner with time estimates
  - Smart retry on transient errors (502, 503, network issues)
  - No retry on permanent errors (401, 422, 429, content moderation)
- Winston logging:
  - Configurable log levels (debug, info, warning, error)
  - Structured log format with timestamps
  - API key redaction in all log output
- Model parameter constraints:
  - Aspect ratio validation (9 supported ratios)
  - Seed range validation (0 to 4,294,967,294)
  - Strength validation (0.0 to 1.0 for image-to-image)
  - Creativity validation (0.1 to 0.5 for Creative Upscale)
  - Prompt length validation (10,000 chars max)
  - Output format validation (jpeg, png, webp)
- Package exports:
  - Main API class: `import { StabilityAPI } from 'stability-ai-api'`
  - Utils: `import { utils } from 'stability-ai-api/utils'`
  - Config: `import { config } from 'stability-ai-api/config'`
- NPM package configuration:
  - Binary CLI: `sai` command globally available
  - Files whitelist for minimal package size
  - Proper ES module exports
  - Node.js >= 18.0.0 requirement

### Technical Details
- **Architecture Pattern**: Data-collection service following bfl-api patterns
- **API Response Handling**:
  - Synchronous models (Ultra, Core, SD3, Fast/Conservative Upscale): HTTP 200 with immediate Buffer
  - Asynchronous models (Creative Upscale): HTTP 202 with task ID, requires polling
- **Request Format**: Multipart/form-data (not JSON)
- **Image Format**: Raw binary Buffers (not base64)
- **Dependencies**:
  - axios: ^1.6.2 (HTTP client)
  - commander: ^11.1.0 (CLI framework)
  - dotenv: ^16.3.1 (Environment variables)
  - form-data: ^4.0.0 (Multipart/form-data)
  - winston: ^3.11.0 (Logging)
  - vitest: ^4.0.9 (Testing framework)

## Links

- [Stability AI Platform](https://platform.stability.ai/)
- [API Documentation](https://platform.stability.ai/docs/api-reference)
- [Get API Key](https://platform.stability.ai/account/keys)

---

**Note**: Versions prior to 0.1.0 were development iterations not publicly released.
