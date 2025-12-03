/**
 * Stability AI API Type Definitions
 *
 * Comprehensive TypeScript types for the Stability AI API wrapper.
 */

// ==================== API CONFIGURATION TYPES ====================

/**
 * Options for initializing the StabilityAPI class.
 */
export interface StabilityApiOptions {
  /** Stability AI API key. If not provided, reads from environment variable. */
  apiKey?: string;
  /** API base URL (default: https://api.stability.ai) */
  baseUrl?: string;
  /** Logging level (debug, info, warn, error) */
  logLevel?: string;
}

// ==================== MODEL ENDPOINT TYPES ====================

/**
 * Model endpoint keys for generate operations.
 */
export type ModelEndpointKey =
  | 'stable-image-ultra'
  | 'stable-image-core'
  | 'sd3-large'
  | 'sd3-medium'
  | 'sd3-large-turbo'
  | 'upscale-fast'
  | 'upscale-conservative'
  | 'upscale-creative'
  | 'results';

/**
 * Edit endpoint keys.
 */
export type EditEndpointKey =
  | 'erase'
  | 'inpaint'
  | 'outpaint'
  | 'search-and-replace'
  | 'search-and-recolor'
  | 'remove-background'
  | 'replace-background-and-relight';

/**
 * Control endpoint keys.
 */
export type ControlEndpointKey =
  | 'sketch'
  | 'structure'
  | 'style'
  | 'style-transfer';

export type ModelEndpoints = {
  [K in ModelEndpointKey]: string;
};

export type EditEndpoints = {
  [K in EditEndpointKey]: string;
};

export type ControlEndpoints = {
  [K in ControlEndpointKey]: string;
};

// ==================== MODEL CONSTRAINT TYPES ====================

/**
 * Range constraint for numeric parameters.
 */
export interface RangeConstraint {
  min: number;
  max: number;
  default?: number;
}

/**
 * Pixel constraint for images.
 */
export interface PixelConstraint {
  min: number;
  max: number;
}

/**
 * Constraints for a specific model.
 */
export interface ModelConstraint {
  promptMaxLength?: number;
  aspectRatios?: string[];
  outputFormats?: string[];
  seed?: RangeConstraint;
  strength?: RangeConstraint;
  creativity?: RangeConstraint;
  models?: string[];
  stylePresets?: string[];
}

/**
 * Constraints for edit operations.
 */
export interface EditConstraint {
  promptMaxLength?: number;
  grow_mask?: RangeConstraint;
  direction?: RangeConstraint;
  creativity?: RangeConstraint;
  seed?: RangeConstraint;
  outputFormats?: string[];
  stylePresets?: string[];
  pixels?: PixelConstraint;
  requiresAspectRatio?: boolean;
  preserve_original_subject?: RangeConstraint;
  original_background_depth?: RangeConstraint;
  light_source_strength?: RangeConstraint;
  light_source_directions?: string[];
  async?: boolean;
}

/**
 * Constraints for control operations.
 */
export interface ControlConstraint {
  promptMaxLength?: number;
  control_strength?: RangeConstraint;
  fidelity?: RangeConstraint;
  style_strength?: RangeConstraint;
  composition_fidelity?: RangeConstraint;
  change_strength?: RangeConstraint;
  seed?: RangeConstraint;
  outputFormats?: string[];
  stylePresets?: string[];
  aspectRatios?: string[];
  pixels?: PixelConstraint;
  requiresAspectRatio?: boolean;
}

/**
 * All model constraints mapped by model key.
 */
export type ModelConstraints = {
  [key: string]: ModelConstraint;
};

/**
 * All edit constraints mapped by operation key.
 */
export type EditConstraints = {
  [key: string]: EditConstraint;
};

/**
 * All control constraints mapped by operation key.
 */
export type ControlConstraints = {
  [key: string]: ControlConstraint;
};

// ==================== GENERATION PARAMETER TYPES ====================

/**
 * Base parameters common to generation methods.
 */
export interface BaseGenerationParams {
  /** Text description of desired image (required) */
  prompt: string;
  /** Negative prompt - what NOT to generate */
  negative_prompt?: string;
  /** Aspect ratio (e.g., '16:9', '1:1') */
  aspect_ratio?: string;
  /** Random seed (0-4294967294) */
  seed?: number;
  /** Output format: 'jpeg', 'png', or 'webp' */
  output_format?: string;
}

/**
 * Parameters for Stable Image Ultra generation.
 */
export interface UltraParams extends BaseGenerationParams {
  /** Input image for image-to-image (file path or URL) */
  image?: string;
  /** Strength for image-to-image (0-1) */
  strength?: number;
}

/**
 * Parameters for Stable Image Core generation.
 */
export interface CoreParams extends BaseGenerationParams {
  /** Style preset (photographic, anime, etc.) */
  style_preset?: string;
}

/**
 * Parameters for SD3 generation.
 */
export interface SD3Params extends BaseGenerationParams {
  /** Model variant: sd3.5-large, sd3.5-medium, sd3.5-large-turbo */
  model?: string;
}

// ==================== UPSCALE PARAMETER TYPES ====================

/**
 * Parameters for upscale operations.
 */
export interface UpscaleParams {
  /** Enhancement prompt */
  prompt?: string;
  /** Negative prompt */
  negative_prompt?: string;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Creativity level for creative upscale (0.1-0.5) */
  creativity?: number;
  /** Wait for async result */
  wait?: boolean;
}

// ==================== EDIT PARAMETER TYPES ====================

/**
 * Parameters for erase operation.
 */
export interface EraseParams {
  /** Mask image path (white=erase) */
  mask?: string;
  /** Pixels to grow mask edges (0-20) */
  grow_mask?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
}

/**
 * Parameters for inpaint operation.
 */
export interface InpaintParams {
  /** Mask image path (white=inpaint) */
  mask?: string;
  /** Negative prompt */
  negative_prompt?: string;
  /** Pixels to grow mask edges (0-100) */
  grow_mask?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for outpaint operation.
 */
export interface OutpaintParams {
  /** Pixels to extend left (0-2000) */
  left?: number;
  /** Pixels to extend right (0-2000) */
  right?: number;
  /** Pixels to extend up (0-2000) */
  up?: number;
  /** Pixels to extend down (0-2000) */
  down?: number;
  /** Creativity level (0-1) */
  creativity?: number;
  /** Prompt for extended areas */
  prompt?: string;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for search and replace operation.
 */
export interface SearchAndReplaceParams {
  /** Negative prompt */
  negative_prompt?: string;
  /** Pixels to grow auto-detected mask (0-20) */
  grow_mask?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for search and recolor operation.
 */
export interface SearchAndRecolorParams {
  /** Negative prompt */
  negative_prompt?: string;
  /** Pixels to grow auto-detected mask (0-20) */
  grow_mask?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for remove background operation.
 */
export interface RemoveBackgroundParams {
  /** Output format (png or webp only) */
  output_format?: string;
}

/**
 * Parameters for replace background and relight operation.
 */
export interface ReplaceBackgroundParams {
  /** Description of desired background */
  background_prompt?: string;
  /** Reference image for background style */
  background_reference?: string;
  /** Description of subject */
  foreground_prompt?: string;
  /** Negative prompt */
  negative_prompt?: string;
  /** Subject overlay strength (0-1) */
  preserve_original_subject?: number;
  /** Background depth matching (0-1) */
  original_background_depth?: number;
  /** Keep original background with new lighting */
  keep_original_background?: boolean;
  /** Direction of light */
  light_source_direction?: 'left' | 'right' | 'above' | 'below';
  /** Reference image for lighting */
  light_reference?: string;
  /** Light intensity (0-1) */
  light_source_strength?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Wait for async result */
  wait?: boolean;
}

// ==================== CONTROL PARAMETER TYPES ====================

/**
 * Parameters for control sketch operation.
 */
export interface ControlSketchParams {
  /** Control strength (0-1) */
  control_strength?: number;
  /** Negative prompt */
  negative_prompt?: string;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for control structure operation.
 */
export interface ControlStructureParams {
  /** Control strength (0-1) */
  control_strength?: number;
  /** Negative prompt */
  negative_prompt?: string;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for control style operation.
 */
export interface ControlStyleParams {
  /** Fidelity to input style (0-1) */
  fidelity?: number;
  /** Output aspect ratio */
  aspect_ratio?: string;
  /** Negative prompt */
  negative_prompt?: string;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
  /** Style preset */
  style_preset?: string;
}

/**
 * Parameters for control style transfer operation.
 */
export interface ControlStyleTransferParams {
  /** Optional prompt to guide transfer */
  prompt?: string;
  /** Negative prompt */
  negative_prompt?: string;
  /** Style influence (0-1) */
  style_strength?: number;
  /** Composition preservation (0-1) */
  composition_fidelity?: number;
  /** How much to change (0.1-1) */
  change_strength?: number;
  /** Random seed */
  seed?: number;
  /** Output format */
  output_format?: string;
}

// ==================== RESPONSE TYPES ====================

/**
 * Result from synchronous generation (image buffer response).
 */
export interface ImageResult {
  /** Generated image data */
  image: Buffer;
  /** Finish reason */
  finish_reason?: string;
  /** Seed used */
  seed?: string;
}

/**
 * Task result from async operation.
 */
export interface TaskResult {
  /** Task ID */
  id: string;
}

/**
 * User credits information.
 */
export interface CreditsResult {
  /** Credits remaining */
  credits: number;
}

/**
 * Validation result from parameter validation.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Array of error messages */
  errors: string[];
}

// ==================== POLLING OPTIONS ====================

/**
 * Options for waitForResult polling.
 */
export interface WaitResultOptions {
  /** Seconds between polls */
  pollInterval?: number;
  /** Maximum wait time in seconds */
  timeout?: number;
  /** Show animated spinner */
  showSpinner?: boolean;
}

// ==================== UTILITY TYPES ====================

/**
 * Spinner object for long-running operations.
 */
export interface SpinnerObject {
  /** Start the spinner animation */
  start(): void;
  /** Stop the spinner and optionally show final message */
  stop(finalMessage?: string | null): void;
  /** Update the spinner message */
  update(newMessage: string): void;
}

/**
 * Constraints for image file validation.
 */
export interface ImageValidationConstraints {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed file formats (e.g., ['png', 'jpg', 'jpeg']) */
  formats?: string[];
}

/**
 * Result from image file validation.
 */
export interface ImageFileValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Array of error messages */
  errors: string[];
}

/**
 * File format for read/write operations.
 */
export type FileFormat = 'json' | 'txt' | 'binary' | 'auto';

// ==================== HTTP TYPES ====================

/**
 * HTTP method types.
 */
export type HttpMethod = 'GET' | 'POST';

/**
 * Axios error response data shape.
 */
export interface ErrorResponseData {
  errors?: string[];
  error?: string;
  message?: string;
}
