import { describe, expect, it } from 'vitest';

import { buildKnowledgeObject, buildPrincipal, createInMemoryPlugin } from './index';

describe('builders', () => {
  it('builds valid defaults with overrides', () => {
    const principal = buildPrincipal({ groups: ['eng'] });
    expect(principal.id).toBe('test-user');
    expect(principal.groups).toEqual(['eng']);
    const object = buildKnowledgeObject({ ref: { id: 'x', source: 'slack' }, title: 'Thread' });
    expect(object.ref).toEqual({ source: 'slack', type: 'document', id: 'x' });
    expect(object.title).toBe('Thread');
    expect(object.acl.visibility).toBe('public');
  });
});

describe('createInMemoryPlugin', () => {
  it('serves objects through crawler and retriever', async () => {
    const objects = [
      buildKnowledgeObject({ ref: { id: '1' }, title: 'Deploy guide' }),
      buildKnowledgeObject({ ref: { id: '2' }, title: 'Holiday calendar' }),
    ];
    const plugin = createInMemoryPlugin('wiki', objects);
    expect(plugin.manifest.source).toBe('wiki');
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(2);
    const hits = await plugin.retriever?.retrieve(buildPrincipal(), 'deploy');
    expect(hits?.map((o) => o.ref.id)).toEqual(['1']);
  });
});
