import { describe, expect, it } from 'vitest';

import { createGoogleWorkspacePlugin, toKnowledgeObject } from './index';

import type { DriveDocument } from './index';

const domainDoc: DriveDocument = {
  id: 'doc-1',
  title: 'Travel policy',
  text: 'How to book and expense business travel.',
  url: 'https://docs.google.com/document/d/doc-1',
  updatedAt: '2026-05-01T00:00:00Z',
  sharing: 'domain',
  folder: 'policies',
};

const restrictedDoc: DriveDocument = {
  id: 'doc-2',
  title: 'Board minutes',
  text: 'Confidential board meeting minutes.',
  url: 'https://docs.google.com/document/d/doc-2',
  updatedAt: '2026-05-02T00:00:00Z',
  sharing: 'restricted',
  sharedWithUsers: ['ceo'],
  sharedWithGroups: ['board'],
};

describe('google-workspace plugin', () => {
  it('maps Drive sharing to ACLs', () => {
    expect(toKnowledgeObject(domainDoc).acl.visibility).toBe('public');
    expect(toKnowledgeObject(domainDoc).metadata.get('folder')).toBe('policies');
    expect(toKnowledgeObject(restrictedDoc).acl).toEqual({
      visibility: 'restricted',
      allowedPrincipals: ['ceo'],
      allowedGroups: ['board'],
    });
  });

  it('crawls and retrieves documents', async () => {
    const plugin = createGoogleWorkspacePlugin([domainDoc, restrictedDoc]);
    expect(plugin.manifest.source).toBe('google-workspace');
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(2);
    const hits = await plugin.retriever?.retrieve({ id: 'u', groups: [] }, 'travel');
    expect(hits?.map((o) => o.ref.id)).toEqual(['doc-1']);
  });
});
