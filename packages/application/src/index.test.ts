import { AuditLog } from '@companybrain/audit';
import { denyMetadata, PolicyEngine } from '@companybrain/policy';
import { HybridRetriever } from '@companybrain/retrieval';
import { describe, expect, it } from 'vitest';

import { PluginRegistry, SearchService } from './index';

import type { AccessControlList, KnowledgeObject, Principal } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

const PUBLIC: AccessControlList = {
  visibility: 'public',
  allowedPrincipals: [],
  allowedGroups: [],
};
const alice: Principal = { id: 'alice', groups: ['engineering'] };

function makeObject(
  id: string,
  content: string,
  metadata: Map<string, string> = new Map(),
): KnowledgeObject {
  return {
    ref: { source: 'github', type: 'document', id },
    title: `Doc ${id}`,
    content,
    uri: `https://example.com/${id}`,
    updatedAt: '2026-06-01T00:00:00Z',
    metadata,
    acl: PUBLIC,
  };
}

function makePlugin(objects: KnowledgeObject[]): CompanyBrainPlugin {
  return {
    manifest: {
      name: 'github',
      version: '1.0.0',
      source: 'github',
      capabilities: ['crawler', 'webhook-handler'],
      scopes: ['github:read'],
    },
    crawler: { crawl: () => Promise.resolve(objects) },
    webhookHandler: {
      handleWebhook: (event) =>
        Promise.resolve([makeObject(String(event.payload.id), String(event.payload.content))]),
    },
  };
}

function makeService(plugins: CompanyBrainPlugin[] = [], policyEngine = new PolicyEngine()) {
  const registry = new PluginRegistry();
  for (const plugin of plugins) {
    registry.register(plugin);
  }
  const auditLog = new AuditLog();
  const service = new SearchService({
    registry,
    retriever: new HybridRetriever(() => new Date('2026-07-01T00:00:00Z')),
    policyEngine,
    auditLog,
  });
  return { service, auditLog };
}

describe('PluginRegistry', () => {
  it('registers one plugin per source', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin([]);
    registry.register(plugin);
    expect(registry.get('github')).toBe(plugin);
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register(plugin)).toThrow(/already registered/);
  });
});

describe('SearchService', () => {
  it('ingests from crawlers and searches with audit trail', async () => {
    const { service, auditLog } = makeService([
      makePlugin([makeObject('1', 'incident response runbook'), makeObject('2', 'lunch menu')]),
    ]);
    const ingested = await service.ingestFromCrawlers();
    expect(ingested).toBe(2);
    const response = service.search(alice, { text: 'incident runbook' });
    expect(response.results[0].object.ref.id).toBe('1');
    const actions = auditLog.list().map((e) => e.action);
    expect(actions).toEqual(['ingest', 'search']);
    expect(auditLog.verifyIntegrity()).toBe(true);
  });

  it('applies policy restrictions on top of source ACLs', async () => {
    const engine = new PolicyEngine();
    engine.addRule(denyMetadata('classification', 'secret'));
    const { service } = makeService(
      [
        makePlugin([
          makeObject('open', 'deployment guide'),
          makeObject('classified', 'deployment guide', new Map([['classification', 'secret']])),
        ]),
      ],
      engine,
    );
    await service.ingestFromCrawlers();
    const response = service.search(alice, { text: 'deployment guide' });
    expect(response.results.map((r) => r.object.ref.id)).toEqual(['open']);
  });

  it('supports governed point lookups and access explanations', async () => {
    const { service } = makeService([makePlugin([makeObject('1', 'api design notes')])]);
    await service.ingestFromCrawlers();
    expect(service.getObject(alice, 'github:document:1')?.title).toBe('Doc 1');
    expect(service.getObject(alice, 'github:document:404')).toBeUndefined();
    const explanation = service.explainAccess(alice, 'github:document:1');
    expect(explanation.allowed).toBe(true);
    expect(explanation.trace.some((line) => line.includes('public'))).toBe(true);
    expect(service.explainAccess(alice, 'nope:document:1').trace).toEqual([
      'object is not indexed',
    ]);
  });

  it('resolves citations with access re-checks', async () => {
    const { service } = makeService([makePlugin([makeObject('1', 'quarterly planning doc')])]);
    await service.ingestFromCrawlers();
    const response = service.search(alice, { text: 'quarterly planning' });
    const citationId = response.results[0].citation.id;
    expect(service.resolveCitation(alice, citationId)?.objectKey).toBe('github:document:1');
    expect(service.resolveCitation(alice, 'missing')).toBeUndefined();
  });

  it('applies webhook events through the source plugin', async () => {
    const { service } = makeService([makePlugin([])]);
    const changed = await service.applyWebhook('github', {
      type: 'issue.updated',
      payload: { id: '7', content: 'newly created retro notes' },
    });
    expect(changed).toBe(1);
    expect(service.search(alice, { text: 'retro notes' }).results[0].object.ref.id).toBe('7');
    await expect(service.applyWebhook('slack', { type: 'x', payload: {} })).rejects.toThrow(
      /no webhook-capable plugin/,
    );
  });

  it('lists registered sources with their capabilities', () => {
    const { service } = makeService([makePlugin([])]);
    expect(service.listSources()).toEqual([
      {
        source: 'github',
        plugin: 'github',
        version: '1.0.0',
        capabilities: ['crawler', 'webhook-handler'],
      },
    ]);
  });
});
