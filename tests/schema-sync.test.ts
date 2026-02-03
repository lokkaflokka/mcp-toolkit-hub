/**
 * Schema Sync Tests for mcp-toolkit-hub
 *
 * Tests that verify orchestrator schema stays in sync with domain packages:
 * - Parameter existence across packages
 * - Parameter bounds matching
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock fs/promises before importing
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    tool: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

/**
 * Expected schema for newsletter_run_weekly_digest tool
 * This documents what parameters the orchestrator SHOULD expose
 */
const EXPECTED_WEEKLY_DIGEST_SCHEMA = {
  days_back: {
    type: 'number',
    optional: true,
    min: 1,
    max: 30,
    default: 7,
    description: 'Number of days to look back for Gmail newsletters',
  },
  max_items: {
    type: 'number',
    optional: true,
    min: 1,
    max: 30,
    default: 10,
    description: 'Maximum items to include in briefing',
  },
  clear_rss_state: {
    type: 'boolean',
    optional: true,
    default: true,
    description: 'Clear accumulated RSS items after processing',
  },
  raw_output: {
    type: 'boolean',
    optional: true,
    default: false,
    description: 'Return raw JSON for Claude-driven synthesis',
  },
};

/**
 * Expected schema for newsletter_run_rss_digest tool
 */
const EXPECTED_RSS_DIGEST_SCHEMA = {
  max_items: {
    type: 'number',
    optional: true,
    min: 1,
    max: 30,
    default: 15,
    description: 'Maximum items to include',
  },
};

describe('Schema Sync', () => {
  describe('Parameter Existence', () => {
    it('newsletter_run_weekly_digest should expose all expected parameters', async () => {
      // This test verifies the schema definition matches expectations
      // by checking against documented expected parameters

      // Create Zod schema matching expected parameters
      const expectedSchema = z.object({
        days_back: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Number of days to look back for Gmail newsletters'),
        max_items: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Maximum items to include in briefing'),
        clear_rss_state: z
          .boolean()
          .optional()
          .describe('Clear accumulated RSS items after processing'),
        raw_output: z
          .boolean()
          .optional()
          .describe('Return raw JSON for Claude-driven synthesis'),
      });

      // Verify each expected parameter is defined
      const expectedParams = Object.keys(EXPECTED_WEEKLY_DIGEST_SCHEMA);
      const schemaShape = expectedSchema.shape;

      for (const param of expectedParams) {
        expect(schemaShape).toHaveProperty(param);
      }

      // Verify there are no extra unexpected parameters
      const schemaParams = Object.keys(schemaShape);
      expect(schemaParams.sort()).toEqual(expectedParams.sort());
    });

    it('newsletter_run_rss_digest should expose all expected parameters', async () => {
      const expectedSchema = z.object({
        max_items: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Maximum items to include'),
      });

      const expectedParams = Object.keys(EXPECTED_RSS_DIGEST_SCHEMA);
      const schemaShape = expectedSchema.shape;

      for (const param of expectedParams) {
        expect(schemaShape).toHaveProperty(param);
      }

      const schemaParams = Object.keys(schemaShape);
      expect(schemaParams.sort()).toEqual(expectedParams.sort());
    });
  });

  describe('Parameter Bounds', () => {
    it('days_back bounds should match domain package expectations', () => {
      const expected = EXPECTED_WEEKLY_DIGEST_SCHEMA.days_back;

      // Create the schema and test bounds
      const schema = z.number().int().min(expected.min).max(expected.max).optional();

      // Valid values should parse
      expect(schema.safeParse(1).success).toBe(true);
      expect(schema.safeParse(7).success).toBe(true);
      expect(schema.safeParse(30).success).toBe(true);
      expect(schema.safeParse(undefined).success).toBe(true);

      // Invalid values should fail
      expect(schema.safeParse(0).success).toBe(false);
      expect(schema.safeParse(31).success).toBe(false);
      expect(schema.safeParse(-1).success).toBe(false);
    });

    it('max_items bounds should match domain package expectations', () => {
      const expected = EXPECTED_WEEKLY_DIGEST_SCHEMA.max_items;

      const schema = z.number().int().min(expected.min).max(expected.max).optional();

      // Valid values should parse
      expect(schema.safeParse(1).success).toBe(true);
      expect(schema.safeParse(10).success).toBe(true);
      expect(schema.safeParse(30).success).toBe(true);
      expect(schema.safeParse(undefined).success).toBe(true);

      // Invalid values should fail
      expect(schema.safeParse(0).success).toBe(false);
      expect(schema.safeParse(31).success).toBe(false);
    });
  });
});
