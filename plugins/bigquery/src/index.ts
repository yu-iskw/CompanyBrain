/**
 * BigQuery source plugin. Indexes dataset/table metadata (schemas and
 * descriptions), never row data. Dataset IAM readers drive the ACL.
 */
import { definePlugin } from '@companybrain/plugin-sdk';

import type { AccessControlList, KnowledgeObject } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export interface BigQueryTable {
  readonly project: string;
  readonly dataset: string;
  readonly table: string;
  readonly description: string;
  readonly schemaFields: readonly string[];
  readonly updatedAt: string;
  /** Dataset-level IAM: empty means readable org-wide. */
  readonly readerPrincipals?: readonly string[];
  readonly readerGroups?: readonly string[];
}

function toAcl(table: BigQueryTable): AccessControlList {
  const principals = table.readerPrincipals ?? [];
  const groups = table.readerGroups ?? [];
  if (principals.length === 0 && groups.length === 0) {
    return { visibility: 'public', allowedPrincipals: [], allowedGroups: [] };
  }
  return {
    visibility: 'restricted',
    allowedPrincipals: [...principals],
    allowedGroups: [...groups],
  };
}

export function toKnowledgeObject(table: BigQueryTable): KnowledgeObject {
  const id = `${table.project}:${table.dataset}:${table.table}`;
  return {
    ref: { source: 'bigquery', type: 'table', id },
    title: `${table.dataset}.${table.table}`,
    content: `${table.description}\nColumns: ${table.schemaFields.join(', ')}`,
    uri: `https://console.cloud.google.com/bigquery?p=${table.project}&d=${table.dataset}&t=${table.table}`,
    updatedAt: table.updatedAt,
    metadata: new Map([
      ['project', table.project],
      ['dataset', table.dataset],
    ]),
    acl: toAcl(table),
  };
}

export function createBigQueryPlugin(tables: readonly BigQueryTable[]): CompanyBrainPlugin {
  const objects = tables.map((table) => toKnowledgeObject(table));
  return definePlugin({
    manifest: {
      name: 'bigquery',
      version: '0.1.0',
      source: 'bigquery',
      capabilities: ['crawler', 'retriever', 'metadata-provider'],
      scopes: ['bigquery:metadata:read'],
    },
    crawler: { crawl: () => Promise.resolve(objects) },
    retriever: {
      retrieve: (_principal, query) =>
        Promise.resolve(
          objects.filter((object) =>
            `${object.title} ${object.content}`.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
    },
    metadataProvider: {
      getMetadata: (ref) =>
        Promise.resolve(objects.find((object) => object.ref.id === ref.id)?.metadata),
    },
  });
}
