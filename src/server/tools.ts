/**
 * Toolkit Hub MCP Server
 *
 * Generic plugin-based orchestrator. Discovers and registers tools from
 * domain packages via their exported manifest. No package-specific code
 * in this file — all domain logic lives in the packages themselves.
 *
 * Adding a new package:
 * 1. Create the package with src/lib/manifest.ts exporting a PackageManifest
 * 2. Add it to ~/.config/mcp-toolkit-hub/config.yaml
 * 3. Build both packages
 * That's it. No changes to this file needed.
 */

import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  loadConfig,
  getEnabledPackages,
  validatePackages,
  type OrchestratorConfig,
  type PackageValidationResult,
} from '../lib/config.js';
import type { PackageManifest } from '../lib/types.js';

const SERVER_NAME = 'mcp-toolkit-hub';
const SERVER_VERSION = '0.7.0';

interface LoadedPackage {
  manifest: PackageManifest;
  configName: string;
}

export class PersonalOrchestratorServer {
  private server: McpServer;
  private config: OrchestratorConfig | null = null;
  private configError: string | null = null;
  private packageValidation: PackageValidationResult[] = [];
  private loadedPackages: Map<string, LoadedPackage> = new Map();
  private packageLoadErrors: Map<string, string> = new Map();

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
   * Initialize the server — load config, discover packages, register tools.
   */
  async initialize(): Promise<void> {
    // Load orchestrator config
    try {
      this.config = await loadConfig();
    } catch (error) {
      this.configError = error instanceof Error ? error.message : String(error);
      console.error('Failed to load orchestrator config:', this.configError);
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

    // Load manifests from all enabled packages
    const enabledPackages = getEnabledPackages(this.config);
    for (const [name, pkg] of enabledPackages) {
      await this.loadPackageManifest(name, pkg.path);
    }

    // Register tools from all loaded manifests
    for (const [name, loaded] of this.loadedPackages) {
      this.registerPackageTools(name, loaded.manifest);
    }

    // Meta tools (always available)
    this.setupMetaTools();
    this.setupErrorHandling();
  }

  /**
   * Dynamically import a package manifest.
   * Packages export { manifest: PackageManifest } from dist/lib/manifest.js.
   */
  private async loadPackageManifest(
    name: string,
    packagePath: string
  ): Promise<void> {
    const manifestPath = path.join(
      packagePath,
      'dist',
      'lib',
      'manifest.js'
    );

    try {
      const mod = await import(manifestPath);
      const manifest: PackageManifest = mod.manifest;

      if (!manifest || !Array.isArray(manifest.tools)) {
        this.packageLoadErrors.set(
          name,
          `Package '${name}' manifest is missing or has no tools array. Check ${manifestPath}`
        );
        return;
      }

      this.loadedPackages.set(name, { manifest, configName: name });
      console.error(
        `Package '${name}' loaded: ${manifest.tools.length} tools (v${manifest.version})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.includes('Cannot find module') ||
        message.includes('ERR_MODULE_NOT_FOUND')
      ) {
        this.packageLoadErrors.set(
          name,
          `Package '${name}' not built or missing manifest.ts. Run \`npm run build\` in ${packagePath}`
        );
      } else if (message.includes('ENOENT')) {
        this.packageLoadErrors.set(
          name,
          `Package '${name}' not found at ${packagePath}. Check config path.`
        );
      } else {
        this.packageLoadErrors.set(
          name,
          `Package '${name}' failed to load: ${message}`
        );
      }

      console.error(
        `Package '${name}' load error: ${this.packageLoadErrors.get(name)}`
      );
    }
  }

  /**
   * Register all tools from a package manifest, namespaced with the config key.
   */
  private registerPackageTools(
    packageName: string,
    manifest: PackageManifest
  ): void {
    for (const tool of manifest.tools) {
      const fullName = `${packageName}_${tool.name}`;

      this.server.tool(
        fullName,
        tool.description,
        tool.schema,
        async (args) => {
          try {
            const result = await tool.handler(args);
            return { content: [{ type: 'text', text: result }] };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      );
    }
  }

  /**
   * Meta tools that are always available regardless of loaded packages.
   */
  private setupMetaTools(): void {
    // orchestrator_status — human-readable package inventory
    this.server.tool(
      'orchestrator_status',
      'Show status of the personal orchestrator: which packages are loaded and available.',
      {},
      async () => {
        const lines: string[] = [];
        lines.push('## Toolkit Hub Status\n');
        lines.push(`**Version:** ${SERVER_VERSION}`);
        lines.push(
          `**Config loaded:** ${this.config && !this.configError ? 'Yes' : 'No'}`
        );
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

            const loaded = this.loadedPackages.get(name);
            const loadError = this.packageLoadErrors.get(name);

            if (loaded) {
              lines.push(
                `- **${name}**: ✓ Loaded (v${loaded.manifest.version}, ${loaded.manifest.tools.length} tools)`
              );
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

    // orchestrator_health — structured JSON for programmatic checks
    this.server.tool(
      'orchestrator_health',
      'Aggregate health check across the toolkit hub: config status, package load status, and delegated health checks from domain packages.',
      {},
      async () => {
        const health: {
          status: 'ready' | 'degraded' | 'unhealthy';
          config: { loaded: boolean; error?: string };
          packages: Record<
            string,
            {
              enabled: boolean;
              loaded: boolean;
              version?: string;
              toolCount?: number;
              loadError?: string;
              validation?: {
                pathExists: boolean;
                distExists: boolean;
                entryPointExists: boolean;
                error?: string;
              };
              healthCheck?: any;
            }
          >;
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

        if (this.config) {
          for (const [name, pkg] of Object.entries(this.config.packages)) {
            const validation = this.packageValidation.find(
              (v) => v.name === name
            );
            const loaded = this.loadedPackages.get(name);
            const loadError = this.packageLoadErrors.get(name);

            health.packages[name] = {
              enabled: pkg.enabled,
              loaded: !!loaded,
              version: loaded?.manifest.version,
              toolCount: loaded?.manifest.tools.length,
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

            // Run delegated health check if package has one
            if (loaded?.manifest.healthCheck) {
              try {
                health.packages[name].healthCheck =
                  await loaded.manifest.healthCheck();
              } catch (error) {
                health.packages[name].healthCheck = {
                  error:
                    error instanceof Error ? error.message : String(error),
                };
              }
            }

            // Determine overall status
            if (pkg.enabled && !loaded) {
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
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Toolkit Hub MCP Server started');
  }

  async stop(): Promise<void> {
    await this.server.close();
    console.error('Toolkit Hub MCP Server stopped');
  }
}
