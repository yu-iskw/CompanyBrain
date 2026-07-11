import { createConsoleLogger } from '@companybrain/observability';
import { createDemoPlugins, createPlatform } from '@companybrain/testing';

import { createApiServer } from './index';

const logger = createConsoleLogger('api');
const { service } = createPlatform(createDemoPlugins());

async function main(): Promise<void> {
  const ingested = await service.ingestFromCrawlers();
  const port = Number(process.env.PORT ?? 8080);
  createApiServer(service).listen(port, () => {
    logger.info('api listening', { port, ingested });
  });
}

main().catch((error: unknown) => {
  logger.error('api failed to start', { error: String(error) });
  process.exitCode = 1;
});
