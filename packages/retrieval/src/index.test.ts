import { describe, expect, it } from 'vitest';

import { HybridRetriever } from './index';

import type { AccessControlList, KnowledgeObject, Principal } from '@companybrain/domain';

const PUBLIC: AccessControlList = {
  visibility: 'public',
  allowedPrincipals: [],
  allowedGroups: [],
};

function makeObject(
  id: string,
  title: string,
  content: string,
  overrides: Partial<Pick<KnowledgeObject, 'acl' | 'updatedAt' | 'metadata'>> & {
    source?: string;
    type?: KnowledgeObject['ref']['type'];
  } = {},
): KnowledgeObject {
  return {
    ref: { source: overrides.source ?? 'github', type: overrides.type ?? 'document', id },
    title,
    content,
    uri: `https://example.com/${id}`,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00Z',
    metadata: overrides.metadata ?? new Map(),
    acl: overrides.acl ?? PUBLIC,
  };
}

const alice: Principal = { id: 'alice', groups: ['engineering'] };
const now = () => new Date('2026-07-01T00:00:00Z');

describe('HybridRetriever.search', () => {
  it('finds relevant documents and attaches citations', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(
      makeObject('runbook', 'Incident runbook', 'How to respond to production incidents.'),
    );
    retriever.index(makeObject('menu', 'Lunch menu', 'Pasta and salad options for the cafeteria.'));
    const results = retriever.search(alice, { text: 'production incident response' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].object.ref.id).toBe('runbook');
    expect(results[0].citation.objectKey).toBe('github:document:runbook');
    expect(results[0].citation.snippet.toLowerCase()).toContain('incident');
  });

  it('never returns objects the principal cannot access', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(
      makeObject('secret', 'Compensation bands', 'Compensation bands for all engineers.', {
        acl: { visibility: 'restricted', allowedPrincipals: [], allowedGroups: ['hr'] },
      }),
    );
    retriever.index(
      makeObject('handbook', 'Handbook', 'Compensation philosophy overview for everyone.'),
    );
    const results = retriever.search(alice, { text: 'compensation' });
    expect(results.map((r) => r.object.ref.id)).toEqual(['handbook']);
  });

  it('applies source, type, and metadata filters', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(
      makeObject('gh', 'Deploy guide', 'How we deploy services.', { source: 'github' }),
    );
    retriever.index(
      makeObject('nt', 'Deploy guide', 'How we deploy services.', { source: 'notion' }),
    );
    retriever.index(
      makeObject('tagged', 'Deploy guide', 'How we deploy services.', {
        source: 'notion',
        metadata: new Map([['team', 'platform']]),
      }),
    );
    const bySource = retriever.search(alice, { text: 'deploy', filters: { source: 'github' } });
    expect(bySource.map((r) => r.object.ref.id)).toEqual(['gh']);
    const byMetadata = retriever.search(alice, {
      text: 'deploy',
      filters: { metadata: new Map([['team', 'platform']]) },
    });
    expect(byMetadata.map((r) => r.object.ref.id)).toEqual(['tagged']);
    const byType = retriever.search(alice, { text: 'deploy', filters: { type: 'issue' } });
    expect(byType).toEqual([]);
  });

  it('boosts recent objects during reranking', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(
      makeObject('old', 'Roadmap', 'Product roadmap and milestones.', {
        updatedAt: '2020-01-01T00:00:00Z',
      }),
    );
    retriever.index(
      makeObject('new', 'Roadmap', 'Product roadmap and milestones.', {
        updatedAt: '2026-06-28T00:00:00Z',
      }),
    );
    const results = retriever.search(alice, { text: 'roadmap milestones' });
    expect(results[0].object.ref.id).toBe('new');
  });

  it('respects the result limit', () => {
    const retriever = new HybridRetriever(now);
    for (let i = 0; i < 20; i += 1) {
      retriever.index(makeObject(`doc-${i}`, `Guide ${i}`, 'kubernetes cluster operations guide'));
    }
    expect(retriever.search(alice, { text: 'kubernetes', limit: 5 })).toHaveLength(5);
  });
});

describe('HybridRetriever object access', () => {
  it('getObject enforces permissions; getObjectUnchecked does not', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(
      makeObject('secret', 'Secret', 'Restricted content.', {
        acl: { visibility: 'restricted', allowedPrincipals: ['bob'], allowedGroups: [] },
      }),
    );
    expect(retriever.getObject(alice, 'github:document:secret')).toBeUndefined();
    expect(retriever.getObjectUnchecked('github:document:secret')?.title).toBe('Secret');
    expect(retriever.getObject({ id: 'bob', groups: [] }, 'github:document:secret')?.title).toBe(
      'Secret',
    );
  });

  it('supports removal', () => {
    const retriever = new HybridRetriever(now);
    retriever.index(makeObject('a', 'Doc', 'Some content here.'));
    expect(retriever.size()).toBe(1);
    retriever.remove('github:document:a');
    expect(retriever.size()).toBe(0);
    expect(retriever.search(alice, { text: 'content' })).toEqual([]);
  });
});
