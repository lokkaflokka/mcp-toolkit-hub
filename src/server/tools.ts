/**
 * Toolkit Hub MCP Tools
 *
 * Aggregates tools from domain packages with namespaced prefixes.
 * Uses config-driven package paths with actionable error messages.
 */

import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  loadConfig,
  getEnabledPackages,
  validatePackages,
  type OrchestratorConfig,
  type PackageValidationResult,
} from '../lib/config.js';

const SERVER_NAME = 'mcp-toolkit-hub';
const SERVER_VERSION = '0.4.0';

export class PersonalOrchestratorServer {
  private server: McpServer;
  private config: OrchestratorConfig | null = null;
  private configError: string | null = null;
  private packageValidation: PackageValidationResult[] = [];

  // Dynamically loaded newsletter modules
  private newsletterModules: {
    getStateSummary: any;
    runWeeklyDigest: (args: any) => Promise<string>;
    runRssDigest: (args: any) => Promise<string>;
    runHealthCheck: (args: any) => Promise<any>;
  } | null = null;
  private newsletterLoadError: string | null = null;

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
   * Initialize the server - load config, validate packages, and set up tools
   */
  async initialize(): Promise<void> {
    // Load orchestrator config
    try {
      this.config = await loadConfig();
    } catch (error) {
      this.configError = error instanceof Error ? error.message : String(error);
      console.error('Failed to load orchestrator config:', this.configError);
      // Continue with empty config - tools will fail gracefully
      this.config = {
        schema_version: '1.0',
        packages: {},
      };
    }

    // Validate enabled packages on startup
    this.packageValidation = await validatePackages(this.config);
    for (const result of this.packageValidation) {
      if (result.enabled && result.error) {
        console.error(`Package validation: ${result.error}`);
      }
    }

    // Load newsletter-review modules if enabled
    const enabledPackages = getEnabledPackages(this.config);
    if (enabledPackages.has('newsletter')) {
      const newsletterConfig = enabledPackages.get('newsletter')!;
      await this.loadNewsletterModules(newsletterConfig.path);
    }

    // Set up tools
    this.setupTools();
    this.setupErrorHandling();
  }

  /**
   * Dynamically import newsletter-review modules using config-driven path
   */
  private async loadNewsletterModules(packagePath: string): Promise<void> {
    const distPath = path.join(packagePath, 'dist');

    try {
      const [state, digest] = await Promise.all([
        import(`${distPath}/lib/state.js`),
        import(`${distPath}/lib/digest.js`),
      ]);

      this.newsletterModules = {
        getStateSummary: state.getStateSummary,
        runWeeklyDigest: digest.runWeeklyDigest,
        runRssDigest: digest.runRssDigest,
        runHealthCheck: digest.runHealthCheck,
      };

      console.error('Newsletter modules loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Provide actionable error messages
      if (message.includes('Cannot find module') || message.includes('ERR_MODULE_NOT_FOUND')) {
        this.newsletterLoadError = `Package not built? Run \`npm run build\` in ${packagePath}`;
      } else if (message.includes('ENOENT')) {
        this.newsletterLoadError = `Package not found at ${packagePath}. Check config path.`;
      } else {
        this.newsletterLoadError = `Failed to load: ${message}`;
      }

      console.error(`Newsletter module load error: ${this.newsletterLoadError}`);
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
        lines.push('## Toolkit Hub Status\n');
        lines.push(`**Version:** ${SERVER_VERSION}`);
        lines.push(`**Config loaded:** ${this.config && !this.configError ? 'Yes' : 'No'}`);
        if (this.configError) {
          lines.push(`**Config error:** ${this.configError}`);
        }
        lines.push('');

        if (this.config) {
          lines.push('### Packages\n');
          for (const [name, pkg] of Object.entries(this.config.packages)) {
            if (!pkg.enabled) {
              lines.push(`- **${name}**: ○ Disabled`);
              continue;
            }

            // Check if actually loaded
            const isLoaded = name === 'newsletter' && this.newsletterModules;
            const loadError = name === 'newsletter' ? this.newsletterLoadError : null;

            if (isLoaded) {
              lines.push(`- **${name}**: ✓ Loaded`);
            } else if (loadError) {
              lines.push(`- **${name}**: ✗ Failed to load`);
              lines.push(`  Error: ${loadError}`);
            } else {
              lines.push(`- **${name}**: ⚠ Enabled but not loaded`);
            }
            lines.push(`  Path: ${pkg.path}`);
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }
    );

    // Health check tool: aggregate health from all packages
    this.server.tool(
      'orchestrator_health',
      'Aggregate health check across the toolkit hub: config status, package load status, and delegated health checks from domain packages.',
      {},
      async () => {
        const health: {
          status: 'ready' | 'degraded' | 'unhealthy';
          config: { loaded: boolean; error?: string };
          packages: Record<string, {
            enabled: boolean;
            loaded: boolean;
            loadError?: string;
            validation?: { pathExists: boolean; distExists: boolean; entryPointExists: boolean; error?: string };
            healthCheck?: any;
          }>;
        } = {
          status: 'ready',
          config: {
            loaded: this.config !== null && this.configError === null,
            error: this.configError || undefined,
          },
          packages: {},
        };

        if (this.configError) {
          health.status = 'unhealthy';
        }

        // Check each package
        if (this.config) {
          for (const [name, pkg] of Object.entries(this.config.packages)) {
            const validation = this.packageValidation.find((v) => v.name === name);
            const isLoaded = name === 'newsletter' && this.newsletterModules !== null;
            const loadError = name === 'newsletter' ? this.newsletterLoadError : null;

            health.packages[name] = {
              enabled: pkg.enabled,
              loaded: isLoaded,
              loadError: loadError || undefined,
              validation: validation
                ? {
                    pathExists: validation.pathExists,
                    distExists: validation.distExists,
                    entryPointExists: validation.entryPointExists,
                    error: validation.error,
                  }
                : undefined,
            };

            // Run delegated health check if package is loaded and has one
            if (name === 'newsletter' && this.newsletterModules) {
              try {
                const delegatedHealth = await this.newsletterModules.runHealthCheck({});
                health.packages[name].healthCheck = delegatedHealth;
              } catch (error) {
                health.packages[name].healthCheck = {
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            }

            // Determine overall status
            if (pkg.enabled && !isLoaded) {
              if (health.status === 'ready') {
                health.status = 'degraded';
              }
            }
          }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(health, null, 2) }],
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
          const result = await modules.runHealthCheck(args);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );
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
    console.error('Toolkit Hub MCP Server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
    console.error('Toolkit Hub MCP Server stopped');
  }
}
