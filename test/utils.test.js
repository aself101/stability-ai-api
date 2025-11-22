/**
 * Utility Functions Tests
 * Tests for file I/O, image conversion, and filename generation utilities
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'fs';
import { join } from 'path';
import fs from 'fs/promises';

// Mock DNS module before importing utils
vi.mock('dns/promises', () => ({
  lookup: vi.fn()
}));

import {
  promptToFilename,
  generateTimestampedFilename,
  validateImageUrl,
  validateImagePath,
  validateImageFile,
  imageToBuffer,
  fileToBuffer,
  buildFormData,
  ensureDirectory,
  writeToFile,
  readFromFile,
  pause,
  randomNumber,
  setLogLevel,
  fileToBase64
} from '../utils.js';
import { validateApiKeyFormat } from '../config.js';
import { lookup } from 'dns/promises';

describe('Utility Functions', () => {
  describe('promptToFilename', () => {
    it('should sanitize special characters', () => {
      const result = promptToFilename('Hello / World: Test!');
      expect(result).not.toContain('/');
      expect(result).not.toContain(':');
      expect(result).not.toContain('!');
    });

    it('should replace spaces with underscores', () => {
      const result = promptToFilename('hello world test');
      expect(result).toBe('hello_world_test');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'a'.repeat(200);
      const result = promptToFilename(longPrompt);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should respect custom maxLength', () => {
      const longPrompt = 'a'.repeat(200);
      const result = promptToFilename(longPrompt, 30);
      expect(result.length).toBeLessThanOrEqual(30);
    });

    it('should handle empty string with default', () => {
      const result = promptToFilename('');
      expect(result).toBe('image');
    });

    it('should handle only special characters', () => {
      const result = promptToFilename('!!!@@@###');
      expect(result).toBe('image');
    });

    it('should convert to lowercase', () => {
      const result = promptToFilename('HELLO WORLD');
      expect(result).toBe('hello_world');
    });

    it('should remove leading/trailing underscores', () => {
      const result = promptToFilename('  hello world  ');
      expect(result).not.toMatch(/^_/);
      expect(result).not.toMatch(/_$/);
    });
  });

  describe('generateTimestampedFilename', () => {
    it('should generate filename with timestamp', () => {
      const result = generateTimestampedFilename('test', 'jpg');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_test\.jpg$/);
    });

    it('should include base name in filename', () => {
      const result = generateTimestampedFilename('myimage', 'png');
      expect(result).toContain('myimage');
      expect(result).toMatch(/\.png$/);
    });

    it('should handle different extensions', () => {
      const extensions = ['jpg', 'png', 'jpeg', 'webp'];
      extensions.forEach(ext => {
        const result = generateTimestampedFilename('test', ext);
        expect(result).toMatch(new RegExp(`\\.${ext}$`));
      });
    });
  });
});

describe('Configuration Utilities', () => {
  describe('validateApiKeyFormat', () => {
    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });

    it('should reject null', () => {
      expect(validateApiKeyFormat(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(validateApiKeyFormat(undefined)).toBe(false);
    });

    it('should reject short keys', () => {
      expect(validateApiKeyFormat('short')).toBe(false);
      expect(validateApiKeyFormat('abc123')).toBe(false);
    });

    it('should accept valid-looking keys', () => {
      expect(validateApiKeyFormat('this-is-a-valid-looking-api-key')).toBe(true);
      expect(validateApiKeyFormat('sk_test_1234567890abcdef')).toBe(true);
    });

    it('should require minimum length of 10', () => {
      expect(validateApiKeyFormat('a'.repeat(9))).toBe(false);
      expect(validateApiKeyFormat('a'.repeat(10))).toBe(true);
      expect(validateApiKeyFormat('a'.repeat(11))).toBe(true);
    });
  });
});

describe('Image Validation (Security)', () => {
  describe('validateImageUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should accept valid HTTPS URLs with public IPs', async () => {
      // Mock DNS to return a public IP
      lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
      await expect(validateImageUrl('https://example.com/image.jpg')).resolves.toBe('https://example.com/image.jpg');

      lookup.mockResolvedValue({ address: '8.8.8.8', family: 4 });
      await expect(validateImageUrl('https://cdn.example.com/path/to/image.png')).resolves.toBe('https://cdn.example.com/path/to/image.png');
    });

    it('should reject HTTP URLs', async () => {
      await expect(validateImageUrl('http://example.com/image.jpg')).rejects.toThrow('HTTPS');
    });

    it('should reject localhost', async () => {
      // localhost as hostname (blocked by hostname check, no DNS needed)
      await expect(validateImageUrl('https://localhost/image.jpg')).rejects.toThrow('metadata');

      // 127.0.0.1 as direct IP (no DNS lookup)
      await expect(validateImageUrl('https://127.0.0.1/image.jpg')).rejects.toThrow('private');
    });

    it('should reject private IP addresses', async () => {
      await expect(validateImageUrl('https://10.0.0.1/image.jpg')).rejects.toThrow('private');
      await expect(validateImageUrl('https://192.168.1.1/image.jpg')).rejects.toThrow('private');
      await expect(validateImageUrl('https://172.16.0.1/image.jpg')).rejects.toThrow('private');
    });

    it('should reject cloud metadata endpoints', async () => {
      // Direct IP address (no DNS lookup)
      await expect(validateImageUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow();

      // Domain name that's in blocklist (blocked by hostname check, no DNS needed)
      await expect(validateImageUrl('https://metadata.google.internal/computeMetadata')).rejects.toThrow('metadata');
    });

    it('should reject IPv4-mapped IPv6 localhost addresses (SSRF bypass prevention)', async () => {
      await expect(validateImageUrl('https://[::ffff:127.0.0.1]/image.jpg')).rejects.toThrow('localhost');
      await expect(validateImageUrl('https://[::FFFF:127.0.0.1]/image.jpg')).rejects.toThrow('localhost');
    });

    it('should reject IPv4-mapped IPv6 private IP addresses (SSRF bypass prevention)', async () => {
      await expect(validateImageUrl('https://[::ffff:10.0.0.1]/image.jpg')).rejects.toThrow('private');
      await expect(validateImageUrl('https://[::ffff:192.168.1.1]/image.jpg')).rejects.toThrow('private');
      await expect(validateImageUrl('https://[::ffff:172.16.0.1]/image.jpg')).rejects.toThrow('private');
    });

    it('should reject IPv4-mapped IPv6 cloud metadata endpoints (SSRF bypass prevention)', async () => {
      await expect(validateImageUrl('https://[::ffff:169.254.169.254]/latest/meta-data')).rejects.toThrow('private');
    });

    it('should reject invalid URLs', async () => {
      await expect(validateImageUrl('not-a-url')).rejects.toThrow('Invalid URL');
      await expect(validateImageUrl('ftp://example.com/file')).rejects.toThrow();
    });

    // DNS Rebinding Prevention Tests
    it('should reject domains resolving to localhost (DNS rebinding prevention)', async () => {
      lookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
      await expect(validateImageUrl('https://evil.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject domains resolving to private IPs (DNS rebinding prevention)', async () => {
      // Test 10.x.x.x
      lookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
      await expect(validateImageUrl('https://evil.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');

      // Test 192.168.x.x
      lookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
      await expect(validateImageUrl('https://evil2.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');

      // Test 172.16-31.x.x
      lookup.mockResolvedValue({ address: '172.16.0.1', family: 4 });
      await expect(validateImageUrl('https://evil3.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject domains resolving to cloud metadata IPs (DNS rebinding prevention)', async () => {
      lookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
      await expect(validateImageUrl('https://evil.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject domains resolving to IPv6 loopback (DNS rebinding prevention)', async () => {
      lookup.mockResolvedValue({ address: '::1', family: 6 });
      await expect(validateImageUrl('https://evil.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject domains resolving to IPv6 private addresses (DNS rebinding prevention)', async () => {
      // Test fe80: (link-local)
      lookup.mockResolvedValue({ address: 'fe80::1', family: 6 });
      await expect(validateImageUrl('https://evil.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');

      // Test fc00: (unique local)
      lookup.mockResolvedValue({ address: 'fc00::1', family: 6 });
      await expect(validateImageUrl('https://evil2.com/image.jpg')).rejects.toThrow('resolves to internal/private IP');
    });

    it('should handle DNS lookup failures gracefully', async () => {
      lookup.mockRejectedValue({ code: 'ENOTFOUND' });
      await expect(validateImageUrl('https://nonexistent.domain.invalid/image.jpg')).rejects.toThrow('could not be resolved');
    });

    it('should handle DNS timeout errors gracefully', async () => {
      lookup.mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(validateImageUrl('https://timeout.example.com/image.jpg')).rejects.toThrow('Failed to validate domain');
    });
  });

  describe('validateImagePath', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const pngFile = join(testDir, 'test.png');
    const jpegFile = join(testDir, 'test.jpg');
    const invalidFile = join(testDir, 'test.txt');

    beforeAll(() => {
      try { mkdirSync(testDir, { recursive: true }); } catch (e) {}

      // Create valid PNG file (PNG magic bytes: 89 50 4E 47)
      writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(100).fill(0)]));

      // Create valid JPEG file (JPEG magic bytes: FF D8 FF)
      writeFileSync(jpegFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(100).fill(0)]));

      // Create invalid file (text file)
      writeFileSync(invalidFile, 'This is not an image');
    });

    afterAll(() => {
      try { unlinkSync(pngFile); } catch (e) {}
      try { unlinkSync(jpegFile); } catch (e) {}
      try { unlinkSync(invalidFile); } catch (e) {}
      try { rmdirSync(testDir); } catch (e) {}
    });

    it('should accept valid PNG files', async () => {
      await expect(validateImagePath(pngFile)).resolves.toBe(pngFile);
    });

    it('should accept valid JPEG files', async () => {
      await expect(validateImagePath(jpegFile)).resolves.toBe(jpegFile);
    });

    it('should reject non-image files', async () => {
      await expect(validateImagePath(invalidFile)).rejects.toThrow('does not appear to be a valid image');
    });

    it('should reject non-existent files', async () => {
      await expect(validateImagePath('/nonexistent/file.jpg')).rejects.toThrow('not found');
    });
  });

  describe('validateImageFile', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const smallFile = join(testDir, 'small.png');
    const largeFile = join(testDir, 'large.png');

    beforeAll(() => {
      try { mkdirSync(testDir, { recursive: true }); } catch (e) {}

      // Create small file (1KB)
      writeFileSync(smallFile, Buffer.from([0x89, 0x50, 0x4E, 0x47, ...new Array(1000).fill(0)]));

      // Create large file (2MB)
      writeFileSync(largeFile, Buffer.from([0x89, 0x50, 0x4E, 0x47, ...new Array(2 * 1024 * 1024).fill(0)]));
    });

    afterAll(() => {
      try { unlinkSync(smallFile); } catch (e) {}
      try { unlinkSync(largeFile); } catch (e) {}
      try { rmdirSync(testDir); } catch (e) {}
    });

    it('should accept file within size constraints', async () => {
      const result = await validateImageFile(smallFile, { maxSize: 5 * 1024 * 1024 });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject file exceeding size constraints', async () => {
      const result = await validateImageFile(largeFile, { maxSize: 1 * 1024 * 1024 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceeds maximum'))).toBe(true);
    });

    it('should accept valid file formats', async () => {
      const result = await validateImageFile(smallFile, { formats: ['png', 'jpg', 'jpeg'] });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid file formats', async () => {
      const result = await validateImageFile(smallFile, { formats: ['jpg', 'jpeg'] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not supported'))).toBe(true);
    });

    it('should reject non-existent files', async () => {
      const result = await validateImageFile('/nonexistent/file.jpg');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not found'))).toBe(true);
    });
  });
});

describe('Image Buffer Functions', () => {
  const testDir = join(process.cwd(), 'test-temp');
  const testImage = join(testDir, 'buffer-test.png');

  beforeAll(() => {
    try { mkdirSync(testDir, { recursive: true }); } catch (e) {}
    writeFileSync(testImage, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(100).fill(0)]));
  });

  afterAll(() => {
    try { unlinkSync(testImage); } catch (e) {}
    try { rmdirSync(testDir); } catch (e) {}
  });

  describe('fileToBuffer', () => {
    it('should read file to buffer', async () => {
      const buffer = await fileToBuffer(testImage);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
      // Check PNG magic bytes
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4E);
      expect(buffer[3]).toBe(0x47);
    });

    it('should reject non-existent files', async () => {
      await expect(fileToBuffer('/nonexistent/file.png')).rejects.toThrow();
    });
  });

  describe('imageToBuffer', () => {
    it('should handle local file paths', async () => {
      const buffer = await imageToBuffer(testImage);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
    });

    it('should detect file vs URL correctly', async () => {
      const buffer = await imageToBuffer(testImage);
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  describe('buildFormData', () => {
    it('should build form data with text parameters', async () => {
      const formData = await buildFormData({
        prompt: 'test prompt',
        seed: 42,
        output_format: 'png'
      });

      expect(formData).toBeDefined();
      expect(typeof formData.append).toBe('function');
    });

    it('should build form data with image parameters', async () => {
      const formData = await buildFormData(
        { prompt: 'test' },
        { image: testImage }
      );

      expect(formData).toBeDefined();
    });

    it('should handle buffer input', async () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const formData = await buildFormData(
        { prompt: 'test' },
        { image: buffer }
      );

      expect(formData).toBeDefined();
    });

    it('should skip undefined values', async () => {
      const formData = await buildFormData({
        prompt: 'test',
        seed: undefined,
        output_format: 'png'
      });

      expect(formData).toBeDefined();
    });
  });
});

describe('File I/O Functions', () => {
  const testDir = join(process.cwd(), 'test-io-temp');
  const nestedDir = join(testDir, 'nested', 'deep', 'path');

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {}
  });

  describe('ensureDirectory', () => {
    it('should create a directory if it does not exist', async () => {
      const dirPath = join(testDir, 'ensure-test-1');
      await ensureDirectory(dirPath);
      expect(existsSync(dirPath)).toBe(true);
    });

    it('should create nested directories recursively', async () => {
      const dirPath = join(testDir, 'ensure-test-2', 'level1', 'level2');
      await ensureDirectory(dirPath);
      expect(existsSync(dirPath)).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      const dirPath = join(testDir, 'ensure-test-3');
      await ensureDirectory(dirPath);
      await expect(ensureDirectory(dirPath)).resolves.not.toThrow();
    });
  });

  describe('writeToFile', () => {
    it('should write JSON data to file', async () => {
      const filepath = join(testDir, 'write-test.json');
      const data = { name: 'test', value: 42 };
      await writeToFile(data, filepath);

      const content = await fs.readFile(filepath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should write text data to file', async () => {
      const filepath = join(testDir, 'write-test.txt');
      const data = 'Hello, World!';
      await writeToFile(data, filepath);

      const content = await fs.readFile(filepath, 'utf-8');
      expect(content).toBe(data);
    });

    it('should write binary data to file', async () => {
      const filepath = join(testDir, 'write-test.png');
      const data = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      await writeToFile(data, filepath);

      const content = await fs.readFile(filepath);
      expect(content.equals(data)).toBe(true);
    });

    it('should create parent directories automatically', async () => {
      const filepath = join(testDir, 'auto-create', 'nested', 'file.json');
      await writeToFile({ test: true }, filepath);

      expect(existsSync(filepath)).toBe(true);
    });

    it('should throw error when filepath is not provided', async () => {
      await expect(writeToFile({ data: 'test' }, null)).rejects.toThrow('Filepath is required');
      await expect(writeToFile({ data: 'test' }, '')).rejects.toThrow('Filepath is required');
    });

    it('should auto-detect JSON format from extension', async () => {
      const filepath = join(testDir, 'auto-json.json');
      const data = { auto: 'detected' };
      await writeToFile(data, filepath, 'auto');

      const content = await fs.readFile(filepath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should format JSON with indentation', async () => {
      const filepath = join(testDir, 'formatted.json');
      const data = { key: 'value' };
      await writeToFile(data, filepath);

      const content = await fs.readFile(filepath, 'utf-8');
      expect(content).toContain('\n'); // Should have newlines from formatting
    });
  });

  describe('readFromFile', () => {
    const readTestDir = join(testDir, 'read-tests');

    beforeAll(async () => {
      await fs.mkdir(readTestDir, { recursive: true });

      // Create test files
      await fs.writeFile(join(readTestDir, 'test.json'), JSON.stringify({ name: 'test', count: 5 }));
      await fs.writeFile(join(readTestDir, 'test.txt'), 'Plain text content');
      await fs.writeFile(join(readTestDir, 'test.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    });

    it('should read JSON data from file', async () => {
      const filepath = join(readTestDir, 'test.json');
      const data = await readFromFile(filepath);

      expect(data).toEqual({ name: 'test', count: 5 });
    });

    it('should read text data from file', async () => {
      const filepath = join(readTestDir, 'test.txt');
      const data = await readFromFile(filepath);

      expect(data).toBe('Plain text content');
    });

    it('should read binary data from file', async () => {
      const filepath = join(readTestDir, 'test.png');
      const data = await readFromFile(filepath);

      expect(Buffer.isBuffer(data)).toBe(true);
      expect(data[0]).toBe(0x89);
      expect(data[1]).toBe(0x50);
    });

    it('should throw error when filepath is not provided', async () => {
      await expect(readFromFile(null)).rejects.toThrow('Filepath is required');
      await expect(readFromFile('')).rejects.toThrow('Filepath is required');
    });

    it('should throw error for non-existent file', async () => {
      await expect(readFromFile('/nonexistent/path/file.json')).rejects.toThrow();
    });

    it('should auto-detect format from extension', async () => {
      const filepath = join(readTestDir, 'test.json');
      const data = await readFromFile(filepath, 'auto');

      expect(typeof data).toBe('object');
      expect(data.name).toBe('test');
    });
  });

  describe('fileToBase64', () => {
    const base64TestDir = join(testDir, 'base64-tests');

    beforeAll(async () => {
      await fs.mkdir(base64TestDir, { recursive: true });
      await fs.writeFile(join(base64TestDir, 'test.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]));
    });

    it('should convert file to base64 string', async () => {
      const filepath = join(base64TestDir, 'test.png');
      const base64 = await fileToBase64(filepath);

      expect(typeof base64).toBe('string');
      // Verify it's valid base64 by decoding
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded[0]).toBe(0x89);
      expect(decoded[1]).toBe(0x50);
    });

    it('should throw error for non-existent file', async () => {
      await expect(fileToBase64('/nonexistent/image.png')).rejects.toThrow('Failed to read image file');
    });
  });
});

describe('Utility Helper Functions', () => {
  describe('pause', () => {
    it('should pause for specified duration', async () => {
      const start = Date.now();
      await pause(0.1); // 100ms
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle zero seconds', async () => {
      const start = Date.now();
      await pause(0);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('should throw error for negative seconds', async () => {
      expect(() => pause(-1)).toThrow('Seconds cannot be negative');
    });
  });

  describe('randomNumber', () => {
    it('should generate number within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomNumber(1, 10);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    it('should return integer values', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomNumber(1, 100);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    it('should handle same min and max', () => {
      const result = randomNumber(5, 5);
      expect(result).toBe(5);
    });

    it('should throw error when min > max', () => {
      expect(() => randomNumber(10, 5)).toThrow('cannot be greater than');
    });

    it('should handle large ranges', () => {
      const result = randomNumber(0, 1000000);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1000000);
    });

    it('should handle negative ranges', () => {
      const result = randomNumber(-10, -1);
      expect(result).toBeGreaterThanOrEqual(-10);
      expect(result).toBeLessThanOrEqual(-1);
    });
  });

  describe('setLogLevel', () => {
    it('should accept valid log levels', () => {
      expect(() => setLogLevel('debug')).not.toThrow();
      expect(() => setLogLevel('info')).not.toThrow();
      expect(() => setLogLevel('warn')).not.toThrow();
      expect(() => setLogLevel('error')).not.toThrow();
    });

    it('should handle uppercase input', () => {
      expect(() => setLogLevel('DEBUG')).not.toThrow();
      expect(() => setLogLevel('INFO')).not.toThrow();
    });

    it('should handle mixed case input', () => {
      expect(() => setLogLevel('DeBuG')).not.toThrow();
    });
  });
});
