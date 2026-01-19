/**
 * Config Loading Tests for mcp-personal
 *
 * Tests the config loader behavior for various scenarios:
 * - Config file not found
 * - Invalid YAML syntax
 * - Schema validation errors
 * - Path expansion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// We need to mock fs before importing the module
vi.mock('fs/promises');

// Import after mocking
const { loadConfig, getEnabledPackages, ConfigError } = await import('../src/lib/config.js');

describe('Config Loading', () => {
  const CONFIG_PATH = path.join(os.homedir(), '.config', 'personal-orchestrator', 'config.yaml');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should throw ConfigError with NOT_FOUND code when config file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(loadConfig()).rejects.toThrow(ConfigError);
      await expect(loadConfig()).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('should throw ConfigError with PARSE_ERROR code for invalid YAML', async () => {
      // Invalid YAML with bad indentation/syntax
      const invalidYaml = `
schema_version: "1.0"
packages:
  newsletter:
    path: ~/test
    enabled: true
  - this is invalid yaml
`;
      vi.mocked(fs.readFile).mockResolvedValue(invalidYaml);

      await expect(loadConfig()).rejects.toThrow(ConfigError);
      await expect(loadConfig()).rejects.toMatchObject({
        code: 'PARSE_ERROR',
      });
    });

    it('should throw ConfigError with VALIDATION_ERROR code for schema violations', async () => {
      // YAML is valid but doesn't match schema (missing required fields)
      const invalidSchema = `
schema_version: "1.0"
packages:
  newsletter:
    enabled: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(invalidSchema);

      await expect(loadConfig()).rejects.toThrow(ConfigError);
      await expect(loadConfig()).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('should expand tilde in package paths', async () => {
      const validConfig = `
schema_version: "1.0"
packages:
  newsletter:
    path: ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review
    enabled: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(validConfig);

      const config = await loadConfig();

      // Path should be expanded to use actual home directory
      expect(config.packages.newsletter.path).toBe(
        path.join(os.homedir(), 'mcp_personal_dev/mcp-authored/mcp-newsletter-review')
      );
      expect(config.packages.newsletter.path).not.toContain('~');
    });
  });

  describe('getEnabledPackages', () => {
    it('should return only enabled packages', () => {
      const config = {
        schema_version: '1.0',
        packages: {
          newsletter: {
            path: '/path/to/newsletter',
            enabled: true,
          },
          travel: {
            path: '/path/to/travel',
            enabled: false,
          },
          finance: {
            path: '/path/to/finance',
            enabled: true,
          },
        },
      };

      const enabled = getEnabledPackages(config);

      expect(enabled.size).toBe(2);
      expect(enabled.has('newsletter')).toBe(true);
      expect(enabled.has('finance')).toBe(true);
      expect(enabled.has('travel')).toBe(false);
    });

    it('should return empty map when no packages are enabled', () => {
      const config = {
        schema_version: '1.0',
        packages: {
          newsletter: {
            path: '/path/to/newsletter',
            enabled: false,
          },
        },
      };

      const enabled = getEnabledPackages(config);

      expect(enabled.size).toBe(0);
    });
  });
});
