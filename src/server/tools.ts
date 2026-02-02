/**
 * Personal Orchestrator MCP Tools
 *
 * Aggregates tools from domain packages with namespaced prefixes.
 * Phase 1: Hardcoded newsletter-review integration.
 */

import * as path from 'path';
import * as os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loadConfig, getEnabledPackages, type OrchestratorConfig } from '../lib/config.js';

// Newsletter-review imports (hardcoded for Phase 1)
// These paths assume the newsletter-review package is built
const NEWSLETTER_PACKAGE = path.join(
  os.homedir(),
  'mcp_personal_dev/mcp-authored/mcp-newsletter-review/dist'
);

const SERVER_NAME = 'personal-orchestrator';
const SERVER_VERSION = '0.1.0';

export class PersonalOrchestratorServer {
  private server: McpServer;
  private config: OrchestratorConfig | null = null;

  // Dynamically loaded newsletter modules
  private newsletterModules: {
    GmailClient: any;
    getStateSummary: any;
    runWeeklyDigest: (args: any) => Promise<string>;
    runRssDigest: (args: any) => Promise<string>;
    loadSourcesConfig: any;
    addCacheBuster: (url: string) => string;
  } | null = null;

  constructor() {
    this.server = new McpServer(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        capabilities: {},
      }
    );
  }

  /**
   * Initialize the server - load config and set up tools
   */
  async initialize(): Promise<void> {
    // Load orchestrator config
    try {
      this.config = await loadConfig();
    } catch (error) {
      console.error('Failed to load orchestrator config:', error);
      // Continue with empty config - tools will fail gracefully
      this.config = {
        schema_version: '1.0',
        packages: {},
      };
    }

    // Load newsletter-review modules if enabled
    const enabledPackages = getEnabledPackages(this.config);
    if (enabledPackages.has('newsletter')) {
      await this.loadNewsletterModules();
    }

    // Set up tools
    this.setupTools();
    this.setupErrorHandling();
  }

  /**
   * Dynamically import newsletter-review modules
   */
  private async loadNewsletterModules(): Promise<void> {
    try {
      const [gmailClient, state, digest, sourcesConfig] = await Promise.all([
        import(`${NEWSLETTER_PACKAGE}/services/gmail-client.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/state.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/digest.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/sources-config.js`),
      ]);

      this.newsletterModules = {
        GmailClient: gmailClient.GmailClient,
        getStateSummary: state.getStateSummary,
        addCacheBuster: state.addCacheBuster,
        runWeeklyDigest: digest.runWeeklyDigest,
        runRssDigest: digest.runRssDigest,
        loadSourcesConfig: sourcesConfig.loadSourcesConfig,
      };

      console.error('Newsletter modules loaded successfully');
    } catch (error) {
      console.error('Failed to load newsletter modules:', error);
      this.newsletterModules = null;
    }
  }

  private setupTools(): void {
    // Newsletter tools (namespaced with newsletter_)
    if (this.newsletterModules) {
      this.setupNewsletterTools();
    }

    // Meta tool: list available tools
    this.server.tool(
      'orchestrator_status',
      'Show status of the personal orchestrator: which packages are loaded and available.',
      {},
      async () => {
        const lines: string[] = [];
        lines.push('## Personal Orchestrator Status\n');
        lines.push(`**Version:** ${SERVER_VERSION}`);
        lines.push(`**Config loaded:** ${this.config ? 'Yes' : 'No'}\n`);

        if (this.config) {
          lines.push('### Packages\n');
          for (const [name, pkg] of Object.entries(this.config.packages)) {
            const status = pkg.enabled ? (name === 'newsletter' && this.newsletterModules ? '✓ Loaded' : '⚠ Enabled but not loaded') : '○ Disabled';
            lines.push(`- **${name}**: ${status}`);
            lines.push(`  Path: ${pkg.path}`);
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }
    );
  }

  private setupNewsletterTools(): void {
    const modules = this.newsletterModules!;

    // newsletter_run_weekly_digest
    this.server.tool(
      'newsletter_run_weekly_digest',
      'Run unified weekly digest: fetch Gmail newsletters + accumulated RSS items, score all together, deduplicate across sources, and output a briefing.',
      {
        days_back: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Number of days to look back for Gmail newsletters (default: 7)'),
        max_items: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Maximum items to include in briefing (default: 10)'),
        clear_rss_state: z
          .boolean()
          .optional()
          .describe('Clear accumulated RSS items after processing (default: true)'),
        raw_output: z
          .boolean()
          .optional()
          .describe('If true, return raw JSON with full item bodies for Claude-driven synthesis instead of formatted markdown (default: false)'),
      },
      async (args) => {
        try {
          const result = await modules.runWeeklyDigest(args);
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );

    // newsletter_run_rss_digest
    this.server.tool(
      'newsletter_run_rss_digest',
      'Score just the accumulated RSS items without touching Gmail. Useful for checking new content between full digests.',
      {
        max_items: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Maximum items to include (default: 15)'),
      },
      async (args) => {
        try {
          const result = await modules.runRssDigest(args);
          return { content: [{ type: 'text', text: result }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );

    // newsletter_content_feed_status
    this.server.tool(
      'newsletter_content_feed_status',
      'Get status of the unified content feed: pending RSS items, seen items count, last update times.',
      {},
      async () => {
        try {
          const summary = await modules.getStateSummary();
          const lines: string[] = [];
          lines.push('## Content Feed Status\n');
          lines.push(`**Pending RSS items:** ${summary.pendingRssCount}`);
          if (summary.pendingRssLastUpdated) {
            lines.push(
              `**Last RSS update:** ${summary.pendingRssLastUpdated.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}`
            );
          }
          lines.push(`**Seen items tracked:** ${summary.seenItemsCount}`);
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );

    // newsletter_health_check
    this.server.tool(
      'newsletter_health_check',
      'Pre-flight check for newsletter digest: validates Gmail OAuth token and RSS feed freshness. Run this before weekly digest to catch issues early.',
      {
        rss_stale_days: z
          .number()
          .int()
          .min(1)
          .max(14)
          .optional()
          .describe('Number of days after which RSS is considered stale (default: 3)'),
      },
      async (args) => {
        try {
          const result = await this.runHealthCheck(args);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );
  }

  /**
   * Run pre-flight health check for all content sources
   */
  private async runHealthCheck(args: { rss_stale_days?: number }): Promise<{
    ready: boolean;
    gmail: { status: 'ok' | 'error'; email?: string; error?: string; action?: string };
    rss: { status: 'ok' | 'stale' | 'error'; lastUpdated?: string; daysStale?: number; itemCount?: number; error?: string; action?: string };
    warnings: string[];
  }> {
    const modules = this.newsletterModules!;
    const staleDaysThreshold = args.rss_stale_days ?? 3;
    const warnings: string[] = [];

    // Check Gmail
    const gmailClient = new modules.GmailClient();
    let gmailStatus: { status: 'ok' | 'error'; email?: string; error?: string; action?: string };

    const hasToken = await gmailClient.hasToken();
    if (!hasToken) {
      gmailStatus = {
        status: 'error',
        error: 'No OAuth token found',
        action: 'Run: cd ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review && npm run auth:gmail',
      };
      warnings.push('Gmail: No OAuth token. Authentication required.');
    } else {
      const verify = await gmailClient.verifyToken();
      if (verify.valid) {
        gmailStatus = { status: 'ok', email: verify.email };
      } else {
        gmailStatus = {
          status: 'error',
          error: verify.error ?? 'Token invalid',
          action: 'Run: cd ~/mcp_personal_dev/mcp-authored/mcp-newsletter-review && npm run auth:gmail',
        };
        warnings.push(`Gmail: ${verify.error ?? 'Token invalid'}. Re-authentication required.`);
      }
    }

    // Check RSS freshness (from gist URL)
    const sourcesConfig = await modules.loadSourcesConfig();
    let rssStatus: { status: 'ok' | 'stale' | 'error'; lastUpdated?: string; daysStale?: number; itemCount?: number; error?: string; action?: string };

    if (!sourcesConfig.rss_state_url) {
      rssStatus = {
        status: 'error',
        error: 'No RSS state URL configured',
        action: 'Configure rss_state_url in ~/.newsletter-mcp/config/sources.yaml',
      };
      warnings.push('RSS: No state URL configured.');
    } else {
      try {
        const response = await fetch(modules.addCacheBuster(sourcesConfig.rss_state_url), {
          headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
        });

        if (!response.ok) {
          rssStatus = {
            status: 'error',
            error: `Failed to fetch RSS state: ${response.status} ${response.statusText}`,
            action: 'Check n8n workflow and gist URL',
          };
          warnings.push(`RSS: Failed to fetch state (${response.status}).`);
        } else {
          const state = await response.json() as { last_updated: string; items: any[] };
          const lastUpdated = new Date(state.last_updated);
          const daysStale = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));

          if (daysStale >= staleDaysThreshold) {
            rssStatus = {
              status: 'stale',
              lastUpdated: state.last_updated,
              daysStale,
              itemCount: state.items.length,
              action: 'Check n8n workflow - may need to run manually or publish/schedule it',
            };
            warnings.push(`RSS: Stale by ${daysStale} days (last updated: ${lastUpdated.toLocaleDateString()}). Check n8n workflow.`);
          } else {
            rssStatus = {
              status: 'ok',
              lastUpdated: state.last_updated,
              daysStale,
              itemCount: state.items.length,
            };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        rssStatus = {
          status: 'error',
          error: message,
          action: 'Check network and gist URL',
        };
        warnings.push(`RSS: ${message}`);
      }
    }

    const ready = gmailStatus.status === 'ok' && (rssStatus.status === 'ok' || rssStatus.status === 'stale');

    return { ready, gmail: gmailStatus, rss: rssStatus, warnings };
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private setupErrorHandling(): void {
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  async start(): Promise<void> {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Personal Orchestrator MCP Server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
    console.error('Personal Orchestrator MCP Server stopped');
  }
}
