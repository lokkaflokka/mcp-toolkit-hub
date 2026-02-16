/**
 * Plugin manifest types for toolkit-hub domain packages.
 *
 * Each domain package exports a `manifest` from `src/lib/manifest.ts`.
 * The hub discovers and registers tools automatically from manifests.
 */

import { z } from 'zod';

export interface ToolDefinition {
  /** Tool name (will be prefixed with package config key, e.g., "briefing_run_weekly_digest") */
  name: string;
  /** Human-readable description shown to LLM */
  description: string;
  /** Zod schema for tool parameters (MCP SDK native format) */
  schema: Record<string, z.ZodType>;
  /** Handler that receives validated args and returns a formatted string result */
  handler: (args: any) => Promise<string>;
}

export interface PackageManifest {
  /** Package name (informational, used in status/health output) */
  name: string;
  /** Package version (from package.json) */
  version: string;
  /** Tool definitions to register */
  tools: ToolDefinition[];
  /** Optional health check for delegated diagnostics */
  healthCheck?: () => Promise<{ ok: boolean; details?: any }>;
}
