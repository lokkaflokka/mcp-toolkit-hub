/**
 * Personal Orchestrator MCP Server Entry Point
 */

import { PersonalOrchestratorServer } from './tools.js';

async function main(): Promise<void> {
  const server = new PersonalOrchestratorServer();
  await server.initialize();
  await server.start();
}

main().catch((error) => {
  console.error('Failed to start Personal Orchestrator:', error);
  process.exit(1);
});
