import { createInterface } from 'node:readline';

import { McpToolSet } from '@companybrain/mcp-adapter';
import { createConsoleLogger } from '@companybrain/observability';
import { createDemoPlugins, createPlatform } from '@companybrain/testing';

import { handleMessage, principalFromEnv } from './index';

const logger = createConsoleLogger('mcp-server', (line) => {
  process.stderr.write(`${line}\n`);
});

async function main(): Promise<void> {
  const principal = principalFromEnv(process.env);
  const { service } = createPlatform(createDemoPlugins());
  const ingested = await service.ingestFromCrawlers();
  const tools = new McpToolSet(service);
  logger.info('mcp server ready', { user: principal.id, ingested });
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const reply = await handleMessage(tools, principal, line);
    if (reply !== undefined) {
      process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error('mcp server failed', { error: String(error) });
  process.exitCode = 1;
});
