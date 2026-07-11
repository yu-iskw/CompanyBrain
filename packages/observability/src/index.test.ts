import { describe, expect, it } from 'vitest';

import { createConsoleLogger, MetricsRegistry } from './index';

describe('createConsoleLogger', () => {
  it('emits single-line JSON with severity and component', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger('api', (line) => lines.push(line));
    logger.info('server started', { port: 8080 });
    logger.warn('slow query');
    logger.error('boom', { code: 'E1' });
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({
      severity: 'INFO',
      component: 'api',
      message: 'server started',
      port: 8080,
    });
    expect(parsed[1].severity).toBe('WARNING');
    expect(parsed[2]).toMatchObject({ severity: 'ERROR', code: 'E1' });
  });
});

describe('MetricsRegistry', () => {
  it('counts and snapshots', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('search_requests');
    metrics.increment('search_requests', 2);
    expect(metrics.value('search_requests')).toBe(3);
    expect(metrics.value('unknown')).toBe(0);
    expect(metrics.snapshot().get('search_requests')).toBe(3);
  });
});
