import { createConsoleLogger } from '@companybrain/observability';
import { CredentialBroker } from '@companybrain/plugin-sdk';

const logger = createConsoleLogger('plugin-runner');

// Deploy-time wiring: secrets are registered as Secret Manager resource
// names, and plugins to run arrive via job configuration. This entrypoint
// only proves the workload boots in isolation.
const broker = new CredentialBroker();
const configured = (process.env.COMPANYBRAIN_SECRET_SOURCES ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.includes('='));
for (const entry of configured) {
  const [source, secretRef] = entry.split('=');
  broker.registerSecret(source, secretRef);
}
logger.info('plugin runner ready', { registeredSecrets: configured.length });
