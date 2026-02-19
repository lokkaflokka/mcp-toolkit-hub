/**
 * Security Tests for mcp-toolkit-hub
 *
 * Tests the 4 security guardrails:
 * - Tool allowlist filtering
 * - Write gating (read-only defaults)
 * - Resource scoping enforcement
 * - Invocation logging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';

// Mock fs/promises before importing
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs (sync) for WriteStream
const mockWrite = vi.fn();
vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => ({ write: mockWrite })),
}));

// Mock the MCP SDK
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

describe('Security Guardrails', () => {
  beforeEach(() => {
    mockTool.mockClear();
    mockConnect.mockClear();
    mockClose.mockClear();
    mockWrite.mockClear();
    vi.mocked(fs.readFile).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Guardrail 1: Tool Allowlist', () => {
    it('should only register allowlisted tools when allowed_tools is set', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
    allowed_tools:
      - run_weekly_digest
      - content_feed_status
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      // Allowed tools should be registered
      expect(toolNames).toContain('briefing_run_weekly_digest');
      expect(toolNames).toContain('briefing_content_feed_status');

      // Non-allowlisted tools should NOT be registered
      expect(toolNames).not.toContain('briefing_save_for_later');
      expect(toolNames).not.toContain('briefing_import_read_later');
      expect(toolNames).not.toContain('briefing_run_rss_digest');
    });

    it('should register all tools when allowed_tools is not set (backwards-compatible)', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
    allow_writes: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      // All briefing tools should be registered (allow_writes: true to avoid write gating)
      expect(toolNames).toContain('briefing_run_weekly_digest');
      expect(toolNames).toContain('briefing_run_rss_digest');
      expect(toolNames).toContain('briefing_content_feed_status');
      expect(toolNames).toContain('briefing_save_for_later');
    });
  });

  describe('Guardrail 2: Write Gating', () => {
    it('should not register write tools when allow_writes is false (default)', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      // Read tools should be registered
      expect(toolNames).toContain('briefing_run_weekly_digest');
      expect(toolNames).toContain('briefing_run_rss_digest');
      expect(toolNames).toContain('briefing_content_feed_status');
      expect(toolNames).toContain('briefing_health_check');

      // Write tools should NOT be registered
      expect(toolNames).not.toContain('briefing_clear_state');
      expect(toolNames).not.toContain('briefing_save_for_later');
      expect(toolNames).not.toContain('briefing_import_read_later');
    });

    it('should register write tools when allow_writes is true', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
    allow_writes: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const toolNames = mockTool.mock.calls.map((call) => call[0]);

      // Both read and write tools should be registered
      expect(toolNames).toContain('briefing_run_weekly_digest');
      expect(toolNames).toContain('briefing_clear_state');
      expect(toolNames).toContain('briefing_save_for_later');
      expect(toolNames).toContain('briefing_import_read_later');
    });
  });

  describe('Guardrail 3: Resource Scoping', () => {
    it('should block access to unscoped resource values', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  sheets:
    path: ~/mcp_personal_dev/mcp-authored/mcp-google-sheets
    enabled: true
    resource_scope:
      param: spreadsheet_id
      allowed:
        - "abc123"
        - "def456"
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      // Find the registered handler for sheets_list_sheets
      const listSheetsCall = mockTool.mock.calls.find(
        (call) => call[0] === 'sheets_list_sheets'
      );
      expect(listSheetsCall).toBeDefined();

      // The handler is the 4th argument (name, description, schema, handler)
      const handler = listSheetsCall![3];

      // Call with disallowed spreadsheet_id
      const result = await handler({ spreadsheet_id: 'evil_spreadsheet' });

      expect(result.content[0].text).toContain('Access denied');
      expect(result.content[0].text).toContain('evil_spreadsheet');
    });

    it('should allow access to scoped resource values', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  sheets:
    path: ~/mcp_personal_dev/mcp-authored/mcp-google-sheets
    enabled: true
    resource_scope:
      param: spreadsheet_id
      allowed:
        - "abc123"
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const listSheetsCall = mockTool.mock.calls.find(
        (call) => call[0] === 'sheets_list_sheets'
      );
      expect(listSheetsCall).toBeDefined();

      const handler = listSheetsCall![3];

      // Call with allowed spreadsheet_id — handler will fail (no real API)
      // but should NOT fail with "Access denied"
      const result = await handler({ spreadsheet_id: 'abc123' });

      expect(result.content[0].text).not.toContain('Access denied');
    });

    it('should skip scoping check when param is not in args', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  sheets:
    path: ~/mcp_personal_dev/mcp-authored/mcp-google-sheets
    enabled: true
    resource_scope:
      param: spreadsheet_id
      allowed:
        - "abc123"
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      // Find a tool that doesn't use spreadsheet_id in its args
      // (all sheets tools use it, but the handler should pass through
      // if the param is undefined — test with empty args)
      const listSheetsCall = mockTool.mock.calls.find(
        (call) => call[0] === 'sheets_list_sheets'
      );
      const handler = listSheetsCall![3];

      // Call without the scoped param — should not block
      const result = await handler({});
      expect(result.content[0].text).not.toContain('Access denied');
    });
  });

  describe('Guardrail 4: Invocation Logging', () => {
    it('should log invocations to stderr when log_invocations is true', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
    allow_writes: true
settings:
  log_invocations: true
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      // Find and call the content_feed_status handler (read tool, should work)
      const statusCall = mockTool.mock.calls.find(
        (call) => call[0] === 'briefing_content_feed_status'
      );
      expect(statusCall).toBeDefined();

      const handler = statusCall![3];
      await handler({});

      // Check that a JSONL log entry was written to stderr
      const logCalls = stderrSpy.mock.calls.filter((call) => {
        try {
          const parsed = JSON.parse(call[0]);
          return parsed.tool === 'content_feed_status';
        } catch {
          return false;
        }
      });
      expect(logCalls.length).toBeGreaterThanOrEqual(1);

      const logEntry = JSON.parse(logCalls[0][0]);
      expect(logEntry.package).toBe('briefing');
      expect(logEntry.tool).toBe('content_feed_status');
      expect(logEntry.ts).toBeDefined();
      expect(typeof logEntry.duration_ms).toBe('number');

      stderrSpy.mockRestore();
    });

    it('should log to file when log_file is specified', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
settings:
  log_invocations: true
  log_file: /tmp/mcp-toolkit-hub.log
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      // Find and call a handler
      const statusCall = mockTool.mock.calls.find(
        (call) => call[0] === 'briefing_content_feed_status'
      );
      if (statusCall) {
        const handler = statusCall[3];
        await handler({});

        // Check that the write stream was used
        expect(mockWrite).toHaveBeenCalled();
        const logLine = mockWrite.mock.calls[0][0];
        const logEntry = JSON.parse(logLine.replace('\n', ''));
        expect(logEntry.package).toBe('briefing');
        expect(logEntry.tool).toBe('content_feed_status');
      }
    });

    it('should not log when log_invocations is false', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  briefing:
    path: ~/mcp_personal_dev/mcp-authored/mcp-content-feed
    enabled: true
settings:
  log_invocations: false
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const statusCall = mockTool.mock.calls.find(
        (call) => call[0] === 'briefing_content_feed_status'
      );
      if (statusCall) {
        const handler = statusCall[3];
        await handler({});

        // No JSONL log entries should appear
        const logCalls = stderrSpy.mock.calls.filter((call) => {
          try {
            const parsed = JSON.parse(call[0]);
            return parsed.tool === 'content_feed_status';
          } catch {
            return false;
          }
        });
        expect(logCalls.length).toBe(0);
      }

      stderrSpy.mockRestore();
    });
  });

  describe('Meta Tools: Security Info', () => {
    it('orchestrator_status should show security config per package', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  sheets:
    path: ~/mcp_personal_dev/mcp-authored/mcp-google-sheets
    enabled: true
    allow_writes: true
    resource_scope:
      param: spreadsheet_id
      allowed:
        - "abc123"
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      // Find and call orchestrator_status handler
      const statusCall = mockTool.mock.calls.find(
        (call) => call[0] === 'orchestrator_status'
      );
      expect(statusCall).toBeDefined();

      const handler = statusCall![3];
      const result = await handler({});
      const text = result.content[0].text;

      expect(text).toContain('writes: enabled');
      expect(text).toContain('scoped: spreadsheet_id');
    });

    it('orchestrator_health should include security info in JSON', async () => {
      const configYaml = `
schema_version: "1.0"
packages:
  sheets:
    path: ~/mcp_personal_dev/mcp-authored/mcp-google-sheets
    enabled: true
    resource_scope:
      param: spreadsheet_id
      allowed:
        - "abc123"
`;
      vi.mocked(fs.readFile).mockResolvedValue(configYaml);

      const { PersonalOrchestratorServer } = await import('../src/server/tools.js');
      const server = new PersonalOrchestratorServer();
      await server.initialize();

      const healthCall = mockTool.mock.calls.find(
        (call) => call[0] === 'orchestrator_health'
      );
      expect(healthCall).toBeDefined();

      const handler = healthCall![3];
      const result = await handler({});
      const health = JSON.parse(result.content[0].text);

      expect(health.packages.sheets.security).toBeDefined();
      expect(health.packages.sheets.security.allow_writes).toBe(false);
      expect(health.packages.sheets.security.resource_scope).toBeDefined();
      expect(health.packages.sheets.security.resource_scope.param).toBe('spreadsheet_id');
      expect(health.packages.sheets.security.resource_scope.allowed_count).toBe(1);
    });
  });
});
