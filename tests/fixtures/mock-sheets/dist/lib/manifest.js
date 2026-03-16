/**
 * Mock manifest for testing — mimics mcp-google-sheets tool structure.
 */
import { z } from 'zod';

const stubHandler = async (args) => JSON.stringify({ mock: true, args });

export const manifest = {
  name: 'mcp-google-sheets',
  version: '0.0.0-test',
  tools: [
    {
      name: 'list_sheets',
      description: 'Mock list sheets',
      schema: {
        spreadsheet_id: z.string().describe('The Google Spreadsheet ID'),
      },
      handler: stubHandler,
    },
    {
      name: 'get_data',
      description: 'Mock get data',
      schema: {
        spreadsheet_id: z.string().describe('The Google Spreadsheet ID'),
        range: z.string().describe('A1 notation range'),
      },
      handler: stubHandler,
    },
    {
      name: 'update_cells',
      description: 'Mock update cells',
      access: 'write',
      schema: {
        spreadsheet_id: z.string(),
        range: z.string(),
        values: z.array(z.array(z.string())),
      },
      handler: stubHandler,
    },
  ],
  healthCheck: async () => ({ ok: true, details: {} }),
};
