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
const SERVER_VERSION = '0.5.0';

export class PersonalOrchestratorServer {
  private server: McpServer;
  private config: OrchestratorConfig | null = null;
  private configError: string | null = null;
  private packageValidation: PackageValidationResult[] = [];

  // Dynamically loaded content-feed (formerly newsletter) modules
  private briefingModules: {
    getStateSummary: any;
    appendSavedItem: (item: any) => Promise<number>;
    appendSavedItems: (items: any[]) => Promise<number>;
    getSavedItemCount: () => Promise<number>;
    runWeeklyDigest: (args: any) => Promise<string>;
    runRssDigest: (args: any) => Promise<string>;
    runHealthCheck: (args: any) => Promise<any>;
  } | null = null;
  private briefingLoadError: string | null = null;

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

    // Load content-feed modules if enabled (supports both 'briefing' and legacy 'newsletter' config keys)
    const enabledPackages = getEnabledPackages(this.config);
    const briefingConfig = enabledPackages.get('briefing') ?? enabledPackages.get('newsletter');
    if (briefingConfig) {
      await this.loadBriefingModules(briefingConfig.path);
    }

    // Set up tools
    this.setupTools();
    this.setupErrorHandling();
  }

  /**
   * Dynamically import content-feed modules using config-driven path
   */
  private async loadBriefingModules(packagePath: string): Promise<void> {
    const distPath = path.join(packagePath, 'dist');

    try {
      const [state, digest] = await Promise.all([
        import(`${distPath}/lib/state.js`),
        import(`${distPath}/lib/digest.js`),
      ]);

      this.briefingModules = {
        getStateSummary: state.getStateSummary,
        appendSavedItem: state.appendSavedItem,
        appendSavedItems: state.appendSavedItems,
        getSavedItemCount: state.getSavedItemCount,
        runWeeklyDigest: digest.runWeeklyDigest,
        runRssDigest: digest.runRssDigest,
        runHealthCheck: digest.runHealthCheck,
      };

      console.error('Content-feed modules loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Provide actionable error messages
      if (message.includes('Cannot find module') || message.includes('ERR_MODULE_NOT_FOUND')) {
        this.briefingLoadError = `Package not built? Run \`npm run build\` in ${packagePath}`;
      } else if (message.includes('ENOENT')) {
        this.briefingLoadError = `Package not found at ${packagePath}. Check config path.`;
      } else {
        this.briefingLoadError = `Failed to load: ${message}`;
      }

      console.error(`Content-feed module load error: ${this.briefingLoadError}`);
      this.briefingModules = null;
    }
  }

  private isBriefingPackage(name: string): boolean {
    return name === 'briefing' || name === 'newsletter';
  }

  private setupTools(): void {
    // Content-feed tools (namespaced with briefing_)
    if (this.briefingModules) {
      this.setupBriefingTools();
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
            const isLoaded = this.isBriefingPackage(name) && this.briefingModules;
            const loadError = this.isBriefingPackage(name) ? this.briefingLoadError : null;

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
            const isLoaded = this.isBriefingPackage(name) && this.briefingModules !== null;
            const loadError = this.isBriefingPackage(name) ? this.briefingLoadError : null;

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
            if (this.isBriefingPackage(name) && this.briefingModules) {
              try {
                const delegatedHealth = await this.briefingModules.runHealthCheck({});
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

  private setupBriefingTools(): void {
    const modules = this.briefingModules!;

    // briefing_run_weekly_digest
    this.server.tool(
      'briefing_run_weekly_digest',
      'Run unified weekly digest: fetch Gmail newsletters + accumulated RSS items + saved items, score all together, deduplicate across sources, and output a briefing.',
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

    // briefing_run_rss_digest
    this.server.tool(
      'briefing_run_rss_digest',
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

    // briefing_content_feed_status
    this.server.tool(
      'briefing_content_feed_status',
      'Get status of the unified content feed: pending RSS items, saved items, seen items count, last update times.',
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
          lines.push(`**Saved items pending:** ${summary.savedItemCount}`);
          if (summary.savedItemsLastUpdated) {
            lines.push(
              `**Last saved:** ${summary.savedItemsLastUpdated.toLocaleDateString('en-US', {
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

    // briefing_health_check
    this.server.tool(
      'briefing_health_check',
      'Pre-flight check for content digest: validates Gmail OAuth token, RSS feed freshness, and saved items status. Run this before weekly digest to catch issues early.',
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

    // briefing_save_for_later
    this.server.tool(
      'briefing_save_for_later',
      'Save a URL for inclusion in the next weekly digest. Items are scored alongside Gmail and RSS content.',
      {
        url: z.string().url().describe('The URL to save'),
        title: z.string().optional().describe('Title of the article (optional)'),
        tags: z.array(z.string()).optional().describe('Tags for categorization (e.g., ["engineering", "ml"])'),
        notes: z.string().optional().describe('Context about why this was saved'),
      },
      async (args) => {
        try {
          const now = new Date();
          const item = {
            id: `saved:${now.getTime()}`,
            title: args.title ?? args.url,
            body: '',
            author: '',
            date: now,
            source: { type: 'saved' as const, id: 'saved:manual', name: 'Saved' },
            url: args.url,
            tags: args.tags,
          };

          const totalCount = await modules.appendSavedItem(item);

          const lines: string[] = [];
          lines.push(`Saved for next digest: **${item.title}**`);
          lines.push(`URL: ${args.url}`);
          if (args.tags?.length) lines.push(`Tags: ${args.tags.join(', ')}`);
          if (args.notes) lines.push(`Notes: ${args.notes}`);
          lines.push(`\nTotal pending saved items: ${totalCount}`);

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${this.formatError(error)}` }] };
        }
      }
    );

    // briefing_import_read_later
    this.server.tool(
      'briefing_import_read_later',
      'Import saved URLs from the Apple Reminders "Read Later" list into the digest pipeline. Returns imported items so Claude can complete the reminders via AppleScript.',
      {},
      async () => {
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          // Use AppleScript to read reminders with notes (remindctl doesn't expose notes/body)
          // Note: body returns "missing value" as a value, not an error — test with `is not missing value`
          // Uses ||| delimiter instead of tab to avoid breakage if titles contain tabs
          const appleScript = `
            tell application "Reminders"
              set rl to list "Read Later"
              set output to ""
              repeat with r in (reminders of rl whose completed is false)
                set rName to name of r
                set rBody to ""
                try
                  set b to body of r
                  if b is not missing value then set rBody to b
                end try
                set output to output & rName & "|||" & rBody & "\\n"
              end repeat
              return output
            end tell`;

          let stdout: string;
          try {
            const result = await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`);
            stdout = result.stdout.trim();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text', text: `Error reading Read Later reminders: ${message}` }] };
          }

          if (!stdout) {
            return { content: [{ type: 'text', text: 'No open items in "Read Later" list.' }] };
          }

          const urlRegex = /https?:\/\/[^\s]+/g;
          const importedItems: any[] = [];
          const importedDetails: { title: string; url: string }[] = [];
          const needsUrl: string[] = [];

          const lines = stdout.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            const [title, notes] = line.split('|||').map((s: string) => s.trim());
            if (!title) continue;

            // Check both title and notes for URLs
            const allText = `${title} ${notes || ''}`;
            const urls = allText.match(urlRegex);

            if (!urls || urls.length === 0) {
              needsUrl.push(title);
              continue;
            }

            const url = urls[0];
            // If URL was in the title, use the notes or cleaned title as display title
            const displayTitle = notes?.match(urlRegex)
              ? title  // URL is in notes, title is clean
              : title.replace(urlRegex, '').trim() || url;  // URL is in title, clean it

            const now = new Date();
            importedItems.push({
              id: `saved:readlater:${now.getTime()}:${importedItems.length}`,
              title: displayTitle,
              body: '',
              author: '',
              date: now,
              source: { type: 'saved', id: 'saved:read-later', name: 'Read Later' },
              url,
              tags: undefined,
            });
            importedDetails.push({ title: displayTitle, url });
          }

          if (importedItems.length === 0 && needsUrl.length === 0) {
            return { content: [{ type: 'text', text: 'No items in "Read Later" list.' }] };
          }

          let newCount = 0;
          if (importedItems.length > 0) {
            newCount = await modules.appendSavedItems(importedItems);
          }

          const resultLines: string[] = [];
          resultLines.push('## Imported from Read Later\n');

          if (importedItems.length > 0) {
            resultLines.push(`**${newCount} new items** imported (${importedItems.length - newCount} duplicates skipped)\n`);
            for (const detail of importedDetails) {
              resultLines.push(`- **${detail.title}**`);
              resultLines.push(`  ${detail.url}`);
            }
          }

          if (needsUrl.length > 0) {
            resultLines.push(`\n**${needsUrl.length} item(s) need URL resolution** (title only, no URL found):\n`);
            for (const title of needsUrl) {
              resultLines.push(`- ${title}`);
            }
            resultLines.push(`\nUse web search to find URLs, then save via \`briefing_save_for_later\`.`);
          }

          // Auto-complete successfully imported reminders
          if (importedDetails.length > 0) {
            const completeTitles = importedDetails.map(d => d.title);
            const completeScript = `
              tell application "Reminders"
                set rl to list "Read Later"
                repeat with r in (reminders of rl whose completed is false)
                  set rName to name of r
                  ${completeTitles.map(t => `if rName is ${JSON.stringify(t)} then set completed of r to true`).join('\n                  ')}
                end repeat
              end tell
              "Done"`;
            try {
              await execAsync(`osascript -e '${completeScript.replace(/'/g, "'\\''")}'`);
              resultLines.push(`\n**${importedDetails.length} reminder(s) auto-completed** in Read Later.`);
            } catch {
              resultLines.push(`\n**Note:** Could not auto-complete reminders. Complete them manually via AppleScript.`);
            }
          }

          if (needsUrl.length > 0) {
            resultLines.push(`**${needsUrl.length} title-only item(s) remain open** in Read Later (need URL resolution first).`);
          }

          resultLines.push(`\nTotal pending saved items: ${await modules.getSavedItemCount()}`);

          return { content: [{ type: 'text', text: resultLines.join('\n') }] };
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
