/**
 * Config loader for personal orchestrator
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { z } from 'zod';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'personal-orchestrator');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const PackageConfigSchema = z.object({
  path: z.string(),
  enabled: z.boolean().default(true),
});

const ConfigSchema = z.object({
  schema_version: z.string(),
  packages: z.record(z.string(), PackageConfigSchema),
  settings: z
    .object({
      tool_prefix: z.boolean().default(true),
      log_invocations: z.boolean().default(false),
    })
    .optional(),
});

export type OrchestratorConfig = z.infer<typeof ConfigSchema>;
export type PackageConfig = z.infer<typeof PackageConfigSchema>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'PARSE_ERROR' | 'VALIDATION_ERROR'
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Expand ~ to home directory in paths
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Load orchestrator config from ~/.config/personal-orchestrator/config.yaml
 */
export async function loadConfig(): Promise<OrchestratorConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = yaml.parse(content);
    const validated = ConfigSchema.parse(parsed);

    // Expand paths
    for (const [name, pkg] of Object.entries(validated.packages)) {
      validated.packages[name] = {
        ...pkg,
        path: expandPath(pkg.path),
      };
    }

    return validated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(
        `Config file not found at ${CONFIG_FILE}. Create it with your package registry.`,
        'NOT_FOUND'
      );
    }
    if (error instanceof yaml.YAMLParseError) {
      throw new ConfigError(`Invalid YAML in config: ${error.message}`, 'PARSE_ERROR');
    }
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new ConfigError(`Config validation failed: ${issues}`, 'VALIDATION_ERROR');
    }
    throw error;
  }
}

/**
 * Get enabled packages from config
 */
export function getEnabledPackages(config: OrchestratorConfig): Map<string, PackageConfig> {
  const enabled = new Map<string, PackageConfig>();
  for (const [name, pkg] of Object.entries(config.packages)) {
    if (pkg.enabled) {
      enabled.set(name, pkg);
    }
  }
  return enabled;
}
