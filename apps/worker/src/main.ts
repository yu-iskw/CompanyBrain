import { createConsoleLogger } from '@companybrain/observability';
import { createDemoPlugins, createPlatform } from '@companybrain/testing';

import { runIngestionJob } from './index';

const logger = createConsoleLogger('worker');

async function main(): Promise<void> {
  const { service, auditLog } = createPlatform(createDemoPlugins());
  await runIngestionJob(service, logger);
  logger.info('audit log verified', { intact: auditLog.verifyIntegrity() });
}

main().catch((error: unknown) => {
  logger.error('ingestion failed', { error: String(error) });
  process.exitCode = 1;
});
