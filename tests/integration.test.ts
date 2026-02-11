/**
 * Integration Tests for mcp-toolkit-hub
 *
 * Tests system-level behavior:
 * - Graceful degradation when package modules are not built
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

import * as fs from 'fs/promises';

describe('Integration', () => {
  beforeEach(() => {
    mockTool.mockClear();
    mockConnect.mockClear();
    mockClose.mockClear();
    vi.mocked(fs.readFile).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Module Loading', () => {
    it('should gracefully handle when briefing package is not built', async () => {
      // Set up config with briefing enabled but pointing to nonexistent path
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed-nonexistent
    enabled: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      // Import fresh module - dynamic imports will fail because the modules don't exist
      // but the server should still initialize successfully
      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      // This should not throw even if newsletter modules fail to load
      // The server logs errors but continues without the newsletter tools
      await expect(server.initialize()).resolves.not.toThrow();

      // Verify server still registers orchestrator_status
      const toolNames = mockTool.mock.calls.map((call) => call[0]);
      expect(toolNames).toContain('orchestrator_status');
    });

    it('should continue operation when config file is missing', async () => {
      // Simulate missing config file
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();

      // Should initialize with empty config, not crash
      await expect(server.initialize()).resolves.not.toThrow();

      // Verify orchestrator_status is still available
      const toolNames = mockTool.mock.calls.map((call) => call[0]);
      expect(toolNames).toContain('orchestrator_status');
    });
  });
});
