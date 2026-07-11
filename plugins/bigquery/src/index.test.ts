import { describe, expect, it } from 'vitest';

import { createBigQueryPlugin, toKnowledgeObject } from './index';

import type { BigQueryTable } from './index';

const openTable: BigQueryTable = {
  project: 'acme-analytics',
  dataset: 'core',
  table: 'orders',
  description: 'One row per customer order.',
  schemaFields: ['order_id', 'customer_id', 'total_amount'],
  updatedAt: '2026-06-15T00:00:00Z',
};

const restrictedTable: BigQueryTable = {
  project: 'acme-analytics',
  dataset: 'finance',
  table: 'payroll',
  description: 'Payroll ledger.',
  schemaFields: ['employee_id', 'salary'],
  updatedAt: '2026-06-16T00:00:00Z',
  readerGroups: ['finance'],
};

describe('bigquery plugin', () => {
  it('maps tables to knowledge objects with schema metadata only', () => {
    const object = toKnowledgeObject(openTable);
    expect(object.ref).toEqual({
      source: 'bigquery',
      type: 'table',
      id: 'acme-analytics:core:orders',
    });
    expect(object.content).toContain('order_id');
    expect(object.acl.visibility).toBe('public');
    expect(toKnowledgeObject(restrictedTable).acl.allowedGroups).toEqual(['finance']);
  });

  it('crawls, retrieves, and serves metadata', async () => {
    const plugin = createBigQueryPlugin([openTable, restrictedTable]);
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(2);
    const hits = await plugin.retriever?.retrieve({ id: 'u', groups: [] }, 'payroll');
    expect(hits?.map((o) => o.ref.id)).toEqual(['acme-analytics:finance:payroll']);
    const metadata = await plugin.metadataProvider?.getMetadata({
      source: 'bigquery',
      type: 'table',
      id: 'acme-analytics:core:orders',
    });
    expect(metadata?.get('dataset')).toBe('core');
  });
});
