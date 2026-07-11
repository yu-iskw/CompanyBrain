import { createDemoPlugins, createPlatform } from '@companybrain/testing';
import { describe, expect, it } from 'vitest';

import { handlePushMessage, runIngestionJob } from './index';

import type { Logger } from '@companybrain/observability';

function collectingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const push = (message: string): void => {
    messages.push(message);
  };
  return { logger: { info: push, warn: push, error: push }, messages };
}

describe('runIngestionJob', () => {
  it('crawls every source and reports a summary', async () => {
    const { service, auditLog } = createPlatform(createDemoPlugins());
    const { logger, messages } = collectingLogger();
    const summary = await runIngestionJob(service, logger);
    expect(summary.objectsIngested).toBe(6);
    expect(summary.sources).toHaveLength(5);
    expect(messages).toEqual(['ingestion started', 'ingestion finished']);
    expect(auditLog.list().filter((event) => event.action === 'ingest')).toHaveLength(5);
  });
});

describe('handlePushMessage', () => {
  it('routes Pub/Sub events to the source plugin', async () => {
    const { service } = createPlatform(createDemoPlugins());
    const { logger } = collectingLogger();
    const changed = await handlePushMessage(service, logger, {
      source: 'slack',
      eventType: 'message',
      payload: {
        thread: {
          id: 'C9-1',
          channel: '#general',
          channelVisibility: 'public',
          topic: 'All hands recap',
          messages: ['Recording is up'],
          url: 'https://slack.example.com/archives/C9/p1',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    expect(changed).toBe(1);
    const results = service.search({ id: 'anyone', groups: [] }, { text: 'all hands recap' });
    expect(results.results[0].object.ref.id).toBe('C9-1');
  });

  it('fails loudly for sources without webhook support', async () => {
    const { service } = createPlatform(createDemoPlugins());
    const { logger } = collectingLogger();
    await expect(
      handlePushMessage(service, logger, { source: 'notion', eventType: 'x', payload: {} }),
    ).rejects.toThrow(/no webhook-capable plugin/);
  });
});
