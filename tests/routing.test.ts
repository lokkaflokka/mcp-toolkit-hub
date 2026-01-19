/**
 * Routing Tests for mcp-personal
 *
 * Tests the generic routing behavior for any package:
 * - Tool registration when enabled
 * - Tool non-registration when disabled
 * - Parameter passthrough to domain packages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock fs/promises before importing
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock the MCP SDK - must be a factory function
const mockTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class MockMcpServer {
    tool = mockTool;
    connect = mockConnect;
    close = mockClose;
  },
}));

// Mock the StdioServerTransport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

import * as fs from 'fs/promises';

describe('Routing', () => {
  beforeEach(() => {
    mockTool.mockClear();
    mockConnect.mockClear();
    mockClose.mockClear();
    vi.mocked(fs.readFile).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register newsletter tools when newsletter package is enabled', async () => {
      // Set up config with newsletter enabled
      const configYaml = `
schema_version: "1.0"
packages:
  newsletter:
    path: ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review
    enabled: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      // Mock the newsletter module loading to avoid actual file system access
      // @ts-expect-error - accessing private method for testing
      server.newsletterModules = {
        loadConfig: vi.fn(),
        loadSourcesConfig: vi.fn(),
        GmailSource: vi.fn(),
        scoreContentItems: vi.fn(),
        selectForBriefing: vi.fn(),
        deduplicateItems: vi.fn(),
        getPendingRssItems: vi.fn(),
        clearPendingRssItems: vi.fn(),
        markItemsSeen: vi.fn(),
        getStateSummary: vi.fn(),
      };

      await server.initialize();

      // Verify that tool() was called for newsletter tools
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).toContain('newsletter_run_weekly_digest');
      expect(toolNames).toContain('newsletter_run_rss_digest');
      expect(toolNames).toContain('newsletter_content_feed_status');
      expect(toolNames).toContain('orchestrator_status');
    });

    it('should not register newsletter tools when newsletter package is disabled', async () => {
      // Set up config with newsletter disabled
      const configYaml = `
schema_version: "1.0"
packages:
  newsletter:
    path: ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review
    enabled: false
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      await server.initialize();

      // Verify that newsletter-specific tools were NOT registered
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).not.toContain('newsletter_run_weekly_digest');
      expect(toolNames).not.toContain('newsletter_run_rss_digest');
      expect(toolNames).not.toContain('newsletter_content_feed_status');

      // But orchestrator_status should still be registered
      expect(toolNames).toContain('orchestrator_status');
    });

    it('should register orchestrator_status tool regardless of package configuration', async () => {
      // Empty packages config
      const configYaml = `
schema_version: "1.0"
packages: {}
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      await server.initialize();

      // Verify orchestrator_status is registered
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).toContain('orchestrator_status');
    });
  });
});
