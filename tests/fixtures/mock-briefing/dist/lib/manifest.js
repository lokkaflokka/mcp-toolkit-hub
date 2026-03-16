/**
 * Mock manifest for testing — mimics mcp-content-feed tool structure.
 */
import { z } from 'zod';

const stubHandler = async () => 'mock response';

export const manifest = {
  name: 'mcp-content-feed',
  version: '0.0.0-test',
  tools: [
    {
      name: 'run_weekly_digest',
      description: 'Mock weekly digest',
      schema: {
        days_back: z.number().optional(),
      },
      handler: stubHandler,
    },
    {
      name: 'run_rss_digest',
      description: 'Mock RSS digest',
      schema: {},
      handler: stubHandler,
    },
    {
      name: 'content_feed_status',
      description: 'Mock status',
      schema: {},
      handler: stubHandler,
    },
    {
      name: 'health_check',
      description: 'Mock health check',
      schema: {},
      handler: stubHandler,
    },
    {
      name: 'clear_state',
      description: 'Mock clear state',
      access: 'write',
      schema: {},
      handler: stubHandler,
    },
    {
      name: 'save_for_later',
      description: 'Mock save for later',
      access: 'write',
      schema: { url: z.string() },
      handler: stubHandler,
    },
    {
      name: 'import_read_later',
      description: 'Mock import read later',
      access: 'write',
      schema: {},
      handler: stubHandler,
    },
  ],
  healthCheck: async () => ({ ok: true, details: {} }),
};
