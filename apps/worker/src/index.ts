/**
 * Ingestion worker deployable. Runs as a Cloud Run job (scheduled crawls) or
 * service (Pub/Sub push webhooks): both paths funnel into the SearchService
 * so indexing and auditing stay identical across triggers.
 */
import type { SearchService } from '@companybrain/application';
import type { Logger } from '@companybrain/observability';

export interface IngestionSummary {
  readonly objectsIngested: number;
  readonly sources: readonly string[];
}

export async function runIngestionJob(
  service: SearchService,
  logger: Logger,
): Promise<IngestionSummary> {
  const sources = service.listSources().map((source) => source.source);
  logger.info('ingestion started', { sources: sources.join(',') });
  const objectsIngested = await service.ingestFromCrawlers();
  logger.info('ingestion finished', { objectsIngested });
  return { objectsIngested, sources };
}

export interface PubSubPushMessage {
  /** Source system the event belongs to (Pub/Sub message attribute). */
  readonly source: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/** Applies one source-system change event delivered via Pub/Sub. */
export async function handlePushMessage(
  service: SearchService,
  logger: Logger,
  message: PubSubPushMessage,
): Promise<number> {
  const changed = await service.applyWebhook(message.source, {
    type: message.eventType,
    payload: message.payload,
  });
  logger.info('webhook applied', { source: message.source, changed });
  return changed;
}
