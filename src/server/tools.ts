/**
 * Personal Orchestrator MCP Tools
 *
 * Aggregates tools from domain packages with namespaced prefixes.
 * Phase 1: Hardcoded newsletter-review integration.
 */

import * as fs from 'fs/promises';
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

// Default briefings output directory
const DEFAULT_BRIEFINGS_DIR = path.join(os.homedir(), 'Projects', 'newsletters', 'briefings');

const SERVER_NAME = 'personal-orchestrator';
const SERVER_VERSION = '0.1.0';

export class PersonalOrchestratorServer {
  private server: McpServer;
  private config: OrchestratorConfig | null = null;

  // Dynamically loaded newsletter modules
  private newsletterModules: {
    loadConfig: any;
    loadSourcesConfig: any;
    GmailSource: any;
    GmailClient: any;
    scoreContentItems: any;
    selectForBriefing: any;
    deduplicateItems: any;
    getPendingRssItems: any;
    clearPendingRssItems: any;
    markItemsSeen: any;
    getStateSummary: any;
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
      const [configLoader, sourcesConfig, sources, gmailClient, scoring, dedup, state] = await Promise.all([
        import(`${NEWSLETTER_PACKAGE}/services/config-loader.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/sources-config.js`),
        import(`${NEWSLETTER_PACKAGE}/sources/index.js`),
        import(`${NEWSLETTER_PACKAGE}/services/gmail-client.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/scoring.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/dedup.js`),
        import(`${NEWSLETTER_PACKAGE}/lib/state.js`),
      ]);

      this.newsletterModules = {
        loadConfig: configLoader.loadConfig,
        loadSourcesConfig: sourcesConfig.loadSourcesConfig,
        GmailSource: sources.GmailSource,
        GmailClient: gmailClient.GmailClient,
        scoreContentItems: scoring.scoreContentItems,
        selectForBriefing: scoring.selectForBriefing,
        deduplicateItems: dedup.deduplicateItems,
        getPendingRssItems: state.getPendingRssItems,
        clearPendingRssItems: state.clearPendingRssItems,
        markItemsSeen: state.markItemsSeen,
        getStateSummary: state.getStateSummary,
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
          const result = await this.runWeeklyDigest(args);
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
          const result = await this.runRssDigest(args);
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
   * Run the weekly digest (Gmail + RSS)
   */
  private async runWeeklyDigest(args: {
    days_back?: number;
    max_items?: number;
    clear_rss_state?: boolean;
    raw_output?: boolean;
  }): Promise<string> {
    const modules = this.newsletterModules!;
    const daysBack = args.days_back ?? 7;
    const maxItems = args.max_items ?? 10;
    const clearRssState = args.clear_rss_state ?? true;
    const rawOutput = args.raw_output ?? false;

    // Load configs
    const config = await modules.loadConfig({});
    const sourcesConfig = await modules.loadSourcesConfig();

    // Collect content from all sources
    const allItems: any[] = [];
    const sourceStats = { gmail: 0, rss: 0 };

    // Gmail
    try {
      const gmailSource = new modules.GmailSource();
      const gmailItems = await gmailSource.fetch({ daysBack });
      allItems.push(...gmailItems);
      sourceStats.gmail = gmailItems.length;
    } catch (error) {
      console.error('Gmail fetch failed:', error);
    }

    // RSS
    const rssItems = await modules.getPendingRssItems({ url: sourcesConfig.rss_state_url });
    allItems.push(...rssItems);
    sourceStats.rss = rssItems.length;

    if (allItems.length === 0) {
      if (rawOutput) {
        return JSON.stringify({
          items: [],
          stats: {
            totalFetched: 0,
            totalScored: 0,
            duplicatesRemoved: 0,
            selectedCount: 0,
            sourceBreakdown: sourceStats,
          },
          generatedAt: new Date().toISOString(),
        }, null, 2);
      }
      return `No content found. Gmail: ${sourceStats.gmail} items, RSS: ${sourceStats.rss} pending items.`;
    }

    // Deduplicate
    const dedupResult = modules.deduplicateItems(allItems);

    // Score
    const results = modules.scoreContentItems(dedupResult.items, config);

    // Select for briefing
    const selected = modules.selectForBriefing(results, config, maxItems);

    // Mark items as seen and clear RSS state (do this regardless of output format)
    const selectedIds = selected.map((r: any) => r.item.id);
    await modules.markItemsSeen(selectedIds);

    if (clearRssState && rssItems.length > 0) {
      await modules.clearPendingRssItems();
    }

    // Raw output mode: return JSON with full item bodies for Claude-driven synthesis
    if (rawOutput) {
      const rawItems = selected.map((r: any) => ({
        id: r.item.id,
        title: r.item.title,
        source: r.item.source,
        author: r.item.author,
        date: r.item.date,
        url: r.item.url,
        body: r.item.body,
        score: r.score,
        bucket: r.bucket,
        matchedTopics: r.matchedTopics,
        matchedSignals: r.matchedSignals,
      }));

      return JSON.stringify({
        items: rawItems,
        stats: {
          totalFetched: allItems.length,
          totalScored: results.length,
          duplicatesRemoved: dedupResult.duplicatesRemoved,
          selectedCount: selected.length,
          sourceBreakdown: sourceStats,
        },
        config: {
          daysBack,
          maxItems,
          clearRssState,
        },
        generatedAt: new Date().toISOString(),
      }, null, 2);
    }

    // Format briefing (default mode)
    const briefing = this.formatUnifiedBriefing(selected, results.length, daysBack, sourceStats, dedupResult.duplicatesRemoved);

    // Write to file
    const outputPath = this.getDefaultBriefingPath('weekly-digest');
    await this.writeBriefingFile(outputPath, briefing);

    // Return briefing plus metadata
    const lines: string[] = [];
    lines.push(briefing);
    lines.push('\n---\n');
    lines.push(`**Output written to:** ${outputPath}`);
    if (clearRssState && rssItems.length > 0) {
      lines.push(`**RSS state cleared:** ${rssItems.length} items processed`);
    }

    return lines.join('\n');
  }

  /**
   * Run RSS-only digest
   */
  private async runRssDigest(args: { max_items?: number }): Promise<string> {
    const modules = this.newsletterModules!;
    const maxItems = args.max_items ?? 15;

    const config = await modules.loadConfig({});
    const sourcesConfig = await modules.loadSourcesConfig();

    const rssItems = await modules.getPendingRssItems({ url: sourcesConfig.rss_state_url });

    if (rssItems.length === 0) {
      return 'No RSS items pending. Run n8n workflow to fetch new items.';
    }

    const results = modules.scoreContentItems(rssItems, config);
    const selected = results.filter((r: any) => r.bucket !== 'skip').slice(0, maxItems);

    return this.formatRssBriefing(selected, results.length);
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
        const response = await fetch(sourcesConfig.rss_state_url, {
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

  private formatUnifiedBriefing(
    selected: any[],
    totalScored: number,
    daysBack: number,
    sourceStats: { gmail: number; rss: number },
    duplicatesRemoved: number
  ): string {
    const lines: string[] = [];
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    lines.push('# Weekly Content Digest');
    lines.push(`*Generated: ${dateStr}*\n`);
    lines.push(`**Sources:** ${sourceStats.gmail} Gmail newsletters, ${sourceStats.rss} RSS items`);
    lines.push(`**Scored:** ${totalScored} items (${duplicatesRemoved} duplicates removed)`);
    lines.push(`**Selected:** ${selected.length} high-priority items\n`);

    if (selected.length === 0) {
      lines.push('No high-priority content found matching your interests.');
      return lines.join('\n');
    }

    // Group by bucket
    const byBucket = new Map<string, any[]>();
    for (const result of selected) {
      const bucket = result.bucket;
      if (!byBucket.has(bucket)) byBucket.set(bucket, []);
      byBucket.get(bucket)!.push(result);
    }

    const bucketOrder = ['must_read', 'skim', 'low_priority'] as const;
    const bucketLabels: Record<string, string> = {
      must_read: 'Must Read',
      skim: 'Worth a Skim',
      low_priority: 'If You Have Time',
    };

    for (const bucket of bucketOrder) {
      const bucketItems = byBucket.get(bucket);
      if (!bucketItems || bucketItems.length === 0) continue;

      lines.push(`## ${bucketLabels[bucket]}\n`);

      for (const result of bucketItems) {
        const item = result.item;
        const itemDateStr = item.date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });

        const sourceLabel = item.source?.type === 'gmail' ? 'Email' : item.source?.name || 'RSS';

        lines.push(`### ${item.title}`);
        lines.push(`*From: ${this.formatSender(item.author)} (${sourceLabel}) | ${itemDateStr}*\n`);

        if (result.matchedGroups.length > 0) {
          lines.push(`**Topics:** ${result.matchedGroups.join(', ')}`);
        }
        lines.push(`**Score:** ${result.score}`);
        if (item.url) lines.push(`**Link:** ${item.url}`);

        if (item.snippet && item.snippet.length > 0) {
          const snippet = item.snippet.length > 300 ? item.snippet.slice(0, 300) + '...' : item.snippet;
          lines.push(`\n> ${snippet}`);
        }

        lines.push('\n---\n');
      }
    }

    // Summary
    const mustReadCount = byBucket.get('must_read')?.length ?? 0;
    const skimCount = byBucket.get('skim')?.length ?? 0;
    const lowCount = byBucket.get('low_priority')?.length ?? 0;

    lines.push('## Summary\n');
    lines.push(`- ${mustReadCount} must-read items`);
    lines.push(`- ${skimCount} worth skimming`);
    lines.push(`- ${lowCount} lower priority`);
    lines.push(`- ${totalScored - selected.length} skipped (low relevance)`);

    return lines.join('\n');
  }

  private formatRssBriefing(selected: any[], totalScored: number): string {
    const lines: string[] = [];
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    lines.push('# RSS Digest');
    lines.push(`*Generated: ${dateStr}*\n`);
    lines.push(`**RSS items scored:** ${totalScored}`);
    lines.push(`**Showing:** ${selected.length} relevant items\n`);

    if (selected.length === 0) {
      lines.push('No relevant RSS content found.');
      return lines.join('\n');
    }

    for (const result of selected) {
      const item = result.item;
      const itemDateStr = item.date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      const bucketEmoji = result.bucket === 'must_read' ? '🔥' : result.bucket === 'skim' ? '📖' : '📌';

      lines.push(`${bucketEmoji} **${item.title}**`);
      lines.push(`*${this.formatSender(item.author)} | ${itemDateStr} | Score: ${result.score}*`);
      if (item.url) lines.push(`${item.url}`);
      if (result.matchedGroups.length > 0) {
        lines.push(`Topics: ${result.matchedGroups.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatSender(sender: string): string {
    const match = sender.match(/^([^<]+)<[^>]+>$/);
    if (match) return match[1].trim();
    const emailMatch = sender.match(/<([^>]+)>/);
    if (emailMatch) return emailMatch[1];
    return sender;
  }

  private getDefaultBriefingPath(type: string): string {
    const dateStr = new Date().toISOString().split('T')[0];
    return path.join(DEFAULT_BRIEFINGS_DIR, `${dateStr}-${type}.md`);
  }

  private async writeBriefingFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
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
