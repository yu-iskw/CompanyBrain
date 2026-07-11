import {
  InMemoryCredentialVault,
  PluginRequestError,
  type KnowledgePlugin,
} from '@company-brain/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { CompanyBrainService, PluginRegistry, type AuditEvent, type AuditSink } from './index.js';
import { SourceNotLinkedError, UnknownSourceError } from './index.js';

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

const plugin: KnowledgePlugin = {
  manifest: {
    id: 'test',
    displayName: 'Test',
    version: '1.0.0',
    credentialType: 'oauth-user-token',
    metadataStorage: 'non-sensitive-only',
  },
  explainAccess: () => ({
    sourceId: 'test',
    mode: 'delegated-user',
    summary: 'test',
    requiredScopes: [],
  }),
  search: (_request, context) =>
    Promise.resolve([
      {
        id: 'test:1',
        sourceId: 'test',
        type: 'document',
        title: 'Result',
        excerpt: `Visible to ${context.identity.subject}`,
        url: 'https://example.com/1',
        metadata: {},
        citation: {
          sourceId: 'test',
          objectId: '1',
          url: 'https://example.com/1',
          title: 'Result',
          retrievedAt: new Date().toISOString(),
        },
      },
    ]),
  getObject: () => Promise.resolve(undefined),
};

describe('CompanyBrainService', () => {
  it('rejects duplicate plugin registration', () => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow('Plugin already registered');
    expect(registry.get('test')).toBe(plugin);
    expect(registry.list()).toEqual([plugin]);
  });

  it('does not invoke an unlinked source', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    const audit = new MemoryAuditSink();
    const service = new CompanyBrainService(registry, new InMemoryCredentialVault(), audit);

    const response = await service.search({ query: 'policy' }, { subject: 'alice' });

    expect(response.results).toEqual([]);
    expect(response.failures).toEqual([
      { sourceId: 'test', code: 'not-linked', message: 'Source account is not linked' },
    ]);
    expect(audit.events[0]?.outcome).toBe('failure');
  });

  it('uses only the credential linked to the requesting subject', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    const credentials = new InMemoryCredentialVault();
    await credentials.put('alice', 'test', 'alice-token');
    const audit = new MemoryAuditSink();
    const service = new CompanyBrainService(registry, credentials, audit);

    const alice = await service.search({ query: 'policy' }, { subject: 'alice' });
    const bob = await service.search({ query: 'policy' }, { subject: 'bob' });

    expect(alice.results[0]?.excerpt).toBe('Visible to alice');
    expect(bob.failures[0]?.code).toBe('not-linked');
    expect(audit.events[0]?.queryFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit.events)).not.toContain('policy');
  });

  it('lists sources, explains access, limits results, and retrieves an object', async () => {
    const object = await plugin.search(
      { query: 'result' },
      {
        identity: { subject: 'alice' },
        accessToken: 'token',
        requestId: 'request',
      },
    );
    const completePlugin: KnowledgePlugin = {
      ...plugin,
      search: () => Promise.resolve([...object, ...object]),
      getObject: () => Promise.resolve(object[0]),
    };
    const registry = new PluginRegistry();
    registry.register(completePlugin);
    const credentials = new InMemoryCredentialVault();
    await credentials.put('alice', 'test', 'token');
    const service = new CompanyBrainService(registry, credentials, new MemoryAuditSink());

    expect(service.listSources()).toEqual([{ id: 'test', displayName: 'Test' }]);
    expect(service.explainAccess('test')?.mode).toBe('delegated-user');
    expect(service.explainAccess('missing')).toBeUndefined();
    expect(
      (await service.search({ query: 'result', limit: 1 }, { subject: 'alice' })).results,
    ).toHaveLength(1);
    expect(await service.getObject('test', '1', { subject: 'alice' })).toEqual(object[0]);
  });

  it('maps source failures without failing the whole search', async () => {
    const makeFailingService = async (error: Error): Promise<CompanyBrainService> => {
      const registry = new PluginRegistry();
      registry.register({ ...plugin, search: () => Promise.reject(error) });
      const credentials = new InMemoryCredentialVault();
      await credentials.put('alice', 'test', 'token');
      return new CompanyBrainService(registry, credentials, new MemoryAuditSink());
    };

    expect(
      (
        await (
          await makeFailingService(new PluginRequestError('rate limited', 'rate-limited'))
        ).search({ query: 'x' }, { subject: 'alice' })
      ).failures[0]?.code,
    ).toBe('rate-limited');
    expect(
      (
        await (
          await makeFailingService(new PluginRequestError('missing scope', 'forbidden'))
        ).search({ query: 'x' }, { subject: 'alice' })
      ).failures[0]?.code,
    ).toBe('forbidden');
    expect(
      (
        await (
          await makeFailingService(new Error('network down'))
        ).search({ query: 'x' }, { subject: 'alice' })
      ).failures[0]?.code,
    ).toBe('unavailable');
  });

  it('rejects unknown and unlinked object sources', async () => {
    const registry = new PluginRegistry();
    registry.register(plugin);
    const service = new CompanyBrainService(
      registry,
      new InMemoryCredentialVault(),
      new MemoryAuditSink(),
    );

    await expect(service.getObject('missing', '1', { subject: 'alice' })).rejects.toBeInstanceOf(
      UnknownSourceError,
    );
    await expect(service.getObject('test', '1', { subject: 'alice' })).rejects.toBeInstanceOf(
      SourceNotLinkedError,
    );
    await expect(
      service.search({ query: 'x', sourceIds: ['missing'] }, { subject: 'alice' }),
    ).rejects.toBeInstanceOf(UnknownSourceError);
  });
});
