/**
 * Test fixtures and builders shared across CompanyBrain packages and apps.
 */
import { PluginRegistry, SearchService } from '@companybrain/application';
import { AuditLog } from '@companybrain/audit';
import { PUBLIC_ACL } from '@companybrain/domain';
import { createBigQueryPlugin } from '@companybrain/plugin-bigquery';
import { createGithubPlugin } from '@companybrain/plugin-github';
import { createGoogleWorkspacePlugin } from '@companybrain/plugin-google-workspace';
import { createNotionPlugin } from '@companybrain/plugin-notion';
import { definePlugin } from '@companybrain/plugin-sdk';
import { createSlackPlugin } from '@companybrain/plugin-slack';
import { PolicyEngine } from '@companybrain/policy';
import { HybridRetriever } from '@companybrain/retrieval';

import type { KnowledgeObject, Principal } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export function buildPrincipal(overrides: Partial<Principal> = {}): Principal {
  return { id: 'test-user', groups: [], ...overrides };
}

export interface KnowledgeObjectOverrides extends Partial<Omit<KnowledgeObject, 'ref'>> {
  readonly ref?: Partial<KnowledgeObject['ref']>;
}

export function buildKnowledgeObject(overrides: KnowledgeObjectOverrides = {}): KnowledgeObject {
  const ref = { source: 'test', type: 'document' as const, id: 'fixture-1', ...overrides.ref };
  return {
    title: 'Fixture document',
    content: 'Fixture content for tests.',
    uri: `https://example.com/${ref.id}`,
    updatedAt: '2026-01-01T00:00:00Z',
    metadata: new Map(),
    acl: PUBLIC_ACL,
    ...overrides,
    ref,
  };
}

/**
 * All five source plugins loaded with a small demo corpus. Used by the app
 * entrypoints for local runs and by integration tests; production replaces
 * the injected records with live source-system clients.
 */
export function createDemoPlugins(): CompanyBrainPlugin[] {
  return [
    createGithubPlugin([
      {
        kind: 'issue',
        id: 'acme/platform#101',
        title: 'Search latency regression',
        body: 'P95 search latency doubled after the reranker change.',
        url: 'https://github.com/acme/platform/issues/101',
        updatedAt: '2026-06-20T00:00:00Z',
        visibility: 'public',
        labels: ['performance'],
      },
      {
        kind: 'pull-request',
        id: 'acme/secrets#7',
        title: 'Rotate signing keys',
        body: 'Rotates production signing keys.',
        url: 'https://github.com/acme/secrets/pull/7',
        updatedAt: '2026-06-21T00:00:00Z',
        visibility: 'private',
        teamMembers: ['alice'],
      },
    ]),
    createGoogleWorkspacePlugin([
      {
        id: 'doc-travel',
        title: 'Travel policy',
        text: 'How to book and expense business travel.',
        url: 'https://docs.google.com/document/d/doc-travel',
        updatedAt: '2026-05-01T00:00:00Z',
        sharing: 'domain',
      },
    ]),
    createSlackPlugin([
      {
        id: 'C1-1720000000',
        channel: '#incidents',
        channelVisibility: 'public',
        topic: 'Database failover',
        messages: ['Primary is down', 'Failover completed at 12:04'],
        url: 'https://slack.example.com/archives/C1/p1720000000',
        updatedAt: '2026-06-10T00:00:00Z',
      },
    ]),
    createNotionPlugin([
      {
        id: 'page-onboarding',
        title: 'Onboarding guide',
        text: 'Laptop setup, accounts, and the onboarding checklist.',
        url: 'https://notion.so/page-onboarding',
        updatedAt: '2026-06-01T00:00:00Z',
        access: 'workspace',
      },
    ]),
    createBigQueryPlugin([
      {
        project: 'acme-analytics',
        dataset: 'core',
        table: 'orders',
        description: 'One row per customer order.',
        schemaFields: ['order_id', 'customer_id', 'total_amount'],
        updatedAt: '2026-06-15T00:00:00Z',
      },
    ]),
  ];
}

export interface Platform {
  readonly service: SearchService;
  readonly auditLog: AuditLog;
  readonly policyEngine: PolicyEngine;
}

/** Wires a full platform (registry, retriever, policy, audit) from plugins. */
export function createPlatform(plugins: readonly CompanyBrainPlugin[]): Platform {
  const registry = new PluginRegistry();
  for (const plugin of plugins) {
    registry.register(plugin);
  }
  const auditLog = new AuditLog();
  const policyEngine = new PolicyEngine();
  const service = new SearchService({
    registry,
    retriever: new HybridRetriever(),
    policyEngine,
    auditLog,
  });
  return { service, auditLog, policyEngine };
}

/** In-memory plugin serving a fixed object set (crawler + retriever). */
export function createInMemoryPlugin(
  source: string,
  objects: readonly KnowledgeObject[],
): CompanyBrainPlugin {
  return definePlugin({
    manifest: {
      name: source,
      version: '0.0.1',
      source,
      capabilities: ['crawler', 'retriever'],
      scopes: [`${source}:read`],
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
  });
}
