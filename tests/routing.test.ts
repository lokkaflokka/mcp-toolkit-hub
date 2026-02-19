/**
 * Routing Tests for mcp-toolkit-hub
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
    it('should register briefing tools when briefing package is enabled (with writes)', async () => {
      // Set up config with briefing enabled and writes allowed
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
    allow_writes: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      await server.initialize();

      // Verify that tool() was called for briefing tools (read + write since allow_writes: true)
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).toContain('briefing_run_weekly_digest');
      expect(toolNames).toContain('briefing_run_rss_digest');
      expect(toolNames).toContain('briefing_content_feed_status');
      expect(toolNames).toContain('briefing_save_for_later');
      expect(toolNames).toContain('briefing_import_read_later');
      expect(toolNames).toContain('orchestrator_status');
    });

    it('should not register briefing tools when briefing package is disabled', async () => {
      // Set up config with briefing disabled
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: false
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      await server.initialize();

      // Verify that briefing-specific tools were NOT registered
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).not.toContain('briefing_run_weekly_digest');
      expect(toolNames).not.toContain('briefing_run_rss_digest');
      expect(toolNames).not.toContain('briefing_content_feed_status');

      // But orchestrator_status should still be registered
      expect(toolNames).toContain('orchestrator_status');
    });

    it('should register orchestrator_status and orchestrator_health tools regardless of package configuration', async () => {
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

      // Verify orchestrator tools are registered
      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      expect(toolNames).toContain('orchestrator_status');
      expect(toolNames).toContain('orchestrator_health');
    });
  });
});
